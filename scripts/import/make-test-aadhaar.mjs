// Generates Anon Aadhaar TEST QR data for the demo (never real people).
// Starts from UIDAI's official sample QR (a fictional person) and re-signs it with the test key
// that Anon Aadhaar publishes, exactly like their own generateTestData script.
// Run: node scripts/import/make-test-aadhaar.mjs
import crypto from "node:crypto";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "../../packages/identity/package.json"));
const core = require("@anon-aadhaar/core");

const REPO = "https://raw.githubusercontent.com/anon-aadhaar/anon-aadhaar/main/packages/circuits";
const testPrivateKey = await (await fetch(`${REPO}/assets/testPrivateKey.pem`)).text();
const script = await (await fetch(`${REPO}/scripts/generateTestData.ts`)).text();
const uidaiSample = script.match(/const data =\s*'(\d+)'/)?.[1];
if (!uidaiSample || !testPrivateKey.includes("PRIVATE KEY")) throw new Error("Could not download test inputs");

function makeQr({ dob, state }) {
  const decoded = core.decompressByteArray(core.convertBigIntToByteArray(BigInt(uidaiSample)));
  const dataToSign = core.createCustomV2TestData({
    signedData: decoded.slice(0, decoded.length - 256),
    dob,
    state,
  });
  const signature = crypto.createSign("sha256").update(Buffer.from(dataToSign)).sign(testPrivateKey);
  const qr = core.rawDataToCompressedQR(Buffer.concat([dataToSign, signature]));
  return qr.toString();
}

const out = join(here, "../../apps/web/public/test-aadhaar");
const personas = {
  adult: { label: "Test Aadhaar · adult", dob: "15-08-1995", state: "Maharashtra" },
  minor: { label: "Test Aadhaar · minor", dob: "15-08-2012", state: "Maharashtra" },
};
for (const [id, p] of Object.entries(personas)) {
  writeFileSync(join(out, `${id}.json`), JSON.stringify({ label: p.label, dob: p.dob, qrData: makeQr(p) }));
  console.log(`wrote ${id}.json (dob ${p.dob})`);
}
