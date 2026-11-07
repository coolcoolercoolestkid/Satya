/**
 * The stage 14 gate, run against real mainnet ENS.
 *
 * TODO.md, day 15 exit criteria: "a real name resolves to a real address; a name that
 * does not exist returns not-found rather than throwing; an address with no reverse
 * record is a normal first-class case." This script is the artifact that closes it. It
 * talks to mainnet through the configured `MAINNET_RPC_URL` and the Universal Resolver
 * proxy; there is nothing stubbed.
 *
 * The name below (`vitalik.eth`) is the query *input*, a test vector recorded in
 * `myTasks.md` — not a stored answer. The implementation neither hardcodes its address
 * nor special-cases the name: every value printed is what the Universal Resolver returned
 * live. Pass a different name as the first argument to resolve another.
 *
 *   pnpm --filter @aletheia/ens run check
 */

import process from "node:process";

import { getAddress, keccak256, toBytes, type Address } from "viem";

import { createEnsResolver } from "../src/index.ts";

/** The nominated forward test vector (myTasks.md item 5). Input, not a stored result. */
const FORWARD_TEST_NAME = "vitalik.eth";

/**
 * A name nobody has registered. Any unregistered name exercises the not-found path; this
 * one is long and project-specific so a squatter is not going to register it out from
 * under the test.
 */
const NONEXISTENT_NAME = "aletheia-day15-name-that-is-not-registered-9f3a2c7e.eth";

/**
 * An address with no reverse record, derived deterministically so the test is reproducible
 * and can never acquire a record. A reverse record can only be set by the address's owner
 * through the reverse registrar, which needs the private key; this address is the keccak
 * of a fixed label, so no private key exists for it and it is permanently record-free.
 */
const NO_REVERSE_RECORD_ADDRESS: Address = getAddress(
  `0x${keccak256(toBytes("aletheia-day-15-no-reverse-record")).slice(-40)}`,
);

function line(label: string, value: unknown): void {
  console.log(`  ${label.padEnd(22)} ${String(value)}`);
}

async function main(): Promise<void> {
  const forwardName = process.argv[2] ?? FORWARD_TEST_NAME;
  const resolver = createEnsResolver();
  console.log(`universal resolver: ${resolver.universalResolverAddress}\n`);

  // 1. A real name resolves to a real address.
  const address = await resolver.resolveAddress(forwardName);
  console.log("forward (name -> address), live:");
  line("name", forwardName);
  line("address", address ?? "null");
  if (address === null) {
    console.error(`FAIL: ${forwardName} resolved to no address; expected a real one.`);
    process.exitCode = 1;
    return;
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    console.error(`FAIL: ${forwardName} resolved to ${address}, which is not an address.`);
    process.exitCode = 1;
    return;
  }
  console.log();

  // Reverse of that address, as a demonstration that a real reverse record round-trips.
  // Not a gate: an address legitimately may have no primary name (that is check 3). When
  // it does have one, ENSv2 enforces the forward-match on-chain, and we re-check it here.
  const primaryName = await resolver.resolveName(address);
  console.log("reverse (address -> name) of the resolved address, live:");
  line("address", address);
  line("primary name", primaryName ?? "null (no reverse record set)");
  if (primaryName !== null) {
    const roundTrip = await resolver.resolveAddress(primaryName);
    line("forward of that name", roundTrip ?? "null");
    if (roundTrip === null || getAddress(roundTrip) !== getAddress(address)) {
      console.error(
        `FAIL: reverse gave ${primaryName}, but it does not forward-resolve back to ${address}.`,
      );
      process.exitCode = 1;
      return;
    }
    line("round-trips", true);
  }
  console.log();

  // 2. A name that does not exist returns not-found (null) rather than throwing.
  console.log("forward of a name that does not exist, live:");
  line("name", NONEXISTENT_NAME);
  const missing = await resolver.resolveAddress(NONEXISTENT_NAME);
  line("address", missing === null ? "null (not found)" : missing);
  if (missing !== null) {
    console.error(
      `FAIL: ${NONEXISTENT_NAME} resolved to ${missing}; expected null. Is it registered?`,
    );
    process.exitCode = 1;
    return;
  }
  console.log();

  // 3. An address with no reverse record is a normal, first-class null — not an error.
  console.log("reverse of an address with no reverse record, live:");
  line("address", NO_REVERSE_RECORD_ADDRESS);
  const noName = await resolver.resolveName(NO_REVERSE_RECORD_ADDRESS);
  line("primary name", noName === null ? "null (no reverse record)" : noName);
  if (noName !== null) {
    console.error(
      `FAIL: a keccak-derived address returned the name ${noName}; it should have none.`,
    );
    process.exitCode = 1;
    return;
  }
  console.log();

  console.log(
    "stage 14 gate: a real name resolved to a real address, a nonexistent name returned " +
      "not-found without throwing, and an address with no reverse record returned null.",
  );
  console.log(
    "\nENS is resolved live and read-only through the Universal Resolver. No name is " +
      "stored on-chain or in the subgraph. See docs/architecture.md, ENS section.",
  );
}

await main();
