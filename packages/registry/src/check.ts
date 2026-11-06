import type { Finding, PageSnapshot } from "@satya/checks";
import { normalizeHost } from "@satya/checks/src/domain.js";
import { bucketOf, domainCandidates, matchInRecords, type BucketRecord } from "./index.js";

/** Satya's registry publisher on Arkiv. Only records owned by this wallet are trusted. */
export const SATYA_PUBLISHER = "0x0D341d00bB9c2327033f447b45Ebb8712521E736" as const;

const ADDRESS_RE = /\b0x[a-fA-F0-9]{40}\b/g;
/** At most this many wallet addresses from one page are looked up, to keep lookups few. */
export const MAX_PAGE_ADDRESSES = 5;

export type BucketFetcher = (bucket: string) => Promise<BucketRecord[]>;

export interface RegistryResult {
  findings: Finding[];
  /** False when Arkiv couldn't be reached; the caller then falls back to its bundled copy. */
  reachable: boolean;
  /** Bucket ids requested. This is everything Arkiv learns about the page. */
  bucketsAsked: string[];
  /**
   * Sources the registry answered for: a source is covered only if every bucket this page
   * needed had a record from it. For other sources the caller keeps using its bundled copy.
   */
  covered: { domain: string[]; address: string[] };
}

const intersect = (sets: Set<string>[]) =>
  sets.length ? [...sets[0]!].filter((x) => sets.every((s) => s.has(x))) : [];

const short = (k: string) => `${k.slice(0, 10)}…`;
const via = (r: BucketRecord, label: string) =>
  `${label}, mirrored on Arkiv by Satya (record ${short(r.key)}, published ${r.date})`;

/**
 * Checks a page against Satya's Arkiv registry: the site's domain against the phishing
 * lists, and wallet addresses on the page against the sanctions lists. Only bucket ids are
 * fetched; matching happens on this computer.
 */
export async function checkRegistry(page: PageSnapshot, fetchBucket: BucketFetcher): Promise<RegistryResult> {
  const findings: Finding[] = [];
  const asked = new Set<string>();
  const domainSources: Set<string>[] = [];
  const addressSources: Set<string>[] = [];
  const sourcesOf = (records: BucketRecord[], type: BucketRecord["type"]) =>
    new Set(records.filter((r) => r.type === type).map((r) => r.source));
  const host = normalizeHost(page.url);
  const addresses = [...new Set((page.text.match(ADDRESS_RE) ?? []).map((a) => a.toLowerCase()))].slice(0, MAX_PAGE_ADDRESSES);

  try {
    if (host && /^https?:/.test(page.url)) {
      const bucket = await bucketOf("domain", host);
      asked.add(bucket);
      const records = await fetchBucket(bucket);
      domainSources.push(sourcesOf(records, "domain"));
      for (const hit of await matchInRecords("domain", domainCandidates(host), records)) {
        findings.push({
          check: "phishing",
          severity: "danger",
          title: "Known phishing site",
          detail: `${hit.value} appears on ${hit.source.label}.`,
          source: via(hit.record, hit.source.label),
          weight: 70,
        });
      }
    }
    for (const address of addresses) {
      const bucket = await bucketOf("address", address);
      asked.add(bucket);
      const records = await fetchBucket(bucket);
      addressSources.push(sourcesOf(records, "address"));
      for (const hit of await matchInRecords("address", [address], records)) {
        findings.push({
          check: "records",
          severity: "danger",
          title: `Wallet on ${hit.source.label}`,
          detail: `${address.slice(0, 8)}…${address.slice(-6)} is listed. Don't send it money or sign anything for it.`,
          source: via(hit.record, hit.source.label),
          evidence: address,
          weight: 50,
        });
      }
    }
    const covered = { domain: intersect(domainSources), address: addresses.length ? intersect(addressSources) : ["*"] };
    return { findings, reachable: true, bucketsAsked: [...asked], covered };
  } catch {
    return { findings: [], reachable: false, bucketsAsked: [...asked], covered: { domain: [], address: [] } };
  }
}
