import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const watch = process.argv.includes("--watch");
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
cpSync("public", "dist", { recursive: true });
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
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
