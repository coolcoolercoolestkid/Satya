/**
 * The expiry claim, end to end: signed credential in, verified Groth16 proof out.
 *
 * The mirror of `age.ts` and `nationality.ts`. Public signal order is the contract between
 * this package, AletheiaVerifier and the subgraph; it is the same nine-signal layout the
 * other claims use, with the generic parameter slot carrying `expiryParameter`, pinned to
 * zero in-circuit. Fixed by the declaration order in expiry.circom, asserted by test, and
 * documented in docs/public-signals.md.
 *
 * This is the thinnest claim of the three: the statement it proves — that the credential is
 * unexpired as of `currentDate` — is the `expiryDate >= currentDate` check every claim
 * already inherits from the shared base, so expiry adds nothing of its own. A successful
 * proof discloses only that the credential was valid on the date asked about; the expiry
 * date itself never leaves the witness.
 */

import { SCHEMA_VERSION, type SignedCredential } from "@aletheia/credential";

import { EXPIRY_CLAIM, expiryClaimInput, type ExpiryClaimRequest } from "./inputs.ts";
import {
  EXPIRY_PUBLIC_SIGNALS,
  decodeExpiryPublicSignals,
  type ExpiryPublicSignals,
} from "./expiry-signals.ts";
import { prove, verify, type Groth16Proof, type ProofResult } from "./prove.ts";

// Re-exported so the barrel's surface stays consistent with age's and nationality's.
export { EXPIRY_PUBLIC_SIGNALS, decodeExpiryPublicSignals, type ExpiryPublicSignals };

export interface ExpiryClaimProof extends ProofResult {
  decoded: ExpiryPublicSignals;
}

/** Prove an expiry claim. The returned proof has already been verified locally. */
export async function proveExpiryClaim(
  signed: SignedCredential,
  request: ExpiryClaimRequest,
): Promise<ExpiryClaimProof> {
  const result = await prove(EXPIRY_CLAIM.circuit, expiryClaimInput(signed, request));
  const decoded = decodeExpiryPublicSignals(result.publicSignals);

  // The proof is only meaningful if the public signals say what the caller asked. A
  // mismatch here would mean the input builder and the circuit disagree.
  if (decoded.currentDate !== request.currentDate) {
    throw new Error("public signals do not match the requested claim");
  }
  // The circuit pins the parameter slot to zero; a non-zero value would mean the compiled
  // artifacts are not the ones this package expects.
  if (decoded.expiryParameter !== 0) {
    throw new Error(`proof carries a non-zero expiryParameter (${decoded.expiryParameter})`);
  }
  // The circuit pins this too, so a mismatch means the compiled artifacts are from a
  // different schema version than this package expects.
  if (decoded.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `proof declares schemaVersion ${decoded.schemaVersion}, expected ${SCHEMA_VERSION}`,
    );
  }
  return { ...result, decoded };
}

export async function verifyExpiryClaim(
  publicSignals: readonly string[],
  proof: Groth16Proof,
): Promise<boolean> {
  return verify(EXPIRY_CLAIM.circuit, publicSignals, proof);
}
