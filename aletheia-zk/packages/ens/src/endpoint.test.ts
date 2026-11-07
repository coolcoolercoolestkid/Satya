import assert from "node:assert/strict";
import { test } from "node:test";

import { assertMainnetRpc, resolveMainnetRpc } from "./endpoint.ts";
import { MainnetRpcNotConfiguredError } from "./errors.ts";

// A resolver pointed at the wrong chain returns a wrong address with full confidence, so
// an unset variable is an error, not a silent default.
test("an unset MAINNET_RPC_URL is an error, not a default", () => {
  assert.throws(() => resolveMainnetRpc({}), MainnetRpcNotConfiguredError);
});

test("an empty or whitespace-only MAINNET_RPC_URL is an error", () => {
  assert.throws(() => resolveMainnetRpc({ MAINNET_RPC_URL: "" }), MainnetRpcNotConfiguredError);
  assert.throws(
    () => resolveMainnetRpc({ MAINNET_RPC_URL: "   " }),
    MainnetRpcNotConfiguredError,
  );
});

test("surrounding whitespace in the .env value is tolerated", () => {
  assert.equal(
    resolveMainnetRpc({ MAINNET_RPC_URL: "  https://eth-mainnet.example/v2/key  " }),
    "https://eth-mainnet.example/v2/key",
  );
});

// Plaintext http would let anyone on the path rewrite the address a name resolves to,
// which a verifier then trusts.
test("a non-https endpoint is refused", () => {
  assert.throws(
    () => assertMainnetRpc("http://eth-mainnet.example/v2/key"),
    MainnetRpcNotConfiguredError,
  );
  assert.throws(() => assertMainnetRpc("ws://eth-mainnet.example"), MainnetRpcNotConfiguredError);
});

test("a value that is not a URL is refused", () => {
  assert.throws(() => assertMainnetRpc("mainnet"), MainnetRpcNotConfiguredError);
});
