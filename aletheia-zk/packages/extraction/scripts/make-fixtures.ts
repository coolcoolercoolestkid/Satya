/**
 * Regenerate the committed Day 18 fixtures: an image and a PDF of one passport's MRZ.
 *
 *   pnpm --filter @aletheia/extraction run make-fixtures
 *
 * The fixtures are committed, not generated at test time, so the tests depend only on
 * frozen bytes and the committed OCR model — not on this machine's fonts or on
 * `@napi-rs/canvas`, which is a dev-only dependency used here and nowhere in the shipped
 * package. This script exists for provenance: it records exactly how the fixtures were
 * made, so they can be reproduced or a second document added.
 *
 * The image is a clean, high-contrast render of the two MRZ lines — the best case a camera
 * scan or a cropped data page approximates. The padding and size are the ones the OCR path
 * reads back exactly (see `src/ocr.ts` and `src/document.test.ts`); OCR is only ever exact
 * on an image it can actually read, so the fixture is a legitimate clean scan, not a trick.
 *
 * The MRZ below is the same genuinely-valid Indian TD3 specimen used across the parser
 * tests — every check digit computed with the ICAO algorithm — so all three input paths
 * (text, image, PDF) target one known-good document.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts } from "pdf-lib";

const LINE1 = "P<INDRASHMI<<DEVI<<<<<<<<<<<<<<<<<<<<<<<<<<<";
const LINE2 = "J8369854<4IND8805153F3001020<<<<<<<<<<<<<<<4";

const FONT_SIZE = 48;

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, "..", "fixtures");

/** Render the two MRZ lines onto a white ground with the margins the OCR path expects. */
function renderMrzPng(): Uint8Array {
  const measure = createCanvas(10, 10).getContext("2d");
  measure.font = `${FONT_SIZE}px monospace`;
  const width = Math.ceil(
    Math.max(measure.measureText(LINE1).width, measure.measureText(LINE2).width),
  );
  const padX = FONT_SIZE * 2;
  const padY = FONT_SIZE;
  const gap = Math.round(FONT_SIZE * 0.6);

  const canvas = createCanvas(width + padX * 2, FONT_SIZE * 2 + gap + padY * 2);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "black";
  ctx.font = `${FONT_SIZE}px monospace`;
  ctx.textBaseline = "top";
  ctx.fillText(LINE1, padX, padY);
  ctx.fillText(LINE2, padX, padY + FONT_SIZE + gap);
  return canvas.toBuffer("image/png");
}

/** Build a single-page PDF carrying the MRZ in its text layer. */
async function renderMrzPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([420, 260]);
  const font = await doc.embedFont(StandardFonts.Courier);
  page.drawText("SPECIMEN — machine-readable zone", { x: 20, y: 210, size: 11, font });
  page.drawText(LINE1, { x: 20, y: 60, size: 10, font });
  page.drawText(LINE2, { x: 20, y: 44, size: 10, font });
  return doc.save();
}

const png = renderMrzPng();
writeFileSync(path.join(fixturesDir, "passport-mrz.png"), png);
console.log(`wrote passport-mrz.png (${png.byteLength} bytes)`);

const pdf = await renderMrzPdf();
writeFileSync(path.join(fixturesDir, "passport-mrz.pdf"), pdf);
console.log(`wrote passport-mrz.pdf (${pdf.byteLength} bytes)`);
