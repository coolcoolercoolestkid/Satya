import { registrableDomain } from "./domain.js";
import type { Finding } from "./types.js";

/** Minimal shape of an RDAP domain response (RFC 9083). */
interface RdapResponse {
  events?: { eventAction?: string; eventDate?: string }[];
}

/** Pulls the registration date out of an RDAP response. */
export function registrationDateFromRdap(rdap: RdapResponse): Date | undefined {
  const event = rdap.events?.find((e) => e.eventAction === "registration");
  if (!event?.eventDate) return undefined;
  const date = new Date(event.eventDate);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Turns a domain's age into a finding. */
export function domainAgeFinding(domain: string, registered: Date, now = new Date()): Finding {
  const days = Math.floor((now.getTime() - registered.getTime()) / 86_400_000);
  const when = registered.toISOString().slice(0, 10);
  const source = "RDAP domain registration records";
  if (days < 30) {
    return {
      check: "records",
      severity: "danger",
      title: `Domain is only ${days} day${days === 1 ? "" : "s"} old`,
      detail: `${domain} was registered on ${when}. Most scam sites are brand new.`,
      source,
      weight: 30,
    };
  }
  if (days < 180) {
    return {
      check: "records",
      severity: "warning",
      title: `Domain is ${Math.round(days / 30)} months old`,
      detail: `${domain} was registered on ${when}.`,
      source,
      weight: 12,
    };
  }
  const years = Math.floor(days / 365);
  return {
    check: "records",
    severity: years >= 2 ? "good" : "info",
    title: years >= 1 ? `Domain is ${years}+ year${years === 1 ? "" : "s"} old` : "Domain is over 6 months old",
    detail: `${domain} was registered on ${when}.`,
    source,
    weight: 0,
  };
}

/** Looks up a domain's registration date via the public RDAP bootstrap service. */
export async function lookupDomainAge(
  host: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Finding | undefined> {
  const domain = registrableDomain(host);
  try {
    const res = await fetchImpl(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      headers: { accept: "application/rdap+json" },
    });
    if (!res.ok) return undefined;
    const date = registrationDateFromRdap((await res.json()) as RdapResponse);
    return date ? domainAgeFinding(domain, date) : undefined;
  } catch {
    return undefined;
  }
}

/** A public list of labelled wallet addresses, e.g. the OFAC sanctions list. */
export interface AddressLabelList {
  source: string;
  /** Lowercased address -> label shown to the user. */
  labels: Map<string, string>;
}

const ADDRESS_RE = /\b0x[a-fA-F0-9]{40}\b/g;

/** Flags wallet addresses on the page that appear on a public list. */
export function checkAddresses(text: string, lists: AddressLabelList[]): Finding[] {
  const found = new Set((text.match(ADDRESS_RE) ?? []).map((a) => a.toLowerCase()));
  const findings: Finding[] = [];
  for (const address of found) {
    for (const list of lists) {
      const label = list.labels.get(address);
      if (label) {
        findings.push({
          check: "records",
          severity: "danger",
          title: `Wallet on ${list.source}`,
          detail: `${address.slice(0, 8)}…${address.slice(-6)}: ${label}`,
          source: list.source,
          evidence: address,
          weight: 50,
        });
      }
    }
  }
  return findings;
}
