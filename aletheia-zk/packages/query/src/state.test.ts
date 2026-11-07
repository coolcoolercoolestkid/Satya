import assert from "node:assert/strict";
import { test } from "node:test";

import { decodeMeta, decodeVerification } from "./decode.ts";
import { deriveVerificationState, type FreshnessPolicy } from "./state.ts";
import type { IndexingMeta, Verification } from "./types.ts";

// These fixtures are the exact JSON shape the deployed subgraph returns — BigInt scalars
// as decimal strings, Int scalars as numbers, Bytes as 0x hex — and they are run through
// the real decoders before reaching the state machine. So a `Verification` here is never
// hand-built: it is decoded from the same wire format `scripts/states.ts` reads live, and
// a schema rename fails these tests in the same place a live read would. The state values
// (`verifiedAt`, `issuer.active`) are the two the five states actually turn on; everything
// else is the stage 11 record from docs/deployments.md, transcribed once.
//
// This is a test of a pure function, not a mocked read. Nothing here stands in for
// `fetch`: the transport is exercised only against the real endpoint, by scripts/states.ts.

/** The stage 11 record, with the two state-bearing fields left to each test to set. */
function verificationJson(overrides: {
  verifiedAt: string;
  issuerActive: boolean;
  blockNumber?: string;
}): Record<string, unknown> {
  return {
    id: "0xd24a4fc1052a1b7753e1fffd825666a3946fd2ee5c88e8f472fb743fab6928c3",
    subject: { id: "0xa66f7fc3f125b06a5fd4f107d31a400103866cae", registeredAt: null },
    issuer: {
      id: "0xfee4bdf6ec605973cbc4ae331ef4c92cfc89ce43fb42da6d4d6517a164be2588",
      label: "mock-dev",
      active: overrides.issuerActive,
    },
    claimType: 1,
    claimParameter: "18",
    credentialValidOn: 20260910,
    contextId: "0x00000000000000000000000000000000000000000000000000000000000000c1",
    nullifier: "0x00000000000000000000000000000000000000000000000000000000000000f1",
    identityNullifier: "0x00000000000000000000000000000000000000000000000000000000000000e1",
    verifiedAt: overrides.verifiedAt,
    blockNumber: overrides.blockNumber ?? "11674993",
    transactionHash:
      "0x195671d0f3d105a5401656b7ad35d0cd6d94190fd17061dd6d70833524b92719",
  };
}

function verification(overrides: {
  verifiedAt: string;
  issuerActive: boolean;
  blockNumber?: string;
}): Verification {
  return decodeVerification(verificationJson(overrides));
}

function meta(overrides: { blockNumber: number; hasIndexingErrors?: boolean }): IndexingMeta {
  return decodeMeta({
    block: { number: overrides.blockNumber },
    hasIndexingErrors: overrides.hasIndexingErrors ?? false,
  });
}

/** A generous window: 24h. Nothing in these tests is stale against it unless it says so. */
const GENEROUS: FreshnessPolicy = { maxVerificationAgeSeconds: 24 * 60 * 60 };
/** A verifier's `verifiedAt`, and a `now` an hour later. */
const RECORDED_AT = 1_789_043_940;
const ONE_HOUR_LATER = RECORDED_AT + 3_600;

test("verified: present, issuer active, within the freshness window", () => {
  const state = deriveVerificationState({
    verification: verification({ verifiedAt: String(RECORDED_AT), issuerActive: true }),
    meta: meta({ blockNumber: 11_676_296 }),
    policy: GENEROUS,
    nowSeconds: ONE_HOUR_LATER,
  });
  assert.equal(state.status, "verified");
  assert.equal(state.status === "verified" && state.ageSeconds, 3_600);
});

test("stale: the same record read against a one-hour freshness window", () => {
  // The record and the clock are identical to the verified case above; only the policy
  // changes. That is the whole point of freshness being verifier-side: one record, two
  // honest answers.
  const state = deriveVerificationState({
    verification: verification({ verifiedAt: String(RECORDED_AT), issuerActive: true }),
    meta: meta({ blockNumber: 11_676_296 }),
    policy: { maxVerificationAgeSeconds: 60 * 60 - 1 },
    nowSeconds: ONE_HOUR_LATER,
  });
  assert.equal(state.status, "stale");
  if (state.status === "stale") {
    assert.equal(state.ageSeconds, 3_600);
    assert.equal(state.maxVerificationAgeSeconds, 3_599);
  }
});

test("stale boundary: age exactly at the window is verified, one second over is stale", () => {
  const base = {
    verification: verification({ verifiedAt: String(RECORDED_AT), issuerActive: true }),
    meta: meta({ blockNumber: 11_676_296 }),
    nowSeconds: ONE_HOUR_LATER,
  } as const;
  const atLimit = deriveVerificationState({
    ...base,
    policy: { maxVerificationAgeSeconds: 3_600 },
  });
  assert.equal(atLimit.status, "verified");
  const overLimit = deriveVerificationState({
    ...base,
    policy: { maxVerificationAgeSeconds: 3_599 },
  });
  assert.equal(overLimit.status, "stale");
});

test("clock skew: a verifiedAt in the future is clamped to age 0, never stale", () => {
  const state = deriveVerificationState({
    verification: verification({ verifiedAt: String(RECORDED_AT + 500), issuerActive: true }),
    meta: meta({ blockNumber: 11_676_296 }),
    policy: { maxVerificationAgeSeconds: 0 },
    nowSeconds: RECORDED_AT,
  });
  assert.equal(state.status, "verified");
  assert.equal(state.status === "verified" && state.ageSeconds, 0);
});

test("revoked: issuer inactive outranks an otherwise-verified record", () => {
  const state = deriveVerificationState({
    verification: verification({ verifiedAt: String(RECORDED_AT), issuerActive: false }),
    meta: meta({ blockNumber: 11_676_296 }),
    policy: GENEROUS,
    nowSeconds: ONE_HOUR_LATER,
  });
  assert.equal(state.status, "revoked");
  assert.equal(
    state.status === "revoked" && state.issuer.id,
    "0xfee4bdf6ec605973cbc4ae331ef4c92cfc89ce43fb42da6d4d6517a164be2588",
  );
});

test("revoked outranks stale: a revoked key is stronger than an old record", () => {
  // Both conditions hold — inactive issuer AND well past the window — and revoked wins.
  const state = deriveVerificationState({
    verification: verification({ verifiedAt: String(RECORDED_AT), issuerActive: false }),
    meta: meta({ blockNumber: 11_676_296 }),
    policy: { maxVerificationAgeSeconds: 1 },
    nowSeconds: ONE_HOUR_LATER,
  });
  assert.equal(state.status, "revoked");
});

test("not-found: no record and no newer block expected", () => {
  const state = deriveVerificationState({
    verification: null,
    meta: meta({ blockNumber: 11_676_296 }),
    policy: GENEROUS,
    nowSeconds: ONE_HOUR_LATER,
  });
  assert.equal(state.status, "not-found");
});

test("pending / awaiting-index: absent, but the expected block is beyond the indexer head", () => {
  const state = deriveVerificationState({
    verification: null,
    meta: meta({ blockNumber: 11_676_296 }),
    policy: GENEROUS,
    nowSeconds: ONE_HOUR_LATER,
    expectedBlock: 11_676_400n,
  });
  assert.equal(state.status, "pending");
  if (state.status === "pending") {
    assert.equal(state.cause, "awaiting-index");
    assert.equal(state.expectedBlock, 11_676_400n);
  }
});

test("not-found, not pending, once the indexer has reached the expected block", () => {
  // The indexer head has caught up to the transaction's block and the record is still
  // absent: it genuinely does not exist (e.g. the transaction reverted), so this is
  // not-found, not an eternal pending.
  const state = deriveVerificationState({
    verification: null,
    meta: meta({ blockNumber: 11_676_400 }),
    policy: GENEROUS,
    nowSeconds: ONE_HOUR_LATER,
    expectedBlock: 11_676_400n,
  });
  assert.equal(state.status, "not-found");
});

test("pending / indexer-errored outranks everything, even a present healthy-looking record", () => {
  // A record is present and would read as verified, but the indexer reports errors, so
  // its `active` flag and its completeness cannot be trusted. Pending wins.
  const state = deriveVerificationState({
    verification: verification({ verifiedAt: String(RECORDED_AT), issuerActive: true }),
    meta: meta({ blockNumber: 11_676_296, hasIndexingErrors: true }),
    policy: GENEROUS,
    nowSeconds: ONE_HOUR_LATER,
  });
  assert.equal(state.status, "pending");
  assert.equal(state.status === "pending" && state.cause, "indexer-errored");
});

test("every state carries a distinct, non-empty reason", () => {
  const reasons = new Set<string>();
  const cases = [
    deriveVerificationState({
      verification: verification({ verifiedAt: String(RECORDED_AT), issuerActive: true }),
      meta: meta({ blockNumber: 11_676_296 }),
      policy: GENEROUS,
      nowSeconds: ONE_HOUR_LATER,
    }),
    deriveVerificationState({
      verification: verification({ verifiedAt: String(RECORDED_AT), issuerActive: true }),
      meta: meta({ blockNumber: 11_676_296 }),
      policy: { maxVerificationAgeSeconds: 1 },
      nowSeconds: ONE_HOUR_LATER,
    }),
    deriveVerificationState({
      verification: verification({ verifiedAt: String(RECORDED_AT), issuerActive: false }),
      meta: meta({ blockNumber: 11_676_296 }),
      policy: GENEROUS,
      nowSeconds: ONE_HOUR_LATER,
    }),
    deriveVerificationState({
      verification: null,
      meta: meta({ blockNumber: 11_676_296 }),
      policy: GENEROUS,
      nowSeconds: ONE_HOUR_LATER,
      expectedBlock: 11_676_400n,
    }),
    deriveVerificationState({
      verification: null,
      meta: meta({ blockNumber: 11_676_296 }),
      policy: GENEROUS,
      nowSeconds: ONE_HOUR_LATER,
    }),
  ];
  const statuses = cases.map((state) => state.status);
  assert.deepEqual(statuses, ["verified", "stale", "revoked", "pending", "not-found"]);
  for (const state of cases) {
    assert.equal(typeof state.reason, "string");
    assert.ok(state.reason.length > 0);
    reasons.add(state.reason);
  }
  assert.equal(reasons.size, cases.length, "reasons must be distinct across the five states");
});

test("an invalid freshness policy is a caller error, surfaced not swallowed", () => {
  const good = verification({ verifiedAt: String(RECORDED_AT), issuerActive: true });
  const m = meta({ blockNumber: 11_676_296 });
  for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () =>
        deriveVerificationState({
          verification: good,
          meta: m,
          policy: { maxVerificationAgeSeconds: bad },
          nowSeconds: ONE_HOUR_LATER,
        }),
      RangeError,
    );
  }
});

test("a non-finite now is a caller error", () => {
  assert.throws(
    () =>
      deriveVerificationState({
        verification: verification({ verifiedAt: String(RECORDED_AT), issuerActive: true }),
        meta: meta({ blockNumber: 11_676_296 }),
        policy: GENEROUS,
        nowSeconds: Number.NaN,
      }),
    RangeError,
  );
});
