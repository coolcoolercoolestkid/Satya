/**
 * The expiry claim's public-signal layout and its decoder.
 *
 * The same v2 nine-signal shape the age and nationality claims use (`signals.ts`,
 * `nationality-signals.ts`), with the one generic claim-parameter slot at index 6 carrying
 * `expiryParameter` — which the circuit pins to zero, because an expiry claim has no
 * parameter of its own (see `expiry.circom`). Kept in its own module, browser-safe like the
 * others, so a holder or verifier flow can decode an expiry proof without importing the
 * Node-only proving path. The order is the contract between this package, `AletheiaVerifier`
 * and the subgraph: fixed by the declaration order in `expiry.circom`, asserted by test, and
 * documented in `docs/public-signals.md`.
 */

import { fieldToAddress } from "@aletheia/credential";

/**
 * Groth16 public signals for the expiry claim: circuit outputs first, then public inputs in
 * declaration order. Identical to `AGE_PUBLIC_SIGNALS` except index 6, which is
 * `expiryParameter` and is always zero.
 */
export const EXPIRY_PUBLIC_SIGNALS = [
  "nullifier",
  "identityNullifier",
  "schemaVersion",
  "issuerAx",
  "issuerAy",
  "currentDate",
  "expiryParameter",
  "contextId",
  "subject",
] as const;

export interface ExpiryPublicSignals {
  nullifier: bigint;
  identityNullifier: bigint;
  schemaVersion: number;
  issuerAx: bigint;
  issuerAy: bigint;
  currentDate: number;
  /** Always zero: an expiry claim has no parameter, and the circuit pins the slot. */
  expiryParameter: number;
  contextId: bigint;
  subject: string;
}

export function decodeExpiryPublicSignals(signals: readonly string[]): ExpiryPublicSignals {
  if (signals.length !== EXPIRY_PUBLIC_SIGNALS.length) {
    throw new Error(
      `expected ${EXPIRY_PUBLIC_SIGNALS.length} public signals, got ${signals.length}`,
    );
  }
  const at = (name: (typeof EXPIRY_PUBLIC_SIGNALS)[number]): bigint =>
    BigInt(signals[EXPIRY_PUBLIC_SIGNALS.indexOf(name)] as string);

  return {
    nullifier: at("nullifier"),
    identityNullifier: at("identityNullifier"),
    schemaVersion: Number(at("schemaVersion")),
    issuerAx: at("issuerAx"),
    issuerAy: at("issuerAy"),
    currentDate: Number(at("currentDate")),
    expiryParameter: Number(at("expiryParameter")),
    contextId: at("contextId"),
    subject: fieldToAddress(at("subject")),
  };
}
