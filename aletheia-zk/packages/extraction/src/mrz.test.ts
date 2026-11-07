import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseTd3Mrz, type Td3ExtractionResult, type Td3Issue } from "./mrz.ts";

// A fixed clock so century inference is deterministic. Matches the Day 17 fixtures.
const NOW = new Date("2026-09-11T00:00:00Z");

// A valid Indian TD3 MRZ. Every check digit was computed with the ICAO algorithm (see
// checkdigit.test.ts, anchored to the published specimen), so this is a genuinely valid
// document, not a hand-guessed string. DOB 1988-05-15 (2088 is the future, so the century
// is unambiguous), expiry 2030-01-02.
const GOOD_LINE1 = "P<INDRASHMI<<DEVI<<<<<<<<<<<<<<<<<<<<<<<<<<<";
const GOOD_LINE2 = "J8369854<4IND8805153F3001020<<<<<<<<<<<<<<<4";

function issueFields(result: Td3ExtractionResult): Td3Issue[] {
  assert.equal(result.ok, false);
  return (result as { ok: false; issues: Td3Issue[] }).issues;
}

describe("parseTd3Mrz — a well-formed passport extracts", () => {
  it("recovers every field from the two lines", () => {
    const result = parseTd3Mrz(`${GOOD_LINE1}\n${GOOD_LINE2}`, { now: NOW });
    assert.equal(result.ok, true);
    assert.deepEqual((result as { ok: true; fields: unknown }).fields, {
      documentNumber: "J8369854",
      nationalityAlpha3: "IND",
      nationality: 356,
      dateOfBirth: 19880515,
      expiryDate: 20300102,
      sex: "F",
    });
  });

  it("accepts an explicit { line1, line2 } as well as the raw string", () => {
    const result = parseTd3Mrz({ line1: GOOD_LINE1, line2: GOOD_LINE2 }, { now: NOW });
    assert.equal(result.ok, true);
  });

  it("surfaces an unspecified sex `<` as X without disturbing the check digits", () => {
    // Position 21 (sex) is outside every check-digit span, so this stays a valid MRZ.
    const line2 = `${GOOD_LINE2.slice(0, 20)}<${GOOD_LINE2.slice(21)}`;
    const result = parseTd3Mrz({ line1: GOOD_LINE1, line2 }, { now: NOW });
    assert.equal(result.ok, true);
    assert.equal((result as { ok: true; fields: { sex: string } }).fields.sex, "X");
  });
});

describe("parseTd3Mrz — a failing check digit reports which field", () => {
  it("names the date of birth when its check digit is wrong", () => {
    // Corrupt only the DOB check digit (position 20). Its own check fails; the composite,
    // which spans it, fails too — as it would for a real misread.
    const line2 = `${GOOD_LINE2.slice(0, 19)}9${GOOD_LINE2.slice(20)}`;
    const result = parseTd3Mrz({ line1: GOOD_LINE1, line2 }, { now: NOW });
    const issues = issueFields(result);
    assert.ok(
      issues.some((i) => i.code === "check-digit" && i.field === "dateOfBirth"),
      "expected a dateOfBirth check-digit issue",
    );
  });

  it("names the document number when its check digit is wrong", () => {
    const line2 = `${GOOD_LINE2.slice(0, 9)}0${GOOD_LINE2.slice(10)}`;
    const result = parseTd3Mrz({ line1: GOOD_LINE1, line2 }, { now: NOW });
    const issues = issueFields(result);
    assert.ok(
      issues.some((i) => i.code === "check-digit" && i.field === "documentNumber"),
      "expected a documentNumber check-digit issue",
    );
  });

  it("returns no fields when any check digit fails", () => {
    const line2 = `${GOOD_LINE2.slice(0, 19)}9${GOOD_LINE2.slice(20)}`;
    const result = parseTd3Mrz({ line1: GOOD_LINE1, line2 }, { now: NOW });
    assert.equal(result.ok, false);
  });
});

describe("parseTd3Mrz — ambiguous century and unmappable nationality never guess", () => {
  it("reports an ambiguous date of birth rather than picking a century", () => {
    // DOB year 20: 2020 (age 6) and 1920 (age 106) are both plausible living holders.
    const line2 = "J8369854<4IND2001159F3001020<<<<<<<<<<<<<<<4";
    const result = parseTd3Mrz({ line1: GOOD_LINE1, line2 }, { now: NOW });
    const issues = issueFields(result);
    assert.ok(
      issues.some((i) => i.code === "ambiguous-century" && i.field === "dateOfBirth"),
      "expected an ambiguous-century issue on dateOfBirth",
    );
  });

  it("reports an unsupported nationality rather than a nearest match", () => {
    // UTO is the ICAO specimen's fictional state; it has no ISO 3166-1 numeric code.
    const line1 = "P<UTORASHMI<<DEVI<<<<<<<<<<<<<<<<<<<<<<<<<<<";
    const line2 = "J8369854<4UTO8805153F3001020<<<<<<<<<<<<<<<4";
    const result = parseTd3Mrz({ line1, line2 }, { now: NOW });
    const issues = issueFields(result);
    assert.ok(
      issues.some((i) => i.code === "unsupported-nationality" && i.field === "nationality"),
      "expected an unsupported-nationality issue",
    );
  });
});

describe("parseTd3Mrz — structural faults are rejected before fields are trusted", () => {
  it("rejects the wrong number of lines", () => {
    const result = parseTd3Mrz(GOOD_LINE2, { now: NOW });
    const issues = issueFields(result);
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.code, "structure");
  });

  it("rejects a line of the wrong length", () => {
    const result = parseTd3Mrz({ line1: GOOD_LINE1, line2: `${GOOD_LINE2}X` }, { now: NOW });
    const issues = issueFields(result);
    assert.ok(issues.some((i) => i.code === "structure" && i.field === "line2"));
  });

  it("rejects characters outside the MRZ set", () => {
    const line2 = `j${GOOD_LINE2.slice(1)}`; // lowercase j
    const result = parseTd3Mrz({ line1: GOOD_LINE1, line2 }, { now: NOW });
    const issues = issueFields(result);
    assert.ok(issues.some((i) => i.code === "structure" && i.field === "line2"));
  });

  it("rejects a line 1 that is not a passport", () => {
    const line1 = `I${GOOD_LINE1.slice(1)}`; // identity card, not a passport
    const result = parseTd3Mrz({ line1, line2: GOOD_LINE2 }, { now: NOW });
    const issues = issueFields(result);
    assert.ok(issues.some((i) => i.code === "structure" && i.field === "line1"));
  });
});
