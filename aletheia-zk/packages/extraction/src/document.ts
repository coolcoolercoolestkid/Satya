/**
 * The one entry point Day 18 adds: a chosen document (raw MRZ text, an image, or a PDF)
 * becomes the same candidate credential fields `parseTd3Mrz` already produces.
 *
 * Each source is decoded to plain text, the MRZ lines are found in that text, and those
 * lines go through the exact same {@link parseTd3Mrz} the raw-text path uses. So an image
 * and a PDF of one passport reach byte-identical fields to typing its MRZ — which is the
 * stage-15 gate — because after decoding there is only one parser.
 *
 * The result separates two kinds of problem the review step treats differently:
 * - **input issues** ({@link DocumentIssue}) — the file was too big, a PDF had too many
 *   pages, or no MRZ was found in it. These are about the document, not the person.
 * - **MRZ issues** ({@link Td3Issue}) — a check digit failed, a century was ambiguous, a
 *   nationality was unmapped. These come straight from `parseTd3Mrz`.
 *
 * Everything here is decode-then-parse; extraction still produces untrusted candidate
 * fields and never evidence (`docs/passport-extraction.md`).
 */

import { MAX_DOCUMENT_BYTES, MAX_PDF_PAGES } from "./caps.ts";
import { findMrzLines, pairTd3Lines } from "./mrz-lines.ts";
import type { OcrEngine } from "./ocr.ts";
import { extractPdfText } from "./pdf.ts";
import { parseTd3Mrz, type Td3CandidateFields, type Td3Issue } from "./mrz.ts";

/** Which kind of document was decoded. */
export type DocumentSource = "mrz-text" | "image" | "pdf";

/** A problem with the document itself, before the MRZ is ever parsed. */
export type DocumentIssueCode =
  /** The file exceeds {@link MAX_DOCUMENT_BYTES}. */
  | "input-too-large"
  /** A PDF declares more than the page cap; it was refused rather than partly read. */
  | "too-many-pages"
  /** No two-line TD3 MRZ was found in the decoded text. */
  | "no-mrz-found";

/** One input-level problem, with a human-readable detail for the review step. */
export interface DocumentIssue {
  code: DocumentIssueCode;
  detail: string;
}

/**
 * The outcome of extracting from a document.
 *
 * On success: the source, the two MRZ lines that were read (so the review UI can show
 * exactly what was recognised), and the parsed candidate fields.
 *
 * On failure: the source, whatever MRZ-looking lines were found, the input `issues`, and
 * the per-field `mrz` issues from `parseTd3Mrz` (empty when parsing never ran — e.g. a cap
 * tripped or no MRZ was found).
 */
export type DocumentExtractionResult =
  | {
      ok: true;
      source: DocumentSource;
      mrzLines: [string, string];
      fields: Td3CandidateFields;
    }
  | {
      ok: false;
      source: DocumentSource;
      mrzLines: string[];
      issues: DocumentIssue[];
      mrz: Td3Issue[];
    };

/** Options shared by every extraction entry point. */
export interface ExtractOptions {
  /** "Now", for century inference; forwarded to `parseTd3Mrz`. Defaults to the current date. */
  now?: Date;
  /** Byte cap; defaults to {@link MAX_DOCUMENT_BYTES}. */
  maxBytes?: number;
}

/** Options for the PDF entry point. */
export interface ExtractPdfOptions extends ExtractOptions {
  /** Page cap; defaults to {@link MAX_PDF_PAGES}. */
  maxPages?: number;
  /** Local standard-font base URL forwarded to pdf.js; see {@link extractPdfText}. */
  standardFontDataUrl?: string;
}

/**
 * Turn recovered text into a result: find the MRZ lines, pair them, parse them. Shared by
 * all three sources so there is exactly one path from text to fields.
 */
function finishFromText(
  source: DocumentSource,
  text: string,
  now: Date | undefined,
): DocumentExtractionResult {
  const found = findMrzLines(text);
  const pair = pairTd3Lines(found);
  if (pair === null) {
    return {
      ok: false,
      source,
      mrzLines: found,
      issues: [
        {
          code: "no-mrz-found",
          detail:
            found.length === 0
              ? "no 44-character MRZ line was found in the document"
              : "found MRZ-width lines but no line-1 (starting with the passport code P) followed by a second line",
        },
      ],
      mrz: [],
    };
  }

  const [line1, line2] = pair;
  const parseOptions = now === undefined ? {} : { now };
  const parsed = parseTd3Mrz({ line1, line2 }, parseOptions);
  if (parsed.ok) {
    return { ok: true, source, mrzLines: pair, fields: parsed.fields };
  }
  return { ok: false, source, mrzLines: pair, issues: [], mrz: parsed.issues };
}

/** Reject an over-cap file as an input issue rather than decoding it. */
function tooLarge(source: DocumentSource, size: number, maxBytes: number): DocumentExtractionResult {
  return {
    ok: false,
    source,
    mrzLines: [],
    issues: [
      {
        code: "input-too-large",
        detail: `document is ${size} bytes, over the ${maxBytes}-byte cap`,
      },
    ],
    mrz: [],
  };
}

/**
 * Extract from raw MRZ text (two lines, or text containing them). The trivial path: no
 * decoding, just find-and-parse. Kept here so all three sources share one result shape.
 */
export function extractFromMrzText(
  text: string,
  options: ExtractOptions = {},
): DocumentExtractionResult {
  return finishFromText("mrz-text", text, options.now);
}

/**
 * Extract from an encoded image (PNG, JPEG, …) using the supplied OCR engine. The engine is
 * injected so this function stays decoupled from tesseract.js; construct the real one with
 * `createTesseractMrzEngine`.
 */
export async function extractFromImage(
  bytes: Uint8Array,
  engine: OcrEngine,
  options: ExtractOptions = {},
): Promise<DocumentExtractionResult> {
  const maxBytes = options.maxBytes ?? MAX_DOCUMENT_BYTES;
  if (bytes.byteLength > maxBytes) return tooLarge("image", bytes.byteLength, maxBytes);

  const lines = await engine.recognizeLines(bytes);
  return finishFromText("image", lines.join("\n"), options.now);
}

/**
 * Extract from a PDF by reading its text layer. Refuses an over-cap file and refuses a PDF
 * with more than `maxPages` pages rather than reading part of it.
 */
export async function extractFromPdf(
  bytes: Uint8Array,
  options: ExtractPdfOptions = {},
): Promise<DocumentExtractionResult> {
  const maxBytes = options.maxBytes ?? MAX_DOCUMENT_BYTES;
  if (bytes.byteLength > maxBytes) return tooLarge("pdf", bytes.byteLength, maxBytes);

  const maxPages = options.maxPages ?? MAX_PDF_PAGES;
  const pdfOptions =
    options.standardFontDataUrl === undefined
      ? { maxPages }
      : { maxPages, standardFontDataUrl: options.standardFontDataUrl };
  const decoded = await extractPdfText(bytes, pdfOptions);

  if (decoded.pageCount > maxPages) {
    return {
      ok: false,
      source: "pdf",
      mrzLines: [],
      issues: [
        {
          code: "too-many-pages",
          detail: `PDF has ${decoded.pageCount} pages, over the ${maxPages}-page cap`,
        },
      ],
      mrz: [],
    };
  }

  return finishFromText("pdf", decoded.text, options.now);
}
