import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { isFieldElement } from "@aletheia/credential";

import {
  MOCK_ISSUER_LABEL,
  PRIVATE_KEY_BYTES,
  generateKeypair,
  parseKeystore,
  publicKeyFor,
  serializeKeystore,
  type KeystoreFile,
} from "./keys.ts";
import { readKeystore, writeKeystore } from "./keystore-node.ts";

function tempKeystorePath(): string {
  return join(mkdtempSync(join(tmpdir(), "aletheia-issuer-")), "issuer-mock.json");
}

test("generated keys are the right size and on the curve field", async () => {
  const { privateKey, publicKey } = await generateKeypair();
  assert.equal(privateKey.length, PRIVATE_KEY_BYTES);
  assert.ok(isFieldElement(publicKey.ax));
  assert.ok(isFieldElement(publicKey.ay));
  assert.notEqual(publicKey.ax, 0n);
});

test("public key derivation is deterministic", async () => {
  const { privateKey, publicKey } = await generateKeypair();
  assert.deepEqual(await publicKeyFor(privateKey), publicKey);
});

test("distinct keys are generated each time", async () => {
  const first = await generateKeypair();
  const second = await generateKeypair();
  assert.notDeepEqual(first.publicKey, second.publicKey);
});

test("derivation rejects a wrong-length private key", async () => {
  await assert.rejects(() => publicKeyFor(new Uint8Array(16)), RangeError);
});

test("a keystore round-trips and carries the mock warning", async () => {
  const keypair = await generateKeypair();
  const path = writeKeystore(keypair, tempKeystorePath());
  const file = JSON.parse(readFileSync(path, "utf8")) as KeystoreFile;
  assert.equal(file.label, MOCK_ISSUER_LABEL);
  assert.match(file._warning, /DEVELOPMENT MOCK ISSUER/);
  assert.match(file.privateKey, /^0x[0-9a-f]{64}$/);
  const loaded = await readKeystore(path);
  assert.deepEqual(loaded.publicKey, keypair.publicKey);
  assert.deepEqual([...loaded.privateKey], [...keypair.privateKey]);
});

test("an existing keystore is never silently overwritten", async () => {
  const path = writeKeystore(await generateKeypair(), tempKeystorePath());
  assert.throws(() => writeKeystore({ privateKey: new Uint8Array(PRIVATE_KEY_BYTES), publicKey: { ax: 1n, ay: 2n } }, path));
});

test("a keystore whose public key does not match its private key is rejected", async () => {
  const keypair = await generateKeypair();
  const file = serializeKeystore(keypair);
  await assert.rejects(
    () => parseKeystore({ ...file, publicKey: { ax: "1", ay: "2" } }),
    /does not match/,
  );
});

test("a malformed private key is rejected", async () => {
  const file = serializeKeystore(await generateKeypair());
  await assert.rejects(() => parseKeystore({ ...file, privateKey: "0xdeadbeef" }), TypeError);
  await assert.rejects(
    () => parseKeystore({ ...file, privateKey: file.privateKey.slice(0, -2) }),
    TypeError,
  );
});
