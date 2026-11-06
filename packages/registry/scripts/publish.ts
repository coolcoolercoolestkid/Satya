/**
 * Satya registry publisher.
 *
 *   pnpm --filter @satya/registry publish-registry keygen
 *   pnpm --filter @satya/registry publish-registry publish ofac [--file SDN.XML] [--dry-run]
 *   pnpm --filter @satya/registry publish-registry publish metamask [--file config.json] [--dry-run]
 *   pnpm --filter @satya/registry publish-registry verify ofac|metamask [--file …]
 *   pnpm --filter @satya/registry publish-registry lookup <domain or 0x address>
 *
 * Downloads a public list from its official source, hashes and buckets it, and writes one
 * Arkiv record per bucket (256 per source), owned by the Satya publisher wallet and expiring
 * in 7 days. `verify` rebuilds the buckets from the source and compares them with what is on
 * Arkiv, so anyone can check the registry against the original list.
 *
 * The publisher key lives in packages/registry/.env (git-ignored) as SATYA_PUBLISHER_KEY.
 * ARKIV_ACCESS_KEY there is optional (the public endpoint is heavily rate limited).
 */
import { createWalletClient } from "@arkiv-network/sdk";
import { u64 } from "@arkiv-network/sdk/schema";
import { rabdi } from "@arkiv-network/sdk/chains";
import { existsSync, readFileSync, appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { http, isHex, type Hex } from "viem";
import { generatePrivateKey, nonceManager, privateKeyToAccount } from "viem/accounts";
import {
  ALL_BUCKETS,
  BUCKET_LIFETIME,
  buildBuckets,
  fetchBucket,
  hashesOf,
  MAX_BUCKET_BYTES,
  ScamBucket,
  sha256Hex,
  SOURCES,
  bucketOf,
  domainCandidates,
  matchInRecords,
  SATYA_PUBLISHER,
} from "../src/index.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ENV = `${ROOT}.env`;
if (existsSync(ENV)) process.loadEnvFile(ENV);

const OFAC_URL = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML";
const METAMASK_URL = "https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json";

interface Loaded {
  sourceId: string;
  url: string;
  sha256: string;
  values: string[];
}

async function download(url: string, file?: string): Promise<Uint8Array> {
  if (file) return new Uint8Array(readFileSync(file));
  console.log(`Downloading ${url} …`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Every Ethereum-format (0x…) digital currency address in OFAC's SDN list. */
export function ofacAddresses(xml: string): string[] {
  const out = new Set<string>();
  for (const m of xml.matchAll(/<id>([\s\S]*?)<\/id>/g)) {
    const type = /<idType>([^<]*)<\/idType>/.exec(m[1]!)?.[1] ?? "";
    const num = /<idNumber>([^<]*)<\/idNumber>/.exec(m[1]!)?.[1]?.trim() ?? "";
    if (type.startsWith("Digital Currency Address") && /^0x[0-9a-fA-F]{40}$/.test(num)) out.add(num.toLowerCase());
  }
  return [...out];
}

/** MetaMask's blocklist, minus anything it also allowlists. */
export function metamaskDomains(json: string): string[] {
  const cfg = JSON.parse(json) as { blacklist: string[]; whitelist?: string[] };
  const allow = new Set((cfg.whitelist ?? []).map((d) => d.toLowerCase()));
  return cfg.blacklist.filter((d) => !allow.has(d.toLowerCase()));
}

async function load(which: string, file?: string): Promise<Loaded> {
  if (which === "ofac") {
    const raw = await download(OFAC_URL, file);
    return { sourceId: "ofac-sdn", url: OFAC_URL, sha256: await sha256Hex(raw), values: ofacAddresses(new TextDecoder().decode(raw)) };
  }
  if (which === "metamask") {
    const raw = await download(METAMASK_URL, file);
    return { sourceId: "metamask-phishing", url: METAMASK_URL, sha256: await sha256Hex(raw), values: metamaskDomains(new TextDecoder().decode(raw)) };
  }
  throw new Error(`Unknown source "${which}". Use ofac or metamask.`);
}

function publisher() {
  const key = process.env.SATYA_PUBLISHER_KEY;
  if (!key || !isHex(key)) throw new Error("No SATYA_PUBLISHER_KEY in packages/registry/.env. Run `keygen` first.");
  return privateKeyToAccount(key as Hex, { nonceManager });
}

const accessKey = () => process.env.ARKIV_ACCESS_KEY ?? "";

async function publish(which: string, file: string | undefined, dryRun: boolean) {
  const src = await load(which, file);
  const info = SOURCES[src.sourceId]!;
  const buckets = await buildBuckets(info.type, src.values);
  const nonEmpty = [...buckets.values()].filter((b) => b.length).length;
  console.log(`${info.label}: ${src.values.length} entries in ${nonEmpty} non-empty buckets. Source SHA-256 ${src.sha256}`);
  const largest = Math.max(...[...buckets.values()].map((b) => b.length));
  console.log(`Largest bucket: ${(largest / 1024).toFixed(1)} KB (Arkiv limit ${MAX_BUCKET_BYTES / 1024} KB)`);
  if (largest > MAX_BUCKET_BYTES) throw new Error("A bucket is over Arkiv's size limit; nothing was published.");
  if (dryRun) return;

  const account = publisher();
  const wallet = createWalletClient({ chain: rabdi({ accessKey: accessKey() }), transport: http(), account });
  const published = BigInt(Math.floor(Date.now() / 1000));
  const date = new Date().toISOString().slice(0, 10);
  const keys: Record<string, string> = {};
  const queue = [...ALL_BUCKETS];
  const CONCURRENCY = 6;
  let done = 0;

  async function worker() {
    for (let b = queue.shift(); b; b = queue.shift()) {
      const payload = buckets.get(b)!;
      for (let attempt = 1; ; attempt++) {
        try {
          const { entityKey } = await wallet.createEntity(
            ScamBucket,
            {
              type: info.type,
              source: src.sourceId,
              bucket: b,
              date,
              published: u64(published),
              sourceSha256: src.sha256,
              sourceUrl: src.url,
              count: u64(BigInt(payload.length / 32)),
              hashes: payload,
            },
            { expiration: BUCKET_LIFETIME },
          );
          keys[b] = entityKey;
          done++;
          if (done % 16 === 0 || done === 256) console.log(`  ${done}/256 buckets written`);
          break;
        } catch (err) {
          if (attempt >= 4) throw err;
          console.warn(`  bucket ${b} attempt ${attempt} failed: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
          await new Promise((r) => setTimeout(r, 2000 * attempt));
        }
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  mkdirSync(`${ROOT}runs`, { recursive: true });
  const manifest = {
    source: src.sourceId,
    label: info.label,
    licence: info.licence,
    sourceUrl: src.url,
    sourceSha256: src.sha256,
    entries: src.values.length,
    publisher: account.address,
    chain: "Arkiv Rabdi testnet (7794095)",
    date,
    published: Number(published),
    expiresInDays: 7,
    entityKeys: keys,
  };
  const out = `${ROOT}runs/${src.sourceId}-${date}.json`;
  writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Done. Manifest: ${out}`);
}

async function verify(which: string, file?: string) {
  const src = await load(which, file);
  const info = SOURCES[src.sourceId]!;
  const buckets = await buildBuckets(info.type, src.values);
  const owner = publisher().address;
  let ok = 0;
  const problems: string[] = [];
  for (const b of ALL_BUCKETS) {
    const rec = (await fetchBucket(b, owner, accessKey())).find((r) => r.source === src.sourceId);
    if (!rec) { problems.push(`${b}: no record on Arkiv`); continue; }
    const expected = hashesOf(buckets.get(b)!);
    const same = rec.hashes.size === expected.size && [...expected].every((h) => rec.hashes.has(h));
    if (!same) problems.push(`${b}: differs (Arkiv ${rec.hashes.size}, source ${expected.size}; Arkiv used source ${rec.sourceSha256.slice(0, 12)}…, you have ${src.sha256.slice(0, 12)}…)`);
    else ok++;
  }
  console.log(`${ok}/256 buckets match the source.`);
  for (const p of problems.slice(0, 20)) console.log(`  ${p}`);
  if (problems.length) process.exitCode = 1;
}

/** Does what the extension does: hash, fetch one bucket, match locally. Needs no key. */
async function lookup(value: string) {
  const isAddress = /^0x[0-9a-fA-F]{40}$/.test(value);
  const type = isAddress ? "address" : "domain";
  const bucket = await bucketOf(type, value);
  console.log(`${type} ${value} → bucket ${bucket} (the only thing sent to Arkiv)`);
  const records = await fetchBucket(bucket, SATYA_PUBLISHER, accessKey());
  for (const r of records) console.log(`  record ${r.key} · ${r.source} · ${r.hashes.size} hashes · published ${r.date} · source SHA-256 ${r.sourceSha256.slice(0, 16)}…`);
  const hits = await matchInRecords(type, isAddress ? [value] : domainCandidates(value), records);
  for (const h of hits) console.log(`  MATCH: ${h.value} is on ${h.source.label}`);
  if (!hits.length) console.log("  No match in Satya's registry.");
}

function keygen() {
  const existing = process.env.SATYA_PUBLISHER_KEY;
  if (existing && isHex(existing)) {
    console.log(`Publisher already set up: ${privateKeyToAccount(existing as Hex).address}`);
    return;
  }
  const key = generatePrivateKey();
  appendFileSync(ENV, `SATYA_PUBLISHER_KEY=${key}\n`);
  console.log(`New publisher wallet: ${privateKeyToAccount(key).address}`);
  console.log(`Private key saved to ${ENV} (git-ignored). Fund it with test GLM at https://hub.arkiv.network/faucet`);
}

const [cmd, which, ...rest] = process.argv.slice(2);
const fileIdx = rest.indexOf("--file");
const file = fileIdx >= 0 ? rest[fileIdx + 1] : undefined;
if (cmd === "keygen") keygen();
else if (cmd === "publish" && which) await publish(which, file, rest.includes("--dry-run"));
else if (cmd === "verify" && which) await verify(which, file);
else if (cmd === "lookup" && which) await lookup(which);
else console.log("Usage: keygen | publish <ofac|metamask> [--file path] [--dry-run] | verify <ofac|metamask> [--file path] | lookup <domain|address>");
