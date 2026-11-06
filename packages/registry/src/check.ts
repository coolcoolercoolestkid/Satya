import type { Finding, PageSnapshot } from "@satya/checks";
import { normalizeHost } from "@satya/checks/src/domain.js";
import { bucketOf, domainCandidates, matchInRecords, SOURCES, siteOf, type BucketRecord } from "./index.js";

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
  /** What was looked up and which Arkiv records answered, so the panel can show the proof. */
  lookups: RegistryLookup[];
}

export interface RegistryLookup {
  kind: "domain" | "address";
  /** The value that was hashed on this computer (never sent). */
  value: string;
  bucket: string;
  records: { source: string; label: string; key: string; date: string; entries: number; matched: boolean }[];
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
  const lookups: RegistryLookup[] = [];
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
      const domainHits = await matchInRecords("domain", domainCandidates(host), records);
      lookups.push(lookupOf("domain", siteOf(host), bucket, records, domainHits.map((h) => h.record.key)));
      for (const hit of domainHits) {
        const m = hit.source.match ?? { severity: "danger" as const, weight: 70, title: "Known phishing site" };
        findings.push({
          check: "phishing",
          severity: m.severity,
          title: m.title,
          detail: `${hit.value} appears on ${hit.source.label}.${m.severity === "warning" ? " Such sites often carry malicious ads and fake download buttons." : ""}`,
          source: via(hit.record, hit.source.label),
          weight: m.weight,
        });
      }
    }
    for (const address of addresses) {
      const bucket = await bucketOf("address", address);
      asked.add(bucket);
      const records = await fetchBucket(bucket);
      addressSources.push(sourcesOf(records, "address"));
      const addressHits = await matchInRecords("address", [address], records);
      lookups.push(lookupOf("address", address, bucket, records, addressHits.map((h) => h.record.key)));
      for (const hit of addressHits) {
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
    return { findings, reachable: true, bucketsAsked: [...asked], covered, lookups };
  } catch {
    return { findings: [], reachable: false, bucketsAsked: [...asked], covered: { domain: [], address: [] }, lookups };
  }
}

function lookupOf(kind: "domain" | "address", value: string, bucket: string, records: BucketRecord[], hitKeys: string[]): RegistryLookup {
  return {
    kind,
    value,
    bucket,
    records: records
      .filter((r) => r.type === kind)
      .map((r) => ({
        source: r.source,
        label: SOURCES[r.source]?.label ?? r.source,
        key: r.key,
        date: r.date,
        entries: r.hashes.size,
        matched: hitKeys.includes(r.key),
      })),
  };
}
