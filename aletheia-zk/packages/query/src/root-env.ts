/**
 * Loading the repository-root `.env`, for Node callers only.
 *
 * This is the one piece of the endpoint story that touches the filesystem, so it is kept
 * out of `endpoint.ts` (which is pure — URL validation and a `process.env` read) and out
 * of `client.ts`. That separation is what lets the browser entry (`browser.ts`) import the
 * client without dragging `node:fs` into a bundle: a browser caller passes the endpoint
 * explicitly and never needs this, and the Node barrel (`index.ts`) wraps the client
 * factory to call this first, so Node callers keep the auto-load they always had.
 *
 * Loaded the same way `packages/contracts/scripts/*` and `hardhat.config.ts` load it:
 * Node's own env-file loader, no dependency.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository-root `.env`, resolved from this file rather than the process cwd. */
const ROOT_ENV = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env");

/**
 * Load the repository-root `.env` into `process.env`, if it exists.
 *
 * Idempotent and non-overriding: Node's loader does not replace variables already set,
 * so a value exported in the shell — or injected by CI, which has no `.env` — wins over
 * the file. Safe to call more than once.
 */
export function loadRootEnv(): void {
  if (existsSync(ROOT_ENV)) {
    process.loadEnvFile(ROOT_ENV);
  }
}
