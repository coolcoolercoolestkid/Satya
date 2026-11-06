import { describe, expect, it } from "vitest";
import {
  aiFindings,
  analyzePage,
  checkAddresses,
  checkNamedEntities,
  checkPhishing,
  checkScamText,
  domainAgeFinding,
  pangramDetector,
  registrableDomain,
  registrationDateFromRdap,
  SEED_BRANDS,
  skeleton,
  type DomainList,
  type PageSnapshot,
} from "../src/index.js";

const page = (url: string, title = "", text = "", hasPasswordField = false): PageSnapshot => ({
  url,
  title,
  text,
  hasPasswordField,
});

const phishList: DomainList = {
  source: "Test phishing feed",
  kind: "phishing",
  domains: new Set(["evil-airdrop.xyz"]),
};
const ctx = { lists: [phishList], brands: SEED_BRANDS };

describe("domain helpers", () => {
  it("finds the registrable domain", () => {
    expect(registrableDomain("app.uniswap.org")).toBe("uniswap.org");
    expect(registrableDomain("https://www.onlinesbi.sbi/login")).toBe("onlinesbi.sbi");
    expect(registrableDomain("retail.sbi.co.in")).toBe("sbi.co.in");
  });
  it("normalises lookalike characters", () => {
    expect(skeleton("unlswap")).toBe(skeleton("uniswap"));
    expect(skeleton("rnetamask")).toBe(skeleton("metamask"));
    expect(skeleton("с0inbase")).toBe(skeleton("coinbase")); // Cyrillic с + zero
  });
});

describe("phishing / clone check", () => {
  const titles = (url: string, title = "") => checkPhishing(page(url, title), ctx).map((f) => f.title);

  it("marks official domains as good", () => {
    const f = checkPhishing(page("https://app.uniswap.org/swap"), ctx);
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("good");
  });
  it("flags blocklisted domains and their subdomains", () => {
    expect(titles("https://claim.evil-airdrop.xyz")).toContain("Known phishing site");
  });
  it("flags lookalike domains", () => {
    expect(titles("https://unlswap.org")[0]).toMatch(/Looks like Uniswap/);
    expect(titles("https://uniswap-claim.com")[0]).toMatch(/Looks like Uniswap/);
    expect(titles("https://metamask.app")[0]).toMatch(/Looks like MetaMask/);
    expect(titles("https://coinbsae.com")[0]).toMatch(/Looks like Coinbase/);
  });
  it("does not flag unrelated short words", () => {
    expect(titles("https://grow.com")).toEqual([]);
    expect(titles("https://solidorder.com")).toEqual([]);
    expect(titles("https://example.com")).toEqual([]);
  });
  it("flags pages that claim a brand in the title", () => {
    expect(titles("https://random-host.net", "MetaMask - Restore wallet")[0]).toMatch(/Page says "MetaMask"/);
  });
});

describe("scam text check", () => {
  const ids = (text: string) => checkScamText(page("https://x.com", "", text)).map((f) => f.source);

  it("catches common scam promises with evidence", () => {
    const f = checkScamText(
      page("https://x.com", "", "Join today. Get guaranteed monthly returns on your deposit! Contact us."),
    );
    expect(f[0]!.title).toBe("Promises guaranteed returns");
    expect(f[0]!.evidence).toContain("guaranteed monthly returns");
  });
  it("covers India-specific patterns", () => {
    expect(ids("Earn 5% daily on your USDT")).toContain("Satya scam rule: fixed-daily-returns");
    expect(ids("Pay the activation fee of ₹999 to unlock withdrawals")).toContain("Satya scam rule: fee-to-withdraw");
    expect(ids("Part-time job: like videos and earn ₹3000 per day")).toContain("Satya scam rule: task-job");
    expect(ids("Please enter your seed phrase to sync your wallet")).toContain("Satya scam rule: seed-phrase");
  });
  it("leaves normal text alone", () => {
    expect(ids("Uniswap is a decentralized exchange. Swap tokens with low fees.")).toEqual([]);
  });
  it("matches names from a published list as whole words", () => {
    const f = checkNamedEntities(page("https://x.com", "", "Trade forex with OctaFX today"), ["OctaFX"], "RBI Alert List");
    expect(f).toHaveLength(1);
    expect(checkNamedEntities(page("https://x.com", "", "OctaFXpro"), ["OctaFX"], "RBI Alert List")).toEqual([]);
  });
});

describe("records check", () => {
  it("reads the registration date from RDAP", () => {
    const d = registrationDateFromRdap({
      events: [{ eventAction: "expiration", eventDate: "2030-01-01T00:00:00Z" }, { eventAction: "registration", eventDate: "2020-05-01T00:00:00Z" }],
    });
    expect(d?.toISOString()).toBe("2020-05-01T00:00:00.000Z");
  });
  it("rates domain age", () => {
    const now = new Date("2026-11-06T00:00:00Z");
    expect(domainAgeFinding("x.com", new Date("2026-11-01T00:00:00Z"), now).severity).toBe("danger");
    expect(domainAgeFinding("x.com", new Date("2026-08-01T00:00:00Z"), now).severity).toBe("warning");
    expect(domainAgeFinding("x.com", new Date("2015-01-01T00:00:00Z"), now).severity).toBe("good");
  });
  it("flags listed wallet addresses", () => {
    const addr = "0x098B716B8Aaf21512996dC57EB0615e2383E2f96";
    const f = checkAddresses(`Send funds to ${addr}`, [
      { source: "OFAC SDN list", labels: new Map([[addr.toLowerCase(), "Sanctioned"]]) },
    ]);
    expect(f[0]!.severity).toBe("danger");
  });
});

describe("AI check", () => {
  it("words results as signals", () => {
    const f = aiFindings({ detector: "Test", fractionAi: 0.9, label: "AI", aiSegments: ["A passage."] });
    expect(f[0]!.title).toMatch(/Likely AI-generated/);
    expect(f[0]!.detail).toMatch(/can be wrong/);
    expect(f[1]!.evidence).toBe("A passage.");
  });
  it("parses Pangram's task API", async () => {
    let polls = 0;
    const fakeFetch = (async (url: string) => {
      if (url.endsWith("/task")) return new Response(JSON.stringify({ task_id: "t1" }));
      polls++;
      const body =
        polls < 2
          ? { stage: "STAGE_PREPROCESSING" }
          : {
              stage: "STAGE_SUCCESS",
              prediction_short: "AI",
              fraction_ai: 0.7,
              fraction_ai_assisted: 0.1,
              windows: [
                { text: "AI part.", label: "AI-Generated", confidence: "High" },
                { text: "Human part.", label: "Human Written", confidence: "High" },
              ],
            };
      return new Response(JSON.stringify(body));
    }) as typeof fetch;
    const d = await pangramDetector("key", { fetchImpl: fakeFetch, pollMs: 1 }).detect("text");
    expect(d.fractionAi).toBeCloseTo(0.8);
    expect(d.aiSegments).toEqual(["AI part."]);
  });
});

describe("analyzePage", () => {
  it("scores a scam clone as high risk", async () => {
    const r = await analyzePage(
      page("https://metamask-airdrop.xyz", "MetaMask Airdrop", "Claim your free airdrop now. Enter your seed phrase to verify.", true),
      { phishing: ctx, network: false },
    );
    expect(r.level).toBe("high-risk");
    expect(r.findings[0]!.severity).toBe("danger");
  });
  it("scores an official site as trustworthy", async () => {
    const r = await analyzePage(page("https://ethereum.org/en/", "Home | ethereum.org", "Ethereum is a technology."), {
      phishing: ctx,
      network: false,
    });
    expect(r.level).toBe("trustworthy");
  });
});
