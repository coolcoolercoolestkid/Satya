import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decodeIssuer,
  decodeMeta,
  decodeNullable,
  decodeProfile,
  decodeVerification,
  decodeVerifications,
} from "./decode.ts";
import { MalformedResponseError } from "./errors.ts";

// The fixture below is the shape the deployed subgraph actually returns, transcribed
// from `packages/subgraph/schema.graphql`: BigInt scalars as decimal strings, Int
// scalars as numbers, Bytes as 0x hex. The values are the stage 11 record recorded in
// docs/deployments.md, so if the schema ever renames a field these tests fail in the
// same place a live query would.
//
// This is a decoding test, not a mocked read. Nothing here stands in for `fetch`: the
// transport is exercised only against the real endpoint, by scripts/check.ts.
const STAGE_11_VERIFICATION = {
  id: "0xd24a4fc1052a1b7753e1fffd825666a3946fd2ee5c88e8f472fb743fab6928c3",
  subject: {
    id: "0xa66f7fc3f125b06a5fd4f107d31a400103866cae",
    registeredAt: null,
  },
  issuer: {
    id: "0xfee4bdf6ec605973cbc4ae331ef4c92cfc89ce43fb42da6d4d6517a164be2588",
    label: "mock-dev",
    active: true,
  },
  claimType: 1,
  claimParameter: "18",
  credentialValidOn: 20260910,
  contextId: "0x00000000000000000000000000000000000000000000000000000000000000c1",
  nullifier: "0x00000000000000000000000000000000000000000000000000000000000000f1",
  identityNullifier: "0x00000000000000000000000000000000000000000000000000000000000000e1",
  verifiedAt: "1757500000",
  blockNumber: "11674993",
  transactionHash:
    "0x195671d0f3d105a5401656b7ad35d0cd6d94190fd17061dd6d70833524b92719",
};

// _meta.block.number is graph-node's built-in _Block_ type, which is Int! and arrives as
// a JSON number — unlike the subgraph's own BigInt fields, which arrive as decimal
// strings. Confirmed against the live endpoint's introspection.
test("meta decodes the block number as a bigint and the error flag as a boolean", () => {
  const meta = decodeMeta({ block: { number: 11674993 }, hasIndexingErrors: false });
  assert.equal(meta.blockNumber, 11674993n);
  assert.equal(meta.hasIndexingErrors, false);
});

// A block number that stayed a string would sort lexicographically, which makes
// "9999999" look newer than "11674993". Comparing indexer head to chain head is the
// whole basis of the pending state in stage 14, so the type is asserted rather than
// assumed, and the raw Int is converted to bigint despite arriving as a number already.
test("block number is a bigint, not a number", () => {
  const meta = decodeMeta({ block: { number: 11674993 }, hasIndexingErrors: true });
  assert.equal(typeof meta.blockNumber, "bigint");
  assert.equal(meta.hasIndexingErrors, true);
});

test("a decimal-string block number is rejected rather than coerced", () => {
  assert.throws(
    () => decodeMeta({ block: { number: "11674993" }, hasIndexingErrors: false }),
    (error: unknown) =>
      error instanceof MalformedResponseError && error.path === "_meta.block.number",
  );
});

test("a verification decodes every field at its declared type", () => {
  const verification = decodeVerification(STAGE_11_VERIFICATION);

  assert.equal(verification.id, STAGE_11_VERIFICATION.id);
  assert.equal(verification.claimType, 1);
  assert.equal(verification.claimParameter, 18n);
  assert.equal(verification.credentialValidOn, 20260910);
  assert.equal(verification.verifiedAt, 1757500000n);
  assert.equal(verification.blockNumber, 11674993n);
  assert.equal(verification.transactionHash, STAGE_11_VERIFICATION.transactionHash);
  assert.equal(verification.nullifier, STAGE_11_VERIFICATION.nullifier);
  assert.equal(verification.identityNullifier, STAGE_11_VERIFICATION.identityNullifier);
  assert.equal(verification.contextId, STAGE_11_VERIFICATION.contextId);
});

// The `mock-dev` label is load-bearing: every surface that renders a record derived from
// the mock issuer has to say so (AGENTS.md). It reaching the decoded record is asserted
// here for the same reason the subgraph asserts it reaching the entity.
test("the mock-dev label and the issuer's active flag survive decoding", () => {
  const verification = decodeVerification(STAGE_11_VERIFICATION);
  assert.equal(verification.issuer.label, "mock-dev");
  assert.equal(verification.issuer.active, true);
  assert.equal(verification.issuer.id, STAGE_11_VERIFICATION.issuer.id);
});

// registeredAt null means the address proved a claim without ever calling register().
// That is an ordinary case, and it must not decode as 0 — a zero timestamp would read as
// "registered at the epoch".
test("a subject that never registered decodes registeredAt as null, not zero", () => {
  const verification = decodeVerification(STAGE_11_VERIFICATION);
  assert.equal(verification.subject.registeredAt, null);
});

test("a registered profile decodes its timestamp as a bigint", () => {
  const profile = decodeProfile({
    id: "0xa66f7fc3f125b06a5fd4f107d31a400103866cae",
    registeredAt: "1757400000",
  });
  assert.equal(profile.registeredAt, 1757400000n);
});

test("an issuer decodes its BabyJubjub key as bigints", () => {
  const issuer = decodeIssuer({
    id: "0xfee4bdf6ec605973cbc4ae331ef4c92cfc89ce43fb42da6d4d6517a164be2588",
    ax: "15808909928821364056960736135823935383830781668867221144693156124101082714209",
    ay: "16093738387085587958022137404017811413083228893645485512866626227058972605355",
    label: "mock-dev",
    active: true,
    registeredAt: "1757000000",
  });
  assert.equal(
    issuer.ax,
    15808909928821364056960736135823935383830781668867221144693156124101082714209n,
  );
  assert.equal(
    issuer.ay,
    16093738387085587958022137404017811413083228893645485512866626227058972605355n,
  );
  assert.equal(issuer.active, true);
});

test("a list of verifications decodes to an array, and an empty list to an empty array", () => {
  assert.equal(decodeVerifications([STAGE_11_VERIFICATION]).length, 1);
  assert.deepEqual(decodeVerifications([]), []);
});

// Not-found is a normal answer for most addresses, so null must pass through rather than
// throw. Stage 14 turns it into an explicit `not found` state.
test("a null single-entity lookup decodes to null", () => {
  assert.equal(decodeNullable(null, "verification", decodeVerification), null);
  assert.equal(decodeNullable(undefined, "verification", decodeVerification), null);
});

// Everything below is the reason the decoders are strict. A missing or misshaped field
// means this client and schema.graphql have drifted, and a caller handed a partial record
// will make a decision on it.
test("an absent field fails and names its path", () => {
  const { nullifier: _removed, ...withoutNullifier } = STAGE_11_VERIFICATION;
  assert.throws(
    () => decodeVerification(withoutNullifier),
    (error: unknown) =>
      error instanceof MalformedResponseError &&
      error.path === "verification.nullifier" &&
      /absent/.test(error.message),
  );
});

test("a BigInt scalar arriving as a number is rejected rather than coerced", () => {
  assert.throws(
    () => decodeVerification({ ...STAGE_11_VERIFICATION, claimParameter: 18 }),
    (error: unknown) =>
      error instanceof MalformedResponseError &&
      error.path === "verification.claimParameter",
  );
});

test("an Int scalar arriving as a string is rejected rather than coerced", () => {
  assert.throws(
    () => decodeVerification({ ...STAGE_11_VERIFICATION, claimType: "1" }),
    (error: unknown) =>
      error instanceof MalformedResponseError && error.path === "verification.claimType",
  );
});

test("a malformed hex id is rejected", () => {
  assert.throws(
    () => decodeVerification({ ...STAGE_11_VERIFICATION, id: "not-hex" }),
    (error: unknown) =>
      error instanceof MalformedResponseError && error.path === "verification.id",
  );
  // Odd digit count is not a byte string.
  assert.throws(
    () => decodeVerification({ ...STAGE_11_VERIFICATION, id: "0xabc" }),
    MalformedResponseError,
  );
});

test("a nested failure names the nested path", () => {
  assert.throws(
    () =>
      decodeVerification({
        ...STAGE_11_VERIFICATION,
        issuer: { ...STAGE_11_VERIFICATION.issuer, active: "true" },
      }),
    (error: unknown) =>
      error instanceof MalformedResponseError &&
      error.path === "verification.issuer.active",
  );
});

test("a list failure names the offending index", () => {
  assert.throws(
    () =>
      decodeVerifications([
        STAGE_11_VERIFICATION,
        { ...STAGE_11_VERIFICATION, verifiedAt: null },
      ]),
    (error: unknown) =>
      error instanceof MalformedResponseError &&
      error.path === "verifications[1].verifiedAt",
  );
});

test("a non-object where an entity is expected is rejected", () => {
  assert.throws(() => decodeVerification("nope"), MalformedResponseError);
  assert.throws(() => decodeMeta(null), MalformedResponseError);
  assert.throws(() => decodeVerifications({}), MalformedResponseError);
});
