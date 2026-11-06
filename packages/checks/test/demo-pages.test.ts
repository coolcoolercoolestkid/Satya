import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzePage, SEED_BRANDS, snapshotFromHtml, type AnalyzeContext } from "../src/index.js";

// The labelled fake scam pages in apps/demo, checked the way the MCP server reads them.
const page = (file: string, host: string) =>
  snapshotFromHtml(readFileSync(new URL(`../../../apps/demo/pages/${file}`, import.meta.url), "utf8"), `http://${host}.localhost:5180/`);

const ctx: AnalyzeContext = {
  phishing: { brands: SEED_BRANDS, lists: [] },
  network: false,
  addressLists: [{ source: "US Treasury OFAC sanctions list", labels: new Map([["0x0330070fd38ec3bb94f58fa55d40368271e9e54a", "Sanctioned (test)"]]) }],
};

const cases: [string, string, RegExp[]][] = [
  ["kyc.html", "sbi-kyc-update", [/Looks like State Bank of India/, /KYC/i, /OTP|UPI PIN/, /\.apk/, /without encryption/]],
  ["seed.html", "metamask-wallet-sync", [/Looks like MetaMask/, /secret phrase|recovery phrase|seed/i]],
  ["tasks.html", "earn-daily-tasks", [/deposit|withdraw/i, /UPI/, /OFAC/]],
  ["gov.html", "pm-kisan-help", [/\.gov\.in/]],
];

describe("demo scam pages", () => {
  for (const [file, host, expected] of cases) {
    it(`${host} is high risk with the expected reasons`, async () => {
      const r = await analyzePage(page(file, host), ctx);
      const titles = r.findings.map((f) => f.title).join("\n");
      for (const re of expected) expect(titles).toMatch(re);
      expect(r.level).toBe("high-risk");
    });
  }
});
