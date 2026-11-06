import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initAnonAadhaar, proveAnonAadhaarTest, verifyAnonAadhaar } from "../src/index.js";

// Full Anon Aadhaar round trip with TEST data. Downloads the 612 MB proving key.
// Run: LIVE_AADHAAR=1 HOLDER=0xYourWallet pnpm vitest run test/anonAadhaar.live.test.ts
// Writes the proof to apps/web/public/test-aadhaar/proof-<holder>.json so the demo can use it.
const HOLDER = (process.env.HOLDER ?? "0x1111111111111111111111111111111111111111") as `0x${string}`;
const dataDir = join(__dirname, "../../../apps/web/public/test-aadhaar");

describe.runIf(process.env.LIVE_AADHAAR)("Anon Aadhaar (test data)", () => {
  it("proves an adult is 18+, bound to one wallet", async () => {
    await initAnonAadhaar("server");
    const { qrData } = JSON.parse(readFileSync(join(dataDir, "adult.json"), "utf8"));
    const proof = await proveAnonAadhaarTest(qrData, HOLDER);
    writeFileSync(join(dataDir, `proof-${HOLDER.toLowerCase()}.json`), proof);

    const ok = await verifyAnonAadhaar(proof, HOLDER);
    expect(ok).toMatchObject({ ok: true, test: true, ageAbove18: true });

    const otherWallet = await verifyAnonAadhaar(proof, "0x2222222222222222222222222222222222222222");
    expect(otherWallet).toEqual({ ok: false, reason: "Proof was made for a different wallet." });
  }, 30 * 60 * 1000);
});
