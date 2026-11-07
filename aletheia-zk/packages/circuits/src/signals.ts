/**
 * The age claim's public-signal layout and its decoder.
 *
 * Split out of `age.ts` so a browser holder flow can decode a proof's public signals
 * without importing the Node-only proving path (`prove.ts` reads artifacts off disk). The
 * order here is the contract between this package, AletheiaVerifier and the subgraph: it
 * is fixed by the declaration order in age.circom, asserted by test, and documented in
 * docs/public-signals.md.
 */

import { SCHEMA_VERSION, fieldToAddress } from "@aletheia/credential";

/**
 * Groth16 public signals: circuit outputs first, then public inputs in order.
 *
 * This is the v2 nine-signal layout every claim type shares. `minimumAge` sits in the
 * generic claim-parameter slot, so nationality and expiry decode identically with a
 * different name for index 6.
 */
export const AGE_PUBLIC_SIGNALS = [
  "nullifier",
  "identityNullifier",
  "schemaVersion",
  "issuerAx",
  "issuerAy",
  "currentDate",
  "minimumAge",
  "contextId",
  "subject",
] as const;

export interface AgePublicSignals {
  nullifier: bigint;
  identityNullifier: bigint;
  schemaVersion: number;
  issuerAx: bigint;
  issuerAy: bigint;
  currentDate: number;
  minimumAge: number;
  contextId: bigint;
  subject: string;
}

export function decodeAgePublicSignals(signals: readonly string[]): AgePublicSignals {
  if (signals.length !== AGE_PUBLIC_SIGNALS.length) {
    throw new Error(
      `expected ${AGE_PUBLIC_SIGNALS.length} public signals, got ${signals.length}`,
    );
  }
  const at = (name: (typeof AGE_PUBLIC_SIGNALS)[number]): bigint =>
    BigInt(signals[AGE_PUBLIC_SIGNALS.indexOf(name)] as string);

  return {
    nullifier: at("nullifier"),
    identityNullifier: at("identityNullifier"),
    schemaVersion: Number(at("schemaVersion")),
    issuerAx: at("issuerAx"),
    issuerAy: at("issuerAy"),
    currentDate: Number(at("currentDate")),
    minimumAge: Number(at("minimumAge")),
    contextId: at("contextId"),
    subject: fieldToAddress(at("subject")),
  };
}

/** The schema version the compiled artifacts pin; re-exported for the browser proving path. */
export const CIRCUIT_SCHEMA_VERSION = SCHEMA_VERSION;
