import { checkAiContent, type AiDetector } from "./ai.js";
import { lookupCertificates } from "./certs.js";
import { checkAuthority, checkStructure } from "./structure.js";
import { checkPhishing, type PhishingContext } from "./phishing.js";
import { checkAddresses, lookupDomainAge, type AddressLabelList } from "./records.js";
import { checkNamedEntities, checkScamText } from "./scam.js";
import { scoreFindings } from "./score.js";
import type { CredibilityResult, Finding, PageSnapshot } from "./types.js";

export * from "./ai.js";
export * from "./brands.js";
export * from "./certs.js";
export * from "./structure.js";
export * from "./domain.js";
export * from "./phishing.js";
export * from "./records.js";
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
  const [age, certs, ai] = await Promise.all([
    network ? lookupDomainAge(page.url, ctx.fetchImpl) : Promise.resolve(undefined),
    network ? lookupCertificates(page.url, ctx.fetchImpl) : Promise.resolve([]),
    checkAiContent(page.text, ctx.aiDetector),
  ]);
  if (age) findings.push(age);
  findings.push(...certs, ...ai);

  return scoreFindings(findings);
}
