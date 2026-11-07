import assert from "node:assert/strict";
import { test } from "node:test";

import { __internal } from "./client.ts";
import { assertQueryEndpoint, resolveEndpoint } from "./endpoint.ts";
import { EndpointNotConfiguredError } from "./errors.ts";

const { assertPage, normalizeAddress, normalizeBytes32 } = __internal;

// The endpoint decides which subgraph answers, and a client pointed at the wrong one
// returns confident, well-formed, wrong records. So there is no default and no fallback:
// an unset variable is an error, not an empty result.
test("an unset GRAPH_QUERY_URL is an error, not a default", () => {
  assert.throws(() => resolveEndpoint({}), EndpointNotConfiguredError);
});

test("an empty or whitespace-only GRAPH_QUERY_URL is an error", () => {
  assert.throws(() => resolveEndpoint({ GRAPH_QUERY_URL: "" }), EndpointNotConfiguredError);
  assert.throws(
    () => resolveEndpoint({ GRAPH_QUERY_URL: "   " }),
    EndpointNotConfiguredError,
  );
});

test("surrounding whitespace in the .env value is tolerated", () => {
  assert.equal(
    resolveEndpoint({
      GRAPH_QUERY_URL: "  https://api.studio.thegraph.com/query/1760063/aletheia/v0.0.2  ",
    }),
    "https://api.studio.thegraph.com/query/1760063/aletheia/v0.0.2",
  );
});

// Plaintext http would let anyone on the path rewrite the answer to "is this person
// verified", which is the only question this package exists to ask.
test("a non-https endpoint is refused", () => {
  assert.throws(
    () => assertQueryEndpoint("http://api.studio.thegraph.com/query/1/aletheia/v0.0.2"),
    EndpointNotConfiguredError,
  );
  assert.throws(() => assertQueryEndpoint("file:///tmp/subgraph"), EndpointNotConfiguredError);
});

test("a value that is not a URL is refused", () => {
  assert.throws(() => assertQueryEndpoint("aletheia"), EndpointNotConfiguredError);
});

// The subgraph stores Bytes ids lower-cased, so a checksummed address queried verbatim
// returns null — a "not found" that is really a "wrong case". Normalising means a caller
// can pass whichever form they happen to hold.
test("a checksummed address is lower-cased for lookup", () => {
  assert.equal(
    normalizeAddress("0xA66f7fc3F125b06a5fd4f107D31a400103866cAe"),
    "0xa66f7fc3f125b06a5fd4f107d31a400103866cae",
  );
});

test("an address of the wrong length is refused", () => {
  assert.throws(() => normalizeAddress("0xa66f7fc3"), TypeError);
  assert.throws(
    () => normalizeAddress("0xa66f7fc3f125b06a5fd4f107d31a400103866caeff"),
    TypeError,
  );
});

test("a non-hex address is refused", () => {
  assert.throws(() => normalizeAddress("alice.eth"), TypeError);
});

test("a bytes32 id is lower-cased and length-checked", () => {
  assert.equal(
    normalizeBytes32(
      "0xD24A4FC1052A1B7753E1FFFD825666A3946FD2EE5C88E8F472FB743FAB6928C3",
      "verificationId",
    ),
    "0xd24a4fc1052a1b7753e1fffd825666a3946fd2ee5c88e8f472fb743fab6928c3",
  );
  assert.throws(() => normalizeBytes32("0xdeadbeef", "verificationId"), TypeError);
});

// graph-node refuses first > 1000. Rejecting it here means the error says what is wrong
// rather than arriving as a GraphQL error from the server.
test("page bounds are enforced before the request is sent", () => {
  assert.deepEqual(assertPage(undefined), { first: 100, skip: 0 });
  assert.deepEqual(assertPage({ first: 5, skip: 10 }), { first: 5, skip: 10 });
  assert.throws(() => assertPage({ first: 0 }), RangeError);
  assert.throws(() => assertPage({ first: 1001 }), RangeError);
  assert.throws(() => assertPage({ first: 1.5 }), RangeError);
  assert.throws(() => assertPage({ skip: -1 }), RangeError);
});
