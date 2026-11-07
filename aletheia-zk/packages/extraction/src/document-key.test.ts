import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FIELD_MODULUS, isFieldElement } from "@aletheia/credential";

import { DOCUMENT_KEY_DOMAIN, deriveDocumentKey, type DocumentIdentity } from "./document-key.ts";
import { parseTd3Mrz } from "./mrz.ts";

// The committed fixture passport (an Indian TD3), as parseTd3Mrz yields it.
const FIXTURE: DocumentIdentity = {
  documentNumber: "J8369854",
  nationality: 356,
  dateOfBirth: 19880515,
  expiryDate: 20300102,
};

const LINE1 = "P<INDRASHMI<<DEVI<<<<<<<<<<<<<<<<<<<<<<<<<<<";
const LINE2 = "J8369854<4IND8805153F3001020<<<<<<<<<<<<<<<4";

// A change in the derivation is a change in every identityNullifier ever produced from
// this passport, so it must fail a test rather than happen silently.
const FIXTURE_KEY =
  150359595969926093522260862199250265337757030208268992217405649257074130023n;

describe("deriveDocumentKey — the four exit-criteria properties", () => {
  it("is a canonical, non-zero bn128 field element", async () => {
    const key = await deriveDocumentKey(FIXTURE);
    assert.ok(isFieldElement(key), "must be a canonical field element");
    assert.ok(key > 0n && key < FIELD_MODULUS, "must be non-zero and below the modulus");
    // hashToField keeps the leading 31 bytes, so the value is always < 2^248.
    assert.ok(key < 1n << 248n, "must fit in the 31-byte reduced range");
  });

  it("matches the pinned fixture vector, so the derivation cannot drift unnoticed", async () => {
    assert.equal(await deriveDocumentKey(FIXTURE), FIXTURE_KEY);
  });

  it("yields the same key for the same passport, twice", async () => {
    const first = await deriveDocumentKey(FIXTURE);
    const second = await deriveDocumentKey({ ...FIXTURE });
    assert.equal(first, second);
  });

  it("never collides across two different passports — any one field differing is enough", async () => {
    const base = await deriveDocumentKey(FIXTURE);
    const variants: DocumentIdentity[] = [
      { ...FIXTURE, documentNumber: "J8369855" }, // different number
      { ...FIXTURE, nationality: 840 }, // same number, different issuer
      { ...FIXTURE, dateOfBirth: 19880516 }, // different holder DOB
      { ...FIXTURE, expiryDate: 20300103 }, // renewed booklet, new expiry
    ];
    const keys = [base];
    for (const variant of variants) {
      keys.push(await deriveDocumentKey(variant));
    }
    assert.equal(new Set(keys.map((k) => k.toString())).size, keys.length, "all keys distinct");
  });

  it("frames fields unambiguously, so shifting a boundary does not alias another passport", async () => {
    // Without labelled, separated fields, "J8" + nationality "3" ... could collide with
    // "J" + "83" ...; the canonical encoding must keep these apart.
    const a = await deriveDocumentKey({ ...FIXTURE, documentNumber: "J8", nationality: 369 });
    const b = await deriveDocumentKey({ ...FIXTURE, documentNumber: "J83", nationality: 69 });
    assert.notEqual(a, b);
  });
});

describe("deriveDocumentKey — determinism through the real parser", () => {
  it("re-parsing the same MRZ twice derives the same key (same passport, same key)", async () => {
    const first = parseTd3Mrz({ line1: LINE1, line2: LINE2 });
    const second = parseTd3Mrz(`${LINE1}\n${LINE2}`);
    assert.ok(first.ok && second.ok, "fixture MRZ must parse");
    assert.equal(await deriveDocumentKey(first.fields), await deriveDocumentKey(second.fields));
  });

  it("agrees with the key derived from the hand-built fixture identity", async () => {
    const parsed = parseTd3Mrz({ line1: LINE1, line2: LINE2 });
    assert.ok(parsed.ok);
    assert.equal(await deriveDocumentKey(parsed.fields), FIXTURE_KEY);
  });
});

describe("deriveDocumentKey — rejects inputs that would break the framing or the field", () => {
  it("rejects an empty or filler-only document number", async () => {
    await assert.rejects(deriveDocumentKey({ ...FIXTURE, documentNumber: "" }), TypeError);
  });

  it("rejects a document number carrying a separator or lowercase glyph", async () => {
    await assert.rejects(deriveDocumentKey({ ...FIXTURE, documentNumber: "J8|369" }), TypeError);
    await assert.rejects(deriveDocumentKey({ ...FIXTURE, documentNumber: "j8369854" }), TypeError);
  });

  it("rejects a nationality outside the ISO 3166-1 numeric range", async () => {
    await assert.rejects(deriveDocumentKey({ ...FIXTURE, nationality: 0 }), RangeError);
    await assert.rejects(deriveDocumentKey({ ...FIXTURE, nationality: 1000 }), RangeError);
  });

  it("rejects a date that is not a real YYYYMMDD calendar date", async () => {
    await assert.rejects(deriveDocumentKey({ ...FIXTURE, dateOfBirth: 19880230 }), RangeError);
    await assert.rejects(deriveDocumentKey({ ...FIXTURE, expiryDate: 20301332 }), RangeError);
  });
});

describe("DOCUMENT_KEY_DOMAIN", () => {
  it("is a versioned, purpose-specific domain-separation tag", () => {
    assert.equal(DOCUMENT_KEY_DOMAIN, "aletheia/documentKey/v1");
  });
});
