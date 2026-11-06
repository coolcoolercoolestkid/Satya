import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SEED_BRANDS, type AddressLabelList, type AnalyzeContext, type DomainList } from "@satya/checks";

interface DomainListFile { source: string; kind: DomainList["kind"]; domains: string[]; allow?: string[] }
interface NamedListFile { source: string; names: string[] }
interface AddressListFile { source: string; labels: Record<string, string> }

/** The public lists made by `pnpm data` (apps/extension/data), or SATYA_DATA_DIR. */
export const DATA_DIR = process.env.SATYA_DATA_DIR ?? fileURLToPath(new URL("../../extension/data/", import.meta.url));

async function loadJson<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(join(DATA_DIR, name), "utf8")) as T;
  } catch {
    return fallback;
  }
}

export type BaseContext = Omit<AnalyzeContext, "aiDetector" | "reviewer">;

let cached: Promise<BaseContext> | undefined;

export function loadContext(): Promise<BaseContext> {
  cached ??= (async () => {
    const [domainLists, namedLists, addressLists] = await Promise.all([
      loadJson<DomainListFile[]>("domain-lists.json", []),
      loadJson<NamedListFile[]>("named-lists.json", []),
      loadJson<AddressListFile[]>("address-lists.json", []),
    ]);
    if (!domainLists.length) {
      console.error(`[satya] No phishing lists found in ${DATA_DIR}. Run \`pnpm data\` in the repo first.`);
    }
    return {
      phishing: {
        brands: SEED_BRANDS,
        lists: domainLists.map((l) => ({
          source: l.source,
          kind: l.kind,
          domains: new Set(l.domains.map((d) => d.toLowerCase())),
          allow: l.allow ? new Set(l.allow.map((d) => d.toLowerCase())) : undefined,
        })),
      },
      namedLists,
      addressLists: addressLists.map(
        (l): AddressLabelList => ({
          source: l.source,
          labels: new Map(Object.entries(l.labels).map(([k, v]) => [k.toLowerCase(), v])),
        }),
      ),
    };
  })();
  return cached;
}
