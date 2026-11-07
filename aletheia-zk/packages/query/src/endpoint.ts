/**
 * Where the subgraph is.
 *
 * The endpoint comes from the environment, never from a literal in code, for the same
 * reason contract addresses do: the deployed subgraph is a moving target — every stage
 * that redeploys `AletheiaVerifier` (stages 17 and 18) produces a new subgraph version
 * with a new URL, and a URL baked into a source file is a stale answer waiting to be
 * believed.
 *
 * The repository-root `.env` is loaded the same way `packages/contracts/scripts/*` load
 * it: Node's own env-file loader, no dependency. `hardhat.config.ts` does the same. That
 * loader lives in `root-env.ts` because it touches the filesystem; this module is kept
 * pure (URL validation and a `process.env` read) so the browser entry can import the read
 * path without pulling `node:fs` into a bundle. The current endpoint is also recorded in
 * `docs/deployments.md`, which is the human-readable copy — not the one code reads.
 */

import { EndpointNotConfiguredError } from "./errors.ts";

/**
 * Validate an endpoint string.
 *
 * Exported separately from `resolveEndpoint` so it can be unit-tested without touching
 * the environment: this is the pure half.
 *
 * https is required rather than merely preferred. The response to these queries decides
 * whether a person is shown as verified, and a plaintext transport lets anyone on the
 * path rewrite that answer.
 */
export function assertQueryEndpoint(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") throw new EndpointNotConfiguredError("is empty");

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new EndpointNotConfiguredError(
      `is not a valid URL (${JSON.stringify(trimmed)})`,
    );
  }
  if (url.protocol !== "https:") {
    throw new EndpointNotConfiguredError(
      `must be an https URL, found ${JSON.stringify(url.protocol)}`,
    );
  }
  return url.toString();
}

/**
 * The subgraph query endpoint, from `GRAPH_QUERY_URL`.
 *
 * Throws rather than falling back to a default. There is no sensible default: a client
 * pointed at the wrong subgraph returns confident, well-formed, wrong answers.
 */
export function resolveEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env["GRAPH_QUERY_URL"];
  if (raw === undefined) throw new EndpointNotConfiguredError("is not set");
  return assertQueryEndpoint(raw);
}
