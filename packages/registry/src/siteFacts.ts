/**
 * Recorded site facts on Arkiv: a domain's registration date and first Internet Archive capture,
 * with the exact source URL, the SHA-256 of the raw response and when it was fetched.
 *
 * The extension's full check asks RDAP and the Wayback Machine live. These records let anyone
 * compare that live answer with what Satya recorded earlier, and keep the proof even if a
 * source later changes or goes away. Owned by the publisher wallet, like the blocklists.
 *
 * Looked up only in the full check, by SHA-256 of the domain.
 */
import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { desc, eq } from "@arkiv-network/sdk/query";
import { defineSchema, str, u64 } from "@arkiv-network/sdk/schema";
import { http, type Hex } from "viem";
import { SATYA_PUBLISHER } from "./check.js";

export const SiteFacts = defineSchema("satya_site_facts_v1", {
  /** SHA-256 of the registrable domain, 0x-prefixed. */
  domainHash: str().indexed(),
  domain: str(),
  /** YYYY-MM-DD, or "" when the registry gave none. */
  registered: str(),
  rdapUrl: str(),
  rdapSha256: str(),
  /** YYYY-MM-DD of the first capture, or "" when never archived. */
  firstArchived: str(),
  archiveUrl: str(),
  archiveSha256: str(),
  /** Unix seconds the sources were fetched. */
  fetchedAt: u64().indexed(),
});

export interface SiteFactsRecord {
  key: Hex;
  domain: string;
  registered: string;
  rdapUrl: string;
  rdapSha256: string;
  firstArchived: string;
  archiveUrl: string;
  archiveSha256: string;
  fetchedAt: Date;
}

export async function domainHash(domain: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(domain.toLowerCase()));
  return `0x${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** The newest recorded facts for a domain, from the publisher; undefined when none. */
export async function lookupSiteFacts(domain: string, accessKey = "", publisher: Hex = SATYA_PUBLISHER): Promise<SiteFactsRecord | undefined> {
  const client = createPublicClient({ chain: rabdi({ accessKey }), transport: http() });
  const res = await client
    .select({ $key: true, domain: true, registered: true, rdapUrl: true, rdapSha256: true, firstArchived: true, archiveUrl: true, archiveSha256: true, fetchedAt: true })
    .from(SiteFacts)
    .where(eq("domainHash", await domainHash(domain)))
    .ownedBy(publisher)
    .orderBy(desc("fetchedAt"))
    .limit(1)
    .fetch();
  const r = res.entities[0];
  if (!r) return undefined;
  const v = (x: unknown) => String((x as { value?: unknown })?.value ?? x);
  return {
    key: r.$key as Hex,
    domain: v(r.domain),
    registered: v(r.registered),
    rdapUrl: v(r.rdapUrl),
    rdapSha256: v(r.rdapSha256),
    firstArchived: v(r.firstArchived),
    archiveUrl: v(r.archiveUrl),
    archiveSha256: v(r.archiveSha256),
    fetchedAt: new Date(Number(v(r.fetchedAt)) * 1000),
  };
}
