/**
 * How well does Satya's score separate real sites from phishing sites?
 *
 *   pnpm --filter @satya/registry exec tsx scripts/evaluate.ts <phishing-domains.txt> [count]
 *
 * Runs the full check (deeper mode: domain age, certificates, archive history, page HTML) on a
 * fixed list of legitimate sites and a random sample of live phishing domains, WITHOUT the
 * blocklists (they'd make the phishing result circular). Only HTML is downloaded; no page code
 * runs. Prints the score distribution of each group and writes docs/evaluation.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { analyzePage, SEED_BRANDS, snapshotFromHtml, type CredibilityResult, type PageSnapshot } from "@satya/checks";

const LEGIT = [
  "google.com", "wikipedia.org", "amazon.in", "flipkart.com", "onlinesbi.sbi", "hdfcbank.com", "icicibank.com", "paytm.com",
  "zomato.com", "swiggy.com", "irctc.co.in", "incometax.gov.in", "uidai.gov.in", "github.com", "stackoverflow.com", "bbc.com",
  "ndtv.com", "thehindu.com", "indianexpress.com", "coinbase.com", "metamask.io", "ethereum.org", "uniswap.org", "zerodha.com",
  "groww.in", "makemytrip.com", "nykaa.com", "myntra.com", "bookmyshow.com", "naukri.com", "ola.com", "airtel.in",
  "jio.com", "tatamotors.com", "infosys.com", "python.org",
];

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 SatyaEval";

async function snapshot(domain: string): Promise<{ page: PageSnapshot; loaded: boolean }> {
  for (const scheme of ["https", "http"]) {
    try {
      const res = await fetch(`${scheme}://${domain}/`, { redirect: "follow", signal: AbortSignal.timeout(12000), headers: { "user-agent": UA } });
      const type = res.headers.get("content-type") ?? "";
      if (!type.includes("html")) continue;
      const html = (await res.text()).slice(0, 2_000_000);
      return { page: snapshotFromHtml(html, res.url || `${scheme}://${domain}/`), loaded: true };
    } catch {
      /* try next scheme */
    }
  }
  return { page: { url: `https://${domain}/`, title: "", text: "" }, loaded: false };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polite fetch for public lookups: waits and retries when a service says "too many requests". */
const politeFetch: typeof fetch = async (input, init) => {
  for (let i = 0; ; i++) {
    const res = await fetch(input, init);
    if (res.status !== 429 || i >= 3) return res;
    await sleep(5000 * (i + 1));
  }
};

async function run(domains: string[], label: string) {
  const out: { domain: string; loaded: boolean; score: number; level: CredibilityResult["level"]; reasons: string[] }[] = [];
  for (const d of domains) {
    const { page, loaded } = await snapshot(d);
    const r = await analyzePage(page, { phishing: { brands: SEED_BRANDS, lists: [] }, network: true, fetchImpl: politeFetch });
    out.push({
      domain: d,
      loaded,
      score: r.score,
      level: r.level,
      reasons: r.findings.filter((f) => f.severity !== "info").map((f) => `${f.severity === "good" ? "+" : "-"}${f.weight} ${f.title}`),
    });
    console.log(`${label.padEnd(8)} ${String(r.score).padStart(3)} ${r.level.padEnd(11)} ${d}${loaded ? "" : " (page didn't load)"}`);
    await sleep(2500);
  }
  return out;
}

const [phishFile, countArg] = process.argv.slice(2);
const count = Number(countArg ?? 35);
const phishAll = readFileSync(phishFile!, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
// Deterministic sample so the run can be repeated.
const step = Math.floor(phishAll.length / count);
const PHISH = Array.from({ length: count }, (_, i) => phishAll[i * step + 7]!).filter(Boolean);

const legit = await run(LEGIT, "legit");
const phish = await run(PHISH, "phishing");

const stats = (xs: { score: number; loaded: boolean }[]) => {
  const s = xs.map((x) => x.score).sort((a, b) => a - b);
  return {
    n: s.length,
    loaded: xs.filter((x) => x.loaded).length,
    mean: Math.round(s.reduce((a, b) => a + b, 0) / s.length),
    median: s[Math.floor(s.length / 2)],
    below45: xs.filter((x) => x.score < 45).length,
    atLeast75: xs.filter((x) => x.score >= 75).length,
  };
};
const summary = { date: new Date().toISOString(), legit: stats(legit), phishing: stats(phish) };
console.log(JSON.stringify(summary, null, 2));
writeFileSync(new URL("../../../docs/evaluation.json", import.meta.url), JSON.stringify({ summary, legit, phish }, null, 2) + "\n");
process.exit(0);
