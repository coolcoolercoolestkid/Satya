import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, test } from "node:test";

import { CLAIM_TYPE, claimNullifier } from "@aletheia/credential";
import { loadCredentialFixture } from "@aletheia/credential/test-fixture";

import {
  AGE_PUBLIC_SIGNALS,
  ageClaimInput,
  assertAgeClaimRequest,
  circuitArtifacts,
  decodeAgePublicSignals,
  proveAgeClaim,
  releaseProver,
  verifyAgeClaim,
} from "../src/index.ts";
import { rawAgeInput, signedFixture } from "./support.ts";

after(releaseProver);

const fixture = loadCredentialFixture();

/**
 * currentDate deliberately differs from every date in the fixture credential. The leak
 * check below asserts that no private value appears among the public signals, and a
 * coincidental match would make it pass for the wrong reason.
 */
const REQUEST = {
  minimumAge: 18,
  currentDate: 20260901,
  contextId: fixture.expected.contextId,
} as const;

test("the setup produced a proving key and a verification key", () => {
  const artifacts = circuitArtifacts("age");
  assert.ok(existsSync(artifacts.zkey), "final zkey is missing; run the build");
  assert.ok(existsSync(artifacts.vkey), "verification key is missing; run the build");
});

test("a real Groth16 proof verifies against the verification key", async () => {
  const { signed } = await signedFixture();
  const { proof, publicSignals } = await proveAgeClaim(signed, REQUEST);

  assert.equal(proof.protocol, "groth16");
  assert.equal(proof.curve, "bn128");
  assert.equal(publicSignals.length, AGE_PUBLIC_SIGNALS.length);
  assert.equal(await verifyAgeClaim(publicSignals, proof), true);
});

test("the public signals say exactly what was claimed, and nothing private", async () => {
  const { signed } = await signedFixture();
  const { publicSignals } = await proveAgeClaim(signed, REQUEST);
  const decoded = decodeAgePublicSignals(publicSignals);

  assert.equal(decoded.minimumAge, 18);
  assert.equal(decoded.currentDate, REQUEST.currentDate);
  assert.equal(decoded.contextId, REQUEST.contextId);
  assert.equal(decoded.subject.toLowerCase(), signed.credential.subject.toLowerCase());
  assert.equal(decoded.issuerAx, signed.issuer.ax);
  assert.equal(decoded.issuerAy, signed.issuer.ay);
  assert.equal(
    decoded.nullifier,
    await claimNullifier({
      credentialId: signed.credential.credentialId,
      claimTypeId: CLAIM_TYPE.AGE,
      contextId: REQUEST.contextId,
      subject: signed.credential.subject,
    }),
  );

  // The private fields must not appear anywhere in the public signals. The date of
  // birth is the one the whole protocol exists to keep back.
  const asStrings = publicSignals.map((signal) => signal.toString());
  for (const secret of [
    signed.credential.dateOfBirth,
    signed.credential.nationality,
    signed.credential.expiryDate,
    signed.credential.issuedAt,
    signed.credential.credentialId,
    signed.signature.s,
  ]) {
    assert.ok(
      !asStrings.includes(secret.toString()),
      `${secret} is private and must not be published`,
    );
  }
});

test("a proof does not verify against altered public signals", async () => {
  const { signed } = await signedFixture();
  const { proof, publicSignals } = await proveAgeClaim(signed, REQUEST);
  const index = (name: (typeof AGE_PUBLIC_SIGNALS)[number]): number =>
    AGE_PUBLIC_SIGNALS.indexOf(name);

  // Claiming a higher threshold than was proven is the attack that matters: a proof of
  // "at least 18" must not pass as a proof of "at least 21".
  const inflated = [...publicSignals];
  inflated[index("minimumAge")] = "21";
  assert.equal(await verifyAgeClaim(inflated, proof), false);

  for (const name of ["nullifier", "currentDate", "contextId", "subject", "issuerAx"] as const) {
    const altered = [...publicSignals];
    altered[index(name)] = (BigInt(publicSignals[index(name)] as string) + 1n).toString();
    assert.equal(await verifyAgeClaim(altered, proof), false, `altering ${name} must not verify`);
  }
});

test("a tampered proof does not verify", async () => {
  const { signed } = await signedFixture();
  const { proof, publicSignals } = await proveAgeClaim(signed, REQUEST);
  const tampered = {
    ...proof,
    pi_a: [(BigInt(proof.pi_a[0]) + 1n).toString(), proof.pi_a[1], proof.pi_a[2]] as [
      string,
      string,
      string,
    ],
  };
  assert.equal(await verifyAgeClaim(publicSignals, tampered), false);
});

test("an unsatisfiable claim cannot be proven at all", async () => {
  // The fixture holder was born in 2004, so a 30-year threshold has no witness. The
  // prover fails; it does not return an unverifiable proof.
  const { signed } = await signedFixture();
  await assert.rejects(() => proveAgeClaim(signed, { ...REQUEST, minimumAge: 30 }));
});

test("the input builder rejects requests the circuit would reject", () => {
  for (const request of [
    { ...REQUEST, minimumAge: 121 },
    { ...REQUEST, minimumAge: -1 },
    { ...REQUEST, minimumAge: 18.5 },
    { ...REQUEST, currentDate: 20260230 },
    { ...REQUEST, currentDate: 18991231 },
  ]) {
    assert.throws(() => assertAgeClaimRequest(request), RangeError);
  }
  assert.doesNotThrow(() => assertAgeClaimRequest({ ...REQUEST }));
});

test("the validated builder and the raw test builder agree", async () => {
  // Keeps the negative tests honest: they exercise the same input shape the library
  // produces, minus the validation.
  const { signed } = await signedFixture();
  assert.deepEqual(ageClaimInput(signed, REQUEST), rawAgeInput(signed, REQUEST));
});
