/**
 * Where mainnet is.
 *
 * ENS resolves on **mainnet**, even though every Aletheia record lives on Sepolia: ENS
 * names and their reverse records are registered on mainnet, so that is the only chain
 * that can answer "what address is `vitalik.eth`" or "does this address have a primary
 * name". The endpoint is read-only and used for nothing else — Aletheia issues no ENS
 * writes and holds no ENS state (`docs/architecture.md`, ENS section).
 *
 * Loaded exactly like `@aletheia/query`'s endpoint and the contracts scripts: from the
 * repository-root `.env` via Node's own env-file loader, no dependency, never a literal.
 * That loader lives in `root-env.ts` because it touches the filesystem; this module is
 * kept pure (URL validation and a `process.env` read) so the browser entry can import the
 * resolver without pulling `node:fs` into a bundle.
 */

import { MainnetRpcNotConfiguredError } from "./errors.ts";

/**
 * Validate a mainnet RPC endpoint string.
 *
 * Exported separately from `resolveMainnetRpc` so it can be unit-tested without touching
 * the environment: this is the pure half.
 *
 * https is required. A forward resolution decides which address a human-readable name
 * points at, and a verifier that trusts that address is trusting the transport that
 * delivered it — plaintext http would let anyone on the path rewrite `vitalik.eth` to
 * their own address.
 */
export function assertMainnetRpc(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") throw new MainnetRpcNotConfiguredError("is empty");

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new MainnetRpcNotConfiguredError(`is not a valid URL (${JSON.stringify(trimmed)})`);
  }
  if (url.protocol !== "https:") {
    throw new MainnetRpcNotConfiguredError(
      `must be an https URL, found ${JSON.stringify(url.protocol)}`,
    );
  }
  return url.toString();
}

/**
 * The mainnet RPC endpoint, from `MAINNET_RPC_URL`.
 *
 * Throws rather than falling back to a default. A public default endpoint would rate-limit
 * or disappear, and silently resolving against the wrong chain would return a wrong
 * address with full confidence — the same failure mode `@aletheia/query` refuses a default
 * to avoid.
 */
export function resolveMainnetRpc(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env["MAINNET_RPC_URL"];
  if (raw === undefined) throw new MainnetRpcNotConfiguredError("is not set");
  return assertMainnetRpc(raw);
}
