// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AletheiaVerifier} from "../AletheiaVerifier.sol";

/**
 * @title ReserveOrderingProbe
 * @notice Test-only adversarial verifier that pins one ordering property of
 * `AletheiaVerifier`: a nullifier is marked used *before* the external verifier is
 * called.
 *
 * That ordering is the contract's reentrancy defence. The verifier is set by the owner
 * and is therefore untrusted; if it could re-enter `submitAgeClaim` before the id was
 * reserved, it could record the same verification twice. Reserving first makes the id
 * already-used by the time control reaches the external call.
 *
 * This contract stands in for the Groth16 verifier. When `submitAgeClaim` calls
 * `verifyProof`, the probe reads back whether the verification id has already been
 * reserved and reverts carrying that observation. It never returns `true`: no simulated
 * proof success ever enters the real submit path — the transaction always reverts, and
 * the test asserts on the observed value alone.
 *
 * Not part of the protocol and never deployed to a public network.
 */
contract ReserveOrderingProbe {
    AletheiaVerifier public immutable aletheia;

    uint8 private constant CLAIM_TYPE_AGE = 1;

    /// @param reserved whether the verification id was already reserved when the external
    /// verifier was called. Must be true for the reentrancy defence to hold.
    error ReservedBeforeVerify(bool reserved);

    constructor(AletheiaVerifier verifier) {
        aletheia = verifier;
    }

    /**
     * @dev Signature matches `IGroth16Verifier9.verifyProof`. Called by `submitAgeClaim`
     * via staticcall (the interface method is `view`), so this reads chain state and
     * reverts rather than writing anything.
     */
    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[9] calldata publicSignals
    ) external view returns (bool) {
        bytes32 verificationId = aletheia.verificationIdFor(
            CLAIM_TYPE_AGE,
            publicSignals[7],
            publicSignals[0]
        );
        revert ReservedBeforeVerify(aletheia.verificationUsed(verificationId));
    }
}
