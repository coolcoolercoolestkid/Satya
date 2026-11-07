import { checkAiContent, type AiDetector } from "./ai.js";
import { lookupCertificates } from "./certs.js";
import { checkAuthority, checkStructure } from "./structure.js";
import { checkPhishing, type PhishingContext } from "./phishing.js";
import { checkAddresses, lookupArchiveHistory, lookupDomainAge, type AddressLabelList } from "./records.js";
import { checkNamedEntities, checkScamText } from "./scam.js";
import { scoreFindings } from "./score.js";
import { freeHostOf } from "./structure.js";
import { officialBrandFor } from "./phishing.js";
import { normalizeHost } from "./domain.js";
import type { CredibilityResult, Finding, PageSnapshot } from "./types.js";

export * from "./ai.js";
export * from "./brands.js";
export * from "./certs.js";
export * from "./structure.js";
export * from "./domain.js";
export * from "./phishing.js";
export * from "./records.js";
export * from "./html.js";
export * from "./scam.js";
export * from "./score.js";
export * from "./types.js";

export interface AnalyzeContext {
  phishing: PhishingContext;
  /** Named lists such as the RBI Alert List (entity names, not domains). */
  namedLists?: { source: string; names: string[] }[];
  addressLists?: AddressLabelList[];
  aiDetector?: AiDetector;
  /** Set false to skip network lookups (domain age). */
  network?: boolean;
  fetchImpl?: typeof fetch;
}

/** Runs all four checks on a page and returns the credibility card. */
export async function analyzePage(page: PageSnapshot, ctx: AnalyzeContext): Promise<CredibilityResult> {
  const findings: Finding[] = [
    ...checkPhishing(page, ctx.phishing),
    ...checkAuthority(page, ctx.phishing.brands),
    ...checkStructure(page, ctx.phishing.brands),
    ...checkScamText(page),
    ...(ctx.namedLists ?? []).flatMap((l) => checkNamedEntities(page, l.names, l.source)),
    ...checkAddresses(page.text, ctx.addressLists ?? []),
  ];

  const network = ctx.network ?? true;
  const [age, certs, ai, archive] = await Promise.all([
    network ? lookupDomainAge(page.url, ctx.fetchImpl) : Promise.resolve(undefined),
    network ? lookupCertificates(page.url, ctx.fetchImpl) : Promise.resolve([]),
    checkAiContent(page.mainText || page.text, ctx.aiDetector),
    network ? lookupArchiveHistory(normalizeHost(page.url), ctx.fetchImpl) : Promise.resolve(undefined),
  ]);
  if (age) findings.push(age);
  if (archive) findings.push(archive);
  findings.push(...certs, ...ai);

  return scoreFindings(adjustForOrigin(findings, page, ctx.phishing.brands));
}

/**
 * Context the individual checks can't see on their own:
 * - On an official brand, government or bank domain, scam wording is almost always help text
 *   ("never share your seed phrase"), so it's shown for information only.
 * - On a shared host (pages.dev, netlify.app…), the domain's age, certificate and archive history
 *   belong to the hosting company, so they can't vouch for this site.
 */
export function adjustForOrigin(findings: Finding[], page: PageSnapshot, brands: PhishingContext["brands"]): Finding[] {
  const host = normalizeHost(page.url);
  const trusted = !!officialBrandFor(host, brands) || /\.(gov|nic)\.in$/.test(host) || host.endsWith(".bank.in");
  const sharedHost = freeHostOf(host);
  return findings.map((f) => {
    if (trusted && f.check === "scam" && f.severity !== "good") {
      return { ...f, severity: "info", weight: 0, detail: `${f.detail ?? ""} This is the official site, where such text is usually a safety warning.`.trim() };
    }
    if (sharedHost && f.check === "records" && f.severity === "good") {
      return { ...f, severity: "info", weight: 0, detail: `This describes ${sharedHost}, the hosting service, not this site.` };
    }
    return f;
  });
}
export * from "./credentials.js";
export * from "./recorded.js";
export * from "./evidence.js";
