import { normalizeHost } from "./domain.js";
import { fetchRecorded } from "./recorded.js";
import type { Finding } from "./types.js";

/**
 * HTTPS certificates, from public Certificate Transparency logs (Cert Spotter).
 *
 * The padlock alone proves little: free certificates take a minute to get, and most phishing
 * sites have one. What does matter is the *type* of certificate:
 *  - DV (domain validated): proves only that someone controls the domain.
 *  - OV / EV (organization / extended validation): a certificate authority checked the
 *    company's legal identity. Phishing sites almost never have these.
 */

export type ValidationLevel = "DV" | "OV" | "EV" | "unknown";

interface Issuance {
  not_before?: string;
  not_after?: string;
  issuer?: { friendly_name?: string; name?: string };
}

/** Infers the validation level from the issuing CA's name. */
export function validationLevel(issuerName: string): ValidationLevel {
  const n = issuerName.toLowerCase();
  if (/\bev\b|extended validation/.test(n)) return "EV";
  if (/\bov\b|organization validation|organisation validation/.test(n)) return "OV";
  if (/\bdv\b|domain validation|let's encrypt|lets encrypt|zerossl|cn=r1[0-9]|cn=e[5-9]|cn=wr\d|cn=we\d/.test(n)) return "DV";
  return "unknown";
}

export function certificateFindings(host: string, issuances: Issuance[], now = new Date()): Finding[] {
  const source = "Certificate Transparency logs (Cert Spotter)";
  if (!issuances.length) {
    return [{
      check: "records",
      severity: "info",
      title: "No valid HTTPS certificate found in public logs",
      detail: `Couldn't find a current certificate for ${host}.`,
      source,
      weight: 0,
    }];
  }
  const levels = issuances.map((i) => validationLevel(i.issuer?.name ?? ""));
  const best = levels.includes("EV") ? "EV" : levels.includes("OV") ? "OV" : levels.includes("DV") ? "DV" : "unknown";
  const issuer = issuances[0]?.issuer?.friendly_name ?? "a certificate authority";
  const findings: Finding[] = [];

  if (best === "EV" || best === "OV") {
    findings.push({
      check: "records",
      severity: "good",
      title: `Certificate verifies the company behind the site (${best})`,
      detail: `${issuer} checked the organisation's legal identity before issuing it.`,
      source,
      weight: best === "EV" ? 15 : 10,
    });
  } else {
    findings.push({
      check: "records",
      severity: "info",
      title: "HTTPS certificate only proves domain control",
      detail: `The padlock (from ${issuer}) shows the connection is encrypted, not who runs the site.`,
      source,
      weight: 0,
    });
  }

  const newest = Math.max(...issuances.map((i) => new Date(i.not_before ?? 0).getTime()));
  const oldest = Math.min(...issuances.map((i) => new Date(i.not_before ?? now).getTime()));
  const daysSinceFirst = Math.floor((now.getTime() - oldest) / 86_400_000);
  if (daysSinceFirst <= 7 && Number.isFinite(newest)) {
    findings.push({
      check: "records",
      severity: "warning",
      title: `HTTPS certificate is only ${daysSinceFirst} day${daysSinceFirst === 1 ? "" : "s"} old`,
      detail: "Every certificate this site currently has was issued this week. Scam sites are often days old.",
      source,
      weight: 10,
    });
  }
  return findings;
}

export async function lookupCertificates(url: string, fetchImpl: typeof fetch = fetch): Promise<Finding[]> {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return [];
    host = normalizeHost(u.hostname);
  } catch {
    return [];
  }
  try {
    const res = await fetchRecorded(fetchImpl, `https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(host)}&expand=issuer`);
    if (!res.ok) return []; // rate-limited or down: say nothing rather than guess
    // crt.sh shows the same Certificate Transparency logs as a readable page.
    const link = `https://crt.sh/?q=${encodeURIComponent(host)}`;
    return certificateFindings(host, JSON.parse(res.body) as Issuance[]).map((f) => ({ ...f, link, proof: res.proof }));
  } catch {
    return [];
  }
}
