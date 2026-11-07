/**
 * Copy the runtime assets the holder flow serves from its own origin into `public/`.
 *
 * The proving artifacts (the circuit wasm, the final zkey, the verification key) are large
 * and are produced by `pnpm --filter @aletheia/circuits run build`, so they are not
 * committed; this script copies the built ones next to the app. Serving them from the app
 * origin — not a CDN — is what lets the proof be produced on the device.
 *
 * Run automatically by `predev`/`prebuild`; fails loudly if an artifact is missing rather
 * than letting the app 404 at proving time.
 */

import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");
const repoRoot = join(webRoot, "..", "..");
const require = createRequire(import.meta.url);

const circuitsBuild = join(repoRoot, "packages", "circuits", "build", "age");
const nationalityBuild = join(repoRoot, "packages", "circuits", "build", "nationality");
const expiryBuild = join(repoRoot, "packages", "circuits", "build", "expiry");
const publicCircuits = join(webRoot, "public", "circuits");
const publicOcr = join(webRoot, "public", "ocr");
const srcAbi = join(webRoot, "src", "abi");

interface Copy {
  from: string;
  to: string;
  hint: string;
}

const copies: Copy[] = [
  {
    from: join(circuitsBuild, "age_js", "age.wasm"),
    to: join(publicCircuits, "age.wasm"),
    hint: "pnpm --filter @aletheia/circuits run build",
  },
  {
    from: join(circuitsBuild, "age_final.zkey"),
    to: join(publicCircuits, "age_final.zkey"),
    hint: "pnpm --filter @aletheia/circuits run build",
  },
  {
    from: join(circuitsBuild, "age_vkey.json"),
    to: join(publicCircuits, "age_vkey.json"),
    hint: "pnpm --filter @aletheia/circuits run build",
  },
  {
    from: join(nationalityBuild, "nationality_js", "nationality.wasm"),
    to: join(publicCircuits, "nationality.wasm"),
    hint: "pnpm --filter @aletheia/circuits run build",
  },
  {
    from: join(nationalityBuild, "nationality_final.zkey"),
    to: join(publicCircuits, "nationality_final.zkey"),
    hint: "pnpm --filter @aletheia/circuits run build",
  },
  {
    from: join(nationalityBuild, "nationality_vkey.json"),
    to: join(publicCircuits, "nationality_vkey.json"),
    hint: "pnpm --filter @aletheia/circuits run build",
  },
  {
    from: join(expiryBuild, "expiry_js", "expiry.wasm"),
    to: join(publicCircuits, "expiry.wasm"),
    hint: "pnpm --filter @aletheia/circuits run build",
  },
  {
    from: join(expiryBuild, "expiry_final.zkey"),
    to: join(publicCircuits, "expiry_final.zkey"),
    hint: "pnpm --filter @aletheia/circuits run build",
  },
  {
    from: join(expiryBuild, "expiry_vkey.json"),
    to: join(publicCircuits, "expiry_vkey.json"),
    hint: "pnpm --filter @aletheia/circuits run build",
  },
  // The verifier ABI and the deployment manifest come from their canonical sources so the
  // app's addresses are always the generated deployment output, never a literal. The
  // committed copies under src/abi exist only so typecheck works on a clean checkout;
  // these overwrites keep them from drifting.
  {
    from: join(repoRoot, "packages", "subgraph", "abis", "AletheiaVerifier.json"),
    to: join(srcAbi, "AletheiaVerifier.json"),
    hint: "the committed subgraph ABI copy is missing",
  },
  {
    from: join(repoRoot, "packages", "contracts", "deployments", "sepolia.json"),
    to: join(srcAbi, "sepolia-deployment.json"),
    hint: "the committed Sepolia deployment manifest is missing",
  },
];

mkdirSync(publicCircuits, { recursive: true });
mkdirSync(srcAbi, { recursive: true });

for (const { from, to, hint } of copies) {
  if (!existsSync(from)) {
    throw new Error(`missing asset ${from}\n  ${hint}`);
  }
  cpSync(from, to);
  console.log(`copied ${from} -> ${to}`);
}

// The offline OCR assets for the image path and the pdf.js worker for the PDF path. These
// are same-origin so extraction issues no network request for the document. Best-effort:
// a resolution failure warns rather than blocking dev, so the always-available typed-MRZ
// and PDF paths still run.
try {
  const tesseractPkg = require.resolve("tesseract.js/package.json");
  const tesseractDir = dirname(tesseractPkg);
  const coreDir = dirname(createRequire(tesseractPkg).resolve("tesseract.js-core/package.json"));
  const langSource = join(repoRoot, "packages", "extraction", "assets");
  const pdfWorker = require.resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs");

  mkdirSync(join(publicOcr, "lang"), { recursive: true });
  // The tesseract.js worker script, its wasm core builds, and the committed MRZ model.
  cpSync(join(tesseractDir, "dist", "worker.min.js"), join(publicOcr, "worker.min.js"));
  cpSync(coreDir, join(publicOcr, "core"), { recursive: true });
  cpSync(join(langSource, "mrz.traineddata"), join(publicOcr, "lang", "mrz.traineddata"));
  cpSync(pdfWorker, join(webRoot, "public", "pdf.worker.min.mjs"));
  console.log("copied OCR assets and the pdf.js worker.");
} catch (error) {
  console.warn(
    `WARNING: could not copy the OCR/pdf.js assets (${error instanceof Error ? error.message : error}). ` +
      "The image and PDF tabs will not work until these resolve; the typed-MRZ path still does.",
  );
}

console.log("assets copied.");
