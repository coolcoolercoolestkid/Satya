/**
 * Raw GraphQL JSON to typed models.
 *
 * Everything here is pure: JSON in, typed value or a thrown `MalformedResponseError`
 * out. No network, no clock, no environment. That is deliberate — it is the only part of
 * this package that can honestly be unit-tested, because `.cursor/rules/ethereum.mdc`
 * confines test doubles to unit tests of pure functions and forbids a mocked `fetch`
 * anywhere in the read path. The transport in `client.ts` is therefore only ever
 * exercised against the real endpoint.
 *
 * The decoders are strict on purpose. A field that is absent, null where it cannot be
 * null, or the wrong JSON type is a schema drift between this client and
 * `packages/subgraph/schema.graphql`, and drift that is coerced into a default value is
 * drift nobody finds until it has produced a wrong answer.
 */

import { MalformedResponseError } from "./errors.ts";
import type {
  Hex,
  IndexingMeta,
  Issuer,
  Profile,
  Verification,
  VerificationIssuer,
} from "./types.ts";

/** Narrow an unknown to a JSON object, or fail naming the path. */
function readObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return failWrongType(path, "an object", value);
  }
  return value as Record<string, unknown>;
}

/** Narrow an unknown to a JSON array, or fail naming the path. */
function readArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) return failWrongType(path, "an array", value);
  return value;
}

function failWrongType(path: string, expected: string, actual: unknown): never {
  const found =
    actual === null ? "null" : Array.isArray(actual) ? "an array" : `a ${typeof actual}`;
  throw new MalformedResponseError(path, `expected ${expected}, found ${found}`);
}

function readField(source: Record<string, unknown>, key: string, path: string): unknown {
  if (!(key in source)) {
    throw new MalformedResponseError(`${path}.${key}`, "field is absent from the response");
  }
  return source[key];
}

function readString(source: Record<string, unknown>, key: string, path: string): string {
  const value = readField(source, key, path);
  if (typeof value !== "string") return failWrongType(`${path}.${key}`, "a string", value);
  return value;
}

function readBoolean(source: Record<string, unknown>, key: string, path: string): boolean {
  const value = readField(source, key, path);
  if (typeof value !== "boolean") return failWrongType(`${path}.${key}`, "a boolean", value);
  return value;
}

/**
 * A `Bytes` scalar: 0x followed by an even number of hex characters.
 *
 * Validated rather than cast, because these ids are compared against values derived
 * on-chain and a silently malformed one produces a "not found" that looks like an
 * absent record instead of a bad query.
 */
function readHex(source: Record<string, unknown>, key: string, path: string): Hex {
  const value = readString(source, key, path);
  if (!/^0x([0-9a-fA-F]{2})*$/.test(value)) {
    throw new MalformedResponseError(
      `${path}.${key}`,
      `expected 0x-prefixed hex with an even number of digits, found ${JSON.stringify(value)}`,
    );
  }
  return value as Hex;
}

/**
 * A GraphQL `Int` scalar: a JSON number that is a safe integer.
 *
 * The Graph emits `Int` as a number, unlike `BigInt`. Rejecting a non-integer here stops
 * a schema change from turning `claimType` into a float nobody notices.
 */
function readInt(source: Record<string, unknown>, key: string, path: string): number {
  const value = readField(source, key, path);
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return failWrongType(`${path}.${key}`, "a safe integer", value);
  }
  return value;
}

/**
 * A GraphQL `BigInt` scalar, which arrives as a decimal string.
 *
 * Parsed into a `bigint` rather than kept as a string so that block numbers and
 * timestamps compare numerically. `BigInt()` accepts whitespace, `0x` and `_`
 * separators, so the shape is checked first.
 */
function readBigInt(source: Record<string, unknown>, key: string, path: string): bigint {
  const value = readField(source, key, path);
  if (typeof value !== "string") {
    return failWrongType(`${path}.${key}`, "a decimal string", value);
  }
  if (!/^-?[0-9]+$/.test(value)) {
    throw new MalformedResponseError(
      `${path}.${key}`,
      `expected a decimal integer string, found ${JSON.stringify(value)}`,
    );
  }
  return BigInt(value);
}

/**
 * A nullable `BigInt`.
 *
 * Only `Profile.registeredAt` is nullable, and its null is meaningful: the address
 * appeared as a verification subject but never called `register()`. Absent and null are
 * treated the same here because a GraphQL server may omit neither, but conflating them
 * would mean a query that forgot to select the field reads as "never registered".
 * Absence is therefore still an error; only an explicit `null` is a null.
 */
function readNullableBigInt(
  source: Record<string, unknown>,
  key: string,
  path: string,
): bigint | null {
  const value = readField(source, key, path);
  if (value === null) return null;
  return readBigInt(source, key, path);
}

/**
 * `_meta { block { number } hasIndexingErrors }`.
 *
 * `block.number` is graph-node's own built-in `_Block_` type, not a field the subgraph's
 * schema declares — and graph-node types it `Int!`, so it arrives as a JSON number, unlike
 * the subgraph's own `BigInt` fields (`Verification.blockNumber`, `Issuer.registeredAt`),
 * which arrive as decimal strings. Confirmed against the live endpoint's introspection.
 * Converted to `bigint` here anyway, so callers compare it against other block numbers
 * without caring which scalar produced it.
 */
export function decodeMeta(raw: unknown, path = "_meta"): IndexingMeta {
  const meta = readObject(raw, path);
  const block = readObject(readField(meta, "block", path), `${path}.block`);
  return {
    blockNumber: BigInt(readInt(block, "number", `${path}.block`)),
    hasIndexingErrors: readBoolean(meta, "hasIndexingErrors", path),
  };
}

/** The issuer fields carried inline on a verification. */
export function decodeVerificationIssuer(raw: unknown, path: string): VerificationIssuer {
  const issuer = readObject(raw, path);
  return {
    id: readHex(issuer, "id", path),
    label: readString(issuer, "label", path),
    active: readBoolean(issuer, "active", path),
  };
}

/** A full `Issuer` entity. */
export function decodeIssuer(raw: unknown, path = "issuer"): Issuer {
  const issuer = readObject(raw, path);
  return {
    id: readHex(issuer, "id", path),
    ax: readBigInt(issuer, "ax", path),
    ay: readBigInt(issuer, "ay", path),
    label: readString(issuer, "label", path),
    active: readBoolean(issuer, "active", path),
    registeredAt: readBigInt(issuer, "registeredAt", path),
  };
}

/** A `Profile` entity. `registeredAt` null means the address never called `register()`. */
export function decodeProfile(raw: unknown, path = "profile"): Profile {
  const profile = readObject(raw, path);
  return {
    id: readHex(profile, "id", path),
    registeredAt: readNullableBigInt(profile, "registeredAt", path),
  };
}

/** A `Verification` entity, with its subject and issuer resolved inline. */
export function decodeVerification(raw: unknown, path = "verification"): Verification {
  const verification = readObject(raw, path);
  return {
    id: readHex(verification, "id", path),
    subject: decodeProfile(readField(verification, "subject", path), `${path}.subject`),
    issuer: decodeVerificationIssuer(
      readField(verification, "issuer", path),
      `${path}.issuer`,
    ),
    claimType: readInt(verification, "claimType", path),
    claimParameter: readBigInt(verification, "claimParameter", path),
    credentialValidOn: readInt(verification, "credentialValidOn", path),
    contextId: readHex(verification, "contextId", path),
    nullifier: readHex(verification, "nullifier", path),
    identityNullifier: readHex(verification, "identityNullifier", path),
    verifiedAt: readBigInt(verification, "verifiedAt", path),
    blockNumber: readBigInt(verification, "blockNumber", path),
    transactionHash: readHex(verification, "transactionHash", path),
  };
}

/** A list of verifications. */
export function decodeVerifications(raw: unknown, path = "verifications"): Verification[] {
  return readArray(raw, path).map((entry, index) =>
    decodeVerification(entry, `${path}[${index}]`),
  );
}

/**
 * A single-entity lookup, where GraphQL returns `null` for an id that does not exist.
 *
 * Not-found is a normal answer, never an error: an address with no verification is the
 * ordinary case for most addresses.
 */
export function decodeNullable<T>(
  raw: unknown,
  path: string,
  decode: (value: unknown, path: string) => T,
): T | null {
  if (raw === null || raw === undefined) return null;
  return decode(raw, path);
}
