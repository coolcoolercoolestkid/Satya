import { registrableDomain } from "./domain.js";
import { fetchRecorded } from "./recorded.js";
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
  // Trust points grow with history: a scam rarely keeps the same domain for years.
  const points = years >= 10 ? 25 : years >= 5 ? 20 : years >= 2 ? 15 : years >= 1 ? 8 : 0;
  return {
    check: "records",
    severity: points ? "good" : "info",
    title: years >= 1 ? `Domain is ${years}+ year${years === 1 ? "" : "s"} old` : "Domain is over 6 months old",
    detail: `${domain} was registered on ${when}.`,
    source,
    weight: points,
  };
}

let bootstrap: Promise<Map<string, string>> | undefined;

/**
 * IANA's RDAP bootstrap file maps each top-level domain to its registry's RDAP server, so the
 * lookup goes straight to the registry (e.g. Verisign for .com) instead of through a middleman.
 */
function rdapServers(fetchImpl: typeof fetch): Promise<Map<string, string>> {
  bootstrap ??= (async () => {
    const res = await fetchImpl("https://data.iana.org/rdap/dns.json");
    const body = (await res.json()) as { services: [string[], string[]][] };
    const map = new Map<string, string>();
    for (const [tlds, urls] of body.services) {
      const url = urls.find((u) => u.startsWith("https://")) ?? urls[0];
      if (url) for (const t of tlds) map.set(t.toLowerCase(), url.endsWith("/") ? url : `${url}/`);
    }
    return map;
  })().catch((e) => {
    bootstrap = undefined;
    throw e;
  });
  return bootstrap;
}

/** Looks up a domain's registration date from its registry's RDAP server. */
export async function lookupDomainAge(
  host: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Finding | undefined> {
  const domain = registrableDomain(host);
  try {
    const labels = domain.split(".");
    const servers = await rdapServers(fetchImpl).catch(() => new Map<string, string>());
    // Longest matching suffix first ("co.in" before "in").
    const base = labels.map((_, i) => servers.get(labels.slice(i).join("."))).find(Boolean);
    const url = base ? `${base}domain/${encodeURIComponent(domain)}` : `https://rdap.org/domain/${encodeURIComponent(domain)}`;
    const res = await fetchRecorded(fetchImpl, url, { headers: { accept: "application/rdap+json" } });
    if (!res.ok) return undefined;
    const date = registrationDateFromRdap(JSON.parse(res.body) as RdapResponse);
    if (!date) return undefined;
    // The exact registry record this came from, so anyone can check it, plus a hash of what we saw.
    return { ...domainAgeFinding(domain, date), source: `RDAP · ${new URL(url).host}`, link: url, proof: res.proof };
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

/**
 * When the Internet Archive first captured the site: its public "original release" date.
 * Long archive history is hard for a scam to fake; a site first seen weeks ago is a warning.
 */
export function archiveFinding(domain: string, firstSeen: Date | undefined, now = new Date()): Finding {
  const source = "Internet Archive Wayback Machine (first capture)";
  if (!firstSeen) {
    return {
      check: "records",
      severity: "info",
      title: "The Internet Archive has never captured this site",
      detail: "Common for small or brand-new sites; on its own it means little.",
      source,
      weight: 0,
    };
  }
  const days = Math.floor((now.getTime() - firstSeen.getTime()) / 86_400_000);
  const when = firstSeen.toISOString().slice(0, 10);
  if (days < 90) {
    return {
      check: "records",
      severity: "warning",
      title: `First seen online only ${days} day${days === 1 ? "" : "s"} ago`,
      detail: `The Internet Archive's first capture of ${domain} is from ${when}.`,
      source,
      weight: 8,
    };
  }
  const years = Math.floor(days / 365);
  const points = years >= 10 ? 10 : years >= 3 ? 6 : years >= 1 ? 3 : 0;
  return {
    check: "records",
    severity: points ? "good" : "info",
    title: years >= 1 ? `Online since ${firstSeen.getUTCFullYear()}` : `Online for ${Math.round(days / 30)} months`,
    detail: `The Internet Archive's first capture of ${domain} is from ${when}.`,
    source,
    weight: points,
  };
}

export async function lookupArchiveHistory(host: string, fetchImpl: typeof fetch = fetch): Promise<Finding | undefined> {
  const domain = registrableDomain(host);
  try {
    const res = await fetchRecorded(fetchImpl, `https://archive.org/wayback/available?url=${encodeURIComponent(domain)}&timestamp=19900101`);
    if (!res.ok) return undefined;
    const body = JSON.parse(res.body) as { archived_snapshots?: { closest?: { timestamp?: string; available?: boolean } } };
    const ts = body.archived_snapshots?.closest?.timestamp;
    const first = ts ? new Date(`${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T00:00:00Z`) : undefined;
    const f = archiveFinding(domain, first && !Number.isNaN(first.getTime()) ? first : undefined);
    // Link to the first capture itself, or to the archive's calendar when there is none.
    return { ...f, link: ts ? `https://web.archive.org/web/${ts}/${domain}` : `https://web.archive.org/web/*/${domain}`, proof: res.proof };
  } catch {
    return undefined;
  }
}
