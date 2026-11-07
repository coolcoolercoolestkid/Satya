import assert from "node:assert/strict";
import { test } from "node:test";

import { CLAIM_TYPE } from "./constants.ts";
import type { NormalizedCredential } from "./credential.ts";
import { addressToField, hashToField, isFieldElement } from "./field.ts";
import {
  claimNullifier,
  credentialMessageHash,
  identityNullifier,
  poseidonHash,
} from "./hash.ts";
import { loadCredentialFixture } from "./test-fixture.ts";

const fixture = loadCredentialFixture();

function credential(): NormalizedCredential {
  return { ...fixture.credential };
}

test("Poseidon matches the reference circomlib vector", async () => {
  // Poseidon([1, 2]) from circomlib's own test suite. If this fails, the hash
  // parameters are wrong and nothing downstream can be trusted.
  assert.equal(
    await poseidonHash([1n, 2n]),
    7853200120776062878684798364095072458815029376092732009249414926327459813530n,
  );
});

test("Poseidon rejects unusable input counts", async () => {
  await assert.rejects(() => poseidonHash([]), RangeError);
  await assert.rejects(() => poseidonHash(Array.from({ length: 17 }, () => 1n)), RangeError);
});

test("credential message hash is pinned by fixture", async () => {
  assert.equal(await credentialMessageHash(credential()), fixture.expected.messageHash);
});

test("message hash changes when any signed field changes", async () => {
  const baseline = await credentialMessageHash(credential());
  const mutations: ReadonlyArray<[string, Partial<NormalizedCredential>]> = [
    ["credentialId", { credentialId: fixture.credential.credentialId + 1n }],
    ["subject", { subject: "0x70997970c51812dc3a010c7d01b50e0d17dc79c9" }],
    ["dateOfBirth", { dateOfBirth: 20040315 }],
    ["nationality", { nationality: 840 }],
    ["expiryDate", { expiryDate: 20340315 }],
    ["issuedAt", { issuedAt: 20260910 }],
    ["identitySecret", { identitySecret: fixture.credential.identitySecret + 1n }],
  ];
  for (const [label, patch] of mutations) {
    const mutated = await credentialMessageHash({ ...credential(), ...patch });
    assert.notEqual(mutated, baseline, `changing ${label} must change the hash`);
  }
});

test("field order is load-bearing", async () => {
  // Hash the exact same eight values with two of them transposed. The validator would
  // reject such a credential, so this goes through Poseidon directly: the point is that
  // the layout itself is unambiguous, not that the credential is well-formed.
  const { credentialId, dateOfBirth, nationality, expiryDate, issuedAt, identitySecret } =
    fixture.credential;
  const version = BigInt(fixture.credential.schemaVersion);
  const subject = addressToField(fixture.credential.subject);
  const inOrder = [version, credentialId, subject, BigInt(dateOfBirth), BigInt(nationality), BigInt(expiryDate), BigInt(issuedAt), identitySecret];
  const datesTransposed = [version, credentialId, subject, BigInt(issuedAt), BigInt(nationality), BigInt(expiryDate), BigInt(dateOfBirth), identitySecret];
  // credentialId and identitySecret are both opaque field elements, so position is the
  // only thing telling them apart — and they carry deliberately different lifetimes.
  const secretsTransposed = [version, identitySecret, subject, BigInt(dateOfBirth), BigInt(nationality), BigInt(expiryDate), BigInt(issuedAt), credentialId];
  assert.equal(await poseidonHash(inOrder), fixture.expected.messageHash);
  assert.notEqual(await poseidonHash(datesTransposed), fixture.expected.messageHash);
  assert.notEqual(await poseidonHash(secretsTransposed), fixture.expected.messageHash);
});

test("arity is load-bearing: a v1 message is not a v2 message", async () => {
  // v1 signed seven fields and omitted identitySecret. Dropping the eighth field must
  // not reproduce a v2 hash, or the schema bump would be cosmetic and a v1 credential
  // could satisfy a v2 circuit.
  const { credentialId, dateOfBirth, nationality, expiryDate, issuedAt } = fixture.credential;
  const subject = addressToField(fixture.credential.subject);
  const asV1 = [1n, credentialId, subject, BigInt(dateOfBirth), BigInt(nationality), BigInt(expiryDate), BigInt(issuedAt)];
  assert.notEqual(await poseidonHash(asV1), fixture.expected.messageHash);
});

test("context id derivation is pinned by fixture", () => {
  assert.equal(hashToField(fixture.expected.contextIdSource), fixture.expected.contextId);
});

test("nullifiers are pinned by fixture and separated by claim type", async () => {
  const common = {
    credentialId: fixture.credential.credentialId,
    contextId: fixture.expected.contextId,
    subject: fixture.credential.subject,
  };
  const age = await claimNullifier({ ...common, claimTypeId: CLAIM_TYPE.AGE });
  const nationality = await claimNullifier({ ...common, claimTypeId: CLAIM_TYPE.NATIONALITY });
  assert.equal(age, fixture.expected.nullifierAge);
  assert.equal(nationality, fixture.expected.nullifierNationality);
  assert.notEqual(age, nationality, "one credential must not reuse a nullifier across claims");
  assert.ok(isFieldElement(age));
});

test("nullifiers separate by context, credential and subject", async () => {
  const base = {
    credentialId: fixture.credential.credentialId,
    claimTypeId: CLAIM_TYPE.AGE,
    contextId: fixture.expected.contextId,
    subject: fixture.credential.subject,
  };
  const baseline = await claimNullifier(base);
  assert.notEqual(
    await claimNullifier({ ...base, contextId: fixture.expected.contextId + 1n }),
    baseline,
    "different verifier contexts must be unlinkable",
  );
  assert.notEqual(
    await claimNullifier({ ...base, credentialId: fixture.credential.credentialId + 1n }),
    baseline,
    "different credentials must yield different nullifiers",
  );
  assert.notEqual(
    await claimNullifier({ ...base, subject: "0x70997970c51812dc3a010c7d01b50e0d17dc79c9" }),
    baseline,
    "a nullifier must be bound to one wallet",
  );
});

test("nullifier derivation is deterministic", async () => {
  const input = {
    credentialId: fixture.credential.credentialId,
    claimTypeId: CLAIM_TYPE.AGE,
    contextId: fixture.expected.contextId,
    subject: fixture.credential.subject,
  };
  assert.equal(await claimNullifier(input), await claimNullifier(input));
});

test("identity nullifier is pinned by fixture", async () => {
  assert.equal(
    await identityNullifier({
      identitySecret: fixture.credential.identitySecret,
      contextId: fixture.expected.contextId,
    }),
    fixture.expected.identityNullifier,
  );
});

test("identity nullifier survives re-issuance and a change of wallet", async () => {
  // The property the field exists for. Two credentials the issuer derived from one
  // document carry the same identitySecret, so they collide here — while their claim
  // nullifiers stay distinct, because those do bind credentialId and subject. Neither
  // is an input to this hash, which is the whole point rather than an oversight.
  //
  // claimTypeId is not an input either, so one holder proving age and nationality to
  // one verifier yields one identity nullifier. That is structural: the function has
  // nowhere to accept a claim type.
  const reissued = {
    credentialId: fixture.credential.credentialId + 1n,
    subject: "0x70997970c51812dc3a010c7d01b50e0d17dc79c9",
  };
  const contextId = fixture.expected.contextId;

  assert.equal(
    await identityNullifier({ identitySecret: fixture.credential.identitySecret, contextId }),
    fixture.expected.identityNullifier,
    "re-issuance and a new wallet must not change the identity nullifier",
  );
  assert.notEqual(
    await claimNullifier({ ...reissued, claimTypeId: CLAIM_TYPE.AGE, contextId }),
    fixture.expected.nullifierAge,
    "the claim nullifier must still separate the two credentials",
  );
});

test("identity nullifiers are unlinkable across verifiers", async () => {
  const base = {
    identitySecret: fixture.credential.identitySecret,
    contextId: fixture.expected.contextId,
  };
  assert.notEqual(
    await identityNullifier({ ...base, contextId: fixture.expected.contextId + 1n }),
    fixture.expected.identityNullifier,
    "two verifiers must not see the same value for one holder",
  );
  assert.notEqual(
    await identityNullifier({ ...base, identitySecret: base.identitySecret + 1n }),
    fixture.expected.identityNullifier,
    "a different identity secret must not collide",
  );
  assert.equal(await identityNullifier(base), await identityNullifier(base));
});
