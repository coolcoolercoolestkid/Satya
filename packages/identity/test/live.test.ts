import { describe, expect, it } from "vitest";
import { fetchProofRecords, viemEnsResolver } from "../src/index.js";

// Talks to real networks. Run with: LIVE=1 pnpm test
describe.runIf(process.env.LIVE)("live networks", () => {
  it("queries Arkiv testnet for proof records", async () => {
    const records = await fetchProofRecords("0x1111111111111111111111111111111111111111");
    expect(Array.isArray(records)).toBe(true);
  }, 30000);
  it("resolves a real ENS name on mainnet", async () => {
    expect(await viemEnsResolver().address("vitalik.eth")).toMatch(/^0x/);
  }, 30000);
});
