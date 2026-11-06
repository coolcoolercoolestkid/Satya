# Satya

**सत्य: truth. "Can I trust what's in front of me?", answered with reasons and proofs, not
guesses.**

AI can fake any face, ID or website. Satya is a browser extension plus a web app that works
in two directions:

1. **Websites.** Open any site and the Satya side panel scores it 0 to 100. Every point lost
   comes with a reason and a source: known phishing sites and sanctioned wallets (from a public
   registry Satya mirrors on Arkiv), lookalike clones of real brands, fake government or bank
   domains, scam wording ("guaranteed daily returns", "KYC pending, account blocked today"),
   pages asking for your OTP, UPI PIN, card or seed phrase, forms that send what you type to
   another site, and fake app downloads. Scam sentences are highlighted on the page itself.
2. **People.** Anyone can prove a fact such as "18+" with an **Anon Aadhaar** zero-knowledge
   proof (no Aadhaar number, name or birthday revealed), tied to their wallet, stored on
   **Arkiv** and linked to their **ENS** name. When a page shows that ENS name, Satya shows the
   verified proofs, and warns if a profile claims an ENS name that points to someone else.

It is **private by default**: until you choose otherwise, the only thing that leaves your browser
is a two-character bucket id. On first open Satya asks once whether to run full checks
automatically, and says exactly which services would see the site's name (see [CROPS](#crops-a-checker-that-learns-nothing-about-your-browsing)).

Built at **ETHGlobal Mumbai 2026**. Design notes: [ARCHITECTURE.md](ARCHITECTURE.md).

## Status

| Part | Status |
|---|---|
| Extension side panel: score, reasons with sources, on-page highlights | ✅ |
| Checks: lookalike domains, scam wording incl. India-specific scams, risky forms and fields, gov/bank domain rules, fake app downloads | ✅ (run locally) |
| **Arkiv public scam registry**: MetaMask phishing list + OFAC sanctioned wallets, hashed into 256 buckets, private lookup | ✅ live on Rabdi testnet, verified 256/256 buckets per list |
| Deeper check on request: domain age (RDAP), HTTPS certificate type (Cert Spotter), ENS identity and proofs | ✅ |
| AI content, shown separately and never part of the trust score. Images: reads Content Credentials (C2PA) labels, e.g. "made by AI", "camera photo", "label broken", with the official C2PA SDK running inside the extension | ✅ in the deeper check; tested in a browser on official C2PA test images |
| Identity: demo DigiLocker issuer (EIP-712 signed claims), proofs on Arkiv owned by the holder | ✅ |
| Identity: Anon Aadhaar 18+ proof, fresh-QR rule (3 days), one wallet per card (nullifier on Arkiv) | ✅ real TEST-data proof made, published to Arkiv and read back verified ([record](https://rabdi.explorer.arkiv.network/entity/0x2bc7745c1a37db51b75f81b50a084a828719aaab9a00eed8a4459d8a0d2c2afd)); proving inside the browser not yet timed |
| **Scam evidence**: Save a page (text, screenshot, findings) to a file; anchor only its SHA-256 fingerprint on Arkiv; anyone can later check the file is unchanged and when it was anchored | ✅ file check tested in a browser; extension capture not yet tried in Chrome |
| ENS: profile lookup, handle linking, impersonation warnings | ✅ |
| MCP server: lets AI agents check links, messages and wallets before acting ([apps/mcp](apps/mcp/README.md)) | ✅ |
| zkTLS proven scam reports (TLSNotary + Arkiv) | 📝 [design only](docs/zktls.md) |

## How the score works

The score is the **amount of trust the evidence supports**, from 0 to 100. Every point comes
from a line on the receipt, with its source.

1. **An unknown site starts at 50**: no evidence either way. (It used to start at 100, which made
   every unknown site look perfect.)
2. **Trust evidence adds points**, only from things a scammer can't easily fake: an official
   brand domain or `.gov.in` / `.bank.in` (+45); a domain registered years ago (+8 to +25 by
   age); a company-verified OV/EV certificate (+10/+15); a long Internet Archive history (+3 to
   +10).
3. **Risk evidence takes points away**: scam wording, extortion and scareware, requests for an
   OTP / UPI PIN / seed phrase, forms sending data elsewhere, crypto miners, hidden frames,
   scrambled code, drive-by downloads, a brand-new domain or certificate, and so on.
4. **Decisive evidence overrides the sum.** On a phishing, scam, fraud, ransomware or sanctions
   list: at most 5. Impersonating a known brand: at most 15. Any other danger: at most 35. An
   official domain with no danger: at least 90.
5. **Bands:** 75+ *Looks trustworthy* · 45–74 *No red flags / Probably fine / Mixed signals* ·
   25–44 *Be careful* · below 25 *High risk*.
6. **AI content and people's proofs are shown but don't move the score**: AI-made content isn't a
   scam by itself.

The panel shows the whole calculation as a chart: the starting 50, every finding's points as a
bar, any rule that overrode the sum, and the result. It also shows a **confidence** label (how many
independent signals the score rests on), so a 50 with no evidence is labelled *low confidence*
instead of looking like a verdict.

The quick (private) check can only catch scams, not vouch for a site, so with it most unknown sites
stay at **50**. The **full check** (asked once, then automatic; also one click on the panel) adds
domain age, certificates, archive history and the brand's ENS name, which is what moves a real
site up. Sites on shared hosts (vercel.app, github.io…) stay at 50 by design: the host's age and
certificate say nothing about who made that one site.

How well this separates real sites from phishing sites is measured, not assumed: see
[docs/evaluation.md](docs/evaluation.md).

## Satya on Arkiv

Satya **mirrors public scam lists that Ethereum users depend on** (MetaMask's phishing list,
which wallets use to block drainer sites, the US Treasury's sanctioned-wallet list, and open
phishing, fraud, scam, ransomware and piracy lists) onto Arkiv, in a form anyone can read
without revealing what they're checking. Sources and licences: [arkiv/schema.md](arkiv/schema.md).

- **Publisher wallet:** `0x0D341d00bB9c2327033f447b45Ebb8712521E736`
  ([explorer](https://rabdi.explorer.arkiv.network/address/0x0D341d00bB9c2327033f447b45Ebb8712521E736))
- **Network:** Arkiv Rabdi testnet, chain ID 7794095
- **Records:** 256 per source, 7-day expiry, attributes and hashing in [arkiv/schema.md](arkiv/schema.md)
- **Problems we hit:** [arkiv/friction.md](arkiv/friction.md)

**Fetch a live bucket yourself** (no install, no key). This asks for bucket `3f`, exactly
what the extension sends:

```bash
curl -s https://rpc.rabdi.db-chain.testnet.arkiv.network -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":["arkiv.schema = str('"'"'satya_scam_bucket_v1'"'"') AND bucket = str('"'"'3f'"'"') AND $owner = addr(0x0D341d00bB9c2327033f447b45Ebb8712521E736) ORDER BY published:u64 DESC",{"select":{"key":true,"expiresAt":true,"attributes":{"source":true,"bucket":true,"date":true,"count":true,"sourceSha256":true,"sourceUrl":true}},"limit":"0x4"}]}'
```

It returns the newest record per source for that bucket: source, date, number of hashes,
and the SHA-256 and URL of the source file it was built from.

**Look up a sanctioned wallet directly** (OFAC is also mirrored as one plain record per address):

```bash
curl -s https://rpc.rabdi.db-chain.testnet.arkiv.network -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":["arkiv.schema = str('"'"'satya_sanctioned_address_v1'"'"') AND address = addr(0x0330070fd38ec3bb94f58fa55d40368271e9e54a) AND $owner = addr(0x0D341d00bB9c2327033f447b45Ebb8712521E736)",{"select":{"key":true,"attributes":{"name":true,"program":true,"sdnType":true,"currency":true,"date":true}},"limit":"0x5"}]}'
```

→ `AMNOKGANG TECHNOLOGY DEVELOPMENT COMPANY · DPRK4 · Entity · ETH`. Swap the address filter
for `program = str('DPRK4')` to list every address under one sanctions programme. If the public
endpoint answers `ANON_COST_LIMITED`, wait a minute or use an Arkiv access key.

Judging write-ups: [reach](arkiv/reach.md) · [why Arkiv](arkiv/why-arkiv.md) ·
[data quality](arkiv/data-quality.md) · [schema](arkiv/schema.md) · [friction](arkiv/friction.md).

**Check a domain or wallet the way the extension does, and verify the registry against the
official lists** (after `pnpm install`):

```bash
pnpm --filter @satya/registry publish-registry lookup openmsea.io
pnpm --filter @satya/registry publish-registry verify ofac
```

People's proofs (`satya_proofs_v1`) are owned by each person's own wallet and expire with the
credential; see [arkiv/schema.md](arkiv/schema.md).

## Public data used

Every flag shows its source. Satya only uses information that is already public.

| List | Source | License |
|---|---|---|
| ~115,000 phishing domains | [MetaMask eth-phishing-detect](https://github.com/MetaMask/eth-phishing-detect), mirrored on Arkiv by Satya | DBAD |
| ~392,000 active phishing domains | [Phishing.Database](https://github.com/mitchellkrogza/Phishing.Database), mirrored on Arkiv by Satya | MIT |
| Fraud, scam, ransomware and piracy domains (~269,000) | [Block List Project](https://github.com/blocklistproject/Lists), mirrored on Arkiv by Satya | MIT / Unlicense |
| Sanctioned Ethereum addresses | US Treasury OFAC SDN list (official `SDN.XML`), mirrored on Arkiv by Satya. The extension's offline fallback copy comes from [0xB10C/ofac-sanctioned-digital-currency-addresses](https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses) | Public domain / MIT |
| Domain registration dates (deeper check only) | [RDAP](https://rdap.org) | Public registry data |
| HTTPS certificate history (deeper check only) | [Cert Spotter](https://sslmate.com/certspotter/) | Public CT logs |

For real people, Satya only shows proofs they created or public lists they appear on. It
never labels a real person on its own judgment.

The RBI Alert List is **not** included: RBI's website terms forbid copying or caching its
contents without written permission.

## CROPS: a checker that learns nothing about your browsing

A safety checker sees every site you visit, which makes it a perfect tracker. Satya is built
so that no server, including ours (we don't have one), can rebuild your browsing history.

**What the extension sends when a page opens, by default:** one request to Arkiv asking for a
**bucket id**, two hex characters such as `3f`. The bucket id is the first byte of the
SHA-256 hash of the site's domain, so it stands for 1/256 of all websites. Arkiv sends back
every hashed entry in that bucket, and the extension checks for a match **on your computer**.
Buckets are cached for 6 hours, so revisiting sites in the same bucket sends nothing at all.
If the page shows wallet addresses, the same is done for up to 5 of them.

**What it never sends by default:** the page's address, its domain, its title, its text,
your wallet, or anything you type. All other checks (lookalike domains, scam wording, risky
forms, gov/bank domain rules) run locally against rules and lists shipped with the extension.

**Only when you turn on full checks, or click "Run full check"** (the panel says exactly what each step sends):
- the site's domain to [rdap.org](https://rdap.org) (when it was registered) and
  [Cert Spotter](https://sslmate.com/certspotter/) (its HTTPS certificates);
- ENS names written on the page to a public Ethereum node (publicnode.com), and the wallet
  addresses they point to, to Arkiv, to load and verify those people's proofs;
- the page's larger images (up to 8) are fetched again from the sites that served them, mostly
  from the browser cache and without cookies, to read their Content Credentials on your
  computer;
- nothing is ever sent to an AI-detection service. AI-written text isn't scored, because no
  detector that runs without an outside account is accurate enough to show a percentage.

**No analytics, no trackers, no accounts.** The extension and web app load no third-party
scripts or fonts.

**Why no server can rebuild your history:** each lookup reveals only a bucket shared with
about 1/256 of all domains, and repeat lookups are cached. To learn which site you visited, an
observer would have to guess among every domain in that bucket, which for the open web is
millions of sites. Every record's owner is Satya's publisher wallet, and anyone can re-run
`verify` against the official source lists, so you don't have to trust us either.

**Proofs about people** follow the same idea: Anon Aadhaar proves "18+" without revealing
the Aadhaar number, name or birthday. Satya only accepts a QR code signed in the last 3 days
(a fresh one needs an OTP to the card owner's phone), and each card counts for one wallet:
the proof's nullifier is stored on Arkiv, so a card that already verified another wallet is
flagged.

The [MCP server](apps/mcp/README.md) is different by design: an AI agent asks it to check a
specific link, so it loads that link. It runs on your own computer.

## Run it

Requires Node ≥ 22 and pnpm.

```bash
pnpm install
pnpm data    # download the offline fallback copies of the public lists
pnpm test
pnpm build
```

- **Extension:** Chrome → `chrome://extensions` → Developer mode → **Load unpacked** →
  select `apps/extension/dist`. Pin Satya and click it to open the side panel.
- **Web app (identity):** copy `apps/web/.env.example` to `apps/web/.env`, then
  `pnpm --filter @satya/web dev` and open http://localhost:5173. Publishing proofs needs a
  little test GLM from the [Arkiv faucet](https://hub.arkiv.network/faucet).
- **Demo scam pages** (local only, clearly labelled, forms send nothing): `pnpm demo`, then
  open http://localhost:5180.
- **Republish the registry** (needs a funded key in `packages/registry/.env`):
  `pnpm --filter @satya/registry publish-registry publish ofac` (and `metamask`).

## Built with Claude Code

Satya was built with help from **Claude Code** (Anthropic's AI coding assistant). It:

- wrote most of the TypeScript code (check engine, extension, web app, Arkiv registry and
  publisher, MCP server) and the tests, from our instructions;
- researched data sources and their licences (and flagged the RBI list as not reusable),
  Arkiv's SDK and limits, and the Anon Aadhaar library;
- drafted this README, `arkiv/schema.md`, `docs/zktls.md` and the demo pages, and logged
  `arkiv/friction.md` as problems happened.

We decided what to build and for whom, chose the sponsors and data sources, set the rules
(private by default, every finding has a source, never label a real person, never fake a
working feature), funded the publisher wallet, and reviewed and tested the results.

## License

MIT, see [LICENSE](LICENSE).
