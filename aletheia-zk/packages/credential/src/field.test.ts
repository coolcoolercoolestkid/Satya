import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FIELD_MODULUS,
  addressToField,
  assertFieldElement,
  fieldToAddress,
  fieldToBytes32,
  hashToField,
  isAddress,
  isFieldElement,
  randomFieldElement,
} from "./field.ts";

test("field membership is checked against the bn128 modulus", () => {
  assert.ok(isFieldElement(0n));
  assert.ok(isFieldElement(FIELD_MODULUS - 1n));
  assert.equal(isFieldElement(FIELD_MODULUS), false);
  assert.equal(isFieldElement(-1n), false);
  assert.throws(() => assertFieldElement(FIELD_MODULUS, "value"), RangeError);
});

test("addresses round-trip through the field", () => {
  const address = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
  const asField = addressToField(address);
  assert.equal(asField, BigInt(address));
  assert.equal(fieldToAddress(asField), address);
  // Mixed case in, lowercase out: the field element carries no case information.
  assert.equal(
    fieldToAddress(addressToField("0x70997970C51812dc3A010C7d01b50e0d17dc79C8")),
    address,
  );
  // The zero address is representable and must stay zero-padded, not "0x0".
  assert.equal(fieldToAddress(0n), `0x${"0".repeat(40)}`);
});

test("rejects malformed addresses", () => {
  for (const value of [
    "70997970c51812dc3a010c7d01b50e0d17dc79c8", // no 0x
    "0x70997970c51812dc3a010c7d01b50e0d17dc79c", // 19.5 bytes
    "0x70997970c51812dc3a010c7d01b50e0d17dc79c89", // too long
    "0xzz997970c51812dc3a010c7d01b50e0d17dc79c8", // not hex
    "",
  ]) {
    assert.equal(isAddress(value), false, `${value} should be rejected`);
    assert.throws(() => addressToField(value), TypeError);
  }
  assert.throws(() => fieldToAddress(1n << 160n), RangeError);
});

test("hashToField keeps the leading 31 bytes of a digest", () => {
  const digest = `0x${"11".repeat(32)}`;
  const reduced = hashToField(digest);
  assert.equal(reduced, BigInt(digest) >> 8n);
  assert.ok(isFieldElement(reduced));
  // A digest above the modulus still reduces into it, which is the point.
  const large = `0x${"ff".repeat(32)}`;
  assert.ok(BigInt(large) > FIELD_MODULUS);
  assert.ok(isFieldElement(hashToField(large)));
  // Digests differing only in the final byte collide by construction; document it.
  assert.equal(hashToField(`0x${"11".repeat(31)}22`), hashToField(`0x${"11".repeat(31)}33`));
  assert.throws(() => hashToField("0x1234"), TypeError);
});

test("fieldToBytes32 pads to 32 bytes", () => {
  assert.equal(fieldToBytes32(1n), `0x${"0".repeat(63)}1`);
  assert.equal(fieldToBytes32(0n), `0x${"0".repeat(64)}`);
  assert.equal(fieldToBytes32(255n).length, 66);
  assert.throws(() => fieldToBytes32(FIELD_MODULUS), RangeError);
});

test("random field elements are in range and not repeated", () => {
  const seen = new Set<bigint>();
  for (let i = 0; i < 64; i += 1) {
    const value = randomFieldElement();
    assert.ok(isFieldElement(value));
    assert.ok(value < 1n << 248n, "31 bytes must stay below 2^248");
    seen.add(value);
  }
  assert.equal(seen.size, 64, "credential ids must not collide");
});
