/**
 * Derivation of the credential's `identitySecret`.
 *
 * DEVELOPMENT ONLY, and the limits here are the point of the file rather than a caveat
 * at the end of it. Read `docs/trust-model.md` before relying on anything below.
 */

import { assertFieldElement, poseidonHash, randomFieldElement } from "@aletheia/credential";

/**
 * A fresh issuer salt.
 *
 * A real issuer generates this once and persists it for the lifetime of its signing key:
 * rotating it re-partitions every `identityNullifier` it has ever produced, which looks
 * to verifiers like every returning holder becoming a new one. The mock issuer generates
 * one per run, because it has nothing to be consistent about.
 */
export function randomIdentitySalt(): bigint {
  return randomFieldElement();
}

export interface IdentitySecretInput {
  /** The issuer's long-lived secret. Never leaves the issuer. */
  issuerSalt: bigint;
  /**
   * A field element identifying the source document — for a passport, a digest of its
   * stable identifying fields (issuing nationality, number, date of birth, date of
   * expiry). Producing it is the extraction layer's job, because only that layer knows the
   * document format: `@aletheia/extraction`'s `deriveDocumentKey`, see
   * `docs/passport-extraction.md`.
   */
  documentKey: bigint;
}

/**
 * `identitySecret = Poseidon([issuerSalt, documentKey])`.
 *
 * Two credentials this issuer derives from the same document get the same value, so
 * their `identityNullifier`s match within any one `contextId`. Because `issuerSalt` is
 * secret, nobody outside the issuer can compute the value from a document number, and
 * two different issuers derive unrelated values from the same document.
 *
 * What this does NOT do, stated plainly so no caller has to infer it:
 *
 * - It is not a person identifier. It is bound to an issuer and a document. One human
 *   with two passports has two values; one passport held by two people has one.
 * - It is not Sybil resistance, and `identityNullifier` must not be described as such.
 *   Uniqueness holds only among credentials sharing an `identitySecret`.
 * - Under the Phase 1 mock issuer it establishes no real-world uniqueness at all. This
 *   issuer verifies no identity, runs on the holder's own machine, and its salt is
 *   whatever that machine generated, so a holder can mint unlimited distinct values.
 *
 * The guarantee is exactly as strong as the issuer, which in Phase 1 means: not at all.
 */
export async function deriveIdentitySecret(input: IdentitySecretInput): Promise<bigint> {
  assertFieldElement(input.issuerSalt, "issuerSalt");
  assertFieldElement(input.documentKey, "documentKey");
  if (input.issuerSalt === 0n) throw new RangeError("issuerSalt must not be zero");
  if (input.documentKey === 0n) throw new RangeError("documentKey must not be zero");
  return poseidonHash([input.issuerSalt, input.documentKey]);
}
