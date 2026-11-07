/**
 * Node-only convenience: resolve the local tesseract.js assets so the OCR engine runs
 * offline without the caller spelling out paths.
 *
 * Kept apart from `ocr.ts` because it imports Node built-ins. `ocr.ts` stays free of them
 * so it bundles for the browser, where the caller supplies same-origin asset paths itself.
 *
 * The wasm core is resolved as tesseract.js itself sees it (pnpm nests it under
 * tesseract.js rather than hoisting it), and the language directory is this package's
 * committed `assets/`, which holds `mrz.traineddata`. Both are on disk, so an engine built
 * from this config downloads nothing.
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

import type { TesseractMrzConfig } from "./ocr.ts";

/** The offline {@link TesseractMrzConfig} for running the MRZ engine under Node. */
export function nodeTesseractMrzConfig(): TesseractMrzConfig {
  const require = createRequire(import.meta.url);
  const tesseractPackage = require.resolve("tesseract.js/package.json");
  const corePath = path.dirname(
    createRequire(tesseractPackage).resolve("tesseract.js-core/package.json"),
  );
  const langPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets");
  return { corePath, langPath, cachePath: langPath };
}
