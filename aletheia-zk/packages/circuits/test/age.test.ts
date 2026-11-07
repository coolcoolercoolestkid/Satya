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
  rawAgeInput,
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

// The fixture credential: born 2004-03-14, Indian, expires 2034-03-14.
const CURRENT_DATE = 20260909;

test("compiled constraint counts match constraints.lock.json", () => {
  const compiled = compiledStats("age");
  const locked = lockedStats("age");
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

test("a signed credential satisfying the claim produces a valid witness", async () => {
  const { signed } = await signedFixture();
  const witness = await calculateAndCheckWitness(
    "age",
    rawAgeInput(signed, { currentDate: CURRENT_DATE, minimumAge: 18, contextId: CONTEXT }),
  );
  assert.equal(witness[0], 1n, "witness[0] is the constant one");
  assert.ok(witness.length > 10_000);
});

test("the circuit's nullifier matches the TypeScript derivation", async () => {
  // The cross-check that keeps packages/credential honest: same Poseidon layout, same
  // result. The circuit is the authority; this asserts the client agrees with it.
  const { signed } = await signedFixture();
  const witness = await calculateAndCheckWitness(
    "age",
    rawAgeInput(signed, { currentDate: CURRENT_DATE, minimumAge: 18, contextId: CONTEXT }),
  );
  const expected = await claimNullifier({
    credentialId: signed.credential.credentialId,
    claimTypeId: CLAIM_TYPE.AGE,
    contextId: CONTEXT,
    subject: signed.credential.subject,
  });
  assert.equal(witness[1], expected);
  assert.equal(witness[1], fixture.expected.nullifierAge);
});

test("the circuit's identity nullifier matches the TypeScript derivation", async () => {
  const { signed } = await signedFixture();
  const witness = await calculateAndCheckWitness(
    "age",
    rawAgeInput(signed, { currentDate: CURRENT_DATE, minimumAge: 18, contextId: CONTEXT }),
  );
  const expected = await identityNullifier({
    identitySecret: signed.credential.identitySecret,
    contextId: CONTEXT,
  });
  assert.equal(witness[2], expected);
  assert.equal(witness[2], fixture.expected.identityNullifier);
});

test("the identity nullifier is stable across credentials and wallets, and scoped to context", async () => {
  // The three properties that make it useful, and the one that keeps it contained.
  // Everything here shares one identitySecret, which is what the issuer controls.
  const holderA = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
  const holderB = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
  const otherContext = CONTEXT + 1n;

  const read = async (
    overrides: Partial<NormalizedCredential>,
    contextId: bigint,
  ): Promise<{ identity: bigint; replay: bigint }> => {
    const { signed } = await signedFixture(overrides);
    const witness = await calculateAndCheckWitness(
      "age",
      rawAgeInput(signed, { currentDate: CURRENT_DATE, minimumAge: 18, contextId }),
    );
    return { identity: witness[2] as bigint, replay: witness[1] as bigint };
  };

  const base = await read({ subject: holderA }, CONTEXT);
  // Re-issued as a brand new credential instance: new random credentialId, same person.
  const reissued = await read(
    { subject: holderA, credentialId: fixture.credential.credentialId + 12345n },
    CONTEXT,
  );
  const otherWallet = await read({ subject: holderB }, CONTEXT);
  const elsewhere = await read({ subject: holderA }, otherContext);

  assert.equal(base.identity, reissued.identity, "survives re-issuance");
  assert.equal(base.identity, otherWallet.identity, "survives a change of wallet");
  assert.notEqual(base.identity, elsewhere.identity, "does not cross contexts");

  // And the replay nullifier keeps doing its own, different job: a new credential
  // instance is a new replay nullifier even though the identity nullifier is the same.
  assert.notEqual(base.replay, reissued.replay, "replay nullifier is per credential");
});

test("public signals appear in the documented order", async () => {
  // Witness layout is [1, ...outputs, ...publicInputs, ...private]. This is what
  // AletheiaVerifier decodes by index, so the order is pinned here and in
  // docs/public-signals.md.
  const { signed } = await signedFixture();
  const params = { currentDate: CURRENT_DATE, minimumAge: 18, contextId: CONTEXT };
  const witness = await calculateAndCheckWitness("age", rawAgeInput(signed, params));
  assert.deepEqual(witness.slice(3, 10), [
    BigInt(SCHEMA_VERSION),
    signed.issuer.ax,
    signed.issuer.ay,
    BigInt(CURRENT_DATE),
    18n,
    CONTEXT,
    BigInt(signed.credential.subject),
  ]);
});

test("the circuit pins schemaVersion to the version it was compiled for", async () => {
  // schemaVersion is public so the contract can route on it. That is only safe because
  // the prover cannot choose it: the circuit forces it to the compiled constant.
  const { signed } = await signedFixture();
  for (const declared of [1, 3, 0]) {
    await assert.rejects(
      () =>
        calculateWitness(
          "age",
          rawAgeInput(signed, {
            currentDate: CURRENT_DATE,
            minimumAge: 18,
            contextId: CONTEXT,
            schemaVersion: declared,
          }),
        ),
      `declaring schemaVersion ${declared} must be rejected`,
    );
  }
});

test("boundary: the claim holds on the birthday and fails the day before", async () => {
  const { signed: onBirthday } = await signedFixture({ dateOfBirth: 20080909 });
  await calculateAndCheckWitness(
    "age",
    rawAgeInput(onBirthday, { currentDate: CURRENT_DATE, minimumAge: 18, contextId: CONTEXT }),
  );

  const { signed: dayShort } = await signedFixture({ dateOfBirth: 20080910 });
  await assert.rejects(
    () =>
      calculateWitness(
        "age",
        rawAgeInput(dayShort, { currentDate: CURRENT_DATE, minimumAge: 18, contextId: CONTEXT }),
      ),
    "a holder one day short of 18 must not be able to prove the claim",
  );
});

test("boundary: expiry is inclusive", async () => {
  const { signed } = await signedFixture({ expiryDate: CURRENT_DATE });
  await calculateAndCheckWitness(
    "age",
    rawAgeInput(signed, { currentDate: CURRENT_DATE, minimumAge: 18, contextId: CONTEXT }),
  );

  // Issued years ago and expired yesterday. The issuer refuses to sign a credential
  // that expires before it was issued, so issuedAt moves back too.
  const { signed: expired } = await signedFixture({
    expiryDate: 20260908,
    issuedAt: 20200101,
  });
  await assert.rejects(
    () =>
      calculateWitness(
        "age",
        rawAgeInput(expired, { currentDate: CURRENT_DATE, minimumAge: 18, contextId: CONTEXT }),
      ),
    "an expired credential must not satisfy an age claim",
  );
});

test("boundary: minimumAge 0 and 120", async () => {
  const { signed } = await signedFixture();
  await calculateAndCheckWitness(
    "age",
    rawAgeInput(signed, { currentDate: CURRENT_DATE, minimumAge: 0, contextId: CONTEXT }),
  );

  const { signed: veryOld } = await signedFixture({ dateOfBirth: 19060909, issuedAt: 20260909 });
  await calculateAndCheckWitness(
    "age",
    rawAgeInput(veryOld, { currentDate: CURRENT_DATE, minimumAge: 120, contextId: CONTEXT }),
  );
});

test("boundary: the year rollover case from docs/date-format.md", async () => {
  const { signed: dec31 } = await signedFixture({ dateOfBirth: 20081231, issuedAt: 20260101 });
  await assert.rejects(
    () =>
      calculateWitness(
        "age",
        rawAgeInput(dec31, { currentDate: 20260101, minimumAge: 18, contextId: CONTEXT }),
      ),
  );

  const { signed: jan1 } = await signedFixture({ dateOfBirth: 20080101, issuedAt: 20260101 });
  await calculateAndCheckWitness(
    "age",
    rawAgeInput(jan1, { currentDate: 20260101, minimumAge: 18, contextId: CONTEXT }),
  );
});

test("tampering with any signed field breaks the proof", async () => {
  // The signature covers all eight fields, so editing one after signing makes the
  // in-circuit EdDSA check fail. This is what stops a self-asserted credential.
  const { privateKey } = await generateKeypair();
  const signed = await signCredential(privateKey, fixture.credential);

  const tampering: ReadonlyArray<[string, Partial<NormalizedCredential>]> = [
    ["dateOfBirth", { dateOfBirth: 20000101 }],
    ["nationality", { nationality: 840 }],
    ["expiryDate", { expiryDate: 20440314 }],
    ["issuedAt", { issuedAt: 20250101 }],
    ["credentialId", { credentialId: fixture.credential.credentialId + 1n }],
    // Without this the holder could pick their own identityNullifier, which is the
    // whole reason identitySecret is inside the signed message.
    ["identitySecret", { identitySecret: fixture.credential.identitySecret + 1n }],
  ];

  for (const [label, patch] of tampering) {
    const forged = { ...signed, credential: { ...signed.credential, ...patch } };
    await assert.rejects(
      () =>
        calculateWitness(
          "age",
          rawAgeInput(forged, {
            currentDate: CURRENT_DATE,
            minimumAge: 18,
            contextId: CONTEXT,
          }),
        ),
      `tampering with ${label} must break the proof`,
    );
  }
});

test("a credential signed by another key cannot be passed off as this issuer's", async () => {
  const { signed } = await signedFixture();
  const other = await generateKeypair();
  await assert.rejects(
    () =>
      calculateWitness(
        "age",
        rawAgeInput(signed, {
          currentDate: CURRENT_DATE,
          minimumAge: 18,
          contextId: CONTEXT,
          issuer: other.publicKey,
        }),
      ),
    "claiming a different issuer key must break the signature check",
  );
});

test("a credential cannot be used from a different wallet", async () => {
  // subject is inside the signed message, so proving with another address fails here.
  // On-chain, subject is additionally compared against msg.sender.
  const { signed } = await signedFixture();
  await assert.rejects(
    () =>
      calculateWitness(
        "age",
        rawAgeInput(signed, {
          currentDate: CURRENT_DATE,
          minimumAge: 18,
          contextId: CONTEXT,
          subject: "0x70997970c51812dc3a010c7d01b50e0d17dc79c9",
        }),
      ),
    "a stolen credential must not prove a claim for another wallet",
  );
});

test("signature components cannot be forged", async () => {
  const { signed } = await signedFixture();
  for (const [label, signature] of [
    ["s", { ...signed.signature, s: signed.signature.s + 1n }],
    ["r8x", { ...signed.signature, r8x: signed.signature.r8x + 1n }],
    ["r8y", { ...signed.signature, r8y: signed.signature.r8y + 1n }],
  ] as const) {
    await assert.rejects(
      () =>
        calculateWitness(
          "age",
          rawAgeInput(
            { ...signed, signature },
            { currentDate: CURRENT_DATE, minimumAge: 18, contextId: CONTEXT },
          ),
        ),
      `a mutated ${label} must break the signature check`,
    );
  }
});

test("out-of-range public inputs are rejected by the circuit itself", async () => {
  const { signed } = await signedFixture();
  const base = { currentDate: CURRENT_DATE, minimumAge: 18, contextId: CONTEXT };

  // minimumAge above the supported maximum: the range check exists so that
  // minimumAge * 10000 cannot wrap the field into a satisfiable threshold.
  await assert.rejects(
    () => calculateWitness("age", rawAgeInput(signed, { ...base, minimumAge: 121 })),
    "minimumAge 121 must be rejected",
  );
  await assert.rejects(
    () => calculateWitness("age", rawAgeInput(signed, { ...base, minimumAge: 256 })),
    "minimumAge beyond 8 bits must be rejected",
  );

  // currentDate outside the supported calendar range.
  await assert.rejects(
    () => calculateWitness("age", rawAgeInput(signed, { ...base, currentDate: 21010101 })),
    "a currentDate after 2100 must be rejected",
  );
  await assert.rejects(
    () => calculateWitness("age", rawAgeInput(signed, { ...base, currentDate: 18991231 })),
    "a currentDate before 1900 must be rejected",
  );
  await assert.rejects(
    () => calculateWitness("age", rawAgeInput(signed, { ...base, currentDate: 2n ** 32n })),
    "a currentDate beyond 32 bits must be rejected",
  );
});

test("an age threshold below the supported range is rejected", async () => {
  // currentDate at the very start of the range with a large minimumAge would put the
  // threshold before 1900. The subtraction cannot underflow the field given the
  // currentDate bound, so this asserts the explicit lower-bound check does its job.
  const { signed } = await signedFixture({ dateOfBirth: 19000101, issuedAt: 19000102 });
  await assert.rejects(
    () =>
      calculateWitness(
        "age",
        rawAgeInput(signed, { currentDate: 19000102, minimumAge: 120, contextId: CONTEXT }),
      ),
  );
});

test("a date of birth beyond 32 bits is rejected", async () => {
  // Not reachable through the issuer, which validates dates, so this bypasses it and
  // hands the circuit a raw out-of-range value directly.
  const { signed } = await signedFixture();
  const input = rawAgeInput(signed, {
    currentDate: CURRENT_DATE,
    minimumAge: 18,
    contextId: CONTEXT,
  });
  await assert.rejects(
    () => calculateWitness("age", { ...input, dateOfBirth: 2n ** 32n }),
    "an out-of-range dateOfBirth must be rejected by the range check",
  );
});
