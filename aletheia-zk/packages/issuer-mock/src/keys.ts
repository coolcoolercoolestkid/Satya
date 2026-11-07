/**
 * Keypair handling for the mock issuer.
 *
 * DEVELOPMENT ONLY. This key attests to nothing: whoever holds it can sign any
 * credential, and the mock issuer checks no identity before signing. See
 * `docs/trust-model.md`.
 *
 * This module is free of `node:fs` on purpose, so it can be bundled into the browser
 * holder flow where the Phase 1 mock issuer signs on the holder's own device. Reading and
 * writing keystore files lives in the Node-only `keystore-node.ts`.
 */

import type { IssuerPublicKey } from "@aletheia/credential";
import { assertFieldElement } from "@aletheia/credential";

import { eddsa } from "./eddsa.ts";

/** Label this issuer is registered under on-chain, so its records stay identifiable. */
export const MOCK_ISSUER_LABEL = "mock-dev";

/** EdDSA on BabyJubjub takes a 32-byte private key; circomlibjs prunes it internally. */
export const PRIVATE_KEY_BYTES = 32;

export interface IssuerKeypair {
  privateKey: Uint8Array;
  publicKey: IssuerPublicKey;
}

export interface KeystoreFile {
  _warning: string;
  label: string;
  createdAt: string;
  privateKey: string;
  publicKey: { ax: string; ay: string };
}

const KEYSTORE_WARNING =
  "DEVELOPMENT MOCK ISSUER. This key performs no identity verification. " +
  "Credentials signed with it prove issuance by a mock issuer and nothing more. " +
  "Never register this key as a production issuer.";

function toHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function fromHex(hex: string, expectedBytes: number): Uint8Array {
  if (!new RegExp(`^0x[0-9a-fA-F]{${expectedBytes * 2}}$`).test(hex)) {
    throw new TypeError(`expected a ${expectedBytes}-byte hex string, got: ${hex}`);
  }
  const bytes = new Uint8Array(expectedBytes);
  for (let i = 0; i < expectedBytes; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16);
  }
  return bytes;
}

/** Derive the BabyJubjub public key for a private key. */
export async function publicKeyFor(privateKey: Uint8Array): Promise<IssuerPublicKey> {
  if (privateKey.length !== PRIVATE_KEY_BYTES) {
    throw new RangeError(`private key must be ${PRIVATE_KEY_BYTES} bytes`);
  }
  const instance = await eddsa();
  const point = instance.prv2pub(privateKey);
  return {
    ax: instance.F.toObject(point[0]),
    ay: instance.F.toObject(point[1]),
  };
}

export async function generateKeypair(): Promise<IssuerKeypair> {
  const privateKey = new Uint8Array(PRIVATE_KEY_BYTES);
  globalThis.crypto.getRandomValues(privateKey);
  return { privateKey, publicKey: await publicKeyFor(privateKey) };
}

export function serializeKeystore(keypair: IssuerKeypair): KeystoreFile {
  return {
    _warning: KEYSTORE_WARNING,
    label: MOCK_ISSUER_LABEL,
    createdAt: new Date().toISOString(),
    privateKey: toHex(keypair.privateKey),
    publicKey: {
      ax: keypair.publicKey.ax.toString(10),
      ay: keypair.publicKey.ay.toString(10),
    },
  };
}

/**
 * Parse a keystore and re-derive the public key from the private key rather than
 * trusting the file, so a tampered or stale `publicKey` field cannot silently produce
 * signatures that no registered issuer key verifies.
 */
export async function parseKeystore(file: KeystoreFile): Promise<IssuerKeypair> {
  const privateKey = fromHex(file.privateKey, PRIVATE_KEY_BYTES);
  const declared = { ax: BigInt(file.publicKey.ax), ay: BigInt(file.publicKey.ay) };
  assertFieldElement(declared.ax, "publicKey.ax");
  assertFieldElement(declared.ay, "publicKey.ay");
  const derived = await publicKeyFor(privateKey);
  if (derived.ax !== declared.ax || derived.ay !== declared.ay) {
    throw new Error("keystore publicKey does not match its privateKey");
  }
  return { privateKey, publicKey: derived };
}
