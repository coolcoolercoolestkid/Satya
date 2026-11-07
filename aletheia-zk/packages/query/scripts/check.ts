/**
 * The stage 13 gate, run against the real subgraph.
 *
 * TODO.md, day 13: "a live query against the real endpoint returns the stage 11 record
 * plus meta. No mocked `fetch` anywhere in the read path." This script is the artifact
 * that closes it. It talks to the deployed Studio endpoint over the network; there is
 * nothing to stub and nothing is stubbed.
 *
 * The verification id below is the query *input*, not a stored answer: it is the record
 * the stage 11 transaction produced, recorded in docs/deployments.md, and looking it up
 * is the only way to prove the read path returns real indexed data. Every value printed
 * comes back from the endpoint. Pass a different id as the first argument to check
 * another record.
 *
 *   pnpm --filter @aletheia/query run check
 */

import process from "node:process";

import { createQueryClient } from "../src/index.ts";
import type { Verification } from "../src/types.ts";

/** The `ClaimVerified` produced by the stage 11 transaction (docs/deployments.md). */
const STAGE_11_VERIFICATION_ID =
  "0xd24a4fc1052a1b7753e1fffd825666a3946fd2ee5c88e8f472fb743fab6928c3";
/** The transaction that produced it. Checked against what the endpoint returns. */
const STAGE_11_TRANSACTION_HASH =
  "0x195671d0f3d105a5401656b7ad35d0cd6d94190fd17061dd6d70833524b92719";

function line(label: string, value: unknown): void {
  console.log(`  ${label.padEnd(20)} ${String(value)}`);
}

function printVerification(verification: Verification): void {
  line("id", verification.id);
  line("claimType", `${verification.claimType} (1 = age)`);
  line("claimParameter", verification.claimParameter);
  line("credentialValidOn", verification.credentialValidOn);
  line("subject", verification.subject.id);
  line("subject registered", verification.subject.registeredAt ?? "never (shell profile)");
  line("issuer", verification.issuer.id);
  line("issuer label", verification.issuer.label);
  line("issuer active", verification.issuer.active);
  line("contextId", verification.contextId);
  line("nullifier", verification.nullifier);
  line("identityNullifier", verification.identityNullifier);
  line("verifiedAt", verification.verifiedAt);
  line("blockNumber", verification.blockNumber);
  line("transactionHash", verification.transactionHash);
}

async function main(): Promise<void> {
  const target = process.argv[2] ?? STAGE_11_VERIFICATION_ID;
  const client = createQueryClient();
  console.log(`endpoint: ${client.endpoint}\n`);

  // Every read carries meta, so this is the same object the record query returns; asking
  // for it alone first makes the indexer's state visible even if the record is missing.
  const meta = await client.meta();
  console.log("indexer:");
  line("last indexed block", meta.blockNumber);
  line("hasIndexingErrors", meta.hasIndexingErrors);
  console.log();

  if (meta.hasIndexingErrors) {
    // Not fatal on its own — the record may still be there — but a subgraph that has
    // errored cannot be assumed complete, and reading it as complete is how "not
    // verified" gets reported for something that was verified.
    console.error(
      "WARNING: the subgraph reports indexing errors. Its records are not complete.",
    );
  }

  const result = await client.verification(target);
  if (result.data === null) {
    console.error(`FAIL: no Verification is indexed for ${target}.`);
    console.error(
      `The subgraph has indexed up to block ${result.meta.blockNumber}; the stage 11 ` +
        `claim was mined in block 11674993. If the indexer is behind that, wait and re-run.`,
    );
    process.exitCode = 1;
    return;
  }

  const verification = result.data;
  console.log("verification (live, from the endpoint):");
  printVerification(verification);
  line("meta block", result.meta.blockNumber);
  console.log();

  // The record must be the one the stage 11 transaction actually produced. Checking the
  // transaction hash rather than only the id is what makes this a real gate: an id can
  // be produced by any transaction, the hash cannot.
  if (target === STAGE_11_VERIFICATION_ID) {
    if (verification.transactionHash.toLowerCase() !== STAGE_11_TRANSACTION_HASH) {
      console.error(
        `FAIL: the indexed record points at transaction ${verification.transactionHash}, ` +
          `not the stage 11 transaction ${STAGE_11_TRANSACTION_HASH}.`,
      );
      process.exitCode = 1;
      return;
    }
    if (verification.issuer.label !== "mock-dev") {
      // Phase 1 has exactly one issuer and it is labelled. A record that reads as
      // anything else would be a record presenting a mock as real.
      console.error(
        `FAIL: the record's issuer is labelled ${JSON.stringify(verification.issuer.label)}, ` +
          `expected "mock-dev".`,
      );
      process.exitCode = 1;
      return;
    }
  }

  // The relation resolves in both directions: the subject Profile derives its list back.
  const profile = await client.profile(verification.subject.id, { first: 5 });
  console.log("subject profile (derived side of the relation):");
  if (profile.data === null) {
    console.error("FAIL: the subject has a verification but no Profile entity.");
    process.exitCode = 1;
    return;
  }
  line("id", profile.data.id);
  line("registeredAt", profile.data.registeredAt ?? "never (shell profile)");
  line("verifications", profile.data.verifications.length);
  const derived = profile.data.verifications.some((entry) => entry.id === verification.id);
  line("includes this record", derived);
  console.log();

  if (!derived) {
    console.error(
      "FAIL: the subject's derived verifications list does not contain this record.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    "stage 13 gate: the stage 11 record and the indexer's meta were both read live " +
      "from the deployed subgraph.",
  );
  console.log(
    "\nEvery record above is derived from the mock-dev issuer, which verifies no " +
      "identity. See docs/trust-model.md.",
  );
}

await main();
