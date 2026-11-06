# Reach

## How many people and projects already depend on this data?

Satya mirrors public safety lists that the Ethereum ecosystem already runs on. Numbers below were
pulled on 6 Nov 2026 from GitHub and npm.

| List (source id) | Who depends on it today | Numbers |
|---|---|---|
| **MetaMask eth-phishing-detect** (`metamask-phishing`) | MetaMask itself: the wallet shows a full-page warning when a user visits any domain on this list. Other wallets and dapps reuse it through the npm packages. | 1,349 GitHub stars, 1,129 forks. `@metamask/phishing-controller` (ships the list into wallets): **275,941 npm downloads in the last month**. `eth-phishing-detect`: 97,531. |
| **US Treasury OFAC SDN list**, Ethereum-format addresses (`ofac-sdn`) | Every compliant exchange, wallet, RPC provider and front end that must refuse sanctioned addresses (Tornado Cash, Lazarus Group and DPRK-linked wallets…). | 127 Ethereum-format addresses (ETH and USDT) from the official SDN.XML. The best-known community extract, 0xB10C's, has 179 stars and 45 forks. |
| **Phishing.Database** (`phishing-database`) | Ad and DNS blockers (Pi-hole, AdGuard lists) and security tools. | 1,636 stars; 391,557 active phishing domains. |
| **Block List Project** fraud / scam / ransomware / piracy (`blp-*`) | Pi-hole and DNS filtering users. | 5,174 stars, 440 forks; 268,769 domains across the four lists. |

## Who would use our copy on Arkiv after Mumbai, and for what?

1. **Satya's users.** The Satya browser extension reads these records on every page a user
   opens, to warn them about phishing sites and sanctioned wallets **without sending the site's
   address anywhere**: it asks Arkiv for one of 256 hashed buckets and matches locally. That is
   the main reader today, and it works in the extension now.
2. **AI agents.** Satya's MCP server lets an agent (Claude, Cursor, agent frameworks) check a link
   or wallet before it opens or pays. Agents increasingly act for users; they need a source they
   can query without an account or API key.
3. **Wallets and dapp front ends** that want a sanctions or phishing check without signing up for
   a compliance API or shipping a 3 MB list. One query by address:
   `satya_sanctioned_address_v1` with `address = addr(0x…)`.
4. **Researchers and journalists** who want the OFAC crypto list as structured, filterable records
   (by programme such as `DPRK4` or `CYBER2`, by entity name, by currency) instead of a 30 MB XML
   file.
5. **Other safety tools** that want to show "this domain is on MetaMask's list" with a verifiable
   record and source-file hash, instead of trusting a third party's API.

## Can people use it today, and will it keep going?

- **Yes, today.** Load the extension (README → Run it) and open any site; the "How this was
  checked" section links the exact Arkiv records it read. Or run the `curl` query in the README.
- **It stays current.** `publish-registry refresh` re-downloads every list and re-publishes only
  what changed or is due, and `.github/workflows/arkiv-refresh.yml` runs it daily. See
  [data-quality.md](data-quality.md).
- **After Mumbai** we plan to keep the registry running, add more Ethereum-specific lists (scam
  token lists, drainer contract addresses) where their licences allow it, and apply for a
  production Arkiv access key.
