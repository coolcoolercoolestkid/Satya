/**
 * Arkiv mirror of the Aletheia contracts (ETHGlobal Mumbai 2026; replaces the subgraph).
 *
 * Reads every event the Aletheia contracts emitted on Sepolia (ClaimVerified on each
 * AletheiaVerifier deployment, IssuerRegistered / IssuerActiveSet on the registry,
 * ProfileRegistered on the profile contract) and writes each log to Arkiv once, as an
 * `aletheia_event_v1` entity. Then it records the block it has fully copied in an
 * `aletheia_mirror_meta_v1` entity, which readers use as the "indexed up to" block.
 *
 * Idempotent: logs already on Arkiv (same tx hash and log index) are skipped, so it can run
 * on a schedule.
 *
 *   SATYA_PUBLISHER_KEY=0x… node --experimental-strip-types packages/arkiv-mirror/src/mirror.ts
 *
 * The key defaults to the one in Satya's packages/registry/.env.
 */
import { readFileSync, existsSync } from "node:fs";
import { createPublicClient as createArkivReader, createWalletClient, ExpirationTime } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { eq } from "@arkiv-network/sdk/query";
import { addr, u64 } from "@arkiv-network/sdk/schema";
import { createPublicClient, http, isHex, parseAbi, stringToBytes, type Hex, type Log } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

import { AletheiaEvent, AletheiaMirrorMeta, SEPOLIA_CHAIN_ID } from "../../query/src/arkiv.ts";

const root = new URL("../../../", import.meta.url);
const deployment = JSON.parse(readFileSync(new URL("packages/contracts/deployments/sepolia.json", root), "utf8"));

const satyaEnv = new URL("../packages/registry/.env", root);
if (!process.env.SATYA_PUBLISHER_KEY && existsSync(satyaEnv)) process.loadEnvFile(satyaEnv);
const key = process.env.SATYA_PUBLISHER_KEY;
if (!key || !isHex(key)) throw new Error("Set SATYA_PUBLISHER_KEY (0x + 64 hex), the Arkiv publisher key.");
const account = privateKeyToAccount(key as Hex);

// Tenderly's public gateway keeps full history; many free RPCs prune old logs.
const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL ?? "https://sepolia.gateway.tenderly.co";
const sepoliaClient = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) });
const arkivChain = rabdi({ accessKey: process.env.ARKIV_ACCESS_KEY ?? "" });
const arkiv = createWalletClient({ chain: arkivChain, transport: http(), account });
const arkivReader = createArkivReader({ chain: arkivChain, transport: http() });

const ABI = parseAbi([
  "event ClaimVerified(bytes32 indexed verificationId, address indexed subject, uint8 indexed claimType, bytes32 issuerId, uint256 claimParameter, uint32 credentialValidOn, bytes32 contextId, bytes32 nullifier, bytes32 identityNullifier, uint64 verifiedAt)",
  "event IssuerRegistered(bytes32 indexed issuerId, uint256 ax, uint256 ay, string label, uint64 registeredAt)",
  "event IssuerActiveSet(bytes32 indexed issuerId, bool active)",
  "event ProfileRegistered(address indexed account, uint64 registeredAt)",
]);

/** Every contract the subgraph indexed, with the block to start from (subgraph.yaml). */
const SOURCES: { name: string; address: Hex; from: bigint; events: string[] }[] = [
  { name: "AletheiaVerifier", address: deployment.contracts.AletheiaVerifier.address, from: BigInt(deployment.contracts.AletheiaVerifier.deployBlock), events: ["ClaimVerified"] },
  ...deployment.previousDeployments.map((p: { AletheiaVerifier: { address: Hex; deployBlock: number } }, i: number) => ({
    name: `AletheiaVerifier (previous ${i + 1})`,
    address: p.AletheiaVerifier.address,
    from: BigInt(p.AletheiaVerifier.deployBlock),
    events: ["ClaimVerified"],
  })),
  { name: "AletheiaIssuerRegistry", address: deployment.contracts.AletheiaIssuerRegistry.address, from: BigInt(deployment.contracts.AletheiaIssuerRegistry.deployBlock), events: ["IssuerRegistered", "IssuerActiveSet"] },
  { name: "AletheiaProfile", address: deployment.contracts.AletheiaProfile.address, from: BigInt(deployment.contracts.AletheiaProfile.deployBlock), events: ["ProfileRegistered"] },
];

const CHUNK = 50_000n;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getLogsChunked(address: Hex, from: bigint, to: bigint) {
  const out: Log[] = [];
  let step = CHUNK;
  for (let start = from; start <= to; ) {
    const end = start + step - 1n > to ? to : start + step - 1n;
    try {
      out.push(...(await sepoliaClient.getLogs({ address, events: ABI, fromBlock: start, toBlock: end, strict: false })));
      start = end + 1n;
    } catch (e) {
      if (step <= 1000n) throw e;
      step /= 2n; // range too large for this RPC: halve and retry
    }
  }
  return out;
}

const json = (args: Record<string, unknown>) =>
  JSON.stringify(Object.fromEntries(Object.entries(args).map(([k, v]) => [k, typeof v === "string" ? v.toLowerCase() : String(v)])));

async function alreadyMirrored(txHash: string, logIndex: number) {
  const res = await arkivReader
    .select({ logIndex: true })
    .from(AletheiaEvent as never)
    .where(eq("txHash", txHash.toLowerCase()))
    .ownedBy(account.address)
    .limit(50)
    .fetch();
  return res.entities.some((r) => Number((r.logIndex as { value: unknown }).value ?? r.logIndex) === logIndex);
}

async function withRetry<T>(fn: () => Promise<T>, what: string): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= 6) throw e;
      console.warn(`  retry ${i} (${what}): ${e instanceof Error ? e.message.split("\n")[0] : e}`);
      await sleep(1500 * i);
    }
  }
}

const head = await sepoliaClient.getBlockNumber();
console.log(`Sepolia head ${head}. Mirroring to Arkiv as ${account.address}.`);
let written = 0;
let skipped = 0;
for (const src of SOURCES) {
  const logs = await getLogsChunked(src.address, src.from, head);
  console.log(`${src.name} ${src.address}: ${logs.length} logs`);
  for (const log of logs as (Log & { eventName?: string; args?: Record<string, unknown> })[]) {
    if (!log.eventName || !src.events.includes(log.eventName) || !log.args) continue;
    const a = log.args;
    const keyOf: Record<string, unknown> = {
      ClaimVerified: a.verificationId,
      IssuerRegistered: a.issuerId,
      IssuerActiveSet: a.issuerId,
      ProfileRegistered: a.account,
    };
    const subject = (log.eventName === "ClaimVerified" ? a.subject : log.eventName === "ProfileRegistered" ? a.account : undefined) as Hex | undefined;
    if (await withRetry(() => alreadyMirrored(log.transactionHash!, log.logIndex!), "check")) {
      skipped++;
      continue;
    }
    const r = await withRetry(
      () =>
        arkiv.createEntity(
          AletheiaEvent as never,
          {
            chainId: u64(SEPOLIA_CHAIN_ID),
            contract: addr(src.address),
            event: log.eventName!,
            eventKey: String(keyOf[log.eventName!]).toLowerCase(),
            ...(subject ? { subject: addr(subject) } : {}),
            blockNumber: u64(log.blockNumber!),
            logIndex: u64(BigInt(log.logIndex!)),
            txHash: log.transactionHash!.toLowerCase(),
            payload: stringToBytes(json(a)),
          },
          { expiration: ExpirationTime.max() },
        ),
      "write",
    );
    written++;
    console.log(`  + ${log.eventName} block ${log.blockNumber} → ${r.entityKey}`);
  }
}
const metaWrite = await withRetry(
  () =>
    arkiv.createEntity(
      AletheiaMirrorMeta as never,
      {
        chainId: u64(SEPOLIA_CHAIN_ID),
        syncedBlock: u64(head),
        payload: stringToBytes(JSON.stringify({ sources: SOURCES.map((s) => s.address), mirroredAt: new Date().toISOString() })),
      },
      { expiration: ExpirationTime.max() },
    ),
  "meta",
);
console.log(`Done: ${written} written, ${skipped} already there. Synced to Sepolia block ${head} (meta ${metaWrite.entityKey}).`);
