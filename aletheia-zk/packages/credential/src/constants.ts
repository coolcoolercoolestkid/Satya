/**
 * Protocol constants. These values are part of the issuer-signed message and of the
 * public signals decoded on-chain, so changing one is a breaking protocol change:
 * it requires a new schema version, recompiled circuits, and redeployed verifiers.
 */

/**
 * Version of the normalized credential and of the signed-message layout.
 *
 * v2 added the private `identitySecret` field and made the version itself a public
 * signal. v1 is retired: its circuits produced seven public signals and no verifier for
 * them is deployed. See docs/credential-schema.md.
 */
export const SCHEMA_VERSION = 2;

/** Upper bound on `schemaVersion`, so it fits the `uint16` the contract routes on. */
export const MAX_SCHEMA_VERSION = 65535;

/**
 * Claim type ids. Bound into the nullifier inside the circuit and used on-chain to
 * select the Groth16 verifier for a claim, so ids are never reused or renumbered.
 */
export const CLAIM_TYPE = {
  AGE: 1,
  NATIONALITY: 2,
  EXPIRY: 3,
} as const;

export type ClaimTypeName = keyof typeof CLAIM_TYPE;
export type ClaimTypeId = (typeof CLAIM_TYPE)[ClaimTypeName];

/** Inclusive bounds on any YYYYMMDD date accepted by the codec and the circuits. */
export const MIN_DATE_YYYYMMDD = 19000101;
export const MAX_DATE_YYYYMMDD = 21001231;
