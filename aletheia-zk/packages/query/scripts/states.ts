/**
 * The Day 14 gate, run against the real subgraph.
 *
 * TODO.md, day 14: "Derive `verified`, `stale`, `revoked issuer`, `pending indexing`,
 * `not found`, each with its own reason ... all five reproduced from real endpoint data,
 * each with the artifact that caused it. A simulated state does not count."
 *
 * This script is the read half of that gate. It performs live queries and runs the pure
 * `deriveVerificationState` over what the endpoint actually returns — nothing is stubbed.
 * Which of the five it can show depends on the real state of the chain and the indexer at
 * the moment it runs, so it is driven through a sequence (see STATUS.md, "The five
 * verification states"):
 *
 *   - `verified` and `stale`  — the same real record, read now, under a generous and a
 *     tight freshness window. The record is genuinely hours old, so the tight window
 *     renders it stale and the generous one verified. No chain write needed.
 *   - `not-found`             — a real query for an id no record matches.
 *   - `pending`               — run with `--expected-block B` right after a real submit,
 *     while the indexer is still behind block B (scripts/submit-age-claim.ts supplies B).
 *   - `revoked`               — run after scripts/set-issuer-active.ts has flipped the
 *     mock-dev issuer inactive on-chain and the subgraph has indexed that block; the same
 *     record then reads `revoked` instead of verified.
 *
 * Usage:
 *   pnpm --filter @aletheia/query run states
 *   pnpm --filter @aletheia/query run states -- --id 0x… --expected-block 11700000
 *   pnpm --filter @aletheia/query run states -- --not-found      # force the not-found demo
 */

import process from "node:process";

import { createQueryClient } from "../src/index.ts";
import { deriveVerificationState, type FreshnessPolicy } from "../src/state.ts";
import type { Verification } from "../src/types.ts";

/** The `ClaimVerified` produced by the stage 11 transaction (docs/deployments.md). */
const STAGE_11_VERIFICATION_ID =
  "0xd24a4fc1052a1b7753e1fffd825666a3946fd2ee5c88e8f472fb743fab6928c3";

/** An id no record will ever match: all zeroes. Used to reproduce `not-found`. */
const NONEXISTENT_ID = `0x${"0".repeat(64)}`;

/** A generous verifier: a verification is fresh for 30 days. */
const GENEROUS: FreshnessPolicy = { maxVerificationAgeSeconds: 30 * 24 * 60 * 60 };
/** A strict verifier: a verification older than one hour is stale. */
const TIGHT: FreshnessPolicy = { maxVerificationAgeSeconds: 60 * 60 };

interface Args {
  id: string;
  expectedBlock?: bigint;
  notFound: boolean;
}

function parseArgs(argv: string[]): Args {
  let id = STAGE_11_VERIFICATION_ID;
  let expectedBlock: bigint | undefined;
  let notFound = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--id") {
      const value = argv[(i += 1)];
      if (value === undefined) throw new Error("--id needs a value");
      id = value;
    } else if (arg === "--expected-block") {
      const value = argv[(i += 1)];
      if (value === undefined) throw new Error("--expected-block needs a value");
      expectedBlock = BigInt(value);
    } else if (arg === "--not-found") {
      notFound = true;
    } else if (arg === "--") {
      // pnpm forwards a literal `--` separator; ignore it.
      continue;
    } else {
      throw new Error(`unknown argument ${JSON.stringify(arg)}`);
    }
  }
  const resolvedId = notFound ? NONEXISTENT_ID : id;
  return { id: resolvedId, notFound, ...(expectedBlock !== undefined ? { expectedBlock } : {}) };
}

function line(label: string, value: unknown): void {
  console.log(`  ${label.padEnd(20)} ${String(value)}`);
}

function printRecord(v: Verification): void {
  line("id", v.id);
  line("issuer", `${v.issuer.id} (${JSON.stringify(v.issuer.label)})`);
  line("issuer active", v.issuer.active);
  line("verifiedAt", v.verifiedAt);
  line("blockNumber", v.blockNumber);
  line("transactionHash", v.transactionHash);
}

/** Print the derived state for one policy, labelled, so the artifact and the verdict sit together. */
function report(label: string, state: ReturnType<typeof deriveVerificationState>): void {
  console.log(`\n[${label}] -> ${state.status.toUpperCase()}`);
  console.log(`  reason: ${state.reason}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const client = createQueryClient();
  const nowSeconds = Math.floor(Date.now() / 1000);
  console.log(`endpoint: ${client.endpoint}`);
  console.log(`now:      ${nowSeconds} (Unix seconds, this machine's clock)\n`);

  // One live read: the record (or null) and the indexer's meta, together.
  const result = await client.verification(args.id);
  console.log("live read:");
  line("queried id", args.id);
  line("indexer block", result.meta.blockNumber);
  line("hasIndexingErrors", result.meta.hasIndexingErrors);
  if (result.data === null) {
    line("record", "null (no such record indexed)");
  } else {
    console.log("record:");
    printRecord(result.data);
  }

  const base = {
    verification: result.data,
    meta: result.meta,
    nowSeconds,
    ...(args.expectedBlock !== undefined ? { expectedBlock: args.expectedBlock } : {}),
  };

  if (result.data === null) {
    // Absent: either pending (a specific newer block was expected) or not-found. The
    // derivation decides from the real block gap, not from a flag we set.
    const state = deriveVerificationState({ ...base, policy: GENEROUS });
    report(args.expectedBlock !== undefined ? "absent, expecting block" : "absent", state);
    console.log(
      `\nDay 14: reproduced ${state.status.toUpperCase()} from a real query returning no record` +
        (args.expectedBlock !== undefined
          ? ` while the indexer (block ${result.meta.blockNumber}) is behind block ${args.expectedBlock}.`
          : "."),
    );
    return;
  }

  // Present: the same real record read under two real verifier policies. If the issuer has
  // been revoked on-chain, both collapse to `revoked` and freshness never enters into it.
  const generous = deriveVerificationState({ ...base, policy: GENEROUS });
  const tight = deriveVerificationState({ ...base, policy: TIGHT });
  report(`generous policy (${GENEROUS.maxVerificationAgeSeconds}s window)`, generous);
  report(`tight policy (${TIGHT.maxVerificationAgeSeconds}s window)`, tight);

  const seen = new Set([generous.status, tight.status]);
  console.log(
    `\nDay 14: from one real indexed record, reproduced ${[...seen].map((s) => s.toUpperCase()).join(" and ")}.`,
  );
  if (!result.data.issuer.active) {
    console.log(
      "The issuer reads inactive on-chain: this is the `revoked` state, from a real " +
        "IssuerActiveSet(false) — see STATUS.md.",
    );
  }
  console.log(
    "\nEvery record above is derived from the mock-dev issuer, which verifies no " +
      "identity. See docs/trust-model.md.",
  );
}

await main();
