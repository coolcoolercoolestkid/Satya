import type { Finding, PageSnapshot } from "@satya/checks";
import { createPublicClient, http, type Address } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { normalize } from "viem/ens";
import { verifyAnonAadhaar } from "./anonAadhaar.js";
import { earlierWalletForCard, fetchProofRecords, type ProofRecord } from "./arkiv.js";
import { CLAIM_LABELS, verifyAttestation } from "./credential.js";

export interface EnsResolver {
  address(name: string): Promise<Address | null>;
  text(name: string, key: string): Promise<string | null>;
}

/** Resolves ENS on mainnet first, then Sepolia (where demo names can live for free). */
export function viemEnsResolver(
  rpc: { mainnet?: string; sepolia?: string } = {},
): EnsResolver {
  const clients = [
    createPublicClient({ chain: mainnet, transport: http(rpc.mainnet ?? "https://ethereum-rpc.publicnode.com") }),
    createPublicClient({ chain: sepolia, transport: http(rpc.sepolia ?? "https://ethereum-sepolia-rpc.publicnode.com") }),
  ];
  const first = async <T>(fn: (c: (typeof clients)[number]) => Promise<T | null>) => {
    for (const c of clients) {
      try {
        const v = await fn(c);
        if (v) return v;
      } catch {
        /* try the next network */
      }
    }
    return null;
  };
  return {
    address: (name) => first((c) => c.getEnsAddress({ name: normalize(name) })),
    text: (name, key) => first((c) => c.getEnsText({ name: normalize(name), key })),
  };
}

const ENS_RE = /\b((?:[a-z0-9-]+\.)+eth)\b/gi;

/** ENS names written on the page, e.g. in a profile bio. */
export function ensNamesOnPage(page: PageSnapshot, max = 3): string[] {
  const names = new Set<string>();
  for (const m of `${page.title}\n${page.text}`.matchAll(ENS_RE)) {
    names.add(m[1]!.toLowerCase());
    if (names.size >= max) break;
  }
  return [...names];
}

/** The profile handle a URL points at, with the ENS text-record key that should match it. */
export function profileHandle(url: string): { platform: string; handle: string; ensKey: string } | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  const host = u.hostname.replace(/^www\./, "");
  const first = u.pathname.split("/").filter(Boolean)[0];
  if (!first) return undefined;
  const reserved = new Set(["home", "explore", "search", "settings", "notifications", "messages", "i", "login", "orgs", "topics"]);
  if (reserved.has(first.toLowerCase())) return undefined;
  if (host === "x.com" || host === "twitter.com") return { platform: "X", handle: first, ensKey: "com.twitter" };
  if (host === "github.com") return { platform: "GitHub", handle: first, ensKey: "com.github" };
  return undefined;
}

const sameHandle = (a: string, b: string) => a.replace(/^@/, "").toLowerCase() === b.replace(/^@/, "").toLowerCase();

export interface IdentityDeps {
  ens: EnsResolver;
  proofs: (holder: Address) => Promise<ProofRecord[]>;
  /** The wallet this Aadhaar card verified first, if it wasn't `holder`. */
  cardFirstWallet?: (nullifier: string, holder: Address) => Promise<Address | undefined>;
  now?: Date;
}

export function defaultIdentityDeps(arkivAccessKey = ""): IdentityDeps {
  return {
    ens: viemEnsResolver(),
    proofs: (a) => fetchProofRecords(a, arkivAccessKey),
    cardFirstWallet: (n, h) => earlierWalletForCard(n, h, arkivAccessKey),
  };
}

/** "Who is this?" findings for the ENS names on a page, with their verified proofs. */
export async function checkIdentity(page: PageSnapshot, deps: IdentityDeps): Promise<Finding[]> {
  const findings: Finding[] = [];
  const handle = profileHandle(page.url);

  for (const name of ensNamesOnPage(page)) {
    let address: Address | null = null;
    try {
      address = await deps.ens.address(name);
    } catch {
      address = null;
    }
    if (!address) continue;

    findings.push({
      check: "identity",
      severity: "info",
      title: `${name} is a registered ENS name`,
      detail: `Points to ${address.slice(0, 6)}…${address.slice(-4)}.`,
      source: "ENS",
      evidence: name,
      weight: 0,
    });

    // Does the ENS name confirm it owns this profile?
    if (handle) {
      const linked = await deps.ens.text(name, handle.ensKey).catch(() => null);
      if (linked && sameHandle(linked, handle.handle)) {
        findings.push({
          check: "identity",
          severity: "good",
          title: `${handle.platform} @${handle.handle} is confirmed by ${name}`,
          detail: `${name}'s ENS record "${handle.ensKey}" points back to this profile.`,
          source: `ENS record ${handle.ensKey}`,
          weight: 0,
        });
      } else if (linked) {
        findings.push({
          check: "identity",
          severity: "danger",
          title: `Possible impersonation: ${name} belongs to @${linked.replace(/^@/, "")}`,
          detail: `This profile shows ${name}, but that name's owner links a different ${handle.platform} account.`,
          source: `ENS record ${handle.ensKey}`,
          evidence: name,
          weight: 45,
        });
      }
    }

    // Verified claims (18+, nationality, ID valid) from Arkiv.
    let records: ProofRecord[] = [];
    try {
      records = await deps.proofs(address);
    } catch {
      findings.push({
        check: "identity",
        severity: "info",
        title: "Couldn't reach Arkiv to load proofs",
        source: "Arkiv",
        weight: 0,
      });
      continue;
    }
    let verified = 0;
    for (const r of records) {
      if (r.anonAadhaar) {
        const v = await verifyAnonAadhaar(r.anonAadhaar, address);
        const earlier = v.ok && deps.cardFirstWallet ? await deps.cardFirstWallet(v.nullifier, address).catch(() => undefined) : undefined;
        if (v.ok && earlier) {
          findings.push({
            check: "identity",
            severity: "warning",
            title: `${name}: this Aadhaar card already verified another wallet`,
            detail: `The same card proved for ${earlier.slice(0, 6)}…${earlier.slice(-4)} first. Satya counts one wallet per card, so this proof doesn't count.`,
            source: "Anon Aadhaar nullifier, records on Arkiv",
            weight: 10,
          });
          continue;
        }
        if (v.ok && v.ageAbove18) {
          verified++;
          findings.push({
            check: "identity",
            severity: "good",
            title: `${name}: 18+ Aadhaar holder${v.state ? ` · ${v.state}` : ""}`,
            detail: `${v.test
              ? "Zero-knowledge proof made from Anon Aadhaar TEST data, not a real Aadhaar card."
              : "Zero-knowledge proof from a UIDAI-signed Aadhaar QR. No Aadhaar number, name or birthday revealed."} QR signed ${v.signedAt.toISOString().slice(0, 10)}.`,
            source: "Anon Aadhaar ZK proof, record on Arkiv",
            weight: 0,
          });
        } else if (!v.ok) {
          findings.push({
            check: "identity",
            severity: "warning",
            title: `${name}: an Aadhaar proof failed`,
            detail: v.reason,
            source: "Anon Aadhaar verifier, record on Arkiv",
            weight: 10,
          });
        }
        continue;
      }
      if (!r.signed) continue;
      const v = await verifyAttestation(r.signed, address, deps.now);
      const label = CLAIM_LABELS[r.signed.attestation.claim]?.(r.signed.attestation.value) ?? r.signed.attestation.claim;
      if (v.ok) {
        verified++;
        findings.push({
          check: "identity",
          severity: "good",
          title: `${name}: ${label}`,
          detail: v.issuer.demo ? "Proven with a demo issuer, not a real government source." : undefined,
          source: `${v.issuer.name}, record on Arkiv`,
          weight: 0,
        });
      } else {
        findings.push({
          check: "identity",
          severity: "warning",
          title: `${name}: a "${label}" proof failed`,
          detail: v.reason,
          source: "Satya signature check, record on Arkiv",
          weight: 10,
        });
      }
    }
    if (verified === 0) {
      findings.push({
        check: "identity",
        severity: "info",
        title: `No verified proofs for ${name}`,
        detail: "That doesn't mean anything is wrong; they just haven't proven anything with Satya.",
        source: "Arkiv",
        weight: 0,
      });
    }
  }
  return findings;
}

/**
 * Does the brand's own ENS name link back to this site? For example uniswap.eth's "url" record.
 * Only the owner of the ENS name can set that record, so a match is strong, independent proof
 * that this is the real site. Tries "<site name>.eth".
 */
export async function checkSiteEns(host: string, ens: EnsResolver): Promise<Finding[]> {
  const h = host.replace(/^www\./, "").toLowerCase();
  const parts = h.split(".");
  const label = parts.length >= 2 ? parts[parts.length - 2] : undefined;
  if (!label || label.length < 3) return [];
  const name = `${label}.eth`;
  try {
    const url = await ens.text(name, "url");
    if (!url) return [];
    const linked = new URL(/^https?:/.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
    if (linked === h || h.endsWith(`.${linked}`)) {
      return [{
        check: "phishing",
        severity: "good",
        title: `${name} links to this site`,
        detail: `The ENS name ${name} lists ${linked} as its website. Only the name's owner can set that.`,
        source: `ENS record "url" of ${name}`,
        weight: 15,
      }];
    }
  } catch {
    /* no such name or no record */
  }
  return [];
}
