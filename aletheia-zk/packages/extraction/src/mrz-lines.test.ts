import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findMrzLines, pairTd3Lines } from "./mrz-lines.ts";

const LINE1 = "P<INDRASHMI<<DEVI<<<<<<<<<<<<<<<<<<<<<<<<<<<";
const LINE2 = "J8369854<4IND8805153F3001020<<<<<<<<<<<<<<<4";

describe("findMrzLines — recovers 44-char MRZ runs from noisy text", () => {
  it("finds both lines on their own text lines", () => {
    assert.deepEqual(findMrzLines(`${LINE1}\n${LINE2}`), [LINE1, LINE2]);
  });

  it("strips spaces a PDF text layer or OCR injects within a line", () => {
    const spaced = `${LINE1.slice(0, 10)} ${LINE1.slice(10)}`;
    assert.deepEqual(findMrzLines(spaced), [LINE1]);
  });

  it("keeps two stacked lines separate rather than welding them into one 88-run", () => {
    // Each MRZ line arrives on its own text line (as the PDF and OCR decoders emit them);
    // the newline between them stops the two 44-runs merging into one 88-char match.
    const lines = findMrzLines(`REPUBLIC OF INDIA\n${LINE1}\n${LINE2}\nissued elsewhere`);
    assert.deepEqual(lines, [LINE1, LINE2]);
  });

  it("ignores visual-zone text that is not 44 MRZ characters", () => {
    assert.deepEqual(findMrzLines("REPUBLIC OF INDIA\nRASHMI DEVI\n1988-05-15"), []);
  });

  it("uppercases so a lowercased OCR/text artifact still matches", () => {
    assert.deepEqual(findMrzLines(LINE1.toLowerCase()), [LINE1]);
  });
});

describe("pairTd3Lines — picks the passport line pair", () => {
  it("returns the P-anchored line and the one after it", () => {
    assert.deepEqual(pairTd3Lines([LINE1, LINE2]), [LINE1, LINE2]);
  });

  it("skips a 44-wide non-passport run before the real line 1", () => {
    const decoy = "X".repeat(44);
    assert.deepEqual(pairTd3Lines([decoy, LINE1, LINE2]), [LINE1, LINE2]);
  });

  it("returns null when there is no line starting with P followed by another", () => {
    assert.equal(pairTd3Lines([LINE2]), null);
    assert.equal(pairTd3Lines([]), null);
  });
});
