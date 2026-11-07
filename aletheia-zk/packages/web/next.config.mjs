/**
 * Next.js config for the holder flow.
 *
 * Three things it has to arrange:
 * - `transpilePackages`: the workspace packages ship ESM `dist`, but they and their
 *   dependencies (circomlibjs, snarkjs) are transpiled through Next so browser targeting
 *   and the worker graph resolve cleanly.
 * - node-core fallbacks: snarkjs and pdf.js reference `fs`/`os`/`path`/`crypto` on their
 *   Node paths, which the browser never takes. Mapping them to `false` lets webpack drop
 *   those branches instead of failing to resolve them.
 * - `asyncWebAssembly`: the extraction OCR core and pdf.js load wasm; the proving wasm and
 *   zkey are fetched from `public/` at runtime, not bundled.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Let a second instance (e.g. a verification run alongside a dev server already holding
  // `.next`) use an isolated build dir via NEXT_DIST_DIR, so the two never clobber each
  // other. Defaults to the standard `.next`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The monorepo root, so Next does not latch onto a stray lockfile in the home directory.
  outputFileTracingRoot: repoRoot,
  transpilePackages: [
    "@aletheia/credential",
    "@aletheia/circuits",
    "@aletheia/issuer-mock",
    "@aletheia/extraction",
    "@aletheia/query",
    "@aletheia/ens",
  ],
  webpack: (config, { isServer }) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true, topLevelAwait: true };
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        os: false,
        path: false,
        crypto: false,
        readline: false,
        constants: false,
        stream: false,
        worker_threads: false,
      };
    }
    return config;
  },
};

export default nextConfig;
