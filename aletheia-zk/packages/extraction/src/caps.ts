/**
 * Input caps for document extraction.
 *
 * Extraction runs on the holder's device against a file the holder chose, so the file is
 * untrusted input in the same sense the MRZ text is (`docs/passport-extraction.md`). Two
 * things a hostile or malformed file can do that a text MRZ cannot are exhaust memory with
 * its sheer size and exhaust CPU with a huge page count, so both are bounded before any
 * decoder touches the bytes. These are refusals, not errors: an oversized file is reported
 * as an issue the review step can show, exactly like a failing check digit.
 */

/**
 * Largest document accepted, in bytes. A phone photo of a passport page is a few megabytes
 * and a one- or two-page PDF scan comparable, so 8 MiB clears every legitimate input while
 * refusing a file large enough to be a memory-exhaustion attempt.
 */
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

/**
 * Most PDF pages that will be decoded. A passport copy is one page, occasionally two; the
 * cap bounds the work a crafted PDF with thousands of pages could force. Pages past the cap
 * are not read — the MRZ is on the data page, which is page one of any real copy.
 */
export const MAX_PDF_PAGES = 4;
