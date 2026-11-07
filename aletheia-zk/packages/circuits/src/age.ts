/**
 * The age claim, end to end: signed credential in, verified Groth16 proof out.
 *
 * Public signal order is the contract between this package, AletheiaVerifier and the
 * subgraph. It is fixed by the declaration order in age.circom, asserted by test, and
 * documented in docs/public-signals.md. Decoding it by name here means no other layer
 * has to index into an array of decimal strings and hope.
 */

import { SCHEMA_VERSION, type SignedCredential } from "@aletheia/credential";

import { AGE_CLAIM, ageClaimInput, type AgeClaimRequest } from "./inputs.ts";
import {
  AGE_PUBLIC_SIGNALS,
  decodeAgePublicSignals,
  type AgePublicSignals,
} from "./signals.ts";
import { prove, verify, type Groth16Proof, type ProofResult } from "./prove.ts";

// Re-exported so the barrel's surface is unchanged after the signals split.
export { AGE_PUBLIC_SIGNALS, decodeAgePublicSignals, type AgePublicSignals };

export interface AgeClaimProof extends ProofResult {
  decoded: AgePublicSignals;
}

/** Prove an age claim. The returned proof has already been verified locally. */
export async function proveAgeClaim(
  signed: SignedCredential,
  request: AgeClaimRequest,
): Promise<AgeClaimProof> {
  const result = await prove(AGE_CLAIM.circuit, ageClaimInput(signed, request));
  const decoded = decodeAgePublicSignals(result.publicSignals);

  // The proof is only meaningful if the public signals say what the caller asked. A
  // mismatch here would mean the input builder and the circuit disagree.
  if (decoded.minimumAge !== request.minimumAge || decoded.currentDate !== request.currentDate) {
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

export async function verifyAgeClaim(
  publicSignals: readonly string[],
  proof: Groth16Proof,
): Promise<boolean> {
  return verify(AGE_CLAIM.circuit, publicSignals, proof);
}
