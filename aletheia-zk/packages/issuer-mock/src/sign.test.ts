import assert from "node:assert/strict";
import { test } from "node:test";

import {
  credentialMessageHash,
  parseSignedCredential,
  serializeSignedCredential,
  type NormalizedCredential,
} from "@aletheia/credential";
import { loadCredentialFixture } from "@aletheia/credential/test-fixture";

import { generateKeypair, publicKeyFor } from "./keys.ts";
import { createMockIssuer, isSignedBy, signCredential, verifySignedCredential } from "./sign.ts";

const fixture = loadCredentialFixture();

function credential(): NormalizedCredential {
  return { ...fixture.credential };
}

test("a signed credential verifies", async () => {
  const { privateKey, publicKey } = await generateKeypair();
  const signed = await signCredential(privateKey, credential());
  assert.equal(await verifySignedCredential(signed), true);
  assert.deepEqual(signed.issuer, publicKey);
  assert.ok(isSignedBy(signed, publicKey));
});

test("signing is deterministic for a given key and credential", async () => {
  const { privateKey } = await generateKeypair();
  const first = await signCredential(privateKey, credential());
  const second = await signCredential(privateKey, credential());
  assert.deepEqual(second.signature, first.signature);
});

test("mutating any signed field invalidates the signature", async () => {
  const { privateKey } = await generateKeypair();
  const signed = await signCredential(privateKey, credential());
  const mutations: ReadonlyArray<[string, Partial<NormalizedCredential>]> = [
    ["credentialId", { credentialId: fixture.credential.credentialId + 1n }],
    ["subject", { subject: "0x70997970c51812dc3a010c7d01b50e0d17dc79c9" }],
    ["dateOfBirth", { dateOfBirth: 20080909 }],
    ["nationality", { nationality: 840 }],
    ["expiryDate", { expiryDate: 20440314 }],
    ["issuedAt", { issuedAt: 20260908 }],
  ];
  for (const [label, patch] of mutations) {
    const tampered = { ...signed, credential: { ...signed.credential, ...patch } };
    assert.equal(
      await verifySignedCredential(tampered),
      false,
      `tampering with ${label} must invalidate the signature`,
    );
  }
});

test("mutating the signature or the claimed issuer key invalidates it", async () => {
  const { privateKey } = await generateKeypair();
  const signed = await signCredential(privateKey, credential());
  const other = await generateKeypair();

  for (const [label, tampered] of [
    ["s", { ...signed, signature: { ...signed.signature, s: signed.signature.s + 1n } }],
    ["r8x", { ...signed, signature: { ...signed.signature, r8x: signed.signature.r8x + 1n } }],
    ["r8y", { ...signed, signature: { ...signed.signature, r8y: signed.signature.r8y + 1n } }],
    ["issuer key", { ...signed, issuer: other.publicKey }],
  ] as const) {
    assert.equal(
      await verifySignedCredential(tampered),
      false,
      `tampering with ${label} must invalidate the signature`,
    );
  }
});

test("a signature from one key does not verify under another", async () => {
  const first = await generateKeypair();
  const second = await generateKeypair();
  const signed = await signCredential(first.privateKey, credential());
  assert.equal(isSignedBy(signed, second.publicKey), false);
  // Swapping in the other key's identity is the forgery attempt the circuit's public
  // issuer key, checked against the on-chain registry, is there to defeat.
  assert.equal(
    await verifySignedCredential({ ...signed, issuer: second.publicKey }),
    false,
  );
});

test("signing refuses a malformed credential", async () => {
  const { privateKey } = await generateKeypair();
  await assert.rejects(
    () => signCredential(privateKey, { ...credential(), dateOfBirth: 20040230 }),
    RangeError,
  );
  await assert.rejects(
    () => signCredential(privateKey, { ...credential(), nationality: 0 }),
    RangeError,
  );
});

test("verification rejects a malformed credential outright", async () => {
  const { privateKey } = await generateKeypair();
  const signed = await signCredential(privateKey, credential());
  // schemaVersion 1 is retired and unsupported, so the credential cannot even be hashed:
  // verifySignedCredential must reject it via the malformed-credential path, not by
  // reaching the signature check. (The signed value is 2; see docs/credential-schema.md.)
  assert.equal(
    await verifySignedCredential({
      ...signed,
      credential: { ...signed.credential, schemaVersion: 1 },
    }),
    false,
  );
});

test("signatures survive the JSON wire format", async () => {
  const { privateKey } = await generateKeypair();
  const signed = await signCredential(privateKey, credential());
  const round = parseSignedCredential(
    JSON.parse(JSON.stringify(serializeSignedCredential(signed))),
  );
  assert.deepEqual(round, signed);
  assert.equal(await verifySignedCredential(round), true);
});

test("the signed message is the documented Poseidon hash", async () => {
  // Ties the issuer to docs/credential-schema.md: it signs that hash, not its own.
  const { privateKey } = await generateKeypair();
  const signed = await signCredential(privateKey, credential());
  assert.equal(await credentialMessageHash(signed.credential), fixture.expected.messageHash);
});

test("the CredentialSigner seam produces the same signature", async () => {
  const { privateKey, publicKey } = await generateKeypair();
  const issue = createMockIssuer(privateKey);
  const signed = await issue(credential());
  assert.equal(await verifySignedCredential(signed), true);
  assert.deepEqual(signed.issuer, await publicKeyFor(privateKey));
  assert.deepEqual(signed.issuer, publicKey);
});
