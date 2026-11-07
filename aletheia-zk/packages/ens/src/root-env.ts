/**
 * Loading the repository-root `.env`, for Node callers only.
 *
 * Kept out of `endpoint.ts` (pure URL validation and a `process.env` read) and out of
 * `resolver.ts` so the browser entry (`browser.ts`) can import the resolver without
 * dragging `node:fs` into a bundle. A browser caller passes the RPC URL explicitly and
 * never needs this; the Node barrel (`index.ts`) wraps the resolver factory to call it
 * first, so Node callers keep the auto-load they always had.
 *
 * Loaded the same way `@aletheia/query` and the contracts scripts load it: Node's own
 * env-file loader, no dependency.
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
 * so a value from the shell — or injected by CI, which has no `.env` — wins over the
 * file. Safe to call more than once.
 */
export function loadRootEnv(): void {
  if (existsSync(ROOT_ENV)) {
    process.loadEnvFile(ROOT_ENV);
  }
}
