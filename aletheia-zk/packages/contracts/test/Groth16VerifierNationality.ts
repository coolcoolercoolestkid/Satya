import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import { type SignedCredential } from "@aletheia/credential";
import { loadCredentialFixture } from "@aletheia/credential/test-fixture";
import {
  NATIONALITY_PUBLIC_SIGNALS,
  proveNationalityClaim,
  releaseProver,
  toSolidityCalldata,
  verifyNationalityClaim,
  type SolidityCalldata,
} from "@aletheia/circuits";
import { generateKeypair, signCredential } from "@aletheia/issuer-mock";
import { network } from "hardhat";

import { exportVerifier, verifierPath } from "../scripts/export-verifier.ts";

const fixture = loadCredentialFixture();
const REQUEST = {
  requiredNationality: fixture.credential.nationality, // 356 (India)
  currentDate: 20260901,
  contextId: fixture.expected.contextId,
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
  assert.equal(values.length, NATIONALITY_PUBLIC_SIGNALS.length);
  return values as unknown as Signals;
}

describe("Groth16VerifierNationality", async () => {
  const { viem } = await network.create();
  const verifier = await viem.deployContract("Groth16VerifierNationality");

  let signed: SignedCredential;
  let calldata: SolidityCalldata;
  let publicSignals: string[];

  before(async () => {
    // One real proof, produced from a real issuer signature, reused across the cases.
    const { credential } = loadCredentialFixture();
    const { privateKey } = await generateKeypair();
    signed = await signCredential(privateKey, credential);
    const proved = await proveNationalityClaim(signed, REQUEST);
    publicSignals = proved.publicSignals;
    calldata = await toSolidityCalldata(proved.proof, proved.publicSignals);
  });

  after(releaseProver);

  it("is exactly what scripts/export-verifier.ts produces for the current proving key", async () => {
    const committed = readFileSync(verifierPath("nationality"), "utf8");
    const fresh = await exportVerifier("nationality");
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
    assert.equal(
      await verifyNationalityClaim(publicSignals, (await proveNationalityClaim(signed, REQUEST)).proof),
      true,
    );
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
    const index = (name: (typeof NATIONALITY_PUBLIC_SIGNALS)[number]): number =>
      NATIONALITY_PUBLIC_SIGNALS.indexOf(name);

    for (const name of NATIONALITY_PUBLIC_SIGNALS) {
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

  it("rejects a proof claiming a different nationality than was proven", async () => {
    // The attack this layer stops: relabelling a proof of "is Indian (356)" as "is American
    // (840)". The pairing check fails because requiredNationality is a public input.
    const relabelled = [...calldata.publicSignals];
    relabelled[NATIONALITY_PUBLIC_SIGNALS.indexOf("requiredNationality")] = 840n;
    const accepted = await verifier.read.verifyProof([
      calldata.a,
      calldata.b,
      calldata.c,
      asSignals(relabelled),
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
});
