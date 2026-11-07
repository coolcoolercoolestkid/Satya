/**
 * Extraction, driven from the browser.
 *
 * Every path runs the same `@aletheia/extraction` core the Node tests exercise, entirely
 * on the device: typed MRZ text and a PDF's text layer are decoded here, and an image is
 * OCR'd by tesseract.js, which runs its heavy work in its own worker with assets served
 * from the app origin. No extraction path issues a network request for the document.
 *
 * The result is untrusted candidate fields; the review step is mandatory and lives in the
 * UI, never skipped here.
 */

import {
  createTesseractMrzEngine,
  extractFromImage,
  extractFromMrzText,
  extractFromPdf,
  type DocumentExtractionResult,
  type TesseractMrzConfig,
} from "@aletheia/extraction/browser";
import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";

/** Same-origin tesseract.js assets, copied into `public/ocr` by `scripts/copy-assets.ts`. */
const OCR_CONFIG: TesseractMrzConfig = {
  corePath: "/ocr/core",
  langPath: "/ocr/lang",
  workerPath: "/ocr/worker.min.js",
  cachePath: "/ocr/lang",
};

// pdf.js needs its worker script named in the browser. It is copied to the app origin by
// scripts/copy-assets.ts; the package's dynamic import shares this same module singleton.
GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

export function extractText(text: string): DocumentExtractionResult {
  return extractFromMrzText(text);
}

export async function extractPdf(file: File): Promise<DocumentExtractionResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return extractFromPdf(bytes);
}

export async function extractImage(file: File): Promise<DocumentExtractionResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const engine = await createTesseractMrzEngine(OCR_CONFIG);
  try {
    return await extractFromImage(bytes, engine);
  } finally {
    await engine.close();
  }
}
