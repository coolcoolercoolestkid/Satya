import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertNormalizedCredential,
  isCountryCode,
  isNormalizedCredential,
  parseSignedCredential,
  serializeSignedCredential,
  type NormalizedCredential,
  type SignedCredential,
} from "./credential.ts";
import { loadCredentialFixture } from "./test-fixture.ts";

const fixture = loadCredentialFixture();

function valid(): NormalizedCredential {
  return { ...fixture.credential };
}

test("the committed fixture is a valid credential", () => {
  assertNormalizedCredential(valid());
  assert.ok(isNormalizedCredential(valid()));
});

test("rejects every malformed credential", () => {
  const cases: ReadonlyArray<[string, Partial<NormalizedCredential>]> = [
    ["retired schema version 1", { schemaVersion: 1 }],
    ["unreleased schema version", { schemaVersion: 3 }],
    ["zero credential id", { credentialId: 0n }],
    ["zero identity secret", { identitySecret: 0n }],
    ["identity secret above the field", { identitySecret: 2n ** 255n }],
    [
      "identity secret reused as the credential id",
      { identitySecret: fixture.credential.credentialId },
    ],
    ["credential id above the field", { credentialId: 2n ** 255n }],
    ["address without 0x", { subject: "70997970c51812dc3a010c7d01b50e0d17dc79c8" }],
    ["truncated address", { subject: "0x7099" }],
    ["impossible date of birth", { dateOfBirth: 20040230 }],
    ["date of birth below range", { dateOfBirth: 18991231 }],
    ["impossible expiry", { expiryDate: 20341301 }],
    ["nationality zero", { nationality: 0 }],
    ["nationality above three digits", { nationality: 1000 }],
    ["nationality not an integer", { nationality: 356.5 }],
    ["born after issuance", { dateOfBirth: 20270101 }],
    ["expired before issuance", { expiryDate: 20200101 }],
  ];
  for (const [label, patch] of cases) {
    const credential = { ...valid(), ...patch };
    assert.throws(() => assertNormalizedCredential(credential), label);
    assert.equal(isNormalizedCredential(credential), false, label);
  }
});

test("country codes are ISO 3166-1 numeric", () => {
  assert.ok(isCountryCode(356)); // India
  assert.ok(isCountryCode(1));
  assert.ok(isCountryCode(999));
  assert.equal(isCountryCode(0), false);
  assert.equal(isCountryCode(1000), false);
});

test("signed credentials round-trip through JSON without losing precision", () => {
  // Signature components here are arbitrary in-field values: this test covers the wire
  // format only. Real signatures are produced and verified in packages/issuer-mock.
  const signed: SignedCredential = {
    credential: valid(),
    issuer: { ax: 12345678901234567890n, ay: 98765432109876543210n },
    signature: { r8x: 1n, r8y: 2n ** 200n, s: 2n ** 250n - 1n },
  };
  const json = serializeSignedCredential(signed);
  assert.equal(typeof json.credentialId, "string");
  assert.equal(typeof json.signature.s, "string");
  const parsed = parseSignedCredential(json);
  assert.deepEqual(parsed, signed);
  // JSON.parse of a bigint-as-number would silently lose precision; assert it did not.
  assert.equal(
    parseSignedCredential(JSON.parse(JSON.stringify(json))).signature.s,
    2n ** 250n - 1n,
  );
});

test("parsing rejects out-of-field signature components", () => {
  const json = serializeSignedCredential({
    credential: valid(),
    issuer: { ax: 1n, ay: 2n },
    signature: { r8x: 1n, r8y: 2n, s: 3n },
  });
  assert.throws(
    () => parseSignedCredential({ ...json, signature: { ...json.signature, s: (2n ** 255n).toString() } }),
    RangeError,
  );
});
