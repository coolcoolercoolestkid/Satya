/**
 * The nationality claim, end to end: signed credential in, verified Groth16 proof out.
 *
 * The mirror of `age.ts`. Public signal order is the contract between this package,
 * AletheiaVerifier and the subgraph; it is the same nine-signal layout age uses, with the
 * generic parameter slot carrying `requiredNationality`. Fixed by the declaration order in
 * nationality.circom, asserted by test, and documented in docs/public-signals.md.
 */

import { SCHEMA_VERSION, type SignedCredential } from "@aletheia/credential";

import {
  NATIONALITY_CLAIM,
  nationalityClaimInput,
  type NationalityClaimRequest,
} from "./inputs.ts";
import {
  NATIONALITY_PUBLIC_SIGNALS,
  decodeNationalityPublicSignals,
  type NationalityPublicSignals,
} from "./nationality-signals.ts";
import { prove, verify, type Groth16Proof, type ProofResult } from "./prove.ts";

// Re-exported so the barrel's surface stays consistent with age's.
export { NATIONALITY_PUBLIC_SIGNALS, decodeNationalityPublicSignals, type NationalityPublicSignals };

export interface NationalityClaimProof extends ProofResult {
  decoded: NationalityPublicSignals;
}

/** Prove a nationality claim. The returned proof has already been verified locally. */
export async function proveNationalityClaim(
  signed: SignedCredential,
  request: NationalityClaimRequest,
): Promise<NationalityClaimProof> {
  const result = await prove(NATIONALITY_CLAIM.circuit, nationalityClaimInput(signed, request));
  const decoded = decodeNationalityPublicSignals(result.publicSignals);

  // The proof is only meaningful if the public signals say what the caller asked. A
  // mismatch here would mean the input builder and the circuit disagree.
  if (
    decoded.requiredNationality !== request.requiredNationality ||
    decoded.currentDate !== request.currentDate
  ) {
    throw new Error("public signals do not match the requested claim");
  }
  // The circuit pins this, so a mismatch means the compiled artifacts are from a
  // different schema version than this package expects.
  if (decoded.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `proof declares schemaVersion ${decoded.schemaVersion}, expected ${SCHEMA_VERSION}`,
    );
  }
  return { ...result, decoded };
}

export async function verifyNationalityClaim(
  publicSignals: readonly string[],
  proof: Groth16Proof,
): Promise<boolean> {
  return verify(NATIONALITY_CLAIM.circuit, publicSignals, proof);
}
