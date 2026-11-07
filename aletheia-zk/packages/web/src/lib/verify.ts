/**
 * The verifier flow's read layer, browser side.
 *
 * A verifier asks one question — "should I act on this claim?" — and the honest answer is
 * one of five states, never a bare boolean. This module wires the two read paths that
 * answer it entirely from the device:
 *
 *   - ENS resolution (`@aletheia/ens/browser`) over the mainnet RPC, so a verifier can
 *     type a name or an address. The name is resolved live and never stored — the wallet
 *     address is the only anchor a proof binds to (docs/architecture.md, ENS section).
 *   - the subgraph read client (`@aletheia/query/browser`) over the Studio endpoint, which
 *     carries the indexer's block and error state on every read so indexing lag is an
 *     explicit `pending` state, not a silent wrong answer.
 *
 * The classification itself is `deriveVerificationState`, the same pure function the query
 * package unit-tests and reproduces against the real endpoint (`scripts/states.ts`). This
 * module supplies it real endpoint data; nothing here is mocked.
 *
 * Both endpoints are read from `NEXT_PUBLIC_*` env vars and passed to the factories
 * explicitly, so the browser bundle never touches the Node `.env` loader.
 */

import { isAddress } from "viem";

import { createEnsResolver, type EnsResolver } from "@aletheia/ens/browser";
import {
  createQueryClient,
  type FreshnessPolicy,
  type QueryClient,
} from "@aletheia/query/browser";

const GRAPH_QUERY_URL = process.env.NEXT_PUBLIC_GRAPH_QUERY_URL;
const MAINNET_RPC_URL = process.env.NEXT_PUBLIC_MAINNET_RPC_URL;

/** Whether ENS-name resolution is configured. Address lookup works without it. */
export const ensAvailable = Boolean(MAINNET_RPC_URL);

let queryClient: QueryClient | null = null;
let ensResolver: EnsResolver | null = null;

/** The subgraph read client, built once. Throws a readable error if unconfigured. */
export function getQueryClient(): QueryClient {
  if (queryClient === null) {
    if (!GRAPH_QUERY_URL) {
      throw new Error(
        "NEXT_PUBLIC_GRAPH_QUERY_URL is not set. Add it to packages/web/.env.local " +
          "(the subgraph query endpoint, same as the root .env GRAPH_QUERY_URL).",
      );
    }
    queryClient = createQueryClient({ endpoint: GRAPH_QUERY_URL });
  }
  return queryClient;
}

/** The ENS resolver, built once. Throws if the mainnet RPC is not configured. */
function getEnsResolver(): EnsResolver {
  if (ensResolver === null) {
    if (!MAINNET_RPC_URL) {
      throw new Error(
        "NEXT_PUBLIC_MAINNET_RPC_URL is not set, so ENS names cannot be resolved. " +
          "Paste a 0x address instead, or add the endpoint to packages/web/.env.local.",
      );
    }
    ensResolver = createEnsResolver({ rpcUrl: MAINNET_RPC_URL });
  }
  return ensResolver;
}

/** What the verifier typed, resolved to the address a proof would have bound to. */
export interface ResolvedTarget {
  /** The wallet address to query the subgraph for. */
  address: `0x${string}`;
  /** How the address was reached: typed directly, or resolved from an ENS name. */
  via: "address" | "ens";
  /**
   * A human-readable ENS name for display, resolved live. For a typed address this is its
   * primary name (reverse record) if it has one; for a typed name it is that name. Null
   * when there is none — a first-class, common case, never an error.
   */
  name: string | null;
}

/**
 * Resolve a verifier's free-text input to an address.
 *
 * A 20-byte hex string is used directly and reverse-resolved for a display name; anything
 * else is treated as an ENS name and forward-resolved. A name with no address record
 * throws with a readable message — that is a lookup the verifier cannot proceed from, not
 * a "no verifications" answer.
 */
export async function resolveTarget(
  input: string,
  options: { resolveName?: boolean } = {},
): Promise<ResolvedTarget> {
  const trimmed = input.trim();
  if (trimmed === "") throw new Error("enter an ENS name or a 0x address");

  if (isAddress(trimmed, { strict: false })) {
    const address = trimmed.toLowerCase() as `0x${string}`;
    // The reverse-record lookup is a mainnet round-trip that is only for a display name, so
    // it must not sit in front of the subgraph read. By default it is skipped here and the
    // caller fills the name in asynchronously via `resolveDisplayName`; pass
    // `resolveName: true` to keep the old blocking behaviour.
    let name: string | null = null;
    if (options.resolveName && ensAvailable) {
      name = await resolveDisplayName(address);
    }
    return { address, via: "address", name };
  }

  const resolved = await getEnsResolver().resolveAddress(trimmed);
  if (resolved === null) {
    throw new Error(
      `${JSON.stringify(trimmed)} resolves to no address record. It may be unregistered, ` +
        "or have no address set.",
    );
  }
  return { address: resolved.toLowerCase() as `0x${string}`, via: "ens", name: trimmed };
}

/**
 * Best-effort ENS reverse resolution for a display name (address → primary name). Returns
 * null on no record or any failure — it is only a nicety, never a gate on the lookup.
 */
export async function resolveDisplayName(address: string): Promise<string | null> {
  if (!ensAvailable) return null;
  try {
    return await getEnsResolver().resolveName(address);
  } catch {
    return null;
  }
}

/**
 * Freshness presets, so both `verified` and `stale` are reachable in the UI from one real
 * record: a generous window renders it verified, a tight one renders it stale. Freshness
 * is a verifier-side policy, never a property of the record (docs/security.md).
 */
export const FRESHNESS_PRESETS: ReadonlyArray<{ label: string; policy: FreshnessPolicy }> = [
  { label: "30 days", policy: { maxVerificationAgeSeconds: 30 * 24 * 60 * 60 } },
  { label: "24 hours", policy: { maxVerificationAgeSeconds: 24 * 60 * 60 } },
  { label: "1 hour", policy: { maxVerificationAgeSeconds: 60 * 60 } },
  { label: "5 minutes", policy: { maxVerificationAgeSeconds: 5 * 60 } },
  { label: "must be brand new (0s)", policy: { maxVerificationAgeSeconds: 0 } },
];

/** Etherscan tx link for Sepolia, matching the holder flow's. */
export function etherscanTx(hash: string): string {
  return `https://sepolia.etherscan.io/tx/${hash}`;
}

/** A short, unambiguous rendering of a 32-byte hex id. */
export function shortHex(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

/** YYYYMMDD integer to an ISO date string, for `credentialValidOn`. */
export function yyyymmddToIso(value: number): string {
  const s = value.toString().padStart(8, "0");
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}
