/**
 * The nationality claim's public-signal layout and its decoder.
 *
 * The layout is the same v2 nine-signal shape the age claim uses (`signals.ts`), with the
 * one generic claim-parameter slot at index 6 carrying `requiredNationality` instead of
 * `minimumAge`. Kept in its own module, browser-safe like `signals.ts`, so a holder or
 * verifier flow can decode a nationality proof without importing the Node-only proving path.
 * The order is the contract between this package, `AletheiaVerifier` and the subgraph: it is
 * fixed by the declaration order in `nationality.circom`, asserted by test, and documented
 * in `docs/public-signals.md`.
 */

import { fieldToAddress } from "@aletheia/credential";

/**
 * Groth16 public signals for the nationality claim: circuit outputs first, then public
 * inputs in declaration order. Identical to `AGE_PUBLIC_SIGNALS` except index 6.
 */
export const NATIONALITY_PUBLIC_SIGNALS = [
  "nullifier",
  "identityNullifier",
  "schemaVersion",
  "issuerAx",
  "issuerAy",
  "currentDate",
  "requiredNationality",
  "contextId",
  "subject",
] as const;

export interface NationalityPublicSignals {
  nullifier: bigint;
  identityNullifier: bigint;
  schemaVersion: number;
  issuerAx: bigint;
  issuerAy: bigint;
  currentDate: number;
  requiredNationality: number;
  contextId: bigint;
  subject: string;
}

export function decodeNationalityPublicSignals(
  signals: readonly string[],
): NationalityPublicSignals {
  if (signals.length !== NATIONALITY_PUBLIC_SIGNALS.length) {
    throw new Error(
      `expected ${NATIONALITY_PUBLIC_SIGNALS.length} public signals, got ${signals.length}`,
    );
  }
  const at = (name: (typeof NATIONALITY_PUBLIC_SIGNALS)[number]): bigint =>
    BigInt(signals[NATIONALITY_PUBLIC_SIGNALS.indexOf(name)] as string);

  return {
    nullifier: at("nullifier"),
    identityNullifier: at("identityNullifier"),
    schemaVersion: Number(at("schemaVersion")),
    issuerAx: at("issuerAx"),
    issuerAy: at("issuerAy"),
    currentDate: Number(at("currentDate")),
    requiredNationality: Number(at("requiredNationality")),
    contextId: at("contextId"),
    subject: fieldToAddress(at("subject")),
  };
}
