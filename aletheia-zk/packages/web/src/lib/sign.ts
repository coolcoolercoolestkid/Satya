/**
 * Client-side credential signing with the mock-dev issuer.
 *
 * In Phase 1 the issuer runs on the holder's own device, so all of this happens in the
 * browser: the mock-dev keystore is fetched from the app's own origin, the `documentKey`
 * is derived from the reviewed passport fields, and the credential is signed with
 * EdDSA-Poseidon. Nothing here touches the network beyond loading the keystore, and no
 * passport field is ever sent anywhere.
 *
 * The issuer is labelled `mock-dev` on-chain and verifies no identity: a credential signed
 * here proves issuance by a mock issuer and nothing more (`docs/trust-model.md`).
 */

import {
  SCHEMA_VERSION,
  hashToField,
  randomFieldElement,
  todayUtcYyyymmdd,
  type NormalizedCredential,
  type SignedCredential,
} from "@aletheia/credential";
import { deriveDocumentKey, type DocumentIdentity } from "@aletheia/extraction/browser";
import {
  MOCK_ISSUER_LABEL,
  deriveIdentitySecret,
  parseKeystore,
  signCredential,
  type IssuerKeypair,
  type KeystoreFile,
} from "@aletheia/issuer-mock/browser";
import { keccak256 } from "viem";

/** Where the gitignored mock-dev keystore is served from (app origin, copied by the operator). */
export const KEYSTORE_URL = "/mock-issuer-keystore.json";

/**
 * Load and verify the mock-dev issuer keystore from the app origin.
 *
 * `parseKeystore` re-derives the public key from the private key, so a tampered file fails
 * here rather than producing signatures no registered issuer verifies. Refuses any
 * keystore not labelled `mock-dev`, mirroring the Node tools.
 */
export async function loadMockIssuer(url = KEYSTORE_URL): Promise<IssuerKeypair> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(
      `no mock issuer keystore at ${url} (${response.status}). Copy your gitignored ` +
        "packages/issuer-mock/keys/issuer-mock.json to packages/web/public/mock-issuer-keystore.json.",
    );
  }
  const file = (await response.json()) as KeystoreFile;
  if (file.label !== MOCK_ISSUER_LABEL) {
    throw new Error(
      `refusing a keystore labelled ${JSON.stringify(file.label)}, not ${JSON.stringify(MOCK_ISSUER_LABEL)}.`,
    );
  }
  return parseKeystore(file);
}

/**
 * A stable issuer salt for the mock issuer, derived from its own long-lived secret (the
 * keystore private key) rather than freshly random. This makes `identitySecret =
 * Poseidon([issuerSalt, documentKey])` — and therefore the per-context `identityNullifier`
 * — stable across sessions for the same passport, which is the whole point of Day 19's
 * `documentKey`. A real issuer persists a dedicated salt; the mock reuses its key material.
 */
function issuerSaltFor(privateKey: Uint8Array): bigint {
  return hashToField(keccak256(privateKey));
}

/** The reviewed, holder-confirmed passport fields that define the credential. */
export interface ReviewedFields extends DocumentIdentity {
  /** ISO 3166-1 numeric nationality (also in DocumentIdentity). */
  nationality: number;
  /** YYYYMMDD UTC date of birth. */
  dateOfBirth: number;
  /** YYYYMMDD UTC expiry date. */
  expiryDate: number;
}

export interface SignInput {
  issuer: IssuerKeypair;
  fields: ReviewedFields;
  /** The connected wallet address the credential is bound to. */
  subject: `0x${string}`;
  /** Injected for determinism; defaults to now. */
  now?: Date;
}

export interface SignResult {
  signed: SignedCredential;
  documentKey: bigint;
}

/**
 * Derive the `documentKey`, assemble a normalized credential bound to the wallet, and sign
 * it. `credentialId` is fresh random per credential (its own privacy property); the
 * document-derived stability lives entirely in `identitySecret`.
 */
export async function signReviewedCredential(input: SignInput): Promise<SignResult> {
  const documentKey = await deriveDocumentKey(input.fields);
  const issuedAt = todayUtcYyyymmdd(input.now ?? new Date());
  const identitySecret = await deriveIdentitySecret({
    issuerSalt: issuerSaltFor(input.issuer.privateKey),
    documentKey,
  });

  const credential: NormalizedCredential = {
    schemaVersion: SCHEMA_VERSION,
    credentialId: randomFieldElement(),
    subject: input.subject.toLowerCase(),
    dateOfBirth: input.fields.dateOfBirth,
    nationality: input.fields.nationality,
    expiryDate: input.fields.expiryDate,
    issuedAt,
    identitySecret,
  };

  const signed = await signCredential(input.issuer.privateKey, credential);
  return { signed, documentKey };
}
