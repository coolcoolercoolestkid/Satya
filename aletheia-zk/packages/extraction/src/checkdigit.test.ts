import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computeCheckDigit,
  isMrzField,
  mrzCharValue,
  verifyCheckDigit,
} from "./checkdigit.ts";

// The published ICAO 9303 Part 3 TD3 specimen ("Anna Maria Eriksson"). Its embedded check
// digits are the external anchor: an implementation that reproduces all of them is doing
// the ICAO algorithm, not one that merely agrees with itself.
const SPECIMEN_LINE2 = "L898902C36UTO7408122F1204159ZE184226B<<<<<10";

describe("mrzCharValue", () => {
  it("scores digits, letters and filler per ICAO", () => {
    assert.equal(mrzCharValue("<"), 0);
    assert.equal(mrzCharValue("0"), 0);
    assert.equal(mrzCharValue("9"), 9);
    assert.equal(mrzCharValue("A"), 10);
    assert.equal(mrzCharValue("Z"), 35);
  });

  it("throws on a non-MRZ character", () => {
    assert.throws(() => mrzCharValue("a"), RangeError);
    assert.throws(() => mrzCharValue(" "), RangeError);
  });
});

describe("computeCheckDigit against the ICAO specimen", () => {
  it("reproduces every embedded check digit", () => {
    // Document number, its check digit at position 10.
    assert.equal(computeCheckDigit(SPECIMEN_LINE2.slice(0, 9)), 6);
    // Date of birth, check at 20.
    assert.equal(computeCheckDigit(SPECIMEN_LINE2.slice(13, 19)), 2);
    // Date of expiry, check at 28.
    assert.equal(computeCheckDigit(SPECIMEN_LINE2.slice(21, 27)), 9);
    // Personal number, check at 43.
    assert.equal(computeCheckDigit(SPECIMEN_LINE2.slice(28, 42)), 1);
    // Composite over 1-10, 14-20, 22-43, check at 44.
    const composite =
      SPECIMEN_LINE2.slice(0, 10) + SPECIMEN_LINE2.slice(13, 20) + SPECIMEN_LINE2.slice(21, 43);
    assert.equal(computeCheckDigit(composite), 0);
  });
});

describe("verifyCheckDigit", () => {
  it("accepts a matching digit and rejects a wrong one", () => {
    assert.equal(verifyCheckDigit("L898902C3", "6"), true);
    assert.equal(verifyCheckDigit("L898902C3", "5"), false);
  });

  it("accepts `<` only where the sum is 0 mod 10 (all-filler field)", () => {
    assert.equal(computeCheckDigit("<<<<<<<<<<<<<<"), 0);
    assert.equal(verifyCheckDigit("<<<<<<<<<<<<<<", "<"), true);
    // A non-zero sum cannot be satisfied by a filler check character.
    assert.equal(verifyCheckDigit("L898902C3", "<"), false);
  });
});

describe("isMrzField", () => {
  it("accepts the MRZ alphabet and rejects anything else", () => {
    assert.equal(isMrzField("ABC123<<<"), true);
    assert.equal(isMrzField("abc"), false);
    assert.equal(isMrzField("A B"), false);
  });
});
