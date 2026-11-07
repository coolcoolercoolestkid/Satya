/**
 * PDF path: a PDF's text layer → the text it contains, page by page.
 *
 * A digitally produced passport copy (and many scan-plus-OCR copies) carry the MRZ in a
 * text layer, which is read here without rendering or executing anything.
 *
 * Three properties this stage requires (`TODO.md`, day 18), all enforced here:
 * - **PDF JavaScript disabled.** pdf.js never runs a document's embedded JavaScript unless
 *   the caller wires up its optional scripting layer; this decoder does not, and it sets
 *   `isEvalSupported: false` so pdf.js will not use `eval`/`Function` for its own font and
 *   colour parsing either. A PDF's `OpenAction` and field scripts are inert.
 * - **A page cap.** Only the first {@link MAX_PDF_PAGES} pages are read; a PDF claiming
 *   thousands cannot force unbounded work.
 * - **Extracted text is never evaluated.** The strings pdf.js returns are concatenated and
 *   handed to the MRZ line finder as data. Nothing in this package passes them to `eval`,
 *   `Function`, or a template that would.
 *
 * The decoder is lazy: pdf.js is a large dependency and is imported only when a PDF is
 * actually decoded, so image-only and MRZ-text callers never load it.
 */

import { MAX_PDF_PAGES } from "./caps.ts";

/** The minimal slice of the pdf.js API this decoder uses, so the dynamic import stays typed. */
interface PdfTextItem {
  str?: string;
  /** pdf.js marks the item that ends a visual line; used to rebuild line structure. */
  hasEOL?: boolean;
}
interface PdfPage {
  getTextContent(): Promise<{ items: readonly PdfTextItem[] }>;
}
interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}
interface PdfModule {
  getDocument(options: Record<string, unknown>): { promise: Promise<PdfDocument> };
}

/** Options for {@link extractPdfText}. */
export interface PdfTextOptions {
  /** Page cap; defaults to {@link MAX_PDF_PAGES}. Pages beyond it are not read. */
  maxPages?: number;
  /**
   * Local base URL for pdf.js' standard fonts, e.g. a `file://…/standard_fonts/` path in
   * Node or a same-origin path in the browser. Optional and used only to silence a font
   * warning during text extraction; leaving it unset keeps the decoder fully offline.
   */
  standardFontDataUrl?: string;
}

/** How many pages were present, and how many were actually read after the cap. */
export interface PdfTextResult {
  /** The concatenated text of the read pages, one page per line group. */
  text: string;
  /** Total pages the document declared. */
  pageCount: number;
  /** Pages actually read (`min(pageCount, maxPages)`). */
  pagesRead: number;
}

/** Join a page's text items into newline-separated visual lines, breaking on `hasEOL`. */
function itemsToLines(items: readonly PdfTextItem[]): string {
  const lines: string[] = [];
  let current = "";
  for (const item of items) {
    current += item.str ?? "";
    if (item.hasEOL === true) {
      lines.push(current);
      current = "";
    }
  }
  if (current.length > 0) lines.push(current);
  return lines.join("\n");
}

async function loadPdfjs(): Promise<PdfModule> {
  // The legacy build runs in a plain Node/worker context without a DOM.
  const mod = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfModule;
  return mod;
}

/**
 * Read the text layer of a PDF. Never renders, never runs document JavaScript, reads at
 * most `maxPages` pages. The input bytes are copied before handing them to pdf.js, which
 * may otherwise detach the caller's buffer.
 */
export async function extractPdfText(
  bytes: Uint8Array,
  options: PdfTextOptions = {},
): Promise<PdfTextResult> {
  const maxPages = options.maxPages ?? MAX_PDF_PAGES;
  const pdfjs = await loadPdfjs();

  const getDocumentOptions: Record<string, unknown> = {
    data: bytes.slice(),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    // Silence pdf.js' own warnings; extraction is not a place for its console output.
    verbosity: 0,
  };
  if (options.standardFontDataUrl !== undefined) {
    getDocumentOptions["standardFontDataUrl"] = options.standardFontDataUrl;
  }

  const pdf = await pdfjs.getDocument(getDocumentOptions).promise;
  try {
    const pageCount = pdf.numPages;
    const pagesRead = Math.min(pageCount, maxPages);
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pagesRead; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      // Rebuild visual lines from the item stream: `hasEOL` marks a line break. Keeping
      // lines separate is what stops visual-zone text from welding onto the MRZ once
      // spaces are stripped downstream — the MRZ line stays a clean 44-character run.
      pages.push(itemsToLines(content.items));
    }
    return { text: pages.join("\n"), pageCount, pagesRead };
  } finally {
    await pdf.destroy();
  }
}
