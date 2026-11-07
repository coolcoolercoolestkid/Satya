/**
 * ENS resolution, read-only.
 *
 * Two lookups on top of one viem public client:
 *
 *   - **forward** — `resolveAddress("vitalik.eth")` → the address the name points at, or
 *     `null` if the name has no address record.
 *   - **reverse** — `resolveName("0x…")` → the address's primary ENS name, or `null` if
 *     it has none.
 *
 * Both go through the ENS **Universal Resolver proxy** at the address below, which viem
 * `>= 2.35` targets as the canonical ENSv2 entrypoint. viem's `getEnsName` performs the
 * on-chain forward-match itself: a reverse record is only returned if the name it claims
 * resolves back to the same address, so a spoofed reverse record cannot pass.
 *
 * **This package resolves; it never writes.** No registrar, no subname minting, no ENS
 * state on-chain — an address-only flow is first-class, and nobody needs to own a name to
 * use Aletheia. The resolved name is returned to the caller and never stored: not
 * on-chain, not in the subgraph. The wallet address is the sole stored anchor a proof
 * binds to; the name is resolved live at read/display time (`docs/architecture.md`, ENS
 * section).
 *
 * As in `@aletheia/query`, there is no injectable transport. The client uses viem over
 * the configured mainnet RPC and nothing else; the pure input-normalisation seam is
 * unit-tested, and the resolution itself is proven against real mainnet ENS by
 * `scripts/check.ts`.
 */

import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  type Address,
  type PublicClient,
} from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";

import { resolveMainnetRpc } from "./endpoint.ts";
import { EnsResolutionError, InvalidAddressError, InvalidEnsNameError } from "./errors.ts";

/**
 * The ENS Universal Resolver proxy. Canonical ENSv2 entrypoint, deployed at the same
 * address on mainnet and testnets (`docs/architecture.md`). Passed explicitly on every
 * call rather than relying on viem's chain default, so the entrypoint is auditable here
 * and does not change silently under a viem upgrade.
 */
export const UNIVERSAL_RESOLVER_ADDRESS = "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe" as const;

/** A read that has not answered in this long is not going to. */
const DEFAULT_TIMEOUT_MS = 15_000;

export interface EnsResolverOptions {
  /**
   * The mainnet RPC endpoint. Defaults to `MAINNET_RPC_URL`, loaded from the
   * repository-root `.env` if it is not already in the environment.
   */
  rpcUrl?: string;
  /** Abort a request after this many milliseconds. Defaults to 15000. */
  timeoutMs?: number;
}

/**
 * Normalise an ENS name for lookup.
 *
 * Runs UTS-46 normalisation (viem's `normalize`), which is mandatory before hashing a
 * name: `Vitalik.eth`, `vitalik.eth` and various confusable Unicode forms must map to one
 * canonical string or they resolve to different nodes. An empty string, or a name
 * `normalize` rejects, is caller misuse and throws rather than resolving to `null` — a
 * malformed name is a different problem from a well-formed name with no record.
 */
export function normalizeEnsName(name: string): string {
  if (typeof name !== "string" || name.trim() === "") {
    throw new InvalidEnsNameError("the name is empty");
  }
  try {
    return normalize(name);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new InvalidEnsNameError(`${JSON.stringify(name)} (${detail})`);
  }
}

/**
 * Normalise an address input to its checksummed form.
 *
 * Accepts a 20-byte hex address in any case (lower-case, upper-case, or already
 * checksummed) and returns the EIP-55 checksummed `Address` viem expects. A string that
 * is not an address at all — a name, the wrong length — throws, because reverse-resolving
 * a non-address is caller misuse, not a "no record" result.
 */
export function normalizeAddressInput(value: string): Address {
  if (typeof value === "string" && isAddress(value, { strict: false })) {
    return getAddress(value);
  }
  throw new InvalidAddressError(`${JSON.stringify(value)} is not a 20-byte hex address`);
}

/** A read-only ENS resolver bound to one mainnet endpoint. */
export interface EnsResolver {
  /**
   * The Universal Resolver entrypoint this resolver targets. Exposed for error reports and
   * the check script; the RPC URL is deliberately not exposed because it usually embeds an
   * API key.
   */
  readonly universalResolverAddress: Address;

  /**
   * Forward resolution: an ENS name to the address it points at.
   *
   * Returns `null` when the name resolves to no address (no resolver set, or an empty
   * address record) — a normal, non-error outcome. Throws `InvalidEnsNameError` for a
   * malformed name and `EnsResolutionError` when the RPC lookup itself fails.
   */
  resolveAddress(name: string): Promise<Address | null>;

  /**
   * Reverse resolution: an address to its primary ENS name.
   *
   * Returns `null` when the address has no reverse record, or when the claimed name fails
   * the on-chain forward-match — both normal, first-class outcomes; an address without a
   * name is the common case, not an error. Throws `InvalidAddressError` for a non-address
   * input and `EnsResolutionError` when the RPC lookup itself fails.
   */
  resolveName(address: string): Promise<string | null>;
}

/**
 * Build a read-only ENS resolver.
 *
 * Browser-safe: it touches no filesystem. When `rpcUrl` is omitted it reads
 * `MAINNET_RPC_URL` from `process.env` but never loads a `.env` file — that is the Node
 * barrel's job (`index.ts` wraps this to `loadRootEnv()` first), which keeps `node:fs` out
 * of the browser bundle. A browser caller passes `rpcUrl` explicitly.
 */
export function createEnsResolver(options: EnsResolverOptions = {}): EnsResolver {
  const rpcUrl = options.rpcUrl ?? resolveMainnetRpc();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const client: PublicClient = createPublicClient({
    chain: mainnet,
    transport: http(rpcUrl, { timeout: timeoutMs }),
  });

  return {
    universalResolverAddress: UNIVERSAL_RESOLVER_ADDRESS,

    async resolveAddress(name: string): Promise<Address | null> {
      const normalized = normalizeEnsName(name);
      try {
        return await client.getEnsAddress({
          name: normalized,
          universalResolverAddress: UNIVERSAL_RESOLVER_ADDRESS,
        });
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        throw new EnsResolutionError("forward", normalized, detail, cause);
      }
    },

    async resolveName(address: string): Promise<string | null> {
      const checksummed = normalizeAddressInput(address);
      try {
        return await client.getEnsName({
          address: checksummed,
          universalResolverAddress: UNIVERSAL_RESOLVER_ADDRESS,
        });
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        throw new EnsResolutionError("reverse", checksummed, detail, cause);
      }
    },
  };
}

/** Exported for the unit tests; callers use `createEnsResolver`. */
export const __internal = { normalizeEnsName, normalizeAddressInput };
