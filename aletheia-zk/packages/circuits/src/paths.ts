/**
 * Locations of compiled circuit artifacts. One place, so scripts, tests, contracts and
 * the frontend cannot disagree about where a wasm or zkey lives.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Works from both `src` (type-stripped) and `dist` (compiled): both sit one level in. */
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface CircuitArtifacts {
  name: string;
  /** Witness calculator produced by circom. */
  wasm: string;
  /** Constraint system, used to check witnesses and to run the setup. */
  r1cs: string;
  /** Signal name map, for debugging a failing constraint. */
  sym: string;
  /** Final proving key after the phase-2 contribution and beacon. */
  zkey: string;
  /** Verification key, consumed by snarkjs and by the Solidity verifier check. */
  vkey: string;
  /** Constraint counts recorded at compile time. */
  stats: string;
}

export function circuitArtifacts(name: string): CircuitArtifacts {
  const dir = join(packageRoot, "build", name);
  return {
    name,
    wasm: join(dir, `${name}_js`, `${name}.wasm`),
    r1cs: join(dir, `${name}.r1cs`),
    sym: join(dir, `${name}.sym`),
    zkey: join(dir, `${name}_final.zkey`),
    vkey: join(dir, `${name}_vkey.json`),
    stats: join(dir, "constraints.json"),
  };
}

export function buildDir(): string {
  return join(packageRoot, "build");
}

/** Fail with an instruction rather than a missing-file stack trace. */
export function assertArtifacts(name: string, need: readonly (keyof CircuitArtifacts)[]): CircuitArtifacts {
  const artifacts = circuitArtifacts(name);
  for (const key of need) {
    const path = artifacts[key];
    if (typeof path === "string" && !existsSync(path)) {
      throw new Error(
        `missing ${key} for circuit "${name}" at ${path}. ` +
          "Run: pnpm --filter @aletheia/circuits run build",
      );
    }
  }
  return artifacts;
}
