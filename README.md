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
| Check engine: phishing / clone | 🚧 |
| Check engine: scam promises | 🚧 |
| Check engine: past records (domain age) | 🚧 |
| Check engine: possibly AI | 🚧 |
| Browser extension side panel | 🚧 |
| Identity proofs (Anon Aadhaar, mock DigiLocker) | ⏳ |
| Arkiv records, ENS lookups | ⏳ |

## Run it

Requires Node ≥ 22 and pnpm.

```bash
pnpm install
pnpm test
pnpm build
```

Load the extension: Chrome → `chrome://extensions` → Developer mode → **Load unpacked** →
select `apps/extension/dist`.

## AI usage disclosure

AI coding assistants were used during this hackathon for scaffolding, boilerplate and code
suggestions. Product design, data choices, integration decisions and testing were done by
the author. (Update this section with specifics before submission, as ETHGlobal requires.)

## License

MIT, see [LICENSE](LICENSE).
