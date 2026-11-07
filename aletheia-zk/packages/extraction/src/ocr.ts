/**
 * OCR for the image path: encoded image bytes → the text lines it contains.
 *
 * The engine is an interface, not a hardcoded dependency, so the extraction core stays
 * decoupled from any one OCR library and a caller can supply a different reader. This file
 * also ships the real one, {@link createTesseractMrzEngine}, built on tesseract.js and a
 * committed MRZ-specific model.
 *
 * **Offline by construction.** tesseract.js downloads its worker script, its wasm core and
 * its language model from a CDN unless every path is pinned to a local file. All three are
 * pinned here: the core comes from the `tesseract.js-core` package and the model from
 * `packages/extraction/assets/mrz.traineddata`, both on disk. Extraction issues no network
 * request — the exit criterion for this stage, asserted by the tests, which run with every
 * socket blocked.
 *
 * **Why two passes.** A single recognition of the whole MRZ strip misreads the odd glyph
 * (a `6` as `G`, an `I` as `1`) because the two lines interfere across the page-layout
 * analysis. Recognising each line on its own, in single-line mode, is exact. So the engine
 * first runs a layout pass to locate the text-line boxes, then re-recognises each box —
 * grown by a margin so single-line mode sees the whitespace it expects — one line at a
 * time. This mirrors how a real MRZ reader works: find the band, then read each line.
 */

import { createWorker, PSM, type Worker } from "tesseract.js";

/** The MRZ alphabet; constrains OCR to the only characters a TD3 line can contain. */
const MRZ_WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<";

/** An image is a byte buffer of an encoded image (PNG, JPEG, …). */
export type EncodedImage = Uint8Array;

/** Reads the text lines out of an encoded image. Implementations must not touch the network. */
export interface OcrEngine {
  /** The text lines the image contains, top to bottom, one string per detected line. */
  recognizeLines(image: EncodedImage): Promise<string[]>;
}

/** An {@link OcrEngine} that owns resources (a worker) and must be closed when done. */
export interface ClosableOcrEngine extends OcrEngine {
  close(): Promise<void>;
}

/**
 * Where the tesseract.js assets live. Every field is a local location so nothing is
 * fetched from a CDN:
 * - `corePath`: directory (or file) of the `tesseract.js-core` wasm build.
 * - `langPath`: directory containing `mrz.traineddata` (a filesystem path in Node, a
 *   same-origin base URL in the browser).
 * - `workerPath`: the tesseract.js worker script, when the runtime needs it named
 *   explicitly (the browser); Node resolves it from the package automatically.
 * - `cachePath`: where tesseract.js may cache the model; point it at `langPath` so it
 *   reuses the committed file rather than writing a copy elsewhere.
 */
export interface TesseractMrzConfig {
  corePath: string;
  langPath: string;
  workerPath?: string;
  cachePath?: string;
}

/**
 * Fraction of a detected line's height to grow its box by before the single-line re-read.
 * Single-line mode expects whitespace around the text; a box cropped tight to the glyphs
 * reads worse than one with a small margin. 0.4 is comfortably inside the range that read
 * the fixtures exactly (0.3–0.6) and well below the point where a box swallows its
 * neighbour.
 */
const LINE_MARGIN_RATIO = 0.4;

interface LineBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Pull the per-line bounding boxes out of a tesseract block tree. */
function lineBoxes(blocks: readonly unknown[] | null | undefined): LineBox[] {
  const boxes: LineBox[] = [];
  for (const block of blocks ?? []) {
    const paragraphs = (block as { paragraphs?: readonly unknown[] }).paragraphs ?? [];
    for (const paragraph of paragraphs) {
      const lines = (paragraph as { lines?: readonly unknown[] }).lines ?? [];
      for (const line of lines) {
        const bbox = (line as { bbox?: LineBox }).bbox;
        if (bbox) boxes.push(bbox);
      }
    }
  }
  return boxes;
}

/**
 * Build the real MRZ OCR engine. Constructs one tesseract.js worker with the committed MRZ
 * model and pinned local assets; `recognizeLines` runs the two-pass read described in the
 * file header. Call {@link ClosableOcrEngine.close} to terminate the worker.
 */
export async function createTesseractMrzEngine(
  config: TesseractMrzConfig,
): Promise<ClosableOcrEngine> {
  const options: Record<string, unknown> = {
    corePath: config.corePath,
    langPath: config.langPath,
    // The model is committed uncompressed; tell tesseract.js not to expect a `.gz`.
    gzip: false,
    // tesseract.js logs progress to the console by default; silence it.
    logger: () => {},
  };
  if (config.workerPath !== undefined) options["workerPath"] = config.workerPath;
  if (config.cachePath !== undefined) options["cachePath"] = config.cachePath;

  const worker: Worker = await createWorker(
    "mrz",
    1,
    options as Parameters<typeof createWorker>[2],
  );

  await worker.setParameters({
    tessedit_char_whitelist: MRZ_WHITELIST,
    tessedit_pageseg_mode: PSM.AUTO,
  });

  return {
    async recognizeLines(image: EncodedImage): Promise<string[]> {
      // Pass 1: locate the text lines. tesseract.js needs a Buffer/Blob-like input; a
      // Uint8Array is accepted directly.
      await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
      const layout = await worker.recognize(
        image as unknown as Parameters<Worker["recognize"]>[0],
        {},
        { blocks: true, text: false },
      );
      const boxes = lineBoxes(
        (layout.data as { blocks?: readonly unknown[] }).blocks,
      );

      // Pass 2: re-read each detected line on its own, in single-line mode, with a margin.
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
      const out: string[] = [];
      for (const box of boxes) {
        const height = box.y1 - box.y0;
        const margin = Math.round(height * LINE_MARGIN_RATIO);
        const left = Math.max(0, box.x0 - margin);
        const top = Math.max(0, box.y0 - margin);
        const rectangle = {
          left,
          top,
          width: box.x1 + margin - left,
          height: box.y1 + margin - top,
        };
        const line = await worker.recognize(
          image as unknown as Parameters<Worker["recognize"]>[0],
          { rectangle },
          { text: true },
        );
        out.push((line.data as { text: string }).text);
      }
      return out;
    },

    async close(): Promise<void> {
      await worker.terminate();
    },
  };
}
