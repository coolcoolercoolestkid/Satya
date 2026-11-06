/**
 * Satya's public scam registry on Arkiv.
 *
 * Public scam and sanctions lists are mirrored on Arkiv so anyone can read them without
 * trusting Satya's servers (Satya has none). To keep the user's browsing private, the lists
 * are never queried by domain or address. Instead:
 *
 * - Every entry is hashed with SHA-256.
 * - Entries are grouped into 256 buckets by the first byte (two hex characters) of a hash.
 * - One Arkiv record per bucket per source holds the sorted 32-byte hashes of its entries.
 *
 * The extension hashes the site you visit, asks Arkiv for that one bucket (1/256 of all
 * domains), and checks membership on your own computer. Arkiv only ever learns a bucket id.
 */
import { createPublicClient, ExpirationTime } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { desc, eq } from "@arkiv-network/sdk/query";
import { bytes, defineSchema, str, u64 } from "@arkiv-network/sdk/schema";
import { registrableDomain } from "@satya/checks/src/domain.js";
import { FREE_HOSTS } from "@satya/checks/src/structure.js";
import { http, type Address, type Hex } from "viem";

export const ScamBucket = defineSchema("satya_scam_bucket_v1", {
  /** "domain" or "address". */
  type: str().indexed(),
  /** Short source id, e.g. "ofac-sdn" or "metamask-phishing". */
  source: str().indexed(),
  /** Two lowercase hex characters, "00" to "ff". */
  bucket: str().indexed(),
  /** Publication date, YYYY-MM-DD (UTC). */
  date: str().indexed(),
  /** Publication time, unix seconds. All buckets from one run share it. */
  published: u64().indexed(),
  /** SHA-256 of the exact source file the run read, so anyone can re-run and compare. */
  sourceSha256: str(),
  /** Where the source file was downloaded from. */
  sourceUrl: str(),
  /** Number of hashes in this bucket. */
  count: u64(),
  /** Sorted 32-byte SHA-256 hashes, concatenated. */
  hashes: bytes(),
});

/** Records live 7 days; the publisher is re-run before they expire. */
export const BUCKET_LIFETIME = ExpirationTime.fromDays(7);

export interface SourceInfo {
  id: string;
  type: "domain" | "address";
  /** Shown to the user as the finding's source. */
  label: string;
  /** Licence or legal basis for republishing. */
  licence: string;
}

export const SOURCES: Record<string, SourceInfo> = {
  "ofac-sdn": {
    id: "ofac-sdn",
    type: "address",
    label: "US Treasury OFAC SDN list",
    licence: "US government work, public domain (17 U.S.C. § 105)",
  },
  "metamask-phishing": {
    id: "metamask-phishing",
    type: "domain",
    label: "MetaMask eth-phishing-detect",
    licence: "DBAD Public License 1.2 (reuse allowed with attribution)",
  },
};

// ---------- hashing and buckets ----------

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function sha256(data: string | Uint8Array): Promise<Uint8Array> {
  const input = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", input));
}

export const sha256Hex = async (data: string | Uint8Array) => hex(await sha256(data));

/** Lowercase, no trailing dot, no "www.". Domains are matched in ASCII (punycode) form. */
export function normalizeDomain(d: string): string {
  return d.trim().toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

export const normalizeAddress = (a: string) => a.trim().toLowerCase();

/**
 * Hosting services where every subdomain is a different person's site. They work like
 * ".co.in": "scam.pages.dev" is its own site, not part of "pages.dev". (Arkiv caps a record
 * at 128 KB, and without this the ~15,000 listed "*.pages.dev" sites would all land in one
 * bucket.)
 */
export const SHARED_HOST_SUFFIXES = [
  ...new Set([...FREE_HOSTS, "wixstudio.com", "gitbook.io", "typedream.app", "workers.dev", "arweave.net", "godaddysites.com"]),
].sort((a, b) => b.length - a.length);

/** The site a domain belongs to: its registrable domain, or one label under a shared host. */
export function siteOf(domain: string): string {
  const h = normalizeDomain(domain);
  const shared = SHARED_HOST_SUFFIXES.find((s) => h.endsWith(`.${s}`));
  if (shared) {
    const rest = h.slice(0, -(shared.length + 1));
    return `${rest.slice(rest.lastIndexOf(".") + 1)}.${shared}`;
  }
  return registrableDomain(h);
}

/**
 * Which bucket a value lives in. Domains go by their registrable domain, so a site and its
 * subdomains ("login.evil.com", "evil.com") share one bucket and one lookup covers them all.
 */
export async function bucketOf(type: SourceInfo["type"], value: string): Promise<string> {
  const key = type === "domain" ? siteOf(value) : normalizeAddress(value);
  return (await sha256Hex(key)).slice(0, 2);
}

/** The values to test for a visited host: the host itself and each parent up to the registrable domain. */
export function domainCandidates(host: string): string[] {
  const h = normalizeDomain(host);
  const base = siteOf(h);
  const out = [h];
  let rest = h;
  while (rest !== base && rest.includes(".")) {
    rest = rest.slice(rest.indexOf(".") + 1);
    out.push(rest);
  }
  return [...new Set(out)];
}

export const ALL_BUCKETS = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

/** Groups a list into 256 buckets of sorted, concatenated hashes. */
export async function buildBuckets(type: SourceInfo["type"], values: string[]): Promise<Map<string, Uint8Array>> {
  const groups = new Map<string, Uint8Array[]>(ALL_BUCKETS.map((b) => [b, []]));
  const seen = new Set<string>();
  for (const raw of values) {
    const v = type === "domain" ? normalizeDomain(raw) : normalizeAddress(raw);
    if (!v || seen.has(v)) continue;
    seen.add(v);
    groups.get(await bucketOf(type, v))!.push(await sha256(v));
  }
  const out = new Map<string, Uint8Array>();
  for (const [b, list] of groups) {
    list.sort((x, y) => (hex(x) < hex(y) ? -1 : 1));
    const buf = new Uint8Array(list.length * 32);
    list.forEach((h, i) => buf.set(h, i * 32));
    out.set(b, buf);
  }
  return out;
}

/** Arkiv's limit on one bytes value. */
export const MAX_BUCKET_BYTES = 128 * 1024;

/** Splits a bucket's payload back into hex hashes. */
export function hashesOf(payload: Uint8Array): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 32 <= payload.length; i += 32) out.add(hex(payload.subarray(i, i + 32)));
  return out;
}

// ---------- reading from Arkiv ----------

export function registryReader(accessKey = "") {
  return createPublicClient({ chain: rabdi({ accessKey }), transport: http() });
}

export interface BucketRecord {
  key: Hex;
  source: string;
  type: SourceInfo["type"];
  bucket: string;
  date: string;
  published: number;
  sourceSha256: string;
  sourceUrl: string;
  hashes: Set<string>;
}

const hexToBytes = (h: string) => {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/**
 * The newest record per source for one bucket, written by the given publisher. Only the
 * bucket id is sent to Arkiv. Records from anyone else are ignored, so nobody can plant
 * entries in Satya's registry.
 */
export async function fetchBucket(bucket: string, publisher: Address, accessKey = ""): Promise<BucketRecord[]> {
  const page = await registryReader(accessKey)
    .select({
      $key: true,
      type: true,
      source: true,
      bucket: true,
      date: true,
      published: true,
      sourceSha256: true,
      sourceUrl: true,
      hashes: true,
    })
    .from(ScamBucket)
    .where(eq("bucket", bucket))
    .ownedBy(publisher)
    .orderBy(desc("published"))
    .limit(50)
    .fetch();
  const newest = new Map<string, BucketRecord>();
  for (const row of page.entities) {
    const source = String(row.source.value);
    if (newest.has(source)) continue; // sorted newest first
    newest.set(source, {
      key: row.$key as Hex,
      source,
      type: String(row.type.value) as SourceInfo["type"],
      bucket: String(row.bucket.value),
      date: String(row.date.value),
      published: Number(row.published.value),
      sourceSha256: String(row.sourceSha256.value),
      sourceUrl: String(row.sourceUrl.value),
      hashes: hashesOf(hexToBytes(String(row.hashes.value))),
    });
  }
  return [...newest.values()];
}

export interface RegistryHit {
  source: SourceInfo;
  value: string;
  record: BucketRecord;
}

/** Checks values against bucket records on this computer. */
export async function matchInRecords(
  type: SourceInfo["type"],
  values: string[],
  records: BucketRecord[],
): Promise<RegistryHit[]> {
  const hits: RegistryHit[] = [];
  for (const value of values) {
    const h = await sha256Hex(type === "domain" ? normalizeDomain(value) : normalizeAddress(value));
    for (const r of records) {
      if (r.type !== type || !r.hashes.has(h)) continue;
      const source = SOURCES[r.source] ?? { id: r.source, type, label: r.source, licence: "" };
      hits.push({ source, value, record: r });
    }
  }
  return hits;
}
export * from "./check.js";
