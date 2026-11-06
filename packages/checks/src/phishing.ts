import type { Brand } from "./brands.js";
import {
  domainLabel,
  isPunycode,
  isSameOrSubdomain,
  levenshtein,
  normalizeHost,
  registrableDomain,
  skeleton,
} from "./domain.js";
import type { Finding, PageSnapshot } from "./types.js";

/** A public list of known-bad domains, e.g. a phishing feed or the RBI Alert List. */
export interface DomainList {
  /** Shown to the user as the source, e.g. "MetaMask eth-phishing-detect". */
  source: string;
  kind: "phishing" | "unauthorised-investment" | "scam";
  domains: Set<string>;
  /** Known-good domains the list publisher says to never flag. */
  allow?: Set<string>;
}

export interface PhishingContext {
  lists: DomainList[];
  brands: Brand[];
}

const LIST_TITLES: Record<DomainList["kind"], string> = {
  phishing: "Known phishing site",
  "unauthorised-investment": "On a government list of unauthorised platforms",
  scam: "Reported scam site",
};

/** Returns the brand whose official domain this host belongs to, if any. */
export function officialBrandFor(host: string, brands: Brand[]): Brand | undefined {
  return brands.find((b) => b.officialDomains.some((d) => isSameOrSubdomain(host, d)));
}

function listHit(host: string, list: DomainList): string | undefined {
  const h = normalizeHost(host);
  const reg = registrableDomain(h);
  if (list.allow && (list.allow.has(h) || list.allow.has(reg))) return undefined;
  // Exact host, then each parent domain down to the registrable domain.
  const labels = h.split(".");
  for (let i = 0; i <= labels.length - 2; i++) {
    const candidate = labels.slice(i).join(".");
    if (list.domains.has(candidate)) return candidate;
    if (candidate === reg) break;
  }
  return undefined;
}

/**
 * Domain-based checks: blocklists, lookalike domains, and pages that claim to be a brand
 * while being hosted somewhere else.
 */
export function checkPhishing(page: PageSnapshot, ctx: PhishingContext): Finding[] {
  const findings: Finding[] = [];
  const host = normalizeHost(page.url);
  if (!host) return findings;

  // 1. Is this an official brand domain?
  const official = officialBrandFor(host, ctx.brands);
  if (official) {
    findings.push({
      check: "phishing",
      severity: "good",
      title: `Official ${official.name} domain`,
      detail: official.ensName
        ? `Matches the domain linked to ${official.ensName}.`
        : `${registrableDomain(host)} is ${official.name}'s official domain.`,
      source: official.ensName ? `ENS: ${official.ensName}` : "Satya verified brand list",
      weight: 45,
    });
  }

  // 2. Blocklists.
  for (const list of ctx.lists) {
    const hit = listHit(host, list);
    if (hit) {
      findings.push({
        check: "phishing",
        severity: "danger",
        title: LIST_TITLES[list.kind],
        detail: `${hit} appears on ${list.source}.`,
        source: list.source,
        weight: list.kind === "phishing" ? 70 : 60,
      });
    }
  }

  if (official) return findings;

  // 3. Lookalike domain of a real brand ("unlswap.org", "uniswap-claim.com").
  const label = domainLabel(host);
  const labelSkeleton = skeleton(label);
  const labelTokens = label.split("-");
  for (const brand of ctx.brands) {
    for (const domain of brand.officialDomains) {
      const brandLabel = domainLabel(domain);
      if (brandLabel.length < 3) continue;
      // Short names ("sbi") only count as a whole hyphen-separated word: "sbi-kyc-update".
      if (brandLabel.length < 4 && !(labelTokens.length > 1 && labelTokens.includes(brandLabel))) continue;
      const brandSkeleton = skeleton(brandLabel);
      const distance = levenshtein(label, brandLabel);
      // Same name on another TLD: "metamask.app" when the real one is "metamask.io".
      const sameNameOtherTld = label === brandLabel;
      // Swapped lookalike letters: "unlswap", "rnetamask".
      const looksSame = labelSkeleton === brandSkeleton && label !== brandLabel;
      // Small typo of a longer name: "coinbsae", "metamaks".
      const closeTypo =
        brandLabel.length >= 6 && distance > 0 && distance <= (brandLabel.length >= 8 ? 2 : 1);
      // Brand name plus extra words: "uniswap-claim", "metamaskwallet".
      const containsBrand =
        label !== brandLabel &&
        (labelTokens.includes(brandLabel) ||
          (brandLabel.length >= 6 && labelSkeleton.includes(brandSkeleton)));
      if (sameNameOtherTld || looksSame || closeTypo || containsBrand) {
        findings.push({
          check: "phishing",
          severity: "danger",
          title: `Looks like ${brand.name}, but isn't`,
          detail: `This site is ${registrableDomain(host)}. ${brand.name}'s real domain is ${domain}.`,
          source: brand.ensName ? `ENS: ${brand.ensName}` : "Satya lookalike check",
          evidence: host,
          weight: 55,
        });
        return findings; // one lookalike finding is enough
      }
    }
  }

  // 4. Page claims to be a brand in its title but lives elsewhere.
  const title = page.title.toLowerCase();
  for (const brand of ctx.brands) {
    const claimed = brand.keywords.find((k) => title.includes(k));
    if (claimed) {
      findings.push({
        check: "phishing",
        severity: "warning",
        title: `Page says "${brand.name}", but this isn't ${brand.name}'s site`,
        detail: `The title mentions ${brand.name}, but the domain is ${registrableDomain(host)}, not ${brand.officialDomains[0]}.`,
        source: "Satya brand check",
        evidence: page.title,
        weight: page.hasPasswordField ? 40 : 20,
      });
      break;
    }
  }

  // 5. Punycode hosts hide lookalike letters.
  if (isPunycode(host)) {
    findings.push({
      check: "phishing",
      severity: "warning",
      title: "Domain uses disguised characters",
      detail: "Non-Latin letters (punycode) are often used to imitate real domains.",
      source: "Satya lookalike check",
      evidence: host,
      weight: 20,
    });
  }

  return findings;
}
