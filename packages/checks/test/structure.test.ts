import { describe, expect, it } from "vitest";
import {
  certificateFindings,
  checkAuthority,
  checkScamText,
  checkStructure,
  SEED_BRANDS,
  validationLevel,
  type PageSignals,
  type PageSnapshot,
} from "../src/index.js";

const signals = (s: Partial<PageSignals> = {}): PageSignals => ({
  protocol: "https:",
  forms: [],
  sensitiveFields: [],
  maxInputsInOneForm: 0,
  downloadLinks: [],
  scriptHosts: [],
  ...s,
});
const page = (url: string, extra: Partial<PageSnapshot> = {}): PageSnapshot => ({ url, title: "", text: "", ...extra });
const titles = (f: { title: string }[]) => f.map((x) => x.title);

describe("page structure", () => {
  it("flags secrets asked over plain HTTP", () => {
    const f = checkStructure(page("http://shop.example", { hasPasswordField: true, signals: signals({ protocol: "http:" }) }), SEED_BRANDS);
    expect(titles(f)).toContain("Asks for passwords or details without encryption");
  });
  it("flags forms that submit to another site", () => {
    const f = checkStructure(
      page("https://login-secure.example", { hasPasswordField: true, signals: signals({ forms: [{ actionHost: "collect.evil.ru", hasPassword: true }] }) }),
      SEED_BRANDS,
    );
    expect(titles(f)[0]).toMatch(/Form sends what you type to evil.ru/);
  });
  it("flags OTP, UPI PIN and seed-phrase grids on unknown sites, but not on official ones", () => {
    const risky = checkStructure(page("https://reward-claim.example", { signals: signals({ sensitiveFields: ["otp", "upi-pin"] }) }), SEED_BRANDS);
    expect(risky[0]!.severity).toBe("danger");
    const grid = checkStructure(page("https://wallet-sync.example", { signals: signals({ maxInputsInOneForm: 12 }) }), SEED_BRANDS);
    expect(grid[0]!.title).toMatch(/secret phrase/);
    const bank = checkStructure(page("https://www.hdfcbank.com/login", { signals: signals({ sensitiveFields: ["otp"] }) }), SEED_BRANDS);
    expect(bank).toEqual([]);
  });
  it("flags APK downloads and free hosting", () => {
    const f = checkStructure(
      page("https://sbi-rewards.netlify.app", { hasPasswordField: true, signals: signals({ downloadLinks: ["https://x.example/SBI_Reward.apk"] }) }),
      SEED_BRANDS,
    );
    expect(titles(f)).toEqual(expect.arrayContaining(["Hosted on netlify.app, where anyone can make a site", "Offers an Android app (.apk) outside the Play Store"]));
  });
});

describe("government and bank domains", () => {
  it("trusts .gov.in and .bank.in", () => {
    expect(checkAuthority(page("https://www.incometax.gov.in"), SEED_BRANDS)[0]!.severity).toBe("good");
    expect(checkAuthority(page("https://www.sbi.bank.in"), SEED_BRANDS)[0]!.severity).toBe("good");
  });
  it("flags fake government and bank pages", () => {
    const gov = checkAuthority(page("https://pm-kisan-help.example", { text: "Ministry of Agriculture, Government of India. Update KYC." }), SEED_BRANDS);
    expect(gov[0]!.title).toMatch(/isn't on a .gov.in domain/);
    const bank = checkAuthority(page("https://secure-netbanking.example", { title: "Net Banking Login", hasPasswordField: true }), SEED_BRANDS);
    expect(bank[0]!.title).toMatch(/isn't on a .bank.in domain/);
  });
});

describe("certificates", () => {
  it("reads the validation level from the issuer", () => {
    expect(validationLevel("C=US, O=Let's Encrypt, CN=R11")).toBe("DV");
    expect(validationLevel("C=GB, O=Sectigo Limited, CN=Sectigo Public Server Authentication CA DV R36")).toBe("DV");
    expect(validationLevel("C=US, O=DigiCert Inc, CN=DigiCert EV RSA CA G2")).toBe("EV");
    expect(validationLevel("C=BE, O=GlobalSign nv-sa, CN=GlobalSign GCC R3 OV TLS CA 2024")).toBe("OV");
  });
  it("explains what the padlock proves and flags brand-new certificates", () => {
    const now = new Date("2026-11-06T00:00:00Z");
    const f = certificateFindings("x.example", [{ not_before: "2026-11-04T00:00:00Z", issuer: { name: "CN=R11, O=Let's Encrypt", friendly_name: "Let's Encrypt" } }], now);
    expect(titles(f)).toEqual(["HTTPS certificate only proves domain control", "HTTPS certificate is only 2 days old"]);
    const ev = certificateFindings("bank.example", [{ not_before: "2026-06-01T00:00:00Z", issuer: { name: "DigiCert EV RSA CA G2" } }], now);
    expect(ev[0]!.severity).toBe("good");
  });
});

describe("India scam patterns", () => {
  const ids = (text: string) => checkScamText(page("https://x.example", { text })).map((f) => f.source.replace("Satya scam rule: ", ""));
  it("covers common Indian scams", () => {
    expect(ids("Your KYC is pending. Update now or your account will be blocked")).toContain("kyc-threat");
    expect(ids("Dear customer your electricity connection will be disconnected tonight at 9:30")).toContain("utility-cutoff");
    expect(ids("You are under digital arrest. Join the video call")).toContain("digital-arrest");
    expect(ids("Flat 90% off on all iPhones")).toContain("too-good-discount");
    expect(ids("Please pay ₹499 to shopdeals@ybl to confirm")).toContain("personal-upi");
    expect(ids("Congratulations! You have won a lucky draw prize of 25 lakh")).toContain("lottery");
    expect(ids("Your computer has been infected. Call Microsoft support")).toContain("tech-support");
  });
});

describe("task, fee and doubling scams", () => {
  const ids = (text: string) => checkScamText(page("https://x.example", { text })).map((f) => f.source.replace("Satya scam rule: ", ""));
  it("catches the common wordings", () => {
    expect(ids("Complete simple tasks and earn ₹5,000 daily")).toContain("task-job");
    expect(ids("To unlock withdrawal, first deposit ₹2,999 as a security fee")).toContain("fee-to-withdraw");
    expect(ids("Your money will double in 7 days")).toContain("multiply-money");
  });
  it("leaves ordinary wording alone", () => {
    expect(ids("Complete tasks to earn badges and streaks")).toEqual([]);
    expect(ids("Withdrawals are free. Deposit any amount from ₹100.")).toEqual([]);
    expect(ids("Our team doubled in size this year")).toEqual([]);
  });
});

describe("privacy by default", () => {
  it("makes no network request unless the deeper check asks for one", async () => {
    const { analyzePage } = await import("../src/index.js");
    const calls: string[] = [];
    const spy = (async (u: string | URL | Request) => { calls.push(String(u)); return new Response("{}"); }) as typeof fetch;
    const p = page("https://some-shop.example/login", { text: "Login to your account", hasPasswordField: true });
    await analyzePage(p, { phishing: { brands: SEED_BRANDS, lists: [] }, network: false, fetchImpl: spy });
    expect(calls).toEqual([]);
    await analyzePage(p, { phishing: { brands: SEED_BRANDS, lists: [] }, network: true, fetchImpl: spy });
    expect(calls.map((u) => new URL(u).hostname).sort()).toEqual(["api.certspotter.com", "rdap.org"]);
  });
});
