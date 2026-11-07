/**
 * Phase-1 trusted setup input.
 *
 * Preferred source: the published Perpetual Powers of Tau file, a real multi-party
 * ceremony with 54 contributions and a beacon, verified against the blake2b hash
 * published in the snarkjs README. Any mirror is acceptable because the hash — not the
 * host — is what is trusted.
 *
 * As of this writing both official hosts (the zkevm Google Storage bucket and the
 * legacy Hermez S3 bucket) return HTTP 403 for every power, so the download usually
 * fails. When it does, a phase 1 is generated locally and labelled
 * "local-development" everywhere it is recorded.
 *
 * That fallback is honest rather than convenient: a locally generated phase 1 has no
 * multi-party guarantee at all. It does not change Aletheia's security claim, because
 * the per-circuit phase 2 is a single contribution and is already unusable for
 * production. What matters is that the two cases are never confused, so the provenance
 * travels with the setup record. See docs/trust-model.md.
 */

import { createHash, randomBytes } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import * as snarkjs from "snarkjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Power 14 supports 16,384 constraints. The age circuit uses 8,421, leaving room for
 * the nationality and expiry circuits, which are smaller.
 */
export const PTAU_POWER = 14;
export const PTAU_MAX_CONSTRAINTS = 2 ** PTAU_POWER;

export const PUBLISHED_PTAU = {
  file: `powersOfTau28_hez_final_${PTAU_POWER}.ptau`,
  url: `https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_${PTAU_POWER}.ptau`,
  /** blake2b hash published in the snarkjs README for this exact file. */
  blake2b:
    "eeefbcf7c3803b523c94112023c7ff89558f9b8e0cf5d6cdcba3ade60f168af4a181c9c21774b94fbae6c90411995f7d854d02ebd93fb66043dbb06f17a831c1",
} as const;

const LOCAL_PTAU_FILE = `aletheia_dev_${PTAU_POWER}.ptau`;

export type PtauProvenance = "perpetual-powers-of-tau" | "local-development";

export interface Phase1 {
  path: string;
  provenance: PtauProvenance;
  power: number;
  blake2b: string;
}

function ptauDir(): string {
  return join(packageRoot, "ptau");
}

export async function blake2bOf(path: string): Promise<string> {
  const hash = createHash("blake2b512");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

async function download(url: string, destination: string): Promise<void> {
  mkdirSync(dirname(destination), { recursive: true });
  const response = await fetch(url);
  if (!response.ok || response.body === null) {
    throw new Error(`HTTP ${response.status}`);
  }
  // Download under a temporary name so an interrupted transfer is not mistaken for a
  // complete file on the next run.
  const partial = `${destination}.partial`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  renameSync(partial, destination);
}

async function usePublished(path: string): Promise<Phase1> {
  const actual = await blake2bOf(path);
  if (actual !== PUBLISHED_PTAU.blake2b) {
    throw new Error(
      `ptau hash mismatch for ${path}\n  expected ${PUBLISHED_PTAU.blake2b}\n` +
        `  actual   ${actual}\n` +
        "Delete the file and retry. Do not proceed with an unverified ceremony file.",
    );
  }
  console.log(
    `phase 1: ${PUBLISHED_PTAU.file} verified against the published hash ` +
      `(${(statSync(path).size / 1_048_576).toFixed(1)} MiB)`,
  );
  return {
    path,
    provenance: "perpetual-powers-of-tau",
    power: PTAU_POWER,
    blake2b: actual,
  };
}

/**
 * Generate a phase 1 locally: accumulator, one contribution, a beacon, then the
 * phase-2 preparation. snarkjs verifies the transcript afterwards, so the file is
 * structurally sound — it simply has no ceremony behind it.
 */
async function generateLocal(): Promise<Phase1> {
  const dir = ptauDir();
  mkdirSync(dir, { recursive: true });
  const final = join(dir, LOCAL_PTAU_FILE);

  if (!existsSync(final)) {
    console.warn(
      "phase 1: the published ceremony file could not be fetched, generating a local " +
        "phase 1 instead. This has NO multi-party guarantee and is development only.",
    );
    const fresh = join(dir, "dev_0000.ptau");
    const contributed = join(dir, "dev_0001.ptau");
    const beaconed = join(dir, "dev_beacon.ptau");
    const curve = await snarkjs.curves.getCurveFromName("bn128");

    await snarkjs.powersOfTau.newAccumulator(curve, PTAU_POWER, fresh);
    await snarkjs.powersOfTau.contribute(
      fresh,
      contributed,
      "aletheia local development contribution",
      randomBytes(32).toString("hex"),
    );
    await snarkjs.powersOfTau.beacon(
      contributed,
      beaconed,
      "aletheia local development beacon",
      "a1e7be1a00000000000000000000000000000000000000000000000000000001",
      10,
    );
    await snarkjs.powersOfTau.preparePhase2(beaconed, final);

    for (const intermediate of [fresh, contributed, beaconed]) {
      rmSync(intermediate, { force: true });
    }
  }

  if (!(await snarkjs.powersOfTau.verify(final))) {
    throw new Error(`locally generated phase 1 failed verification: ${final}`);
  }
  console.log(
    `phase 1: local development file ${LOCAL_PTAU_FILE} (power ${PTAU_POWER}) verified`,
  );
  return {
    path: final,
    provenance: "local-development",
    power: PTAU_POWER,
    blake2b: await blake2bOf(final),
  };
}

/**
 * Resolve the phase-1 file to use, in order of preference:
 *   1. ALETHEIA_PTAU, for an operator who already holds the published file
 *   2. a previously verified copy in packages/circuits/ptau
 *   3. a fresh download of the published file
 *   4. a locally generated phase 1, clearly labelled
 */
export async function ensurePtau(): Promise<Phase1> {
  const override = process.env.ALETHEIA_PTAU;
  if (override !== undefined && override !== "") {
    if (!existsSync(override)) {
      throw new Error(`ALETHEIA_PTAU is set to ${override}, which does not exist`);
    }
    return usePublished(override);
  }

  const published = join(ptauDir(), PUBLISHED_PTAU.file);
  if (existsSync(published)) {
    return usePublished(published);
  }

  const local = join(ptauDir(), LOCAL_PTAU_FILE);
  if (!existsSync(local)) {
    try {
      console.log(`phase 1: downloading ${PUBLISHED_PTAU.file}`);
      await download(PUBLISHED_PTAU.url, published);
      return await usePublished(published);
    } catch (error) {
      rmSync(`${published}.partial`, { force: true });
      console.warn(
        `phase 1: ${PUBLISHED_PTAU.url} is unavailable (${(error as Error).message}). ` +
          "If you have the file, point ALETHEIA_PTAU at it to use the real ceremony.",
      );
    }
  }
  return generateLocal();
}
