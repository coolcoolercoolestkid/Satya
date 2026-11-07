/**
 * Phase-2 Groth16 setup, per circuit.
 *
 * Phase 1 is the published Perpetual Powers of Tau file (see ptau.ts). Phase 2 is
 * circuit-specific and is run here with a single contribution plus a beacon.
 *
 * Be clear about what that means: a one-contributor phase 2 gives no soundness
 * guarantee, because whoever ran it could keep the toxic waste and forge proofs. This
 * is acceptable for a testnet demonstration and is not acceptable for anything real. A
 * production deployment needs a multi-party phase 2 with published transcripts. Recorded
 * in docs/trust-model.md rather than left implicit.
 *
 * The setup is skipped when a final zkey already exists, because regenerating it
 * invalidates the deployed Solidity verifier. Use --force when that is intended.
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import * as snarkjs from "snarkjs";

import { blake2bOf, PTAU_MAX_CONSTRAINTS, ensurePtau, type Phase1 } from "./ptau.ts";
import { circuitArtifacts } from "../src/paths.ts";

/**
 * A fixed development beacon value.
 *
 * A real beacon is a public randomness source nobody could have predicted when the
 * contributions were made — a future bitcoin block hash, a drand round — published so
 * anyone can recompute the final key. This constant is none of those things: it is an
 * arbitrary value committed to this repository, chosen so the setup is reproducible.
 *
 * It is labelled honestly rather than dressed up as public randomness, because calling
 * it a beacon in the cryptographic sense would misrepresent what the setup guarantees.
 * A production deployment replaces this with a real beacon over a multi-party phase 2.
 */
const BEACON_HASH = "a1e7be1a00000000000000000000000000000000000000000000000000000001";
const BEACON_ITERATIONS = 10;

/**
 * What a proving key was built from. Written next to the key so a deployment can always
 * be traced back to a phase 1 and a phase 2, including which kind of phase 1 it was.
 */
interface SetupRecord {
  circuit: string;
  phase1Provenance: Phase1["provenance"];
  phase1File: string;
  phase1Blake2b: string;
  phase2Contributions: number;
  phase2BeaconHash: string;
  productionReady: false;
  zkeyBlake2b: string;
  vkeyBlake2b: string;
  nonLinearConstraints: number;
}

async function setupCircuit(name: string, phase1: Phase1, force: boolean): Promise<SetupRecord> {
  const artifacts = circuitArtifacts(name);
  if (!existsSync(artifacts.r1cs)) {
    throw new Error(`compile first: ${artifacts.r1cs} is missing`);
  }

  const stats = JSON.parse(readFileSync(artifacts.stats, "utf8")) as {
    nonLinearConstraints: number;
  };
  if (stats.nonLinearConstraints > PTAU_MAX_CONSTRAINTS) {
    throw new Error(
      `${name} needs ${stats.nonLinearConstraints} constraints but the phase-1 file ` +
        `supports ${PTAU_MAX_CONSTRAINTS}. Use a larger ptau power.`,
    );
  }

  if (existsSync(artifacts.zkey) && !force) {
    console.log(`${name}: reusing existing proving key (pass --force to regenerate)`);
  } else {
    const dir = join(artifacts.zkey, "..");
    const initial = join(dir, `${name}_0000.zkey`);
    const contributed = join(dir, `${name}_0001.zkey`);

    console.log(`${name}: phase-2 setup`);
    await snarkjs.zKey.newZKey(artifacts.r1cs, phase1.path, initial);

    // Entropy from the OS CSPRNG. The contribution's secret is discarded with the
    // process; it is not written anywhere.
    await snarkjs.zKey.contribute(
      initial,
      contributed,
      "aletheia phase-1 development contribution",
      randomBytes(32).toString("hex"),
    );

    await snarkjs.zKey.beacon(
      contributed,
      artifacts.zkey,
      "aletheia phase-1 beacon",
      BEACON_HASH,
      BEACON_ITERATIONS,
    );

    // Intermediate keys are not needed again and only invite accidental use.
    rmSync(initial, { force: true });
    rmSync(contributed, { force: true });
  }

  // The real check: does this proving key actually belong to this circuit and this
  // phase-1 file? A zkey left over from an earlier version of the circuit fails here.
  const consistent = await snarkjs.zKey.verifyFromR1cs(
    artifacts.r1cs,
    phase1.path,
    artifacts.zkey,
  );
  if (!consistent) {
    throw new Error(`${name}: proving key does not match the r1cs and phase-1 file`);
  }

  const vkey = await snarkjs.zKey.exportVerificationKey(artifacts.zkey);
  writeFileSync(artifacts.vkey, `${JSON.stringify(vkey, null, 2)}\n`, "utf8");

  const record: SetupRecord = {
    circuit: name,
    phase1Provenance: phase1.provenance,
    phase1File: basename(phase1.path),
    phase1Blake2b: phase1.blake2b,
    phase2Contributions: 1,
    phase2BeaconHash: BEACON_HASH,
    productionReady: false,
    zkeyBlake2b: await blake2bOf(artifacts.zkey),
    vkeyBlake2b: await blake2bOf(artifacts.vkey),
    nonLinearConstraints: stats.nonLinearConstraints,
  };
  writeFileSync(
    join(artifacts.zkey, "..", "setup.json"),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8",
  );
  return record;
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  const phase1 = await ensurePtau();

  const records: SetupRecord[] = [];
  for (const name of ["age", "nationality", "expiry"]) {
    records.push(await setupCircuit(name, phase1, force));
  }

  for (const record of records) {
    console.log(
      `${record.circuit}: verification key exported, zkey blake2b ` +
        `${record.zkeyBlake2b.slice(0, 16)}…`,
    );
  }
  console.log(
    `setup complete with a ${phase1.provenance} phase 1 and a single phase-2 ` +
      "contribution. Not production ready; see docs/trust-model.md.",
  );

  const curve = (globalThis as { curve_bn128?: { terminate(): Promise<void> } }).curve_bn128;
  await curve?.terminate();
}

await main();
