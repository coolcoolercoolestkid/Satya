/**
 * Compile every claim circuit with circom 2.x.
 *
 * Refuses to run on circom 1.x: the npm `circom` package is the frozen JavaScript
 * compiler and cannot build these sources, so a silent version mismatch would otherwise
 * surface as a confusing syntax error. See docs/toolchain.md.
 *
 * Treats any `--inspect` warning as a failure. An unconstrained signal or a `<--` that
 * should be `<==` is a soundness bug, not a style note.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const circuitsDir = join(packageRoot, "circuits");
const buildDir = join(packageRoot, "build");
const circomlibCircuits = join(packageRoot, "node_modules", "circomlib", "circuits");

export interface CircuitStats {
  name: string;
  nonLinearConstraints: number;
  linearConstraints: number;
  publicInputs: number;
  privateInputs: number;
  publicOutputs: number;
  wires: number;
}

function assertCircom2(): string {
  const result = spawnSync("circom", ["--version"], { encoding: "utf8" });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(
      "circom not found on PATH. Install circom 2.x — see docs/toolchain.md.",
    );
  }
  const version = result.stdout.trim();
  if (!/^circom compiler 2\./.test(version)) {
    throw new Error(
      `refusing to compile with "${version}". circom 2.x is required; the npm circom ` +
        "0.5.x package is the frozen circom 1 compiler. See docs/toolchain.md.",
    );
  }
  return version;
}

/** Names of every template Aletheia defines, gathered from our own sources. */
function ownTemplateNames(): Set<string> {
  const names = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name.endsWith(".circom")) {
        for (const match of readFileSync(path, "utf8").matchAll(
          /^\s*template\s+([A-Za-z_]\w*)\s*\(/gm,
        )) {
          if (match[1] !== undefined) names.add(match[1]);
        }
      }
    }
  };
  walk(circuitsDir);
  return names;
}

/**
 * Fail on any circom warning that could hide a soundness bug in our circuits.
 *
 * The one tolerated class is CA02 ("signals that do not appear in any constraint")
 * raised inside circomlib's own templates: `LessThan` and friends decompose their
 * inputs and do not use every bit downstream, and we are not going to fork circomlib
 * over it. The same warning raised in one of *our* templates is a real finding — an
 * unconstrained signal is exactly the bug `--inspect` exists to catch — so it fails,
 * and marking a deliberate case with `_ <==` is how it gets silenced.
 */
function assertNoActionableWarnings(name: string, output: string, ours: Set<string>): void {
  const warnings = [...output.matchAll(/warning\[(\w+)\][^\n]*?In template "([^"(]+)/g)];
  const unlabelled = [...output.matchAll(/warning/gi)].length - warnings.length;
  if (unlabelled > 0) {
    throw new Error(
      `circom emitted ${unlabelled} warning(s) for ${name} that could not be ` +
        `attributed to a template; review them:\n${output}`,
    );
  }
  const actionable = warnings.filter(
    (match) => match[1] !== "CA02" || (match[2] !== undefined && ours.has(match[2])),
  );
  if (actionable.length > 0) {
    const summary = actionable
      .map((match) => `  warning[${match[1]}] in template ${match[2]}`)
      .join("\n");
    throw new Error(
      `circom --inspect reported warnings in Aletheia templates for ${name}. Fix them ` +
        `or mark deliberate unused signals with \`_ <==\`:\n${summary}\n\n${output}`,
    );
  }
}

/** Read the statistics circom prints, so a constraint blow-up is visible. */
function parseStats(name: string, output: string): CircuitStats {
  // Strip ANSI colour codes so the labels match, and anchor each label at the start of
  // its line: "linear constraints" is otherwise a substring of "non-linear
  // constraints" and both would read the same number.
  const plain = output.replace(/\u001B\[[\d;]*m/g, "");
  const read = (label: string): number => {
    const match = new RegExp(`^${label}:\\s*(\\d+)`, "m").exec(plain);
    if (match?.[1] === undefined) {
      throw new Error(`could not read "${label}" from circom output for ${name}`);
    }
    return Number.parseInt(match[1], 10);
  };
  return {
    name,
    nonLinearConstraints: read("non-linear constraints"),
    linearConstraints: read("linear constraints"),
    publicInputs: read("public inputs"),
    privateInputs: read("private inputs"),
    publicOutputs: read("public outputs"),
    wires: read("wires"),
  };
}

export function compileCircuit(name: string, ours: Set<string>): CircuitStats {
  const outputDir = join(buildDir, name);
  mkdirSync(outputDir, { recursive: true });

  const result = spawnSync(
    "circom",
    [
      join(circuitsDir, `${name}.circom`),
      "--r1cs",
      "--wasm",
      "--sym",
      "--inspect",
      "-l",
      circomlibCircuits,
      "-o",
      outputDir,
    ],
    { encoding: "utf8" },
  );

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new Error(`circom failed for ${name}:\n${output}`);
  }
  assertNoActionableWarnings(name, output, ours);

  const stats = parseStats(name, output);
  writeFileSync(
    join(outputDir, "constraints.json"),
    `${JSON.stringify(stats, null, 2)}\n`,
    "utf8",
  );
  return stats;
}

/** Top-level circuits only; `circuits/lib` holds templates, not main components. */
export function circuitNames(): string[] {
  return readdirSync(circuitsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".circom"))
    .map((entry) => entry.name.replace(/\.circom$/, ""))
    .sort();
}

function main(): void {
  const version = assertCircom2();
  console.log(`using ${version}`);
  const names = circuitNames();
  if (names.length === 0) {
    throw new Error(`no circuits found in ${circuitsDir}`);
  }
  const ours = ownTemplateNames();
  for (const name of names) {
    const stats = compileCircuit(name, ours);
    console.log(
      `${name}: ${stats.nonLinearConstraints} non-linear + ${stats.linearConstraints} ` +
        `linear constraints, ${stats.publicInputs} public inputs, ` +
        `${stats.publicOutputs} public outputs`,
    );
  }
}

main();
