#!/usr/bin/env node
/**
 * Satya MCP server.
 *
 * AI agents now open links, read messages and send payments for people. This server lets
 * any MCP client (Claude Desktop, Claude Code, agent frameworks) ask Satya first:
 * "is this link / message / wallet safe to act on?" It runs the same checks as the
 * extension and answers with a score, a recommended action, and the reason and source
 * for every point lost.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  analyzePage,
  checkAddresses,
  checkNamedEntities,
  checkPhishing,
  checkScamText,
  scoreFindings,
  snapshotFromHtml,
  type CredibilityResult,
  type PageSnapshot,
} from "@satya/checks";
import { loadContext } from "./context.js";

const USER_AGENT = "SatyaBot/0.1 (+https://github.com/coolcoolercoolestkid/Satya)";
const MAX_HTML_BYTES = 2_000_000;
const FETCH_TIMEOUT_MS = 10_000;

/** Refuses local and private addresses, so a tricked agent can't make us read internal pages. */
function assertPublicUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http and https links can be checked.");
  const h = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const privateHost =
    h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") ||
    /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) ||
    h === "::1" || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h);
  if (privateHost) throw new Error("Local and private network addresses can't be checked.");
  return url;
}

async function fetchPage(url: URL): Promise<{ snapshot: PageSnapshot; note?: string }> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
    });
    const finalUrl = assertPublicUrl(res.url || url.href).href;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html")) {
      return { snapshot: { url: finalUrl, title: "", text: "" }, note: `Link returns ${type || "unknown content"}, not a web page; checked the address only.` };
    }
    const buf = await res.arrayBuffer();
    const html = new TextDecoder().decode(buf.slice(0, MAX_HTML_BYTES));
    const note = finalUrl !== url.href ? `Redirected to ${finalUrl}` : undefined;
    return { snapshot: snapshotFromHtml(html, finalUrl), note };
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return { snapshot: { url: url.href, title: "", text: "" }, note: `Couldn't load the page (${why}); checked the address only.` };
  }
}

const ACTION: Record<CredibilityResult["level"], string> = {
  "high-risk": "DO NOT PROCEED. Don't open, pay, sign or enter any details.",
  careful: "PROCEED ONLY WITH CARE. Ask the user before entering details, paying or signing.",
  trustworthy: "No red flags found. This isn't a guarantee; still don't share secrets like OTPs or seed phrases.",
};

/** For an agent, any single danger finding means stop, whatever the overall score. */
const actionLevel = (r: CredibilityResult): CredibilityResult["level"] =>
  r.findings.some((f) => f.severity === "danger") ? "high-risk" : r.level;

function report(subject: string, r: CredibilityResult, notes: string[] = []): string {
  const lines = [
    `Satya check: ${subject}`,
    `Score: ${r.score}/100 (${r.findings.length ? r.label : "No red flags found"})`,
    `Recommended action: ${ACTION[actionLevel(r)]}`,
    ...notes.map((n) => `Note: ${n}`),
    "",
    r.findings.length ? "Findings:" : "No findings.",
    ...r.findings.map((f) => {
      const ev = f.evidence ? ` Evidence: "${f.evidence.slice(0, 160)}"` : "";
      return `- [${f.severity.toUpperCase()}] ${f.title}${f.detail ? `. ${f.detail}` : ""} (source: ${f.source}).${ev}`;
    }),
  ];
  return lines.join("\n");
}

const output = (subject: string, r: CredibilityResult, notes: string[] = []) => ({
  content: [{ type: "text" as const, text: report(subject, r, notes) }],
  structuredContent: { subject, score: r.score, level: r.level, action: actionLevel(r), label: r.label, findings: r.findings, notes },
});

const failure = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: true } as const;

const server = new McpServer({ name: "satya", version: "0.1.0" });

server.registerTool(
  "check_url",
  {
    title: "Check a link before opening it",
    description:
      "Checks a web link for phishing, lookalike domains, scam wording, risky forms (OTP, UPI PIN, card, seed phrase), fake government or bank sites, brand-new domains and certificates, sanctioned wallets and fake app downloads. Call this before opening, logging in to, paying on, or recommending any link the user didn't type themselves. Returns a 0-100 score, a recommended action and the source for every finding.",
    inputSchema: { url: z.string().describe("The full link, e.g. https://example.com/login") },
    annotations: READ_ONLY,
  },
  async ({ url }) => {
    let target: URL;
    try {
      target = assertPublicUrl(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`);
    } catch (err) {
      return failure(err instanceof Error ? err.message : String(err));
    }
    const ctx = await loadContext();
    const { snapshot, note } = await fetchPage(target);
    const r = await analyzePage(snapshot, ctx);
    return output(snapshot.url, r, note ? [note] : []);
  },
);

server.registerTool(
  "check_domain",
  {
    title: "Check a domain name",
    description:
      "Fast check of a bare domain without loading the page: known phishing lists, lookalikes of real brands (SBI, HDFC, MetaMask, Binance…), .gov.in/.bank.in rules, domain age and HTTPS certificate type.",
    inputSchema: { domain: z.string().describe("A domain such as sbi-kyc-update.in") },
    annotations: READ_ONLY,
  },
  async ({ domain }) => {
    let target: URL;
    try {
      target = assertPublicUrl(`https://${domain.replace(/^[a-z]+:\/\//i, "").split("/")[0]}`);
    } catch (err) {
      return failure(err instanceof Error ? err.message : String(err));
    }
    const ctx = await loadContext();
    const r = await analyzePage({ url: target.href, title: "", text: "" }, ctx);
    return output(target.hostname, r);
  },
);

const LINK_RE = /\bhttps?:\/\/[^\s<>"')]+|\b(?:[a-z0-9-]+\.)+(?:com|in|net|org|io|xyz|top|app|info|co|me|site|online|shop|live|link)\b(?:\/[^\s<>"')]*)?/gi;

server.registerTool(
  "check_message",
  {
    title: "Check a message for scams",
    description:
      "Checks an SMS, WhatsApp, Telegram or email message for scam patterns common in India and crypto: KYC or account-block threats, electricity cut-off, 'digital arrest', task jobs, guaranteed returns, lotteries, personal UPI payment requests, seed-phrase requests. Also checks every link and wallet address inside the message.",
    inputSchema: { text: z.string().describe("The full message text"), sender: z.string().optional().describe("Sender name, number or address, if known") },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ text, sender }) => {
    const ctx = await loadContext();
    const message: PageSnapshot = { url: "about:message", title: sender ?? "", text };
    const findings = [
      ...checkScamText(message),
      ...(ctx.namedLists ?? []).flatMap((l) => checkNamedEntities(message, l.names, l.source)),
      ...checkAddresses(text, ctx.addressLists ?? []),
    ];
    const links = [...new Set(text.match(LINK_RE) ?? [])].slice(0, 5);
    for (const link of links) {
      const url = /^https?:/i.test(link) ? link : `https://${link}`;
      findings.push(...checkPhishing({ url, title: "", text: "" }, ctx.phishing).map((f) => ({ ...f, evidence: f.evidence ?? link })));
    }
    const notes = links.length ? [`Links found: ${links.join(", ")}. Use check_url on any link before opening it.`] : [];
    return output("message", scoreFindings(findings), notes);
  },
);

server.registerTool(
  "check_wallet",
  {
    title: "Check a crypto wallet address",
    description: "Checks an Ethereum address against public sanctions and scam lists (e.g. the US Treasury OFAC list). Call before sending funds or signing a transaction with an address you got from a message or website.",
    inputSchema: { address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe("0x… Ethereum address") },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ address }) => {
    const ctx = await loadContext();
    const findings = checkAddresses(address, ctx.addressLists ?? []);
    const notes = findings.length ? [] : ["Not on any list Satya has. A clean result doesn't prove the address is safe; new scam wallets appear every day."];
    return output(address, scoreFindings(findings), notes);
  },
);

await server.connect(new StdioServerTransport());
console.error("[satya] MCP server ready.");
