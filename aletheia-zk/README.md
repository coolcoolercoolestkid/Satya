# Aletheia

**Verify the claim, not the document.**

Aletheia is a privacy-preserving credential verification protocol. A holder proves a
statement about a credential — "I am at least 18", "my nationality is India", "my
credential has not expired" — with a zero-knowledge proof, and a verifier checks that
proof on Ethereum. The verifier learns the answer, never the data.

Identity flow:

```
ENS name  ->  wallet address  ->  Aletheia verification records
```

ENS is the human-readable lookup layer. The Graph is the verification-record layer.
Ethereum is the only place cryptographic truth is decided.

## What Phase 1 proves

A successful Aletheia verification proves exactly this:

> The holder of this wallet possesses a credential signed by issuer `X`, that credential
> has not expired as of date `D`, and it satisfies claim `C`.

## What Phase 1 does NOT prove

- **It does not prove government identity.** Phase 1 uses a clearly labelled
  development issuer (`mock-dev`, see `packages/issuer-mock`) whose only job is to
  sign a normalized credential. It performs no identity checks.
- **It does not prove a PDF is genuine.** PDF extraction is *input only*. Uploading a
  document proves nothing. Trust comes solely from the issuer's signature over the
  normalized credential, never from the document.
- **It is not production-ready cryptography.** The Groth16 phase-2 ceremony is
  single-contributor in Phase 1. See `docs/trust-model.md`.

A real credential source (DigiLocker / API Setu) replaces the mock issuer without
changing the circuits, contracts, or subgraph. See `docs/phase2-digilocker.md`.

## Privacy boundaries

Never leaves the holder's device: the PDF, extracted text, date of birth, expiry date,
nationality value, credential ID, and issuer signature.

Never written to Ethereum, the subgraph, or ENS: any of the above.

Published by a proof, by design: the issuer's public key, the date the credential was
checked against, the claim parameter the verifier itself chose (e.g. `18`), a
per-context nullifier, and the holder's address. A successful nationality claim
necessarily reveals the nationality it was asked about; the UI states this before
proving.

## Run it

Prerequisites: Node ≥ 22.6, pnpm 11, and a Sepolia RPC URL. The end-to-end runners also
need a funded throwaway Sepolia key and the deployed subgraph endpoint; the exact keys are
listed in `.env.example` and in `myTasks.md`.

```bash
pnpm install
pnpm -r run build      # build every workspace package
pnpm -r run typecheck  # green across the workspace
pnpm -r run test       # unit + contract + circuit suites
```

**End-to-end against real infrastructure** (copy `.env.example` to `.env` and fill it in
first):

```bash
# One claim, all the way: signed credential -> Groth16 proof -> deployed verifier ->
# real Sepolia tx -> ClaimVerified event -> indexed subgraph record, read back.
pnpm --filter @aletheia/scripts run m1

# All three claim types for one credential in one context, proving the property the
# identity nullifier exists for: three distinct nullifiers, one shared identityNullifier.
pnpm --filter @aletheia/scripts run multi-claim
```

**The demo (holder + verifier web app):**

```bash
# one-time: copy the mock issuer keystore in so the app can sign on-device
cp packages/issuer-mock/keys/issuer-mock.json packages/web/public/mock-issuer-keystore.json
pnpm --filter @aletheia/web run dev   # http://localhost:3000
```

The holder flow (`/`) extracts a passport MRZ, lets you review it, proves an **age**,
**nationality**, or **not-expired** claim in the browser, and submits it to Sepolia — the
passport never leaves the device. The verifier flow (`/verify`) looks up an ENS name or
address and renders each record as one of five honest states, live from the subgraph. Full
setup and both signer paths are in `packages/web/README.md`.

### Try it with a demo passport

The holder flow opens with a **"Try a demo passport"** row — one click loads a fabricated
passport into the review step, so you can drive the whole flow without typing an MRZ:

| Sample | Demonstrates |
|---|---|
| **Valid adult · India** | every claim is provable (age ✓, nationality 356, not expired) |
| **Adult · United States** | a different nationality (840) — the nationality claim reveals USA |
| **Minor · India** | under 18 — an "age ≥ 18" proof **cannot** be produced (the proof can't lie) |
| **Expired · India** | expiry in the past — **no** claim is provable, because every proof checks expiry |

> **Every sample is synthetic** — invented names and document numbers with valid ICAO check
> digits, defined in `packages/web/app/page.tsx` (`SAMPLES`). No real person, passport, or
> personal data is used anywhere in this repository.

## Documentation

| Document | Contents |
|---|---|
| `docs/architecture.md` | Full architecture and staged implementation plan |
| `docs/trust-model.md` | What is trusted, what is mocked, what is not proven |
| `docs/toolchain.md` | Required toolchain, including the circom 2.x requirement |
| `docs/credential-schema.md` | Normalized credential v1 and signed-message layout |
| `docs/date-format.md` | Canonical date representation and boundary behaviour |
| `docs/public-signals.md` | Frozen public-signal order per circuit |
| `docs/passport-extraction.md` | TD3 MRZ extraction, the ICAO mapping and its limits |
| `docs/security.md` | Threat model and mitigations, with the artifact that verifies each row |
| `docs/deployments.md` | Deployed contract addresses per network |
| `docs/phase2-digilocker.md` | Replacing the mock issuer with a real credential source |
| `docs/phase2-ens-subnames.md` | Why Phase 1 issues no ENS subnames, and what issuing them would require |

The four working files that track the build, rather than the design:

| File | Contents |
|---|---|
| `STATUS.md` | Current state: what is complete, in progress, and pending |
| `TODO.md` | Day-by-day task breakdown, each with its exit criteria |
| `AGENTS.md` | Working agreement — how contributors (human and agent) work on this repo |
| `myTasks.md` | Work only a human can unblock (API keys, funded accounts, hosted signups) |

## Status

Milestone M1 is complete: the full pipeline runs end to end against real infrastructure —
three claim types (age, nationality, expiry), a browser holder flow, a verifier flow, a
deployed subgraph, and live ENS resolution. `STATUS.md` has the current detail and `TODO.md`
the day-by-day record.

Nothing is simulated: no placeholder proofs, transaction hashes, GraphQL responses, ENS
records, or verification results exist in this repository. Every verification the app shows
is backed by a real on-chain transaction anyone can inspect.
