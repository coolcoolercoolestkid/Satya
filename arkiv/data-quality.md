# Data quality

## Is the data correct?

Every list on Arkiv was rebuilt from its official source and compared bucket by bucket with
`publish-registry verify`, which downloads the source, recomputes all 256 buckets and compares
them with what Arkiv returns (6 Nov 2026). **All 7 lists: 1,792 of 1,792 buckets match.**

| Source id | Entries | Verify result |
|---|---|---|
| `ofac-sdn` | 127 addresses | 256/256 buckets match |
| `metamask-phishing` | 115,817 domains | 256/256 buckets match |
| `phishing-database` | 391,557 domains | 256/256 buckets match |
| `blp-fraud` | 256,184 domains | 256/256 buckets match |
| `blp-scam` | 8,527 domains | 256/256 buckets match |
| `blp-piracy` | 2,154 domains | 256/256 buckets match |
| `blp-ransomware` | 1,904 domains | 256/256 buckets match |

Each record stores the **SHA-256 and URL of the exact source file** it was built from, so anyone
can re-run `verify` against the same file, or against today's file to see what changed.

Things we fixed so the copy is faithful:
- **OFAC:** we use the official `SDN.XML`, not the official CSV. The CSV truncates long entries
  and silently dropped 34 of the 124 ETH addresses; the XML has all of them. We include every
  `0x…` digital currency address (ETH and USDT), 127 in total.
- **MetaMask:** domains on MetaMask's own allowlist are removed from the blocklist, as MetaMask
  itself does.
- **Shared hosts:** 85 hosting, dynamic-DNS and gateway services (`pages.dev`, `*.r.appspot.com`, IPFS
  gateways…) are treated as public suffixes, so `scam.pages.dev` is matched as its own site,
  without flagging `pages.dev` itself.
- **Licences:** we left out lists we may not republish (RBI's Alert List, URLhaus); see
  [schema.md](schema.md).

## Is it up to date, and how does the import keep it that way?

- Records **expire after 7 days**, so nothing stale can linger.
- `pnpm --filter @satya/registry publish-registry refresh` downloads every official list and
  **re-publishes only those whose source file changed or whose records are due** (older than
  4 days). Unchanged lists cost nothing.
- [`.github/workflows/arkiv-refresh.yml`](../.github/workflows/arkiv-refresh.yml) runs that every
  day at 07:00 IST, using the publisher key as a repository secret.
- Readers always take the **newest record per source and bucket**, so a refresh that stops
  halfway never mixes old and new data inside one bucket.
- Freshness is visible: every record has `date` and `published`; the extension shows the date
  next to each record it read.

Honest limits: the sources themselves update at their own pace (MetaMask several times a day,
Phishing.Database's active list was last regenerated on 2 Oct 2026), so our copy is at most a day
behind its source, plus however far behind the source is.

## Can people filter it the way they actually search for it?

People search these lists in two ways, and each has its own shape on Arkiv:

**"Is this wallet sanctioned?" / "Which wallets does programme X cover?"**: plain records,
filter by any field:

```bash
# One address
curl -s https://rpc.rabdi.db-chain.testnet.arkiv.network -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":["arkiv.schema = str('"'"'satya_sanctioned_address_v1'"'"') AND address = addr(0x0330070fd38ec3bb94f58fa55d40368271e9e54a) AND $owner = addr(0x0D341d00bB9c2327033f447b45Ebb8712521E736)",{"select":{"key":true,"attributes":{"name":true,"program":true,"sdnType":true,"currency":true,"date":true}},"limit":"0x5"}]}'

# Every DPRK-programme address: replace the address filter with  program = str('DPRK4')
```

**"Is this site on a phishing list?"**: private bucket lookup. You hash the site, ask for its
bucket, and match locally, which is what the extension does. In one command:

```bash
pnpm --filter @satya/registry publish-registry lookup openmsea.io
# domain openmsea.io → bucket 09 (the only thing sent to Arkiv)
#   MATCH: openmsea.io is on MetaMask eth-phishing-detect
```

Bucket records can also be filtered by `source`, `type`, `date` and `published`, e.g. "all
records of today's MetaMask run".

The trade-off is deliberate: domains are hashed so that checking a site doesn't reveal it. A
plain `domain = str('…')` filter would be easier to use, but every such query would tell the RPC
node which site you're visiting.
