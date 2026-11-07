// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title AletheiaIssuerRegistry
 * @notice Which issuer keys the protocol recognises, and which are still active.
 *
 * A proof carries its issuer's BabyJubjub public key as a public signal. The circuit
 * proves the credential was signed by *that* key; it cannot know whether the key belongs
 * to an issuer anyone should believe. This registry is where that question is answered,
 * on-chain and independently of any proof.
 *
 * Keeping issuer keys here rather than baked into circuits is what makes rotation and
 * revocation possible without a recompile, a new trusted setup and a new verifier
 * deployment.
 *
 * Every entry carries a plain-text label, and Phase 1's only issuer is labelled
 * `mock-dev`. That label is indexed and surfaced in every record: a mock-issued
 * verification must never be mistakable for a government-issued one.
 */
contract AletheiaIssuerRegistry is Ownable2Step {
    struct Issuer {
        uint256 ax;
        uint256 ay;
        bool active;
        /// @dev Free text, e.g. "mock-dev". Not trusted for anything; it is a label.
        string label;
        /// @dev Non-zero once registered, so absence is distinguishable from inactivity.
        uint64 registeredAt;
    }

    mapping(bytes32 issuerId => Issuer) private _issuers;

    event IssuerRegistered(
        bytes32 indexed issuerId, uint256 ax, uint256 ay, string label, uint64 registeredAt
    );
    event IssuerActiveSet(bytes32 indexed issuerId, bool active);

    error IssuerAlreadyRegistered(bytes32 issuerId);
    error IssuerNotRegistered(bytes32 issuerId);
    error IssuerNotActive(bytes32 issuerId);
    error InvalidIssuerKey();

    constructor(address initialOwner) Ownable(initialOwner) {}

    /**
     * @notice Deterministic id for an issuer key pair.
     * @dev Derived from the key itself, so the same key always has the same id and two
     * entries for one key are impossible.
     */
    function issuerId(uint256 ax, uint256 ay) public pure returns (bytes32) {
        return keccak256(abi.encode(ax, ay));
    }

    function register(uint256 ax, uint256 ay, string calldata label)
        external
        onlyOwner
        returns (bytes32 id)
    {
        // A zero key is not a point anyone can sign with, and would silently match an
        // unset public signal.
        if (ax == 0 && ay == 0) revert InvalidIssuerKey();

        id = issuerId(ax, ay);
        if (_issuers[id].registeredAt != 0) revert IssuerAlreadyRegistered(id);

        uint64 registeredAt = uint64(block.timestamp);
        _issuers[id] =
            Issuer({ax: ax, ay: ay, active: true, label: label, registeredAt: registeredAt});
        emit IssuerRegistered(id, ax, ay, label, registeredAt);
    }

    /// @notice Revoke or restore an issuer. Existing records are unaffected by design:
    /// they were true when they were made, and rewriting history would be a lie.
    function setActive(bytes32 id, bool active) external onlyOwner {
        if (_issuers[id].registeredAt == 0) revert IssuerNotRegistered(id);
        _issuers[id].active = active;
        emit IssuerActiveSet(id, active);
    }

    function issuer(bytes32 id) external view returns (Issuer memory) {
        return _issuers[id];
    }

    /**
     * @notice Resolve a key to its id, requiring that it is registered and active.
     * @dev Reverts rather than returning false so a caller cannot ignore the result.
     */
    function requireActive(uint256 ax, uint256 ay) external view returns (bytes32 id) {
        id = issuerId(ax, ay);
        Issuer storage entry = _issuers[id];
        if (entry.registeredAt == 0) revert IssuerNotRegistered(id);
        if (!entry.active) revert IssuerNotActive(id);
    }
}
