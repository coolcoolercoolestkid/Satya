# Satya: handoff notes

For Claude (or anyone) picking this up on another computer. Last updated: 6 Nov 2026.

## What this is

**Satya** (सत्य, "truth") is an ETHGlobal Mumbai 2026 hackathon project, built solo.
**Submission deadline: Sat 7 Nov 2026, 09:00 AM IST.**

A Chrome extension whose side panel tells you whether the website or person in front of you is
real, with a score out of 100 and the reason and source for every point lost. A web app lets
people prove facts about themselves (18+, nationality, ID valid) without showing documents.

- **Partner prizes targeted:** ENS, Arkiv, Ethereum Foundation (CROPS). Chainlink CCIP only if time is left.
- **Pitch:** "AI can fake any face, ID or website. Satya shows proof of what's real, not a guess."
- Full design: [ARCHITECTURE.md](ARCHITECTURE.md). Run instructions: [README.md](README.md).

## Repo layout

| Path | What |
|---|---|
| `packages/checks` | Check engine: phishing/lookalike domains, scam-text rules, page structure, gov/bank domain rules, domain age (RDAP), TLS certificate type (Cert Spotter), sanctioned wallets, AI-text detectors (Pangram, GPTZero), scoring |
| `packages/identity` | Mock DigiLocker issuer (EIP-712 signed claims), Anon Aadhaar (ZK), Arkiv proof records, ENS profile + impersonation checks |
| `apps/extension` | Chrome MV3 extension (esbuild). Side panel, content script, on-page highlights |
| `apps/web` | Vite + React app: Get verified, Aadhaar (ZK), Link profiles, Check anyone, Verify with Satya demo store |
| `scripts/import` | `build-data.mjs` downloads public lists; `make-test-aadhaar.mjs` makes Anon Aadhaar test cards |

## Status

**Done and tested** (36 unit tests pass: `pnpm test`):
- Phishing / lookalike / brand-claim detection; MetaMask's ~115k phishing domains; OFAC wallets; RBI Alert List (partial).
- Scam-text rules incl. India-specific: KYC threats, electricity cut-off, digital arrest, task jobs, fake discounts, personal UPI payments, lottery, tech-support.
- Page structure: secrets over HTTP, forms submitting to another domain, OTP/CVV/UPI PIN/Aadhaar/PAN/seed-phrase fields, 12/24-input seed grids, APK/EXE downloads, free hosting, IP hosts.
- `.gov.in`/`.nic.in` and RBI's `.bank.in` rules; TLS certificate DV vs OV/EV and brand-new certificates.
- Identity: mock DigiLocker claims, Arkiv records (owned by holder, expire with credential), ENS lookups (live-tested), impersonation warnings, Anon Aadhaar verify + in-browser prove (code done).
- Extension and web app build and typecheck. Web app renders with no console errors.

**Not yet verified:**
- New page-structure/certificate checks inside a real Chrome extension (only unit-tested).
- Anon Aadhaar full prove→verify round trip. Blocked by a slow connection: the 612 MB proving
  key keeps dropping. Retry with `LIVE_AADHAAR=1 HOLDER=0x... AA_ARTIFACTS=<dir> npx vitest run test/anonAadhaar.live.test.ts`
  in `packages/identity` after downloading `vkey.json`, `aadhaar-verifier.wasm`,
  `circuit_final.zkey` from `https://anon-aadhaar-artifacts.s3.eu-central-1.amazonaws.com/v2.0.0/`.
- Publishing proofs to Arkiv from a real wallet (needs test GLM from hub.arkiv.network/faucet).

**To do before submitting:**
1. Load the extension in Chrome and test on real + demo pages.
2. Demo scam pages for the video (clearly labelled demo).
3. Arkiv files: `/arkiv/schema.md`, `why-arkiv.md`, `how-you-use-arkiv.md`, `reach.md`, `friction.md`.
4. README: CROPS section (one or two lines per letter), AI usage disclosure, contract/Arkiv wallet + one runnable query.
5. Complete `scripts/import/rbi-alert-list.json` from RBI's official Alert List (rbi.org.in blocks scripts).
6. Demo video (≤ 3 min), deploy the web app, submit.

## Team

- **Ishita** is the registered ETHGlobal hacker; her GitHub is `coolcoolercoolestkid`. Dhruv also works on the project.
- Everything on GitHub (commits, pushes, the repo) and on the ETHGlobal site must come from Ishita's account, or the entry may be disqualified.

## Decisions and preferences (keep these)

- **Commits are authored as `coolcoolercoolestkid <coolcoolercoolestkid@gmail.com>`** (set in local git config). No Claude co-author lines. Commit after each step: ETHGlobal penalises one giant commit.
- The README must still disclose AI use honestly (ETHGlobal rule).
- Real people are only shown with proofs they made or public lists they're on. Never label a real person on Satya's own judgment.
- Demo/test data is always labelled (mock DigiLocker = demo issuer; Anon Aadhaar test cards = TEST).
- The mock issuer private key in `packages/identity/src/credential.ts` is **public on purpose** (demo only). Never put a real key in the repo.

## Remotes

- `origin` → github.com/coolcoolercoolestkid/Satya (public). Push only with gh logged in as coolcoolercoolestkid (`gh auth switch -u coolcoolercoolestkid`).
- github.com/thecherrycoder-dev/Satya was a temporary private copy from the wrong account; don't push there.

## Gotchas

- pnpm 11: `pnpm-workspace.yaml` pins `@zk-email/helpers>snarkjs` to npm 0.7.6 (the original pulls a git fork that pnpm blocks), allows esbuild builds, skips blake-hash's native build.
- Anon Aadhaar's TS sources fail strict checks; we import `@anon-aadhaar/core/dist/index.js` with typed wrappers. Browser needs `Buffer` (web: `src/polyfills.ts`; extension: `src/shims/`) and a `crypto` shim in the extension build.
- Extension CSP allows `wasm-unsafe-eval` for ZK verification.
- Run `pnpm data` before building the extension (downloads public lists, not committed).
- Arkiv access key: optional `VITE_ARKIV_ACCESS_KEY` (web `.env`) and `ARKIV_ACCESS_KEY` (extension build env). Not secret; without it the public RPC is rate-limited.
- Cert Spotter: 100 requests/hour without a key; crt.sh is often down.
