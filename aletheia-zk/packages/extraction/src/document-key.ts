/**
 * `documentKey`: a stable, on-device field element that identifies one physical passport.
 *
 * `deriveIdentitySecret({ issuerSalt, documentKey })` in `@aletheia/issuer-mock` expects
 * this value and nothing produced it until now. It is derived here, in the extraction
 * layer, because this is the only layer that knows the document format — which fields a
 * TD3 passport carries and which of them are the document's stable identity.
 *
 * What it is, exactly (see `docs/passport-extraction.md`, "Document key"):
 *
 * - **Deterministic.** The same passport, scanned or typed twice, yields the same value,
 *   because the input is the *normalized* candidate fields, not the raw glyphs. Two reads
 *   that both extract successfully agree by construction.
 * - **Collision-free across documents.** It hashes the four fields that together identify
 *   the physical booklet — issuing nationality, document number, date of birth, date of
 *   expiry — the same tuple (number, DOB, expiry) ICAO derives the chip access key from,
 *   plus nationality to disambiguate a reused number across issuers. Two distinct
 *   passports would have to agree on all four to collide, which distinct documents do not.
 * - **A field element.** A SHA-256 digest reduced into the bn128 scalar field the same
 *   way every other 32-byte digest in this repo is (`hashToField`: keep the leading 31
 *   bytes), so it is always a canonical element below the modulus and — barring an
 *   all-zero top 31 bytes, which SHA-256 does not produce — non-zero, as
 *   `deriveIdentitySecret` requires.
 * - **On-device only.** This function is pure and offline; it holds no key and issues no
 *   request. The value it returns feeds `identitySecret = Poseidon([issuerSalt,
 *   documentKey])`, and because `issuerSalt` is the issuer's secret, nobody outside the
 *   issuer can recover the document from the credential, and two issuers derive unrelated
 *   secrets from the same passport. The raw document number is still never signed, stored,
 *   or made a public proof input; `documentKey` is a private intermediate that never
 *   leaves the machine that scanned the passport.
 *
 * A renewed passport is a **different** document — a new booklet has a new number and a
 * new expiry — so it derives a new `documentKey`, and therefore a new `identitySecret`.
 * That matches the schema's definition of `identitySecret` as stable "across credentials
 * the same issuer derives from the same document" (`docs/credential-schema.md`).
 *
 * Derivation happens after the mandatory review step, not inside extraction: extraction
 * produces untrusted candidate fields, the holder confirms or corrects them, and the
 * confirmed fields are what identify the document. Baking the key into the extractor's
 * output would key it off unreviewed OCR.
 */

import {
  assertFieldElement,
  assertValidYyyymmdd,
  hashToField,
  isCountryCode,
} from "@aletheia/credential";

import type { Td3CandidateFields } from "./mrz.ts";

/**
 * Domain-separation prefix, versioned. Pins this hash to one purpose so a `documentKey`
 * can never collide with any other `hashToField` input in the system (e.g. a `contextId`),
 * and so the derivation can be revised under a new tag without silently changing values.
 */
export const DOCUMENT_KEY_DOMAIN = "aletheia/documentKey/v1";

/**
 * The stable identity of one physical TD3 passport: the fields that do not change for a
 * given booklet and that, taken together, no other booklet shares. A superset such as
 * {@link Td3CandidateFields} satisfies this structurally, so a caller can pass the parsed
 * fields directly.
 */
export interface DocumentIdentity {
  /** Passport number, filler stripped, uppercase `[A-Z0-9]` as {@link parseTd3Mrz} yields. */
  documentNumber: string;
  /** ISO 3166-1 numeric issuing nationality, 1-999. */
  nationality: number;
  /** Date of birth, YYYYMMDD UTC. */
  dateOfBirth: number;
  /** Date of expiry, YYYYMMDD UTC. */
  expiryDate: number;
}

/** The MRZ character set for a filler-stripped document number; also guards the framing. */
const DOCUMENT_NUMBER_PATTERN = /^[A-Z0-9]+$/;

/**
 * The canonical byte string hashed into the key. Fixed labels and `|`/`:` separators that
 * cannot appear in any field value make the encoding unambiguous: no two distinct field
 * tuples produce the same string, so a shifted or truncated field cannot alias another.
 */
function canonicalDocumentString(identity: DocumentIdentity): string {
  if (!DOCUMENT_NUMBER_PATTERN.test(identity.documentNumber)) {
    throw new TypeError(
      `documentNumber must be non-empty uppercase [A-Z0-9] (filler stripped): ` +
        JSON.stringify(identity.documentNumber),
    );
  }
  if (!isCountryCode(identity.nationality)) {
    throw new RangeError(`nationality is not an ISO 3166-1 numeric code: ${identity.nationality}`);
  }
  assertValidYyyymmdd(identity.dateOfBirth, "dateOfBirth");
  assertValidYyyymmdd(identity.expiryDate, "expiryDate");

  return [
    DOCUMENT_KEY_DOMAIN,
    "TD3",
    `NAT:${identity.nationality}`,
    `NUM:${identity.documentNumber}`,
    `DOB:${identity.dateOfBirth}`,
    `EXP:${identity.expiryDate}`,
  ].join("|");
}

function toHexDigest(digest: ArrayBuffer): string {
  let hex = "0x";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Derive the `documentKey` for a passport from its stable identifying fields.
 *
 * Async because it hashes with Web Crypto's `crypto.subtle.digest`, which is present in
 * Node 22 and in browsers, so the same code path serves the client and any test.
 */
export async function deriveDocumentKey(identity: DocumentIdentity): Promise<bigint> {
  const canonical = canonicalDocumentString(identity);
  const bytes = new TextEncoder().encode(canonical);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const key = hashToField(toHexDigest(digest));

  assertFieldElement(key, "documentKey");
  // SHA-256 does not produce an all-zero leading 31 bytes; guard anyway, because a zero
  // documentKey is rejected downstream by deriveIdentitySecret and must never be returned.
  if (key === 0n) {
    throw new Error("documentKey reduced to zero; refusing to return a degenerate key");
  }
  return key;
}
