import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
  CLAIM_TYPE,
  SCHEMA_VERSION,
  claimNullifier,
  identityNullifier,
  type NormalizedCredential,
} from "@aletheia/credential";
import { loadCredentialFixture } from "@aletheia/credential/test-fixture";
import { generateKeypair, signCredential } from "@aletheia/issuer-mock";

import {
  rawExpiryInput,
  calculateAndCheckWitness,
  calculateWitness,
  compiledStats,
  lockedStats,
  signedFixture,
  terminateCurve,
} from "./support.ts";

after(terminateCurve);

const fixture = loadCredentialFixture();
const CONTEXT = fixture.expected.contextId;

// The fixture credential expires 2034-03-14, so it is comfortably unexpired here.
const CURRENT_DATE = 20260909;

test("compiled constraint counts match constraints.lock.json", () => {
  const compiled = compiledStats("expiry");
  const locked = lockedStats("expiry");
  assert.deepEqual(
    {
      nonLinearConstraints: compiled.nonLinearConstraints,
      linearConstraints: compiled.linearConstraints,
      publicInputs: compiled.publicInputs,
      privateInputs: compiled.privateInputs,
      publicOutputs: compiled.publicOutputs,
      wires: compiled.wires,
    },
    locked,
    "constraint counts changed; update constraints.lock.json deliberately",
  );
});

test("a signed, unexpired credential produces a valid witness", async () => {
  const { signed } = await signedFixture();
  const witness = await calculateAndCheckWitness(
    "expiry",
    rawExpiryInput(signed, { currentDate: CURRENT_DATE, contextId: CONTEXT }),
  );
  assert.equal(witness[0], 1n, "witness[0] is the constant one");
  assert.ok(witness.length > 10_000);
});

test("the circuit's nullifier matches the TypeScript derivation for claim type 3", async () => {
  // Same Poseidon layout as age and nationality but with claimTypeId 3, so the expiry
  // nullifier is a third distinct value for the same credential and context.
  const { signed } = await signedFixture();
  const witness = await calculateAndCheckWitness(
    "expiry",
    rawExpiryInput(signed, { currentDate: CURRENT_DATE, contextId: CONTEXT }),
  );
  const expected = await claimNullifier({
    credentialId: signed.credential.credentialId,
    claimTypeId: CLAIM_TYPE.EXPIRY,
    contextId: CONTEXT,
    subject: signed.credential.subject,
  });
  assert.equal(witness[1], expected);
});

test("the identity nullifier is claim-type independent, so it equals the age and nationality one", async () => {
  const { signed } = await signedFixture();
  const witness = await calculateAndCheckWitness(
    "expiry",
    rawExpiryInput(signed, { currentDate: CURRENT_DATE, contextId: CONTEXT }),
  );
  const expected = await identityNullifier({
    identitySecret: signed.credential.identitySecret,
    contextId: CONTEXT,
  });
  assert.equal(witness[2], expected);
  assert.equal(witness[2], fixture.expected.identityNullifier);
});

test("public signals appear in the documented nine-signal order, with the parameter slot zero", async () => {
  // Witness layout is [1, ...outputs, ...publicInputs, ...private]. expiryParameter sits in
  // the same slot age's minimumAge and nationality's requiredNationality do, pinned to 0.
  const { signed } = await signedFixture();
  const witness = await calculateAndCheckWitness(
    "expiry",
    rawExpiryInput(signed, { currentDate: CURRENT_DATE, contextId: CONTEXT }),
  );
  assert.deepEqual(witness.slice(3, 10), [
    BigInt(SCHEMA_VERSION),
    signed.issuer.ax,
    signed.issuer.ay,
    BigInt(CURRENT_DATE),
    0n,
    CONTEXT,
    BigInt(signed.credential.subject),
  ]);
});

test("the circuit pins schemaVersion to the version it was compiled for", async () => {
  const { signed } = await signedFixture();
  for (const declared of [1, 3, 0]) {
    await assert.rejects(
      () =>
        calculateWitness(
          "expiry",
          rawExpiryInput(signed, {
            currentDate: CURRENT_DATE,
            contextId: CONTEXT,
            schemaVersion: declared,
          }),
        ),
      `declaring schemaVersion ${declared} must be rejected`,
    );
  }
});

test("boundary: the claim holds when expiryDate == currentDate and on both sides of it", async () => {
  // The exit criterion. The base check is expiryDate >= currentDate, so the boundary is
  // inclusive: on the expiry day the credential is still valid, the day before the expiry
  // day (currentDate earlier) it is valid, and the day after (currentDate later) it is
  // expired. A credential expiring exactly on the boundary date, issued years earlier.
  const BOUNDARY = 20260909;
  const { signed } = await signedFixture({ expiryDate: BOUNDARY, issuedAt: 20200101 });

  // On the boundary: expiryDate == currentDate -> valid.
  await calculateAndCheckWitness(
    "expiry",
    rawExpiryInput(signed, { currentDate: BOUNDARY, contextId: CONTEXT }),
  );

  // The day before expiry (currentDate < expiryDate): comfortably valid.
  await calculateAndCheckWitness(
    "expiry",
    rawExpiryInput(signed, { currentDate: 20260908, contextId: CONTEXT }),
  );

  // The day after expiry (currentDate > expiryDate): expired, must be rejected.
  await assert.rejects(
    () => calculateWitness("expiry", rawExpiryInput(signed, { currentDate: 20260910, contextId: CONTEXT })),
    "a credential one day past its expiry must not satisfy an expiry claim",
  );
});

test("the generic parameter slot is pinned to zero", async () => {
  // expiry has no parameter; the circuit forces the slot to 0. A proof declaring anything
  // else is unsatisfiable, which keeps the nine-signal layout aligned with age/nationality.
  const { signed } = await signedFixture();
  for (const value of [1, 18, 356]) {
    await assert.rejects(
      () =>
        calculateWitness(
          "expiry",
          rawExpiryInput(signed, {
            currentDate: CURRENT_DATE,
            contextId: CONTEXT,
            expiryParameter: value,
          }),
        ),
      `a non-zero expiryParameter (${value}) must be rejected`,
    );
  }
});

test("negative: tampering with any signed field breaks the proof", async () => {
  const { privateKey } = await generateKeypair();
  const signed = await signCredential(privateKey, fixture.credential);

  const tampering: ReadonlyArray<[string, Partial<NormalizedCredential>]> = [
    ["dateOfBirth", { dateOfBirth: 20000101 }],
    ["nationality", { nationality: 840 }],
    ["expiryDate", { expiryDate: 20440314 }],
    ["issuedAt", { issuedAt: 20250101 }],
    ["credentialId", { credentialId: fixture.credential.credentialId + 1n }],
    ["identitySecret", { identitySecret: fixture.credential.identitySecret + 1n }],
  ];

  for (const [label, patch] of tampering) {
    const forged = { ...signed, credential: { ...signed.credential, ...patch } };
    await assert.rejects(
      () =>
        calculateWitness("expiry", rawExpiryInput(forged, { currentDate: CURRENT_DATE, contextId: CONTEXT })),
      `tampering with ${label} must break the proof`,
    );
  }
});

test("negative: a credential signed by another key cannot be passed off as this issuer's", async () => {
  const { signed } = await signedFixture();
  const other = await generateKeypair();
  await assert.rejects(
    () =>
      calculateWitness(
        "expiry",
        rawExpiryInput(signed, { currentDate: CURRENT_DATE, contextId: CONTEXT, issuer: other.publicKey }),
      ),
    "claiming a different issuer key must break the signature check",
  );
});

test("negative: a credential cannot be used from a different wallet", async () => {
  const { signed } = await signedFixture();
  await assert.rejects(
    () =>
      calculateWitness(
        "expiry",
        rawExpiryInput(signed, {
          currentDate: CURRENT_DATE,
          contextId: CONTEXT,
          subject: "0x70997970c51812dc3a010c7d01b50e0d17dc79c9",
        }),
      ),
    "a stolen credential must not prove a claim for another wallet",
  );
});

test("negative: signature components cannot be forged", async () => {
  const { signed } = await signedFixture();
  for (const [label, signature] of [
    ["s", { ...signed.signature, s: signed.signature.s + 1n }],
    ["r8x", { ...signed.signature, r8x: signed.signature.r8x + 1n }],
    ["r8y", { ...signed.signature, r8y: signed.signature.r8y + 1n }],
  ] as const) {
    await assert.rejects(
      () =>
        calculateWitness(
          "expiry",
          rawExpiryInput({ ...signed, signature }, { currentDate: CURRENT_DATE, contextId: CONTEXT }),
        ),
      `a mutated ${label} must break the signature check`,
    );
  }
});

test("negative: out-of-range currentDate is rejected by the circuit itself", async () => {
  const { signed } = await signedFixture();
  const base = { contextId: CONTEXT };
  await assert.rejects(
    () => calculateWitness("expiry", rawExpiryInput(signed, { ...base, currentDate: 21010101 })),
    "a currentDate after 2100 must be rejected",
  );
  await assert.rejects(
    () => calculateWitness("expiry", rawExpiryInput(signed, { ...base, currentDate: 18991231 })),
    "a currentDate before 1900 must be rejected",
  );
  await assert.rejects(
    () => calculateWitness("expiry", rawExpiryInput(signed, { ...base, currentDate: 2n ** 32n })),
    "a currentDate beyond 32 bits must be rejected",
  );
});
