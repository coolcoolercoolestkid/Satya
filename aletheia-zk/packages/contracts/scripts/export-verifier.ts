/**
 * Generate the Solidity Groth16 verifier for a circuit from its proving key.
 *
 * The output is snarkjs's, not ours. The only transformation applied is a mechanical
 * rename of the contract — the template always emits `Groth16Verifier`, and Aletheia
 * needs one verifier per claim type — plus a header saying the file is generated.
 *
 * That transformation lives in `renderVerifier`, which the test suite also calls, so the
 * committed file can be proven to be exactly this script's output for the current
 * proving key. Nothing about the verification key is ever edited by hand: those
 * constants are the trust anchor for every on-chain verification.
 */

import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { circuitArtifacts } from "@aletheia/circuits";
import * as snarkjs from "snarkjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Circuit name to the contract name Aletheia deploys for it. */
export const VERIFIER_CONTRACTS = {
  age: "Groth16VerifierAge",
  nationality: "Groth16VerifierNationality",
  expiry: "Groth16VerifierExpiry",
} as const;

export type VerifierCircuit = keyof typeof VERIFIER_CONTRACTS;

export function verifierPath(circuit: VerifierCircuit): string {
  return join(packageRoot, "contracts", "verifiers", `${VERIFIER_CONTRACTS[circuit]}.sol`);
}

/** snarkjs ships the template inside its own package; read it from there. */
function groth16Template(): string {
  const require = createRequire(import.meta.url);
  const snarkjsEntry = require.resolve("snarkjs");
  const templates = join(dirname(snarkjsEntry), "..", "templates");
  return readFileSync(join(templates, "verifier_groth16.sol.ejs"), "utf8");
}

export function renderVerifier(generated: string, circuit: VerifierCircuit): string {
  const contract = VERIFIER_CONTRACTS[circuit];
  const renamed = generated.replace(/contract Groth16Verifier\b/, `contract ${contract}`);
  if (!renamed.includes(`contract ${contract}`)) {
    throw new Error(
      "the snarkjs template no longer emits `contract Groth16Verifier`; update the rename",
    );
  }
  const header = [
    "// GENERATED FILE — DO NOT EDIT.",
    `// snarkjs groth16 verifier for circuits/${circuit}.circom, exported by`,
    "// scripts/export-verifier.ts. The only change from snarkjs's output is the",
    `// contract name (Groth16Verifier -> ${contract}).`,
    "//",
    "// Regenerating this file after a new trusted setup invalidates any deployed copy:",
    "// the verification key is baked into the constants below.",
    "",
  ].join("\n");
  return `${header}${renamed.trimEnd()}\n`;
}

export async function exportVerifier(circuit: VerifierCircuit): Promise<string> {
  const { zkey } = circuitArtifacts(circuit);
  const generated = await snarkjs.zKey.exportSolidityVerifier(zkey, {
    groth16: groth16Template(),
  });
  return renderVerifier(generated, circuit);
}

async function main(): Promise<void> {
  for (const circuit of Object.keys(VERIFIER_CONTRACTS) as VerifierCircuit[]) {
    const source = await exportVerifier(circuit);
    const path = verifierPath(circuit);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source, "utf8");
    console.log(`wrote ${VERIFIER_CONTRACTS[circuit]}.sol (${source.length} bytes)`);
  }

  const curve = (globalThis as { curve_bn128?: { terminate(): Promise<void> } }).curve_bn128;
  await curve?.terminate();
}

// Only run when invoked directly; the test suite imports the helpers above.
if (process.argv[1] !== undefined && process.argv[1].endsWith("export-verifier.ts")) {
  await main();
}
