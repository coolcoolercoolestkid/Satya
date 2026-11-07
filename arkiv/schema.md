# Satya's Arkiv records

Satya stores five kinds of records on **Arkiv Rabdi testnet** (chain ID 7794095,
RPC `https://rpc.rabdi.db-chain.testnet.arkiv.network`, explorer
`https://rabdi.explorer.arkiv.network`). All are written through `defineSchema` from
`@arkiv-network/sdk`, so every entity carries the attribute `arkiv.schema` with the schema's
name.

## 1. `satya_scam_bucket_v1`: the public scam registry

Public scam and sanctions lists, hashed and split into 256 buckets so the extension can check a
site without telling anyone which site it is.

- **Owner:** Satya's publisher wallet `0x0D341d00bB9c2327033f447b45Ebb8712521E736`. Readers only
  accept records owned by this wallet, so nobody else can plant entries.
- **How many:** 256 records per source per publish run (one per bucket, empty buckets included,
  so "no match" is an answer, not a missing record).
- **Expiry:** 7 days (`ExpirationTime.fromDays(7)`). The publisher is re-run before that.
- **Code:** [`packages/registry/src/index.ts`](../packages/registry/src/index.ts), publisher in
  [`packages/registry/scripts/publish.ts`](../packages/registry/scripts/publish.ts).

| Attribute | Type | Indexed | Meaning |
|---|---|---|---|
| `type` | str | yes | `"domain"` or `"address"` |
| `source` | str | yes | Source id, e.g. `"metamask-phishing"`, `"ofac-sdn"`, `"phishing-database"`, `"blp-scam"` (table below) |
| `bucket` | str | yes | Two lowercase hex characters, `"00"` to `"ff"` |
| `date` | str | yes | Publish date, `YYYY-MM-DD` (UTC) |
| `published` | u64 | yes | Publish time in unix seconds; all 256 records of one run share it. Readers take the newest per source. |
| `sourceSha256` | str | no | SHA-256 of the exact source file that run read |
| `sourceUrl` | str | no | Where that file was downloaded from |
| `count` | u64 | no | Number of hashes in this bucket |
| `hashes` | bytes | no | Sorted 32-byte SHA-256 hashes, concatenated |

**Hashing and buckets**

- An entry is normalised (lowercase; domains without a trailing dot or `www.`) and hashed with
  plain SHA-256, so anyone can reproduce it: `sha256("openmsea.io")`.
- **Addresses** go in the bucket given by the first byte of their own hash.
- **Domains** go in the bucket of their *site*: the registrable domain (`login.evil.com` →
  `evil.com`), or, on shared hosts such as `pages.dev`, `netlify.app` or `vercel.app`, one label
  under the host (`scam.pages.dev`; 85 hosting, dynamic-DNS and IPFS-gateway services are
  treated this way). So one bucket lookup covers a site and all its subdomains. The record stores the hash of each full listed entry.
- The extension hashes the visited host and each parent up to the site, and checks those
  hashes against the bucket on the user's computer.

**Sources and licences**

| Source id | List | Licence | Entries (6 Nov 2026) |
|---|---|---|---|
| `metamask-phishing` | [MetaMask eth-phishing-detect](https://github.com/MetaMask/eth-phishing-detect) `blacklist`, minus anything on its `whitelist` | DBAD 1.2 (reuse allowed with attribution) | 115,817 domains |
| `ofac-sdn` | US Treasury OFAC SDN list, official [`SDN.XML`](https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML): every Ethereum-format (`0x…`) digital currency address | US government work, public domain | 127 addresses |
| `phishing-database` | [Phishing.Database](https://github.com/mitchellkrogza/Phishing.Database) `phishing-domains-ACTIVE.txt` | MIT | 391,557 domains |
| `blp-fraud` | [Block List Project](https://github.com/blocklistproject/Lists) fraud list | MIT (list header), repo Unlicense | 256,184 domains |
| `blp-scam` | Block List Project scam list | same | 8,527 domains |
| `blp-piracy` | Block List Project piracy list (shown as a mild warning, not a danger) | same | 2,154 domains |
| `blp-ransomware` | Block List Project ransomware list | same | 1,904 domains |

Not included: the **RBI Alert List** (RBI's terms forbid copying its contents), **URLhaus**
(downloads now need an abuse.ch account key, with paid terms for commercial use), and the Block
List Project **malware** list (about 2 million domains; too large for 128 KB records without a
record-splitting scheme).

Run manifests with all 256 entity keys per source are in
[`packages/registry/runs/`](../packages/registry/runs/).

**Verify it yourself**

```bash
pnpm --filter @satya/registry publish-registry verify ofac      # rebuilds from the official file, compares all 256 buckets
pnpm --filter @satya/registry publish-registry lookup openmsea.io
```

## 2. `satya_proofs_v1`: proofs about people

One record per proven fact about a person (for example "18+"). No personal data: only the
holder's wallet, which fact, who vouched for it, and the proof itself.

- **Owner:** the holder's own wallet. They publish it from the web app with their browser
  wallet, and readers only accept records whose owner is the `holder`.
- **Expiry:** signed attestations expire when the credential does; Anon Aadhaar proofs live for
  Arkiv's maximum (about 6 months), since the proof itself doesn't expire.
- **Code:** [`packages/identity/src/arkiv.ts`](../packages/identity/src/arkiv.ts).

| Attribute | Type | Indexed | Meaning |
|---|---|---|---|
| `holder` | addr | yes | The wallet the fact is about |
| `claim` | str | yes | `age_over_18`, `nationality` or `id_valid` |
| `issuer` | addr | yes | Who vouched: the demo DigiLocker key, or `0x…aada` for Anon Aadhaar |
| `kind` | str | yes | `"attestation"` (EIP-712 signed claim) or `"anon-aadhaar"` (zero-knowledge proof) |
| `payload` | bytes | no | The signed attestation or serialized Anon Aadhaar proof (JSON, UTF-8) |
| `nullifier` | str | yes, optional | Anon Aadhaar only. The same for one card every time it proves for Satya, unrelated to the Aadhaar number. Lets anyone see that one card verified more than one wallet; Satya only counts the first. |

Every reader re-verifies the payload: signatures for attestations; for Anon Aadhaar, the
zero-knowledge proof, that it was made for Satya (nullifier seed) and for this wallet (signal).
Proofs are only accepted for publishing if the Aadhaar QR was signed in the last 3 days.

## 3. `satya_evidence_v1`: scam evidence fingerprints

When someone clicks **Save evidence** in the extension, the page's text, a screenshot and
Satya's findings go into a file on their computer. The file's header holds SHA-256 hashes of the
text and screenshot, and the SHA-256 of the canonical header (keys sorted) is the
**fingerprint**. Only the fingerprint is stored on Arkiv: no URL, no content.

- **Owner:** whoever anchored it, from the web app's **Scam evidence** tab with their wallet.
- **Expiry:** Arkiv's maximum (about 6 months).
- **Code:** [`packages/checks/src/evidence.ts`](../packages/checks/src/evidence.ts) (file format and
  hashing), [`packages/identity/src/arkiv.ts`](../packages/identity/src/arkiv.ts) (record).

| Attribute | Type | Indexed | Meaning |
|---|---|---|---|
| `fingerprint` | str | yes | 64 hex characters: SHA-256 of the evidence file's canonical header |
| `kind` | str | yes | `"page"` |

Checking a file: recompute the text and screenshot hashes, then the fingerprint, then look up
records with that fingerprint. The oldest record's block time is when the file was proven to
exist, unchanged. It doesn't prove the website served it (that would need zkTLS).

## 4. `satya_sanctioned_address_v1`: OFAC addresses, one record each

The OFAC list is small, so besides the private hashed buckets it's also mirrored as one plain
record per address that anyone can filter directly. (Looking up a public sanctions list by
address costs no privacy.)

- **Owner:** Satya's publisher wallet `0x0D341d00bB9c2327033f447b45Ebb8712521E736`.
- **Expiry:** 7 days; renewed by `publish-registry refresh`.
- **Source:** official OFAC `SDN.XML`; every `Digital Currency Address` whose value is a `0x…`
  Ethereum-format address (ETH and USDT), 127 records.

| Attribute | Type | Indexed | Meaning |
|---|---|---|---|
| `address` | addr | yes | The sanctioned address |
| `list` | str | yes | `"ofac-sdn"` |
| `name` | str | yes | Name on the SDN entry (person or organisation), up to 120 bytes |
| `sdnType` | str | yes | `"Entity"` or `"Individual"` |
| `program` | str | yes | First sanctions programme, e.g. `DPRK4`, `CYBER2` |
| `programs` | str | no | All programmes, comma-separated |
| `currency` | str | yes | Currency OFAC listed it under: `ETH` or `USDT` |
| `sdnUid` | str | yes | OFAC's id for the SDN entry |
| `date` | str | yes | Publish date `YYYY-MM-DD` |
| `published` | u64 | yes | Publish time (unix seconds), shared by one run |
| `sourceSha256` | str | no | SHA-256 of the SDN.XML it came from |

Example filters: `address = addr(0x…)`, `program = str('DPRK4')`, `currency = str('USDT')`,
always with `$owner = addr(0x0D341d00bB9c2327033f447b45Ebb8712521E736)`.

## 5. `satya_identity_v1`: verified people, searchable

Written by **Aletheia** ([apps/aletheia](../apps/aletheia/README.md)) when someone publishes the
record the mock DigiLocker issued them. Owned by the person's wallet; expires with their ID
(capped at Arkiv's maximum lifetime).

| Attribute | Type | Indexed | What |
|---|---|---|---|
| `holder` | addr | ✓ | The wallet the record is about |
| `name` | str | | Name as signed by the issuer (public by design) |
| `nameKey` | str | ✓ | Lower-case, single-spaced name, for exact search |
| `docHash` | str | ✓ | SHA-256 of the document file shown to the issuer (the file itself is never stored) |
| `docType` | str | | e.g. "Aadhaar card", "Passport" |
| `issuer` | addr | ✓ | Issuer's signing address (mock DigiLocker: `0x48D4…9BaB`) |
| `published` | u64 | ✓ | Unix seconds; newest first in listings |
| payload | bytes | | The signed record (EIP-712 "Satya Identity": holder, name, docType, docHash, claims, issuedAt, expiresAt) |

**Queries** (all in [packages/identity/src/identityRecord.ts](../packages/identity/src/identityRecord.ts)):
by `nameKey`, by `holder`, by `docHash`, or the most recent (`ORDER BY published DESC`).
Arkiv answers them directly; there is no indexer or subgraph.

**Why nobody can fake one:** a result only counts if the record is owned by the wallet it names
and the payload's signature recovers to a trusted issuer. Both are checked in the reader's browser.

**Live record:** fictional resident Asha Verma, bound to the publisher wallet
`0x0D341d00bB9c2327033f447b45Ebb8712521E736`, published with
`packages/registry/scripts/publish-identity.ts` (the same issue/publish code the site uses).
