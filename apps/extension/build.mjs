import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const watch = process.argv.includes("--watch");
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
cpSync("public", "dist", { recursive: true });
mkdirSync("data", { recursive: true }); // run `pnpm data` first to download the public lists
cpSync("data", "dist/data", { recursive: true });

// Anon Aadhaar's compiled build imports Node's "crypto"; point it at a browser stand-in.
const nodeShims = {
  name: "node-shims",
  setup(build) {
    const shim = fileURLToPath(new URL("./src/shims/node-crypto.js", import.meta.url));
    build.onResolve({ filter: /^(node:)?crypto$/ }, () => ({ path: shim }));
  },
};

const options = {
  entryPoints: {
    background: "src/background.ts",
    content: "src/content.ts",
    sidepanel: "src/sidepanel.tsx",
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  outdir: "dist",
  plugins: [nodeShims],
  inject: ["src/shims/buffer-global.js"],
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
  // Arkiv RPC access key: not a secret, restrict it to the extension at hub.arkiv.network/access-keys.
  define: { __ARKIV_ACCESS_KEY__: JSON.stringify(process.env.ARKIV_ACCESS_KEY ?? "") },
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
