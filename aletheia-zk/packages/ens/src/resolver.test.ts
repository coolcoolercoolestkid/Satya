import assert from "node:assert/strict";
import { test } from "node:test";

import { InvalidAddressError, InvalidEnsNameError } from "./errors.ts";
import { __internal, UNIVERSAL_RESOLVER_ADDRESS } from "./resolver.ts";

const { normalizeEnsName, normalizeAddressInput } = __internal;

// The Universal Resolver proxy is normative (docs/architecture.md). Pinning it in a test
// means a typo or an accidental edit to the constant is caught here, not by a wrong
// resolution against mainnet.
test("the Universal Resolver proxy address is the canonical ENSv2 entrypoint", () => {
  assert.equal(UNIVERSAL_RESOLVER_ADDRESS, "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe");
});

// UTS-46 normalisation is mandatory before a name is hashed: differing cases and
// confusable Unicode forms must collapse to one canonical string.
test("a name is UTS-46 normalised to its canonical form", () => {
  assert.equal(normalizeEnsName("Vitalik.eth"), "vitalik.eth");
  assert.equal(normalizeEnsName("VITALIK.ETH"), "vitalik.eth");
  assert.equal(normalizeEnsName("vitalik.eth"), "vitalik.eth");
});

// A malformed name is caller misuse — a different problem from a well-formed name that
// happens to have no record, which resolves to null rather than throwing.
test("an empty or whitespace-only name is an error, not a null resolution", () => {
  assert.throws(() => normalizeEnsName(""), InvalidEnsNameError);
  assert.throws(() => normalizeEnsName("   "), InvalidEnsNameError);
});

test("a name that fails normalisation is refused", () => {
  // An underscore is not a valid ENS label character; normalize rejects it.
  assert.throws(() => normalizeEnsName("bad_name.eth"), InvalidEnsNameError);
});

// An address may arrive lower-cased (as the subgraph stores it), upper-cased, or already
// checksummed; all three normalise to the one EIP-55 checksummed form viem expects.
test("an address in any case normalises to its checksummed form", () => {
  const checksummed = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
  assert.equal(normalizeAddressInput(checksummed.toLowerCase()), checksummed);
  assert.equal(normalizeAddressInput(checksummed.toUpperCase().replace("0X", "0x")), checksummed);
  assert.equal(normalizeAddressInput(checksummed), checksummed);
});

// Reverse-resolving something that is not an address is caller misuse, not a "no record"
// result — so it throws rather than returning null.
test("a non-address input is refused", () => {
  assert.throws(() => normalizeAddressInput("vitalik.eth"), InvalidAddressError);
  assert.throws(() => normalizeAddressInput("0xdeadbeef"), InvalidAddressError);
  assert.throws(() => normalizeAddressInput(""), InvalidAddressError);
});
