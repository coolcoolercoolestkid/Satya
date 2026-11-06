import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const watch = process.argv.includes("--watch");
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
cpSync("public", "dist", { recursive: true });
mkdirSync("data", { recursive: true }); // run `pnpm data` first to download the public lists
cpSync("data", "dist/data", { recursive: true });

const options = {
  entryPoints: {
    background: "src/background.ts",
    content: "src/content.ts",
    sidepanel: "src/sidepanel.tsx",
  },
  bundle: true,
  format: "iife",
  target: "chrome120",
  outdir: "dist",
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
