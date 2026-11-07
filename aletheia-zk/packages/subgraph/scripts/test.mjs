// Matchstick runner.
//
// Why this exists: matchstick ships a Linux-only binary, so `graph test` cannot run
// natively on Windows. `graph test -d` runs it in Docker, but it bind-mounts only the
// datasource directory (packages/subgraph) — and pnpm's node_modules there is a tree of
// symlinks into the repo-root store (node_modules/.pnpm/...). Docker Desktop translates a
// Windows symlink target `C:\...\node_modules\.pnpm\...` to `/mnt/host/c/...\`, which only
// resolves if the *repo root* is mounted at exactly that translated path. So on Windows we
// mount the repo root at `/mnt/host/<drive>/<path>` and run the binary from the subgraph
// working dir. On Linux/macOS, pnpm uses relative symlinks and the native `graph test`
// works, so we just defer to it.
//
// Toolchain pin (see package.json): matchstick 0.6.0 is the newest release and compiles
// with assemblyscript 0.19.23, so graph-ts is held at 0.35.0 (the last version on asc
// 0.19.x); 0.36+ moved to asc 0.27.31, which matchstick 0.6.0 cannot invoke.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const subgraphDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(subgraphDir, "..", "..");
const args = process.argv.slice(2);

function run(cmd, cmdArgs) {
  execFileSync(cmd, cmdArgs, { stdio: "inherit" });
}

if (process.platform !== "win32") {
  // Native path: matchstick's Linux/macOS binary works directly.
  run("pnpm", ["exec", "graph", "test", ...args]);
  process.exit(0);
}

// Windows: run matchstick inside the image `graph test -d` builds, but mount the whole
// repo so pnpm's absolute symlinks resolve.
const dockerfile = path.join(subgraphDir, "tests", ".docker", "Dockerfile");
if (!existsSync(dockerfile)) {
  console.error(
    `Missing ${dockerfile}. Run \`pnpm --filter @aletheia/subgraph exec graph test -d\`` +
      ` once (in an interactive terminal) to generate it, then re-run this.`,
  );
  process.exit(1);
}

// Build the matchstick image if it is not already present.
try {
  execFileSync("docker", ["image", "inspect", "matchstick:latest"], {
    stdio: "ignore",
  });
} catch {
  run("docker", ["build", "-t", "matchstick:latest", "-f", dockerfile, subgraphDir]);
}

// Translate the Windows repo-root path to the Docker Desktop share path pnpm's symlink
// targets were rewritten to (e.g. C:\Users\me\repo -> /mnt/host/c/Users/me/repo).
const m = /^([A-Za-z]):[\\/](.*)$/.exec(repoRoot);
if (!m) {
  console.error(`Cannot map repo root to a container path: ${repoRoot}`);
  process.exit(1);
}
const containerRepo = `/mnt/host/${m[1].toLowerCase()}/${m[2].replace(/\\/g, "/")}`;
const containerSubgraph = `${containerRepo}/packages/subgraph`;

run("docker", [
  "run",
  "--rm",
  "--mount",
  `type=bind,source=${repoRoot},target=${containerRepo}`,
  "-w",
  containerSubgraph,
  "matchstick:latest",
  "/binary-linux-22",
  ...args,
]);
