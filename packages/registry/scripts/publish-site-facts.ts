/**
 * Records site facts on Arkiv: for each domain, the registration date (RDAP) and first
 * Internet Archive capture, with the source URL, SHA-256 of the raw response and fetch time.
 * Uses the same lookups as the extension's full check (@satya/checks).
 *
 *   pnpm --filter @satya/registry exec tsx scripts/publish-site-facts.ts uniswap.org ens.domains …
 */
import { createWalletClient, ExpirationTime } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { u64 } from "@arkiv-network/sdk/schema";
import { http, isHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { lookupArchiveHistory, lookupDomainAge } from "../../checks/src/records.js";
import { registrableDomain } from "../../checks/src/domain.js";
import { domainHash, lookupSiteFacts, SiteFacts } from "../src/siteFacts.js";

process.loadEnvFile?.(new URL("../.env", import.meta.url));
const key = process.env.SATYA_PUBLISHER_KEY;
if (!key || !isHex(key)) throw new Error("No SATYA_PUBLISHER_KEY in packages/registry/.env");
const account = privateKeyToAccount(key as Hex);
const wallet = createWalletClient({ chain: rabdi({ accessKey: process.env.ARKIV_ACCESS_KEY ?? "" }), transport: http(), account });

const domains = process.argv.slice(2).map((d) => registrableDomain(d.toLowerCase()));
if (!domains.length) throw new Error("Give one or more domains.");
const dateIn = (t?: string) => /\d{4}-\d{2}-\d{2}/.exec(t ?? "")?.[0] ?? "";

for (const domain of domains) {
  const [age, archive] = await Promise.all([lookupDomainAge(domain), lookupArchiveHistory(domain)]);
  if (!age?.proof && !archive?.proof) {
    console.log(`${domain}: no answer from RDAP or the archive, skipped`);
    continue;
  }
  const fetchedAt = Math.floor(Date.now() / 1000);
  const r = await wallet.createEntity(
    SiteFacts,
    {
      domainHash: await domainHash(domain),
      domain,
      registered: dateIn(age?.detail),
      rdapUrl: age?.proof?.url ?? "",
      rdapSha256: age?.proof?.sha256 ?? "",
      firstArchived: archive && !/never captured/.test(archive.title) ? dateIn(archive.detail) : "",
      archiveUrl: archive?.link ?? "",
      archiveSha256: archive?.proof?.sha256 ?? "",
      fetchedAt: u64(BigInt(fetchedAt)),
    },
    { expiration: ExpirationTime.fromDays(30) },
  );
  console.log(`${domain}: registered ${dateIn(age?.detail) || "?"}, first archived ${dateIn(archive?.detail) || "never"} → ${r.entityKey}`);
}

// Read one back the way the extension does.
await new Promise((res) => setTimeout(res, 3000));
const back = await lookupSiteFacts(domains[0]!);
console.log("read back:", back);
