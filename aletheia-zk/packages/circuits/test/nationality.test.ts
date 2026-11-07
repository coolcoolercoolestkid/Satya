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
  rawNationalityInput,
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

// The fixture credential: Indian (ISO 3166-1 numeric 356), expires 2034-03-14.
const NATIONALITY = fixture.credential.nationality; // 356
const CURRENT_DATE = 20260909;

test("compiled constraint counts match constraints.lock.json", () => {
  const compiled = compiledStats("nationality");
  const locked = lockedStats("nationality");
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

test("a signed credential of the asked-about nationality produces a valid witness", async () => {
  const { signed } = await signedFixture();
  const witness = await calculateAndCheckWitness(
    "nationality",
    rawNationalityInput(signed, {
      currentDate: CURRENT_DATE,
      requiredNationality: NATIONALITY,
      contextId: CONTEXT,
    }),
  );
  assert.equal(witness[0], 1n, "witness[0] is the constant one");
  assert.ok(witness.length > 10_000);
});

test("the circuit's nullifier matches the TypeScript derivation for claim type 2", async () => {
  // Same Poseidon layout as age but with claimTypeId 2, so the nationality nullifier is a
  // different value for the same credential and context. The pinned fixture value keeps the
  // client and the circuit from ever drifting.
  const { signed } = await signedFixture();
  const witness = await calculateAndCheckWitness(
    "nationality",
    rawNationalityInput(signed, {
      currentDate: CURRENT_DATE,
      requiredNationality: NATIONALITY,
      contextId: CONTEXT,
    }),
  );
  const expected = await claimNullifier({
    credentialId: signed.credential.credentialId,
    claimTypeId: CLAIM_TYPE.NATIONALITY,
    contextId: CONTEXT,
    subject: signed.credential.subject,
  });
  assert.equal(witness[1], expected);
  assert.equal(witness[1], fixture.expected.nullifierNationality);
});

test("the identity nullifier is the same value age produces, since it is claim-type independent", async () => {
  // Poseidon(identitySecret, contextId): no claimTypeId in it, so one identity proving age
  // and nationality to one verifier carries the identical identityNullifier. That is the
  // whole point of it — see docs/trust-model.md.
  const { signed } = await signedFixture();
  const witness = await calculateAndCheckWitness(
    "nationality",
    rawNationalityInput(signed, {
      currentDate: CURRENT_DATE,
      requiredNationality: NATIONALITY,
      contextId: CONTEXT,
    }),
  );
  const expected = await identityNullifier({
    identitySecret: signed.credential.identitySecret,
    contextId: CONTEXT,
  });
  assert.equal(witness[2], expected);
  assert.equal(witness[2], fixture.expected.identityNullifier);
});

test("public signals appear in the documented nine-signal order", async () => {
  // Witness layout is [1, ...outputs, ...publicInputs, ...private]. requiredNationality sits
  // in the exact slot age's minimumAge does, so the two claim types decode identically.
  const { signed } = await signedFixture();
  const witness = await calculateAndCheckWitness(
    "nationality",
    rawNationalityInput(signed, {
      currentDate: CURRENT_DATE,
      requiredNationality: NATIONALITY,
      contextId: CONTEXT,
    }),
  );
  assert.deepEqual(witness.slice(3, 10), [
    BigInt(SCHEMA_VERSION),
    signed.issuer.ax,
    signed.issuer.ay,
    BigInt(CURRENT_DATE),
    BigInt(NATIONALITY),
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
          "nationality",
          rawNationalityInput(signed, {
            currentDate: CURRENT_DATE,
            requiredNationality: NATIONALITY,
            contextId: CONTEXT,
            schemaVersion: declared,
          }),
        ),
      `declaring schemaVersion ${declared} must be rejected`,
    );
  }
});

test("negative: a different nationality than the credential's cannot be proven", async () => {
  // The claim is an equality, so both neighbours of the real value fail. A holder cannot
  // prove they are of a nationality they are not, and — because nationality is inside the
  // signed message — cannot substitute the value either.
  const { signed } = await signedFixture();
  for (const wrong of [NATIONALITY - 1, NATIONALITY + 1, 840, 0]) {
    await assert.rejects(
      () =>
        calculateWitness(
          "nationality",
          rawNationalityInput(signed, {
            currentDate: CURRENT_DATE,
            requiredNationality: wrong,
            contextId: CONTEXT,
          }),
        ),
      `requiredNationality ${wrong} must be rejected for a ${NATIONALITY} credential`,
    );
  }
});

test("negative: tampering with any signed field breaks the proof", async () => {
  // The signature covers all eight fields, so editing one after signing fails the
  // in-circuit EdDSA check. When nationality itself is tampered, the request is moved with
  // it so the equality still holds — proving that even then the signature check is what
  // rejects it, not the equality.
  const { privateKey } = await generateKeypair();
  const signed = await signCredential(privateKey, fixture.credential);

  const tampering: ReadonlyArray<[string, Partial<NormalizedCredential>, number]> = [
    ["dateOfBirth", { dateOfBirth: 20000101 }, NATIONALITY],
    ["expiryDate", { expiryDate: 20440314 }, NATIONALITY],
    ["issuedAt", { issuedAt: 20250101 }, NATIONALITY],
    ["credentialId", { credentialId: fixture.credential.credentialId + 1n }, NATIONALITY],
    ["identitySecret", { identitySecret: fixture.credential.identitySecret + 1n }, NATIONALITY],
    // Tampering nationality, with requiredNationality moved to match, so only the signature
    // stands between the forgery and a valid proof.
    ["nationality", { nationality: 840 }, 840],
  ];

  for (const [label, patch, required] of tampering) {
    const forged = { ...signed, credential: { ...signed.credential, ...patch } };
    await assert.rejects(
      () =>
        calculateWitness(
          "nationality",
          rawNationalityInput(forged, {
            currentDate: CURRENT_DATE,
            requiredNationality: required,
            contextId: CONTEXT,
          }),
        ),
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
        "nationality",
        rawNationalityInput(signed, {
          currentDate: CURRENT_DATE,
          requiredNationality: NATIONALITY,
          contextId: CONTEXT,
          issuer: other.publicKey,
        }),
      ),
    "claiming a different issuer key must break the signature check",
  );
});

test("negative: an expired credential cannot satisfy a nationality claim", async () => {
  // Expiry is inherited from the base, so a stale credential fails a nationality claim just
  // as it fails an age one. Boundary: expiry == currentDate still passes.
  const { signed: onExpiry } = await signedFixture({ expiryDate: CURRENT_DATE });
  await calculateAndCheckWitness(
    "nationality",
    rawNationalityInput(onExpiry, {
      currentDate: CURRENT_DATE,
      requiredNationality: NATIONALITY,
      contextId: CONTEXT,
    }),
  );

  const { signed: expired } = await signedFixture({ expiryDate: 20260908, issuedAt: 20200101 });
  await assert.rejects(
    () =>
      calculateWitness(
        "nationality",
        rawNationalityInput(expired, {
          currentDate: CURRENT_DATE,
          requiredNationality: NATIONALITY,
          contextId: CONTEXT,
        }),
      ),
    "an expired credential must not satisfy a nationality claim",
  );
});

test("negative: a credential cannot be used from a different wallet", async () => {
  const { signed } = await signedFixture();
  await assert.rejects(
    () =>
      calculateWitness(
        "nationality",
        rawNationalityInput(signed, {
          currentDate: CURRENT_DATE,
          requiredNationality: NATIONALITY,
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
          "nationality",
          rawNationalityInput(
            { ...signed, signature },
            { currentDate: CURRENT_DATE, requiredNationality: NATIONALITY, contextId: CONTEXT },
          ),
        ),
      `a mutated ${label} must break the signature check`,
    );
  }
});

test("negative: out-of-range public inputs are rejected by the circuit itself", async () => {
  const { signed } = await signedFixture();
  const base = { currentDate: CURRENT_DATE, requiredNationality: NATIONALITY, contextId: CONTEXT };

  // requiredNationality beyond 16 bits: rejected by its range check before the equality.
  await assert.rejects(
    () =>
      calculateWitness("nationality", rawNationalityInput(signed, { ...base, requiredNationality: 2n ** 16n })),
    "a requiredNationality beyond 16 bits must be rejected",
  );

  // currentDate outside the supported calendar range, inherited from the base.
  await assert.rejects(
    () => calculateWitness("nationality", rawNationalityInput(signed, { ...base, currentDate: 21010101 })),
    "a currentDate after 2100 must be rejected",
  );
  await assert.rejects(
    () => calculateWitness("nationality", rawNationalityInput(signed, { ...base, currentDate: 18991231 })),
    "a currentDate before 1900 must be rejected",
  );
});

test("negative: a nationality beyond 16 bits in the credential is rejected", async () => {
  // Not reachable through the issuer, which validates the code, so this bypasses it and
  // hands the circuit a raw out-of-range value with a matching request. The base's range
  // check on the private nationality is what rejects it.
  const { signed } = await signedFixture();
  const input = rawNationalityInput(signed, {
    currentDate: CURRENT_DATE,
    requiredNationality: NATIONALITY,
    contextId: CONTEXT,
  });
  await assert.rejects(
    () => calculateWitness("nationality", { ...input, nationality: 2n ** 16n, requiredNationality: 2n ** 16n }),
    "an out-of-range nationality must be rejected by the range check",
  );
});
