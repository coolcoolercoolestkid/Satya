# Why Arkiv

## If this data sat in Postgres instead, what could people no longer do?

1. **Check a site without telling anyone which site.** Satya's extension asks for one of 256
   hashed buckets and matches on the user's computer. With a Postgres API behind *our* server,
   every lookup would go through us, and we'd hold the browsing history of every user. A safety
   checker would become the perfect tracker. On Arkiv there is no Satya server: the extension
   talks to any Arkiv RPC node, and we never see a request.
2. **Use it without asking us.** No API key from Satya, no sign-up, no rate plan, no terms we can
   change. Anyone can query the records directly (the README has a `curl` you can paste).
3. **Keep using it if we disappear.** Records live on Arkiv, not on our infrastructure. If Satya
   stops tomorrow, the last published lists stay readable until they expire, and anyone holding
   the import script can publish a fresh copy under their own wallet.
4. **Trust who wrote it, and check what they wrote.** Every record is owned by our publisher
   wallet (`0x0D341d00bB9c2327033f447b45Ebb8712521E736`), so nobody can plant entries in our
   registry, and readers filter by owner. Every record also carries the SHA-256 and URL of the
   official file it was built from; `publish-registry verify` rebuilds the buckets from the
   source and compares all 256. A database row has none of that: you'd have to trust our
   server's word.
5. **Old data cleans itself up.** Records expire after 7 days. A stale copy can't linger
   unnoticed: if the import stops running, the registry visibly empties instead of silently
   serving outdated lists.

## What can people do with our copy that they can't do with the original sources today?

| Original source | Today | With Satya's copy on Arkiv |
|---|---|---|
| MetaMask's list | A 3.4 MB JSON file on GitHub. To check one domain, download all of it, or run MetaMask. | Check one domain by fetching ~15 KB for its bucket, privately. Each record links to the exact source file hash it came from. |
| OFAC SDN list | A 30 MB XML file mixing every sanctions type; crypto addresses hidden inside `idList` entries. (The official CSV even truncates them: it had 90 of the 124 ETH addresses.) | 127 Ethereum-format addresses as individual records, filterable by address, programme (`DPRK4`, `CYBER2`…), entity name, entity type and currency. |
| Phishing.Database / Block List Project | Large text files meant for DNS blockers. | Same private bucket lookup as MetaMask's list, under one query, alongside the other lists. |

## What did we keep off Arkiv, and why?

- **The pages people visit.** Never sent anywhere by default; that's the point.
- **Plain-text domain lists.** The phishing lists are stored as SHA-256 hashes in buckets, not as
  readable domains, because the bucket design is what keeps lookups private. (The small OFAC list
  is *also* published as plain records, because there's no privacy cost to looking up a public
  sanctions list by address, and it makes the data far more useful.)
- **Personal data.** People's proofs (`satya_proofs_v1`) hold only a wallet, a claim and a
  zero-knowledge proof; no name, Aadhaar number or birthday ever touches Arkiv.
