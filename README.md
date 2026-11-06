# Satya

**सत्य: truth. A browser extension that shows whether the website or person in front of
you is real, with reasons and proofs, not guesses.**

AI can fake any face, ID or website. Satya checks the page you're on and shows a
credibility card:

- **Is this site real?** Known phishing lists, lookalike clones of real brands,
  sanctioned wallets (OFAC), fake government and bank domains.
- **What is it saying?** Highlights scam promises ("guaranteed daily returns", "enter your
  seed phrase") and content that may be AI-generated.
- **Is this person real?** If they link an ENS name, Satya shows their zero-knowledge
  proofs (18+, Indian, owns this handle) without any personal data.

Built at **ETHGlobal Mumbai 2026**. Design and build plan: [ARCHITECTURE.md](ARCHITECTURE.md).

## Status

| Part | Status |
|---|---|
| Check engine: phishing / lookalike domains | ✅ |
| Check engine: scam promises (incl. India-specific patterns) | ✅ |
| Check engine: past records (domain age via RDAP, sanctioned wallets) | ✅ |
| Check engine: possibly AI (Pangram or GPTZero, your own key) | ✅ |
| Check engine: page structure (OTP/UPI PIN/seed fields, forms to other sites, APKs), gov/bank domains, certificate type | ✅ |
| MCP server: lets AI agents check links, messages and wallets before acting ([apps/mcp](apps/mcp/README.md)) | ✅ |
| zkTLS proven scam reports (TLSNotary + Arkiv) | 📝 [design](docs/zktls.md) |
| Browser extension side panel + on-page highlights | ✅ |
| Identity: mock DigiLocker issuer, one signed claim per fact (18+, nationality, ID valid) | ✅ |
| Arkiv: proof records owned by the holder, expiring with the credential | ✅ |
| ENS: profile lookup, handle linking, impersonation warnings | ✅ |
| Web app: get verified, link profiles, check anyone, "Verify with Satya" demo | ✅ |
| Identity: Anon Aadhaar (real ZK) | ⏳ |

## Public data used

Every flag shows its source. Satya only uses information that is already public.

| List | Source | License |
|---|---|---|
| ~115,000 phishing domains | [MetaMask eth-phishing-detect](https://github.com/MetaMask/eth-phishing-detect), mirrored on Arkiv by Satya | DBAD |
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

**Only when you click "Run deeper check"** (the panel says exactly what each step sends):
- the site's domain to [rdap.org](https://rdap.org) (when it was registered) and
  [Cert Spotter](https://sslmate.com/certspotter/) (its HTTPS certificates);
- ENS names written on the page to a public Ethereum node (publicnode.com), and the wallet
  addresses they point to, to Arkiv, to load and verify those people's proofs;
- the page's text to Pangram or GPTZero, **only** if you turned on the AI-written-text
  detector in settings (off by default) and gave it your own API key.

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
pnpm data    # download the public lists
pnpm test
pnpm build
```

Web app (identity): copy `apps/web/.env.example` to `apps/web/.env`, then
`pnpm --filter @satya/web dev` and open http://localhost:5173. Publishing proofs needs a
little test GLM from the [Arkiv faucet](https://hub.arkiv.network/faucet).

Load the extension: Chrome → `chrome://extensions` → Developer mode → **Load unpacked** →
select `apps/extension/dist`.

## AI usage disclosure

AI coding assistants were used during this hackathon for scaffolding, boilerplate and code
suggestions. Product design, data choices, integration decisions and testing were done by
the author. (Update this section with specifics before submission, as ETHGlobal requires.)

## License

MIT, see [LICENSE](LICENSE).
