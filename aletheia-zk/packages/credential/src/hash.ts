/**
 * Poseidon hashing for Aletheia: the issuer-signed credential message and the claim
 * nullifier.
 *
 * Both layouts are reproduced constraint-for-constraint inside the circuits, and the
 * circuit is the authority. These functions exist so the issuer, the witness builder and
 * the tests agree with it; a mismatch shows up as an unsatisfiable circuit, which is why
 * the layouts below are frozen and pinned by fixture.
 */

import { buildPoseidon, type Poseidon } from "circomlibjs";

import type { ClaimTypeId } from "./constants.ts";
import { assertNormalizedCredential, type NormalizedCredential } from "./credential.ts";
import { addressToField, assertFieldElement } from "./field.ts";

let poseidonPromise: Promise<Poseidon> | undefined;

/** The Poseidon instance, built once per process. */
async function poseidon(): Promise<Poseidon> {
  poseidonPromise ??= buildPoseidon();
  return poseidonPromise;
}

/** Hash a list of field elements with circomlib's Poseidon, returning a `bigint`. */
export async function poseidonHash(
  inputs: readonly bigint[],
): Promise<bigint> {
  if (inputs.length === 0 || inputs.length > 16) {
    throw new RangeError(`Poseidon takes 1 to 16 inputs, got ${inputs.length}`);
  }
  inputs.forEach((input, index) => assertFieldElement(input, `input[${index}]`));
  const instance = await poseidon();
  return instance.F.toObject(instance(inputs));
}

/**
 * The message an issuer signs. Field order is normative and versioned by
 * `schemaVersion`, which is itself the first input:
 *
 *   Poseidon([schemaVersion, credentialId, subject, dateOfBirth, nationality,
 *             expiryDate, issuedAt, identitySecret])
 *
 * Binding `subject` into the signed message is what stops a credential being used from
 * another wallet. `identitySecret` is signed rather than holder-supplied so that the
 * issuer, not the prover, decides which credentials share one.
 */
export async function credentialMessageHash(
  credential: NormalizedCredential,
): Promise<bigint> {
  assertNormalizedCredential(credential);
  return poseidonHash([
    BigInt(credential.schemaVersion),
    credential.credentialId,
    addressToField(credential.subject),
    BigInt(credential.dateOfBirth),
    BigInt(credential.nationality),
    BigInt(credential.expiryDate),
    BigInt(credential.issuedAt),
    credential.identitySecret,
  ]);
}

export interface NullifierInput {
  /** Private, from the credential. */
  credentialId: bigint;
  /** Which claim was proven. */
  claimTypeId: ClaimTypeId;
  /** Verifier-chosen scope, reduced into the field by `hashToField`. */
  contextId: bigint;
  /** The proving wallet, as a hex address. */
  subject: string;
}

/**
 * The public nullifier a claim circuit outputs:
 *
 *   Poseidon([credentialId, claimTypeId, contextId, subject])
 *
 * It does three jobs at once. It lets the contract reject a repeat of the same claim in
 * the same context without learning anything about the credential; it binds the proof to
 * one wallet and one claim, so a proof cannot be lifted elsewhere; and because
 * `credentialId` is private and high-entropy, records for the same credential under
 * different verifier contexts cannot be linked to each other.
 */
export async function claimNullifier(input: NullifierInput): Promise<bigint> {
  assertFieldElement(input.credentialId, "credentialId");
  assertFieldElement(input.contextId, "contextId");
  return poseidonHash([
    input.credentialId,
    BigInt(input.claimTypeId),
    input.contextId,
    addressToField(input.subject),
  ]);
}

export interface IdentityNullifierInput {
  /** Private, from the credential. Issuer-derived and document-bound. */
  identitySecret: bigint;
  /** Verifier-chosen scope, reduced into the field by `hashToField`. */
  contextId: bigint;
}

/**
 * The second public nullifier every claim circuit outputs:
 *
 *   Poseidon([identitySecret, contextId])
 *
 * Note what is *not* in it. No `credentialId`, so it survives re-issuance; no `subject`,
 * so it survives a change of wallet; no `claimTypeId`, so it is the same value across
 * every claim the holder proves to one verifier.
 *
 * What it establishes, exactly: two proofs carrying the same value were built from
 * credentials the issuer gave the same `identitySecret`, within the same `contextId`.
 * Different contexts yield unrelated values, so it cannot correlate a holder across
 * verifiers, and Poseidon's preimage resistance keeps `identitySecret` unrecoverable
 * from it.
 *
 * What it does not establish — see docs/trust-model.md, and do not weaken this wording:
 * it is not proof of a distinct human, and it is not Sybil resistance. `identitySecret`
 * is issuer- and document-bound, so it inherits every limit of the issuer that derived
 * it. Under the Phase 1 mock issuer, which verifies nothing and runs on the holder's own
 * machine, it establishes no real-world uniqueness whatsoever.
 */
export async function identityNullifier(input: IdentityNullifierInput): Promise<bigint> {
  assertFieldElement(input.identitySecret, "identitySecret");
  assertFieldElement(input.contextId, "contextId");
  return poseidonHash([input.identitySecret, input.contextId]);
}
