/**
 * Proof shapes and the Solidity-calldata conversion.
 *
 * Split out of `prove.ts` so the browser holder flow can turn a snarkjs proof into the
 * verifier's call arguments without importing the Node-only artifact loaders. This module
 * touches only snarkjs, never the filesystem.
 */

import * as snarkjs from "snarkjs";

/** A Groth16 proof in the shape snarkjs emits and the Solidity verifier consumes. */
export interface Groth16Proof {
  pi_a: [string, string, string];
  pi_b: [[string, string], [string, string], [string, string]];
  pi_c: [string, string, string];
  protocol: string;
  curve: string;
}

export interface ProofResult {
  proof: Groth16Proof;
  /** Decimal strings, in the frozen order: outputs first, then public inputs. */
  publicSignals: string[];
}

/** A proof in the argument form the generated Solidity verifier expects. */
export interface SolidityCalldata {
  a: readonly [bigint, bigint];
  b: readonly [readonly [bigint, bigint], readonly [bigint, bigint]];
  c: readonly [bigint, bigint];
  publicSignals: readonly bigint[];
}

/**
 * Convert a proof into Solidity call arguments.
 *
 * Delegated to snarkjs rather than transposed by hand: the G2 element's coordinate
 * pairs are swapped relative to the JSON encoding, and getting that wrong produces a
 * proof that fails on-chain while verifying perfectly off-chain.
 */
export async function toSolidityCalldata(
  proof: Groth16Proof,
  publicSignals: readonly string[],
): Promise<SolidityCalldata> {
  const raw = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
  const [a, b, c, signals] = JSON.parse(`[${raw}]`) as [
    [string, string],
    [[string, string], [string, string]],
    [string, string],
    string[],
  ];
  return {
    a: [BigInt(a[0]), BigInt(a[1])],
    b: [
      [BigInt(b[0][0]), BigInt(b[0][1])],
      [BigInt(b[1][0]), BigInt(b[1][1])],
    ],
    c: [BigInt(c[0]), BigInt(c[1])],
    publicSignals: signals.map((signal) => BigInt(signal)),
  };
}
