/**
 * The Day 18 gate: a fixture image and a fixture PDF both reach the same candidate fields
 * as the raw MRZ, and no network request is issued while they are extracted.
 *
 * The image is OCR'd by the real tesseract.js engine with the committed MRZ model and the
 * wasm core resolved from disk — no engine is mocked. `withNetworkBlocked` severs every
 * socket and `fetch` around the extraction, so a green run is proof the whole path is
 * offline, not an assertion that it ought to be.
 */

import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { PDFDocument, StandardFonts } from "pdf-lib";

import {
  extractFromImage,
  extractFromMrzText,
  extractFromPdf,
} from "./document.ts";
import { createTesseractMrzEngine, type ClosableOcrEngine, type OcrEngine } from "./ocr.ts";
import { nodeTesseractMrzConfig } from "./ocr-node.ts";
import { MAX_DOCUMENT_BYTES } from "./caps.ts";

// The same genuinely-valid Indian TD3 specimen the parser tests use.
const LINE1 = "P<INDRASHMI<<DEVI<<<<<<<<<<<<<<<<<<<<<<<<<<<";
const LINE2 = "J8369854<4IND8805153F3001020<<<<<<<<<<<<<<<4";
const NOW = new Date("2026-09-11T00:00:00Z");

// The fields typing the raw MRZ produces — the target every other input must match.
const EXPECTED_FIELDS = {
  documentNumber: "J8369854",
  nationalityAlpha3: "IND",
  nationality: 356,
  dateOfBirth: 19880515,
  expiryDate: 20300102,
  sex: "F" as const,
};

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, "..", "fixtures");

/** Run `fn` with every network path severed; return the URLs anything tried to reach. */
async function withNetworkBlocked<T>(fn: () => Promise<T>): Promise<{ value: T; hits: string[] }> {
  const hits: string[] = [];
  const originals = {
    httpRequest: http.request,
    httpGet: http.get,
    httpsRequest: https.request,
    httpsGet: https.get,
    fetch: globalThis.fetch,
  };
  const block =
    (label: string) =>
    (...args: unknown[]): never => {
      hits.push(`${label}:${String(args[0])}`);
      throw new Error(`network blocked during extraction: ${label} ${String(args[0])}`);
    };
  http.request = block("http.request") as typeof http.request;
  http.get = block("http.get") as typeof http.get;
  https.request = block("https.request") as typeof https.request;
  https.get = block("https.get") as typeof https.get;
  globalThis.fetch = block("fetch") as typeof globalThis.fetch;
  try {
    const value = await fn();
    return { value, hits };
  } finally {
    http.request = originals.httpRequest;
    http.get = originals.httpGet;
    https.request = originals.httpsRequest;
    https.get = originals.httpsGet;
    globalThis.fetch = originals.fetch;
  }
}

describe("raw MRZ text extracts to the target fields", () => {
  it("is the reference the image and PDF must match", () => {
    const result = extractFromMrzText(`${LINE1}\n${LINE2}`, { now: NOW });
    assert.equal(result.ok, true);
    assert.deepEqual((result as { ok: true; fields: unknown }).fields, EXPECTED_FIELDS);
  });
});

describe("PDF input reaches the same candidate fields as the raw MRZ", () => {
  it("reads the fixture PDF's text layer, offline", async () => {
    const bytes = readFileSync(path.join(fixturesDir, "passport-mrz.pdf"));
    const { value: result, hits } = await withNetworkBlocked(() =>
      extractFromPdf(new Uint8Array(bytes), { now: NOW }),
    );
    assert.deepEqual(hits, [], "extraction must issue no network request");
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal((result as { source: string }).source, "pdf");
    assert.deepEqual((result as { ok: true; fields: unknown }).fields, EXPECTED_FIELDS);
    assert.deepEqual((result as { ok: true; mrzLines: unknown }).mrzLines, [LINE1, LINE2]);
  });
});

describe("image input reaches the same candidate fields as the raw MRZ", () => {
  let engine: ClosableOcrEngine;

  before(async () => {
    engine = await createTesseractMrzEngine(nodeTesseractMrzConfig());
  });

  after(async () => {
    await engine.close();
  });

  it("OCRs the fixture image with the committed MRZ model, offline", async () => {
    const bytes = readFileSync(path.join(fixturesDir, "passport-mrz.png"));
    const { value: result, hits } = await withNetworkBlocked(() =>
      extractFromImage(new Uint8Array(bytes), engine, { now: NOW }),
    );
    assert.deepEqual(hits, [], "extraction must issue no network request");
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal((result as { source: string }).source, "image");
    assert.deepEqual((result as { ok: true; fields: unknown }).fields, EXPECTED_FIELDS);
    assert.deepEqual((result as { ok: true; mrzLines: unknown }).mrzLines, [LINE1, LINE2]);
  });
});

describe("input caps are enforced before decoding", () => {
  it("refuses an over-cap image without invoking the OCR engine", async () => {
    const oversized = new Uint8Array(MAX_DOCUMENT_BYTES + 1);
    const engine: OcrEngine = {
      recognizeLines() {
        throw new Error("engine must not run on an over-cap file");
      },
    };
    const result = await extractFromImage(oversized, engine);
    assert.equal(result.ok, false);
    assert.deepEqual(
      (result as { issues: { code: string }[] }).issues.map((i) => i.code),
      ["input-too-large"],
    );
  });

  it("refuses a PDF with more pages than the cap", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Courier);
    for (let i = 0; i < 5; i++) {
      const page = doc.addPage([200, 120]);
      page.drawText(`page ${i + 1}`, { x: 10, y: 60, size: 10, font });
    }
    const bytes = await doc.save();
    const result = await extractFromPdf(new Uint8Array(bytes), { maxPages: 4, now: NOW });
    assert.equal(result.ok, false);
    assert.deepEqual(
      (result as { issues: { code: string }[] }).issues.map((i) => i.code),
      ["too-many-pages"],
    );
  });

  it("reports no-mrz-found for a PDF whose text has no MRZ", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 160]);
    const font = await doc.embedFont(StandardFonts.Courier);
    page.drawText("Just a letter, no machine-readable zone here.", { x: 10, y: 80, size: 10, font });
    const bytes = await doc.save();
    const result = await extractFromPdf(new Uint8Array(bytes), { now: NOW });
    assert.equal(result.ok, false);
    assert.deepEqual(
      (result as { issues: { code: string }[] }).issues.map((i) => i.code),
      ["no-mrz-found"],
    );
  });
});
