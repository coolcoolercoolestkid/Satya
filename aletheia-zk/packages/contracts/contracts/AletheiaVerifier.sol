// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

import {AletheiaIssuerRegistry} from "./AletheiaIssuerRegistry.sol";
import {DateLib} from "./lib/DateLib.sol";

/// @dev The snarkjs-generated verifier for a 9-signal circuit (see AgeClaim, schema v2).
interface IGroth16Verifier9 {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[9] calldata publicSignals
    ) external view returns (bool);
}

/**
 * @title AletheiaVerifier
 * @notice The only place in Aletheia where a claim becomes true.
 *
 * A Groth16 proof establishes exactly one thing: that someone knows a witness satisfying
 * the circuit. Everything else a verifier cares about — that the issuer is one we
 * recognise, that the prover is the wallet submitting the transaction, that the date is
 * current, that the threshold is in range, that this credential has not already been used
 * for this question — is checked here, because a proof cannot check any of it.
 *
 * There is deliberately no `bool result` anywhere in this contract. An invalid proof
 * reverts, so no record can exist that says a claim failed or that a claim is unverified.
 * Every `ClaimVerified` event is a claim that was actually proven.
 *
 * Nothing private is accepted or stored. The inputs are the proof and its public
 * signals, and the public signals contain no credential field — see
 * `docs/public-signals.md`.
 */
contract AletheiaVerifier is Ownable2Step {
    uint8 public constant CLAIM_TYPE_AGE = 1;
    uint8 public constant CLAIM_TYPE_NATIONALITY = 2;
    uint8 public constant CLAIM_TYPE_EXPIRY = 3;

    /// @dev Matches `MAX_MINIMUM_AGE` in packages/credential and the circuit's range check.
    uint256 public constant MAX_MINIMUM_AGE = 120;

    /// @dev Matches `MAX_COUNTRY_CODE` in packages/credential: ISO 3166-1 numeric codes are
    /// at most three digits. The circuit range-checks `requiredNationality` to 16 bits and
    /// forces it equal to the signed nationality, so a real proof from a registered issuer
    /// always carries a valid code; this bound stops a nonsensical parameter being recorded
    /// even if a future circuit forgot to, the same role `MAX_MINIMUM_AGE` plays for age.
    uint256 public constant MAX_NATIONALITY_CODE = 999;

    /// @dev An expiry claim has no parameter of its own: the circuit pins the generic
    /// parameter slot (`publicSignals[6]`, `expiryParameter`) to zero, so the only value a
    /// real proof can carry there is `0`. Passing this as the maximum makes the shared
    /// range check enforce exactly that — any non-zero value reverts
    /// `ClaimParameterOutOfRange` — so a proof cannot smuggle a non-zero parameter into an
    /// expiry record even though it decodes through the same nine-signal shape as age.
    uint256 public constant MAX_EXPIRY_PARAMETER = 0;

    /**
     * @dev The single credential schema version this deployment serves.
     *
     * The circuit pins `schemaVersion` to its compiled constant, so a v2 proof cannot
     * carry any other value and the contract cannot be fooled into decoding a v1 layout
     * as a v2 one. The check exists so a proof for the wrong schema is refused with a
     * named error rather than failing an ABI decode or a pairing check, and so the two
     * schema versions can never be live on one deployed verifier — see
     * `docs/credential-schema.md`. It is a `uint16`, matching `MAX_SCHEMA_VERSION` in
     * packages/credential.
     */
    uint16 public constant SUPPORTED_SCHEMA_VERSION = 2;

    AletheiaIssuerRegistry public immutable issuerRegistry;

    /// @notice Claim type to the Groth16 verifier that decides it.
    mapping(uint8 claimType => address verifier) public claimVerifier;

    /**
     * @notice Verification ids already used.
     * @dev Keyed by `keccak256(claimType, contextId, nullifier)`: the same credential can
     * answer the same question for two different verifiers, but not twice for one.
     */
    mapping(bytes32 verificationId => bool) public verificationUsed;

    /**
     * @notice A claim that was proven on-chain.
     * @param verificationId `keccak256(claimType, contextId, nullifier)`, unique per record
     * @param subject the wallet that proved it, which is always `msg.sender`
     * @param claimType 1 age, 2 nationality, 3 expiry
     * @param issuerId the registry id of the issuer whose signature the proof used
     * @param claimParameter the question's parameter, e.g. the age threshold
     * @param credentialValidOn the date the credential was proven unexpired on, YYYYMMDD
     * @param contextId the verifier scope the proof was bound to
     * @param nullifier per credential, claim type and context; makes replay detectable
     * @param identityNullifier `Poseidon(identitySecret, contextId)`; stable across every
     * credential and wallet one identity proves with in this context, and unrelated across
     * contexts. A per-context correlation handle by design — see `docs/trust-model.md`.
     */
    event ClaimVerified(
        bytes32 indexed verificationId,
        address indexed subject,
        uint8 indexed claimType,
        bytes32 issuerId,
        uint256 claimParameter,
        uint32 credentialValidOn,
        bytes32 contextId,
        bytes32 nullifier,
        bytes32 identityNullifier,
        uint64 verifiedAt
    );

    event ClaimVerifierSet(uint8 indexed claimType, address indexed verifier);

    error NoVerifierForClaim(uint8 claimType);
    error SchemaVersionNotSupported(uint256 submitted, uint16 supported);
    error SubjectIsNotSender(address subject, address sender);
    error DateNotCurrent(uint32 submitted, uint32 today);
    error ClaimParameterOutOfRange(uint256 parameter, uint256 maximum);
    error VerificationAlreadyRecorded(bytes32 verificationId);
    error InvalidProof();
    error InvalidVerifierAddress();

    constructor(address initialOwner, AletheiaIssuerRegistry registry) Ownable(initialOwner) {
        issuerRegistry = registry;
    }

    /**
     * @notice Point a claim type at its Groth16 verifier.
     * @dev Needed because a new trusted setup produces a new verifier contract. This is
     * real authority: whoever owns this contract chooses what "verified" means, which is
     * why it is `Ownable2Step` and why every change is an indexed event.
     */
    function setClaimVerifier(uint8 claimType, address verifier) external onlyOwner {
        if (verifier == address(0)) revert InvalidVerifierAddress();
        claimVerifier[claimType] = verifier;
        emit ClaimVerifierSet(claimType, verifier);
    }

    /**
     * @notice Prove an age claim: the holder of an issuer-signed, unexpired credential is
     * at least `publicSignals[6]` years old.
     *
     * Public signals, in the nine-signal v2 order frozen in `docs/public-signals.md`:
     * `[nullifier, identityNullifier, schemaVersion, issuerAx, issuerAy, currentDate,
     * minimumAge, contextId, subject]`.
     *
     * Reverts unless everything holds. There is no partial success.
     */
    function submitAgeClaim(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[9] calldata publicSignals
    ) external returns (bytes32 verificationId) {
        return _submitClaim(CLAIM_TYPE_AGE, MAX_MINIMUM_AGE, a, b, c, publicSignals);
    }

    /**
     * @notice Prove a nationality claim: the holder of an issuer-signed, unexpired
     * credential holds nationality `publicSignals[6]` (an ISO 3166-1 numeric code).
     *
     * Public signals, in the same nine-signal v2 order age uses, with the generic
     * claim-parameter slot carrying `requiredNationality` instead of `minimumAge`:
     * `[nullifier, identityNullifier, schemaVersion, issuerAx, issuerAy, currentDate,
     * requiredNationality, contextId, subject]` — see `docs/public-signals.md`.
     *
     * Unlike age, a successful nationality proof discloses the value asked about: it tells
     * the verifier the holder's nationality is exactly `requiredNationality`. The holder is
     * shown that before proving (the frontend disclosure notice). Everything else is
     * identical to age, because both claims share the same on-chain guards.
     *
     * Reverts unless everything holds. There is no partial success.
     */
    function submitNationalityClaim(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[9] calldata publicSignals
    ) external returns (bytes32 verificationId) {
        return _submitClaim(CLAIM_TYPE_NATIONALITY, MAX_NATIONALITY_CODE, a, b, c, publicSignals);
    }

    /**
     * @notice Prove an expiry claim: the holder of an issuer-signed credential that was
     * still valid — not expired — as of `publicSignals[5]` (`currentDate`).
     *
     * Public signals, in the same nine-signal v2 order age and nationality use, with the
     * generic claim-parameter slot pinned to zero (`expiryParameter`, which an expiry claim
     * has no use for):
     * `[nullifier, identityNullifier, schemaVersion, issuerAx, issuerAy, currentDate,
     * expiryParameter, contextId, subject]` — see `docs/public-signals.md`.
     *
     * This is the thinnest claim: the unexpired check every claim already runs
     * (`expiryDate >= currentDate`) is the whole statement, so an expiry proof discloses only
     * that the credential was valid on the date asked about — never the expiry date itself.
     * The parameter bound is zero, so the shared range check rejects any non-zero parameter.
     *
     * Reverts unless everything holds. There is no partial success.
     */
    function submitExpiryClaim(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[9] calldata publicSignals
    ) external returns (bytes32 verificationId) {
        return _submitClaim(CLAIM_TYPE_EXPIRY, MAX_EXPIRY_PARAMETER, a, b, c, publicSignals);
    }

    /**
     * @dev The one place a claim is verified and recorded, shared by every claim type.
     *
     * Age, nationality and expiry differ only in which verifier decides them, the claim type
     * bound into the nullifier and event, and the maximum their generic parameter may take
     * (age `MAX_MINIMUM_AGE`, nationality `MAX_NATIONALITY_CODE`, expiry `0`); everything that
     * makes a proof mean anything — the schema pin, the sender binding, the date-currency
     * check, the issuer-registry check, the reserve-before-verify ordering — is identical, so
     * it lives here once rather than being copied per claim and risking one copy drifting. `publicSignals` is decoded by the nine-signal v2 index order frozen
     * in `docs/public-signals.md`; the parameter slot's meaning is the only thing that
     * changes between claim types, and it is never trusted beyond its range and the proof.
     */
    function _submitClaim(
        uint8 claimType,
        uint256 maxParameter,
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[9] calldata publicSignals
    ) private returns (bytes32 verificationId) {
        address verifier = claimVerifier[claimType];
        if (verifier == address(0)) revert NoVerifierForClaim(claimType);

        // Refuse a proof for a schema this deployment does not serve. The circuit pins
        // this signal, so a real v2 proof always carries 2; anything else — a padded v1
        // proof, a future schema — is rejected here with a named error rather than
        // reaching the verifier and failing an opaque pairing check.
        if (publicSignals[2] != SUPPORTED_SCHEMA_VERSION) {
            revert SchemaVersionNotSupported(publicSignals[2], SUPPORTED_SCHEMA_VERSION);
        }

        // The proof binds the holder's address into both the signed credential and the
        // nullifier. Requiring it to equal msg.sender is what makes a stolen proof
        // useless to anyone else.
        if (publicSignals[8] != uint256(uint160(msg.sender))) {
            revert SubjectIsNotSender(address(uint160(publicSignals[8])), msg.sender);
        }

        // Checked here as well as in the circuit. The circuit's range check stops field
        // wraparound from forging the parameter; this stops a nonsensical value being
        // recorded even if a future circuit forgot to.
        if (publicSignals[6] > maxParameter) {
            revert ClaimParameterOutOfRange(publicSignals[6], maxParameter);
        }

        uint32 credentialValidOn = _requireCurrentDate(publicSignals[5]);
        bytes32 issuerId = issuerRegistry.requireActive(publicSignals[3], publicSignals[4]);

        verificationId = _reserve(claimType, publicSignals[7], publicSignals[0]);

        if (!IGroth16Verifier9(verifier).verifyProof(a, b, c, publicSignals)) {
            revert InvalidProof();
        }

        emit ClaimVerified(
            verificationId,
            msg.sender,
            claimType,
            issuerId,
            publicSignals[6],
            credentialValidOn,
            bytes32(publicSignals[7]),
            bytes32(publicSignals[0]),
            bytes32(publicSignals[1]),
            uint64(block.timestamp)
        );
    }

    function verificationIdFor(uint8 claimType, uint256 contextId, uint256 nullifier)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(claimType, contextId, nullifier));
    }

    /// @notice Today's date in UTC, as the contract sees it.
    function today() public view returns (uint32) {
        return DateLib.toYyyymmdd(block.timestamp);
    }

    /**
     * @dev Accept only today or yesterday in UTC.
     *
     * `block.timestamp` is the one clock a holder cannot choose, so this is what stops a
     * proof built against a date that suits the prover. Yesterday is allowed because a
     * proof takes time to generate and can be submitted across midnight; a wider window
     * would let a revoked or expired credential keep working.
     */
    function _requireCurrentDate(uint256 submitted) private view returns (uint32) {
        uint32 currentDate = uint32(submitted);
        // Reject before truncation loses information, rather than after.
        if (submitted != uint256(currentDate)) revert DateNotCurrent(0, today());

        uint32 todayUtc = DateLib.toYyyymmdd(block.timestamp);
        uint32 yesterdayUtc = DateLib.toYyyymmdd(block.timestamp - 1 days);
        if (currentDate != todayUtc && currentDate != yesterdayUtc) {
            revert DateNotCurrent(currentDate, todayUtc);
        }
        return currentDate;
    }

    /**
     * @dev Claim the verification id before verifying the proof.
     *
     * Ordering is deliberate: the verifier is an external contract set by the owner, and
     * marking the id used first means it cannot re-enter this function and record the
     * same verification twice. A failed proof reverts, so nothing is burned.
     */
    function _reserve(uint8 claimType, uint256 contextId, uint256 nullifier)
        private
        returns (bytes32 verificationId)
    {
        verificationId = verificationIdFor(claimType, contextId, nullifier);
        if (verificationUsed[verificationId]) {
            revert VerificationAlreadyRecorded(verificationId);
        }
        verificationUsed[verificationId] = true;
    }
}
