/**
 * Browser-safe surface of the extraction package.
 *
 * Everything the holder flow needs to turn typed MRZ text, an image, or a PDF into
 * candidate credential fields and a `documentKey`, plus the Web Worker transport that runs
 * it off the main thread. It excludes `ocr-node.ts` (the Node-only tesseract asset
 * resolver), which imports `node:module`; in the browser the caller supplies same-origin
 * asset paths itself.
 */

export {
  computeCheckDigit,
  isMrzField,
  mrzCharValue,
  verifyCheckDigit,
} from "./checkdigit.ts";

export {
  TD3_LINE_LENGTH,
  parseTd3Mrz,
  type MrzSex,
  type ParseTd3Options,
  type Td3CandidateFields,
  type Td3ExtractionResult,
  type Td3Issue,
  type Td3IssueCode,
} from "./mrz.ts";

export { findMrzLines, pairTd3Lines } from "./mrz-lines.ts";

export {
  DOCUMENT_KEY_DOMAIN,
  deriveDocumentKey,
  type DocumentIdentity,
} from "./document-key.ts";

export { MAX_DOCUMENT_BYTES, MAX_PDF_PAGES } from "./caps.ts";

export {
  createTesseractMrzEngine,
  type ClosableOcrEngine,
  type EncodedImage,
  type OcrEngine,
  type TesseractMrzConfig,
} from "./ocr.ts";

export { extractPdfText, type PdfTextOptions, type PdfTextResult } from "./pdf.ts";

export {
  extractFromImage,
  extractFromMrzText,
  extractFromPdf,
  type DocumentExtractionResult,
  type DocumentIssue,
  type DocumentIssueCode,
  type DocumentSource,
  type ExtractOptions,
  type ExtractPdfOptions,
} from "./document.ts";

export {
  createDocumentExtractorClient,
  registerExtractionWorker,
  type ExtractionRequest,
  type ExtractionResponse,
} from "./worker.ts";
