import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import { type SignedCredential } from "@aletheia/credential";
import { loadCredentialFixture } from "@aletheia/credential/test-fixture";
import {
  AGE_PUBLIC_SIGNALS,
  proveAgeClaim,
  releaseProver,
  toSolidityCalldata,
  verifyAgeClaim,
  type SolidityCalldata,
} from "@aletheia/circuits";
import { generateKeypair, signCredential } from "@aletheia/issuer-mock";
import { network } from "hardhat";

import { exportVerifier, verifierPath } from "../scripts/export-verifier.ts";

const REQUEST = {
  minimumAge: 18,
  currentDate: 20260901,
  contextId: loadCredentialFixture().expected.contextId,
} as const;

/** Public signals as the fixed-size tuple the generated verifier expects. */
type Signals = readonly [
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
];

function asSignals(values: readonly bigint[]): Signals {
  assert.equal(values.length, AGE_PUBLIC_SIGNALS.length);
  return values as unknown as Signals;
}

describe("Groth16VerifierAge", async () => {
  const { viem } = await network.create();
  const verifier = await viem.deployContract("Groth16VerifierAge");

  let signed: SignedCredential;
  let calldata: SolidityCalldata;
  let publicSignals: string[];

  before(async () => {
    // One real proof, produced from a real issuer signature, reused across the cases.
    // Nothing here is a fixture of a proof: it is generated on every run.
    const { credential } = loadCredentialFixture();
    const { privateKey } = await generateKeypair();
    signed = await signCredential(privateKey, credential);
    const proved = await proveAgeClaim(signed, REQUEST);
    publicSignals = proved.publicSignals;
    calldata = await toSolidityCalldata(proved.proof, proved.publicSignals);
  });

  after(releaseProver);

  it("is exactly what scripts/export-verifier.ts produces for the current proving key", async () => {
    // Catches two mistakes that would otherwise surface as unexplained on-chain
    // verification failures: a hand-edited verifier, and a verifier left behind by an
    // earlier trusted setup.
    const committed = readFileSync(verifierPath("age"), "utf8");
    const fresh = await exportVerifier("age");
    assert.equal(
      committed.replace(/\r\n/g, "\n"),
      fresh.replace(/\r\n/g, "\n"),
      "the committed verifier does not match the current proving key; re-run pnpm run export-verifier",
    );
  });

  it("accepts a real proof on-chain", async () => {
    const accepted = await verifier.read.verifyProof([
      calldata.a,
      calldata.b,
      calldata.c,
      asSignals(calldata.publicSignals),
    ]);
    assert.equal(accepted, true);
  });

  it("agrees with off-chain verification", async () => {
    // The contract and snarkjs must reach the same verdict. If they diverge, the
    // calldata transposition is wrong and the whole submit path is broken.
    assert.equal(await verifyAgeClaim(publicSignals, (await proveAgeClaim(signed, REQUEST)).proof), true);
    assert.equal(
      await verifier.read.verifyProof([
        calldata.a,
        calldata.b,
        calldata.c,
        asSignals(calldata.publicSignals),
      ]),
      true,
    );
  });

  it("rejects a proof whose public signals were altered", async () => {
    const index = (name: (typeof AGE_PUBLIC_SIGNALS)[number]): number =>
      AGE_PUBLIC_SIGNALS.indexOf(name);

    for (const name of AGE_PUBLIC_SIGNALS) {
      const altered = [...calldata.publicSignals];
      altered[index(name)] = (altered[index(name)] as bigint) + 1n;
      const accepted = await verifier.read.verifyProof([
        calldata.a,
        calldata.b,
        calldata.c,
        asSignals(altered),
      ]);
      assert.equal(accepted, false, `altering ${name} must not verify on-chain`);
    }
  });

  it("rejects a proof claiming a higher threshold than was proven", async () => {
    // The attack this whole layer exists to stop: reusing a proof of "at least 18" as
    // though it proved "at least 21".
    const inflated = [...calldata.publicSignals];
    inflated[AGE_PUBLIC_SIGNALS.indexOf("minimumAge")] = 21n;
    const accepted = await verifier.read.verifyProof([
      calldata.a,
      calldata.b,
      calldata.c,
      asSignals(inflated),
    ]);
    assert.equal(accepted, false);
  });

  it("rejects a mutated proof", async () => {
    const mutations: ReadonlyArray<[string, Parameters<typeof verifier.read.verifyProof>[0]]> = [
      [
        "pi_a",
        [[calldata.a[0] + 1n, calldata.a[1]], calldata.b, calldata.c, asSignals(calldata.publicSignals)],
      ],
      [
        "pi_b",
        [
          calldata.a,
          [[calldata.b[0][0] + 1n, calldata.b[0][1]], calldata.b[1]],
          calldata.c,
          asSignals(calldata.publicSignals),
        ],
      ],
      [
        "pi_c",
        [calldata.a, calldata.b, [calldata.c[0] + 1n, calldata.c[1]], asSignals(calldata.publicSignals)],
      ],
    ];

    for (const [label, args] of mutations) {
      assert.equal(await verifier.read.verifyProof(args), false, `mutated ${label} must not verify`);
    }
  });

  it("rejects values outside the scalar field instead of reverting", async () => {
    // The generated verifier range-checks its inputs and returns false. Worth pinning:
    // AletheiaVerifier treats a false return as "invalid proof" and must not be
    // surprised by a revert instead.
    const fieldModulus =
      21888242871839275222246405745257275088548364400416034343698204186575808495617n;
    const outOfField = [...calldata.publicSignals];
    outOfField[0] = fieldModulus;
    assert.equal(
      await verifier.read.verifyProof([
        calldata.a,
        calldata.b,
        calldata.c,
        asSignals(outOfField),
      ]),
      false,
    );
  });
});
