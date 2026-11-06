import {
  SEED_BRANDS,
  type AddressLabelList,
  type AnalyzeContext,
  type DomainList,
} from "@satya/checks";
import { fetchBucket, SATYA_PUBLISHER, type BucketFetcher, type BucketRecord } from "@satya/registry";

interface DomainListFile {
  source: string;
  kind: DomainList["kind"];
  domains: string[];
  allow?: string[];
}
interface NamedListFile {
  source: string;
  names: string[];
}
interface AddressListFile {
  source: string;
  labels: Record<string, string>;
}

async function loadJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(chrome.runtime.getURL(path));
    return res.ok ? ((await res.json()) as T) : fallback;
  } catch {
    return fallback;
  }
}

let cached: Promise<Omit<AnalyzeContext, "aiDetector">> | undefined;
let cachedDomainLists: Promise<AnalyzeContext["phishing"]["lists"]> | undefined;

/**
 * The bundled copies of the domain lists (2.8 MB) are only a fallback for when Arkiv doesn't
 * answer, so they load only when asked for.
 */
export function loadDomainLists(): Promise<AnalyzeContext["phishing"]["lists"]> {
  cachedDomainLists ??= loadJson<DomainListFile[]>("data/domain-lists.json", []).then((domainLists) =>
    domainLists.map((l) => ({
      source: l.source,
      kind: l.kind,
      domains: new Set(l.domains.map((d) => d.toLowerCase())),
      allow: l.allow ? new Set(l.allow.map((d) => d.toLowerCase())) : undefined,
    })),
  );
  return cachedDomainLists;
}

/** Loads the small bundled lists; domain lists are added only if `withDomainLists`. */
export async function loadContext(withDomainLists: boolean): Promise<Omit<AnalyzeContext, "aiDetector">> {
  cached ??= (async () => {
    const [namedLists, addressLists] = await Promise.all([
      loadJson<NamedListFile[]>("data/named-lists.json", []),
      loadJson<AddressListFile[]>("data/address-lists.json", []),
    ]);
    return {
      phishing: { brands: SEED_BRANDS, lists: [] },
      namedLists,
      addressLists: addressLists.map(
        (l): AddressLabelList => ({
          source: l.source,
          labels: new Map(Object.entries(l.labels).map(([k, v]) => [k.toLowerCase(), v])),
        }),
      ),
    };
  })();
  const ctx = await cached;
  if (!withDomainLists) return ctx;
  return { ...ctx, phishing: { ...ctx.phishing, lists: await loadDomainLists() } };
}

// ---------- Satya's scam registry on Arkiv ----------

declare const __ARKIV_ACCESS_KEY__: string;

/** Bundled list name → registry source id, so a list the registry covers isn't checked twice. */
export const BUNDLED_TO_REGISTRY: Record<string, string> = {
  "MetaMask phishing list": "metamask-phishing",
  "US Treasury OFAC sanctions list": "ofac-sdn",
};

/** Registry sources that have a bundled domain-list copy (the rest are address lists). */
export const BUNDLED_DOMAIN_SOURCES = ["metamask-phishing"];

const BUCKET_CACHE_MS = 6 * 60 * 60 * 1000;

interface CachedBucket {
  at: number;
  records: (Omit<BucketRecord, "hashes"> & { hashes: string[] })[];
}

/**
 * Fetches one registry bucket from Arkiv, cached in this browser for 6 hours. A cached
 * bucket means no request at all, so repeat visits to sites in the same bucket send nothing.
 */
export const cachedBucket: BucketFetcher = async (bucket) => {
  const key = `registry:${bucket}`;
  const hit = (await chrome.storage.local.get(key))[key] as CachedBucket | undefined;
  if (hit && Date.now() - hit.at < BUCKET_CACHE_MS) {
    return hit.records.map((r) => ({ ...r, hashes: new Set(r.hashes) }));
  }
  // Never let a slow or rate-limited Arkiv endpoint hang the panel: give up after 8 seconds and
  // fall back to the bundled lists (the panel says so).
  const records = await Promise.race([
    fetchBucket(bucket, SATYA_PUBLISHER, __ARKIV_ACCESS_KEY__),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Arkiv timed out")), 8000)),
  ]);
  const store: CachedBucket = { at: Date.now(), records: records.map((r) => ({ ...r, hashes: [...r.hashes] })) };
  await chrome.storage.local.set({ [key]: store });
  return records;
};
