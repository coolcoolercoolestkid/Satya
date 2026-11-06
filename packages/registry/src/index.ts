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
import { addr, bytes, defineSchema, str, u64 } from "@arkiv-network/sdk/schema";
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
  /** How a match is shown. Defaults: danger, 70 points, "Known phishing site" / "Wallet on …". */
  match?: { severity: "danger" | "warning"; weight: number; title: string };
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
  "phishing-database": {
    id: "phishing-database",
    type: "domain",
    label: "Phishing.Database (active phishing domains)",
    licence: "MIT",
    match: { severity: "danger", weight: 70, title: "Known phishing site" },
  },
  "blp-scam": {
    id: "blp-scam",
    type: "domain",
    label: "Block List Project scam list",
    licence: "MIT (list header); repository Unlicense",
    match: { severity: "danger", weight: 60, title: "Listed as a scam site" },
  },
  "blp-fraud": {
    id: "blp-fraud",
    type: "domain",
    label: "Block List Project fraud list",
    licence: "MIT (list header); repository Unlicense",
    match: { severity: "danger", weight: 60, title: "Listed as a fraud site" },
  },
  "blp-ransomware": {
    id: "blp-ransomware",
    type: "domain",
    label: "Block List Project ransomware list",
    licence: "MIT (list header); repository Unlicense",
    match: { severity: "danger", weight: 70, title: "Listed as a ransomware site" },
  },
  "blp-piracy": {
    id: "blp-piracy",
    type: "domain",
    label: "Block List Project piracy list",
    licence: "MIT (list header); repository Unlicense",
    match: {
      severity: "warning",
      weight: 15,
      title: "Listed as a piracy / illegal streaming site",
    },
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
/**
 * Shared hosts the scoring learned about after the 6 Nov 2026 publish. Bucket grouping must match
 * what is on Arkiv, so these join the grouping at the next full republish of every list.
 */
const GROUPING_ADDED_LATER = new Set(["azurefd.net", "replit.dev"]);

export const SHARED_HOST_SUFFIXES = [
  ...new Set([
    ...FREE_HOSTS,
    // Hosting, dynamic DNS and gateway services where each subdomain is a separate owner.
    "wixstudio.com", "gitbook.io", "typedream.app", "workers.dev", "arweave.net", "godaddysites.com",
    "duckdns.org", "appspot.com", "weeblysite.com", "r2.dev", "dweb.link", "square.site", "my.id", "biz.id",
    "xsph.ru", "swtest.ru", "co.vu", "plesk.page", "pantheonsite.io", "cf-ipfs.com", "cprapid.com",
    "amazonaws.com", "ddns.net", "webcindario.com", "azurewebsites.net", "tw1.ru", "ewp.live", "tmweb.ru",
    "usrfiles.com", "appdomain.cloud", "trycloudflare.com", "teachable.com", "filesusr.com", "yolasite.com",
    "nftstorage.link", "w3s.link", "surge.sh", "infura-ipfs.io", "ipfs.io", "gitlab.io", "ngrok-free.app",
    "ngrok.io", "fly.dev", "deno.dev", "no-ip.org", "hopto.org", "zapto.org", "sytes.net", "myshopify.com",
    "wordpress.com", "notion.site", "jimdosite.com", "mystrikingly.com", "site123.me", "webnode.page",
    "r.appspot.com", "ipfs.dweb.link", "ipfs.cf-ipfs.com", "ipfs.nftstorage.link", "ipfs.w3s.link",
    "ipfs.infura-ipfs.io", "temp.swtest.ru", "cloud-object-storage.appdomain.cloud", "atwebpages.com",
  ]),
].filter((h) => !GROUPING_ADDED_LATER.has(h)).sort((a, b) => b.length - a.length);

/** The site a domain belongs to: its registrable domain, or one label under a shared host. */
export function siteOf(domain: string): string {
  const h = normalizeDomain(domain);
  const blogspot = /\.(blogspot\.[a-z]{2,3}(\.[a-z]{2})?)$/.exec(h)?.[1];
  const shared = SHARED_HOST_SUFFIXES.find((s) => h.endsWith(`.${s}`)) ?? blogspot;
  if (shared) {
    const labels = h.slice(0, -(shared.length + 1)).split(".");
    // One label under the host is the site ("scam.pages.dev"). Some hosts put a short region
    // label in between ("project.uc.r.appspot.com"), so then take one more.
    const take = labels.length > 1 && labels[labels.length - 1]!.length <= 3 ? 2 : 1;
    return `${labels.slice(-take).join(".")}.${shared}`;
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

// ---------- OFAC sanctioned addresses, one record each (queryable) ----------

/**
 * The OFAC list is small (about 130 Ethereum-format addresses), so besides the private hashed
 * buckets it is also mirrored as one plain record per address. Anyone can filter it directly
 * by address, sanctions programme, entity type or name, without asking anyone.
 */
export const SanctionedAddress = defineSchema("satya_sanctioned_address_v1", {
  /** The 0x address, as OFAC lists it. */
  address: addr().indexed(),
  /** "ofac-sdn". */
  list: str().indexed(),
  /** The sanctioned person or organisation's name, from the SDN entry. */
  name: str().indexed(),
  /** "Entity" or "Individual". */
  sdnType: str().indexed(),
  /** The first sanctions programme, e.g. "CYBER2" or "DPRK4". */
  program: str().indexed(),
  /** Every programme, comma-separated. */
  programs: str(),
  /** Currency OFAC listed it under, e.g. "ETH", "USDT", "USDC". */
  currency: str().indexed(),
  /** OFAC's unique id for the SDN entry, so you can look it up on sanctionssearch.ofac.treas.gov. */
  sdnUid: str().indexed(),
  /** Publication date, YYYY-MM-DD. */
  date: str().indexed(),
  /** Publication time, unix seconds; all records from one run share it. */
  published: u64().indexed(),
  /** SHA-256 of the SDN.XML file this came from. */
  sourceSha256: str(),
});

export interface SdnAddress {
  address: string;
  name: string;
  sdnType: string;
  programs: string[];
  currency: string;
  sdnUid: string;
}

const clip = (s: string, bytes = 120) => {
  const enc = new TextEncoder();
  let out = s;
  while (enc.encode(out).length > bytes) out = out.slice(0, -1);
  return out;
};

/** Every Ethereum-format (0x…) digital currency address in OFAC's SDN.XML, with its entry details. */
export function parseSdnAddresses(xml: string): SdnAddress[] {
  const out = new Map<string, SdnAddress>();
  const tag = (block: string, t: string) => new RegExp(`<${t}>([^<]*)</${t}>`).exec(block)?.[1]?.trim() ?? "";
  for (const m of xml.matchAll(/<sdnEntry>([\s\S]*?)<\/sdnEntry>/g)) {
    const entry = m[1]!;
    const first = tag(entry, "firstName");
    const last = tag(entry, "lastName");
    const name = clip([first, last].filter(Boolean).join(" ").replace(/&amp;/g, "&"));
    const programs = [...entry.matchAll(/<program>([^<]*)<\/program>/g)].map((p) => p[1]!.trim());
    for (const id of entry.matchAll(/<id>([\s\S]*?)<\/id>/g)) {
      const type = tag(id[1]!, "idType");
      const num = tag(id[1]!, "idNumber");
      if (!type.startsWith("Digital Currency Address") || !/^0x[0-9a-fA-F]{40}$/.test(num)) continue;
      const key = num.toLowerCase();
      if (out.has(key)) continue;
      out.set(key, {
        address: key,
        name,
        sdnType: tag(entry, "sdnType"),
        programs,
        currency: type.replace("Digital Currency Address - ", "").trim(),
        sdnUid: tag(entry, "uid"),
      });
    }
  }
  return [...out.values()];
}

// ---------- Verified contracts: Arkiv's Sourcify mirror ----------

/** Arkiv's mirror of Sourcify (8M+ verified Ethereum mainnet contracts), on the Sorbet testnet. */
export const SOURCIFY_ON_ARKIV = {
  rpc: "https://rpc.sorbet.db-chain.testnet.arkiv.network",
  owner: "0x73d44f158a6990b50b9951532ea2032983a9fc72",
  explorer: "https://sourcify.arkiv.network",
};

export interface VerifiedContract {
  address: string;
  name: string;
  match: string;
  compiler: string;
}

/**
 * Looks up contract addresses in Arkiv's Sourcify mirror: verified source code, and the contract's
 * real name. Unverified addresses (or plain wallets) simply return nothing.
 */
export async function lookupVerifiedContracts(addresses: string[], fetchImpl: typeof fetch = fetch): Promise<VerifiedContract[]> {
  const out: VerifiedContract[] = [];
  for (const a of addresses.slice(0, 5)) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) continue;
    const query = `projectid = str('sourcify') AND $owner = addr(${SOURCIFY_ON_ARKIV.owner}) AND kind = str('verified_contract') AND chainid = u64(1) AND address = addr(${a.toLowerCase()})`;
    try {
      const res = await fetchImpl(SOURCIFY_ON_ARKIV.rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "arkiv_query",
          params: [query, { select: { key: true, attributes: { name: true, match: true, compilerversion: true } }, limit: "0x1" }],
        }),
        signal: AbortSignal.timeout(8000),
      });
      const body = (await res.json()) as { result?: { data?: { attributes?: { name: string; value: string }[] }[] } };
      const attrs = body.result?.data?.[0]?.attributes;
      if (!attrs) continue;
      const get = (n: string) => attrs.find((x) => x.name === n)?.value ?? "";
      out.push({ address: a.toLowerCase(), name: get("name"), match: get("match"), compiler: get("compilerversion") });
    } catch {
      /* unreachable or rate-limited: say nothing */
    }
  }
  return out;
}
