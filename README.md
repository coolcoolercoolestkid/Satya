# Satya

**सत्य: truth. A browser extension that shows whether the website or person in front of
you is real, with reasons and proofs, not guesses.**

AI can fake any face, ID or website. Satya checks the page you're on and shows a
credibility card:

- **Is this site real?** Known phishing lists, lookalike clones of real brands, government
  fraud lists (RBI Alert List), sanctioned wallets (OFAC).
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
| ~115,000 phishing domains | [MetaMask eth-phishing-detect](https://github.com/MetaMask/eth-phishing-detect) | DBAD |
| Sanctioned Ethereum addresses | US Treasury OFAC SDN list, extracted by [0xB10C/ofac-sanctioned-digital-currency-addresses](https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses) | Public domain / MIT |
| Unauthorised forex platforms | RBI Alert List (partial, curated in `scripts/import/rbi-alert-list.json`) | Public government notice |
| Domain registration dates | [RDAP](https://rdap.org) | Public registry data |

For real people, Satya only shows proofs they created or public lists they appear on. It
never labels a real person on its own judgment.

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
