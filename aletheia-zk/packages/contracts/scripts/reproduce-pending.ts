/**
 * Reproduce the `pending indexing` verification state from a real transaction (Day 14).
 *
 * `pending` is the one state that cannot be read from data already sitting in the
 * subgraph: it is the gap between a transaction being mined and the indexer reaching its
 * block. TODO.md, day 14: "`pending` means querying inside the real indexing window." So
 * this script opens that window itself — it submits a genuine age claim, and the instant
 * the receipt returns it polls the deployed subgraph through the real query client,
 * running the pure `deriveVerificationState` over each live read.
 *
 * The Studio indexer lags the chain head by about a block, so the window is short. The
 * first poll, taken immediately after the submit block B is mined, sees the record still
 * absent and `_meta.block.number < B` — which `deriveVerificationState` classifies
 * `pending / awaiting-index`. Polling continues until the indexer reaches B and the same
 * lookup flips to `verified`. Both observations are real reads of the real endpoint;
 * nothing here is stubbed, and the record is a real ClaimVerified event, not a fixture.
 *
 * This deliberately does NOT do the replay-revert that submit-age-claim.ts does: every
 * extra transaction and receipt wait is time the indexer uses to close the window before
 * the first poll.
 *
 * Run against the network holding the deployment (spends Sepolia gas):
 *   npx hardhat run scripts/reproduce-pending.ts --network sepolia
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import {
  SCHEMA_VERSION,
  hashToField,
  randomFieldElement,
  todayUtcYyyymmdd,
  type NormalizedCredential,
} from "@aletheia/credential";
import { proveAgeClaim, releaseProver, toSolidityCalldata } from "@aletheia/circuits";
import {
  MOCK_ISSUER_LABEL,
  defaultKeystorePath,
  deriveIdentitySecret,
  parseKeystore,
  randomIdentitySalt,
  signCredential,
  type KeystoreFile,
} from "@aletheia/issuer-mock";
import {
  createQueryClient,
  deriveVerificationState,
  type FreshnessPolicy,
  type VerificationState,
} from "@aletheia/query";
import { network } from "hardhat";
import { keccak256, parseEventLogs, stringToBytes, type Abi } from "viem";

const HERE = dirname(fileURLToPath(import.meta.url));

/** A generous window, so once indexed the record reads `verified`, not `stale`. */
const POLICY: FreshnessPolicy = { maxVerificationAgeSeconds: 30 * 24 * 60 * 60 };
/** How long to keep polling for the record to index before giving up. */
const POLL_BUDGET_MS = 4 * 60 * 1000;
/** Gap between polls. Short enough to catch the pending window, not a busy loop. */
const POLL_INTERVAL_MS = 1500;

function deployedVerifierAddress(chainId: number): `0x${string}` {
  const file = join(
    HERE,
    "..",
    "ignition",
    "deployments",
    `chain-${chainId}`,
    "deployed_addresses.json",
  );
  let addresses: Record<string, string>;
  try {
    addresses = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
  } catch {
    throw new Error(`no Ignition deployment for chain ${chainId} (${file} is missing).`);
  }
  const address = addresses["Aletheia#AletheiaVerifier"];
  if (address === undefined) {
    throw new Error(`chain ${chainId} has a deployment but no AletheiaVerifier in it.`);
  }
  return address as `0x${string}`;
}

async function loadMockIssuer() {
  const path = defaultKeystorePath();
  let file: KeystoreFile;
  try {
    file = JSON.parse(readFileSync(path, "utf8")) as KeystoreFile;
  } catch {
    throw new Error(`no issuer keystore at ${path}.`);
  }
  if (file.label !== MOCK_ISSUER_LABEL) {
    throw new Error(
      `refusing to sign with a keystore labelled "${file.label}", not "${MOCK_ISSUER_LABEL}".`,
    );
  }
  return parseKeystore(file);
}

function describe(state: VerificationState): string {
  return state.status === "pending"
    ? `${state.status.toUpperCase()} (${state.cause}) — ${state.reason}`
    : `${state.status.toUpperCase()} — ${state.reason}`;
}

async function main(): Promise<void> {
  console.error(
    "!! mock issuer: the credential signed below verifies no identity. This proves the " +
      "pending-indexing state is real, not that anyone is who they say they are. !!",
  );

  const { viem, networkName } = await network.getOrCreate();
  const publicClient = await viem.getPublicClient();
  const [walletClient] = await viem.getWalletClients();
  if (walletClient === undefined) throw new Error("no signer available for this network");
  const account = walletClient.account;

  const chainId = await publicClient.getChainId();
  const verifierAddress = deployedVerifierAddress(chainId);
  const verifier = await viem.getContractAt("AletheiaVerifier", verifierAddress);
  const abi = verifier.abi as Abi;

  console.log(`network:  ${networkName} (chain id ${chainId})`);
  console.log(`verifier: ${verifierAddress}`);
  console.log(`subject:  ${account.address}`);

  const currentDate = todayUtcYyyymmdd();
  const credential: NormalizedCredential = {
    schemaVersion: SCHEMA_VERSION,
    credentialId: randomFieldElement(),
    subject: account.address.toLowerCase(),
    dateOfBirth: 20040314,
    nationality: 356,
    expiryDate: 20340314,
    issuedAt: currentDate,
    identitySecret: await deriveIdentitySecret({
      issuerSalt: randomIdentitySalt(),
      documentKey: randomFieldElement(),
    }),
  };

  const { privateKey } = await loadMockIssuer();
  const signed = await signCredential(privateKey, credential);
  const contextId = hashToField(keccak256(stringToBytes("aletheia:day14:pending")));
  const request = { minimumAge: 18, currentDate, contextId } as const;

  console.log(`\nproving age >= ${request.minimumAge} on ${currentDate}...`);
  const { proof, publicSignals } = await proveAgeClaim(signed, request);
  const calldata = await toSolidityCalldata(proof, publicSignals);
  const signals = calldata.publicSignals as readonly [
    bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  ];
  const args = [calldata.a, calldata.b, calldata.c, signals] as const;

  const { result: verificationId, request: writeRequest } = await publicClient.simulateContract({
    address: verifierAddress,
    abi,
    functionName: "submitAgeClaim",
    args,
    account,
  });
  console.log(`verificationId: ${verificationId}`);

  const submitHash = await walletClient.writeContract(writeRequest);
  console.log(`submit tx: ${submitHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: submitHash });
  if (receipt.status !== "success") {
    throw new Error(`submission reverted on-chain (status ${receipt.status})`);
  }
  const submitBlock = receipt.blockNumber;
  const events = parseEventLogs({ abi, logs: receipt.logs, eventName: "ClaimVerified" });
  if (events[0] === undefined) throw new Error("submission emitted no ClaimVerified event");
  console.log(`mined in block ${submitBlock}. Polling the subgraph from here...\n`);

  // ---- The pending window ------------------------------------------------------------

  const client = createQueryClient();
  console.log(`endpoint: ${client.endpoint}`);

  let sawPending: { state: VerificationState; indexerBlock: bigint } | undefined;
  let sawVerified: { state: VerificationState; indexerBlock: bigint } | undefined;
  const deadline = Date.now() + POLL_BUDGET_MS;

  while (Date.now() < deadline) {
    const result = await client.verification(verificationId);
    const state = deriveVerificationState({
      verification: result.data,
      meta: result.meta,
      policy: POLICY,
      nowSeconds: Math.floor(Date.now() / 1000),
      expectedBlock: submitBlock,
    });
    const tag = `indexer@${result.meta.blockNumber} (submit@${submitBlock})`;
    console.log(`  ${tag}: ${describe(state)}`);

    if (state.status === "pending" && sawPending === undefined) {
      sawPending = { state, indexerBlock: result.meta.blockNumber };
    }
    if (state.status === "verified") {
      sawVerified = { state, indexerBlock: result.meta.blockNumber };
      break;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  console.log("\n--- Day 14 pending artifacts ---");
  console.log(`submit tx:      ${submitHash}`);
  console.log(`verificationId: ${verificationId}`);
  console.log(`submit block:   ${submitBlock}`);
  if (sawPending !== undefined) {
    console.log(
      `PENDING observed: indexer at block ${sawPending.indexerBlock}, behind the submit ` +
        `block ${submitBlock} — the record was mined but not yet queryable.`,
    );
  } else {
    console.log(
      "PENDING was not observed: the indexer had already reached the submit block by the " +
        "first poll. Re-run — the window is ~1 block and can be missed.",
    );
  }
  if (sawVerified !== undefined) {
    console.log(
      `VERIFIED observed: indexer reached block ${sawVerified.indexerBlock}; the same ` +
        "lookup now returns the record.",
    );
  } else {
    console.log(`VERIFIED not observed within ${POLL_BUDGET_MS / 1000}s; the indexer may be lagging.`);
  }

  if (sawPending === undefined || sawVerified === undefined) {
    process.exitCode = 1;
  }
}

try {
  await main();
} finally {
  await releaseProver();
}
