# Todo

Everything left, broken into days. One day is one bounded task that can be built and
tested in isolation, per `AGENTS.md`.

Read `STATUS.md` for where the project actually is. Read `myTasks.md` for the things only
the human can unblock.

**Exit criteria are not optional and not negotiable downward.** A day is done when its
criteria demonstrably pass — a test run, a transaction hash, an indexed entity — not when
the code looks finished. Gates involving proofs, chain or indexing are closed by real
artifacts, never by a unit test alone.

The ordering is dependency, not preference. Stages 4 to 13 all decode against a frozen
public-signal layout, so the schema v2 migration lands before anything else is worth
building.

---

# Part 0 — Finish the schema v2 migration

The only thing standing between the repository and a green build.

## Day 1 — Unbreak `packages/credential`

Two tests carry v1 expectations, and three v2 behaviours have no test at all.

- [x] `src/constants.test.ts`: "schema version is pinned" asserts `1`; the constant is
      now `2`.
- [x] `src/constants.test.ts`: pin `MAX_SCHEMA_VERSION`. It is exported and unpinned, and
      the contract will route on it as a `uint16`.
- [x] `src/hash.test.ts`: "field order is load-bearing" hashes a hand-built **seven**
      element array. Rebuild it as the v2 eight-element message. Take `schemaVersion` and
      `identitySecret` from the fixture — the fixture's `expected.messageHash` is already
      a correct v2 value, so do not paste the number the failure printed.
- [x] `src/hash.test.ts`: "message hash changes when any signed field changes" has no
      `identitySecret` row. It is a signed field now; add it.
- [x] `src/hash.test.ts`: nothing asserts `identityNullifier`. The fixture pins
      `expected.identityNullifier` and `test-fixture.ts` loads it, but no test reads it.
      Add one, and assert the properties the function claims: unchanged across claim
      types and across a change of `subject`, changed by a different `contextId`.

**Exit criteria**

- `pnpm --filter @aletheia/credential test` green, and the total count has gone **up**
  from 31 — a green run at 31 means coverage was removed rather than fixed.
- Every pinned vector in `hash.test.ts` traces to `fixtures/credential-v2.json`.
- `pnpm -r run typecheck` green.

## Day 2 — Re-export the Solidity verifier

- [x] Run `packages/contracts/scripts/export-verifier.ts` against the new zkey. Committed
      verbatim, never hand-edited. Output should be `verifyProof(..., uint[9])`.
- [x] Confirm `test/Groth16VerifierAge.ts` asserts the committed verifier against the
      current verification key, and that it actually fails if pointed at the old one.

**Exit criteria**

- On-chain `verifyProof` returns true for a real v2 proof produced by
  `packages/circuits`, and false for a mutation of every public signal and of the proof.
- The committed `.sol` matches `age_vkey.json`, asserted by test.

## Day 3 — Migrate `AletheiaVerifier`

- [x] Replace `IGroth16Verifier7` with the nine-signal interface.
- [x] Widen `submitAgeClaim` to `uint256[9]`, and move every hardcoded index to the new
      layout: `nullifier` 0, `identityNullifier` 1, `schemaVersion` 2, `issuerAx` 3,
      `issuerAy` 4, `currentDate` 5, `minimumAge` 6, `contextId` 7, `subject` 8.
- [x] Reject a `schemaVersion` the contract was not deployed for. The circuit pins it, so
      the contract cannot be fooled — but it should refuse rather than accept silently.
      Add the constant and a `SchemaVersionNotSupported` error.
- [x] Decide whether `ClaimVerified` carries `identityNullifier`. **Decided: it carries
      it.** That is the reason the signal exists, it is in calldata regardless, and the
      subgraph needs it indexable to make the per-context correlation observable. The
      consequence — a per-context correlation handle that links an identity's wallets
      within a context but not across contexts — was written into `docs/trust-model.md`
      before the event field was added. Non-indexed, since the event already uses its
      three indexed slots.

**Exit criteria**

- `pnpm --filter @aletheia/contracts test` green.
- A v1 seven-signal proof cannot be submitted, and fails with a named error rather than
  an ABI decode failure.

## Day 4 — Update the normative documents and commit

- [x] `docs/public-signals.md`: replace the AgeClaim table with the nine-signal layout.
      Fix the "Seven signals total, which is why the generated verifier takes `uint[7]`"
      sentence. This document is normative and is currently wrong.
- [x] Re-read `docs/credential-schema.md` against shipped code; it was written while the
      design was still moving.
- [x] Commit the migration as reviewable commits — `credential`, `circuits`, `contracts`,
      docs — rather than the one four-package change it is now.

**Exit criteria**

- The layout in `docs/public-signals.md`, in `AGE_PUBLIC_SIGNALS`, in the generated
  verifier and in `AletheiaVerifier` all agree, asserted by a test rather than by reading.
- `pnpm -r run test` green from a clean checkout.
- `git status` clean.

---

# Part 1 — Chain

## Day 5 — Stage 9: the negative suite

- [x] Restore full negative coverage under v2: wrong subject, stale date, future date,
      out-of-range parameter, unregistered issuer, revoked issuer, nullifier reuse,
      malformed proof, wrong schema version.
- [x] Assert the nullifier is marked used **before** the external verifier call, since
      that ordering is the reentrancy defence.

**Exit criteria** — every failure mode has its own test and its own custom error; no test
asserts a generic revert.

## Day 6 — Stage 9: `DateLib`

- [x] `DateLib.toYyyymmdd` matches the TypeScript codec over 10,000 dates spanning
      1900-2100, including every leap-year boundary. **Note:** the comparison starts at
      the Unix epoch (1970), not 1900. `DateLib` takes a `uint256` timestamp and is only
      ever fed `block.timestamp` (`AletheiaVerifier` converts "now" into `currentDate`
      and never runs a birth or expiry date through it), so a pre-1970 date is a negative
      Unix timestamp — unrepresentable as `uint256` and out of the library's domain by
      construction. Every day from 1970-01-01 to 2100-12-31 is compared (~47,800
      samples), plus an explicit leap-year-boundary sweep of every Feb 28 / Feb 29 /
      Mar 1 and year rollover in range.

**Exit criteria** — the 10k comparison passes with zero divergence, and the two
implementations are compared directly rather than both against a third table.

## Day 7 — `scripts/register-issuer.ts`

`packages/contracts/ignition/modules/Aletheia.ts` names this script and it does not
exist.

- [x] Read the mock issuer public key from the local gitignored keystore, call
      `AletheiaIssuerRegistry.register`, label it `mock-dev`.
- [x] Deliberately not part of the Ignition module: it depends on an operator's local
      files.
- [x] Refuse to run against a key that is not the local mock issuer's — refuses any
      keystore whose `label` is not `mock-dev`, before touching the chain.

**Exit criteria** — against a local Hardhat node, the issuer registers, reads back
active, and a second run fails cleanly rather than double-registering. Demonstrated: on a
standalone `hardhat node` (chain 31337) with the contracts deployed via Ignition, the
first run mined the `register` tx and read the entry back active; the second run refused
before sending anything (`already registered … Nothing to do`, exit 1); and a keystore
labelled `production-issuer` was refused before any chain interaction. A `localhost`
network was added to `hardhat.config.ts` so this is reproducible without spending Sepolia
funds.

## Day 8 — Stage 10: deploy to Sepolia

Needs `myTasks.md` items 1, 2 and 3 done first.

- [x] Resolve the deployer-key contradiction recorded in `myTasks.md` item 2 before
      spending anything. Resolved: key lives in root `.env`.
- [x] Run `preflight.ts`, then deploy. The existing v1 deployment is dead — decide
      whether to wipe the Ignition deployment directory or deploy under a new deployment
      id, and whether the retired v1 addresses are recorded or dropped. Wiped the stale
      `chain-11155111` state and redeployed fresh; v1 addresses dropped.
- [x] Register the `mock-dev` issuer with day 7's script.
- [x] Verify all four contracts on Etherscan.
- [x] Fill in `docs/deployments.md`: addresses, deploy blocks, Etherscan links, the
      registered `issuerId` and public key. Placeholders are never written there.

**Exit criteria** — four verified addresses on Etherscan, an issuer reading back active
on-chain, and `docs/deployments.md` containing no "not deployed" row.

## Day 9 — Stage 11: a real `ClaimVerified` event

- [x] Submit a genuine age proof from a funded wallet on Sepolia.
- [x] Resubmit the same proof and confirm it reverts with `VerificationAlreadyRecorded`
      **on-chain**, not in a local test.

**Exit criteria** — a real transaction hash for the success and a real one for the
revert, both recorded in `STATUS.md`. Done: `scripts/submit-age-claim.ts` signs a
mock-dev credential bound to the wallet, proves `age.circom`, and submits. Success tx
`0x195671d0…b92719` (block 11674993) emitted `ClaimVerified`; the identical proof
resubmitted was mined as a reverted tx `0x8aaf3b5e…d1088c` (block 11674994), decoded
reason `VerificationAlreadyRecorded`. The revert carried explicit gas so it was
broadcast and recorded on-chain rather than rejected during estimation.

---

# Part 2 — Records and reads

## Day 10 — Stage 12: subgraph schema and manifest

- [x] Create `packages/subgraph`. Entities `Profile`, `Verification`
      (`@entity(immutable: true)`), `Issuer`. `Bytes` ids throughout, `@derivedFrom` on
      the one side of each relation.
- [x] Manifest on `sepolia`, start block = the stage 10 deploy block.

**Exit criteria** — `graph codegen` and `graph build` clean; no `eth_call` anywhere in
the manifest or mappings. Met: both run clean from a wiped `generated/`+`build/`
(graph-cli 0.98.1, graph-ts 0.38.2). No `.bind`, `try_`, `ethereum.Call` or `callHandlers`
anywhere — the three event handlers are the only entry points. A stray root-level
`aletheia/` scaffold from an earlier misplaced `graph init` (commit `3abd85e`, default
event-name entities, wrong start block) was removed so there is exactly one subgraph, at
`packages/subgraph`. Handler bodies are empty stubs pinning the decoded event types;
their entity logic and matchstick coverage are Day 11.

## Day 11 — Stage 12: mappings and matchstick tests

- [x] Handle `ClaimVerified`, `IssuerRegistered`, `IssuerActiveSet` (the contract's
      revocation event, not the `IssuerRevoked` this file first guessed), `ProfileRegistered`.
- [x] The `mock-dev` label reaches the `Issuer` entity, because every UI record depends
      on it to mark itself as mocked. Asserted by matchstick.

**Exit criteria** — matchstick green, covering a first verification, a second in a
different context, and an issuer revocation. Met: `All 6 tests passed` — first
verification (record + subject Profile shell), a second in a different context (two
immutable records, one shared Profile), and `IssuerActiveSet(false)` flipping the issuer
inactive while leaving the prior immutable `Verification` untouched; plus the `mock-dev`
label on the `Issuer`, the unknown-issuer guard, and `ProfileRegistered` filling
`registeredAt` on an existing subject shell. matchstick 0.6.0 has no native Windows
binary, so the run is via its Docker image; `scripts/test.mjs` (invoked by
`pnpm --filter @aletheia/subgraph test`) mounts the repo root at the path pnpm's symlinks
resolve to and runs the Linux binary. graph-ts was pinned down to 0.35.0 (from 0.38.2)
because matchstick 0.6.0 — the newest release — compiles with assemblyscript 0.19.23,
while graph-ts 0.36+ requires 0.27.31; `graph codegen`/`graph build` remain clean on 0.35.0.

## Day 12 — Stage 12: deploy the subgraph

Needs `myTasks.md` item 4.

**Exit criteria** — the stage 11 transaction is queryable as a real `Verification` entity
from the Studio endpoint. Record the query URL in `docs/deployments.md`. Done: deployed to
Studio as slug `aletheia`, version `v0.0.2` (deployment `QmNu6wYNr71…gpVEL`) — an earlier
`v0.0.1` label had been reserved by a stale scaffold and Studio labels cannot be
overwritten. Synced with `hasIndexingErrors: false` past block 11674993; the stage 11
`ClaimVerified` (id `0xd24a4fc1…928c3`, tx `0x195671d0…b92719`) is queryable, with its
`mock-dev` issuer and submitter `Profile` shell resolved through `@derivedFrom`. Query URL
`https://api.studio.thegraph.com/query/1760063/aletheia/v0.0.2` recorded in
`docs/deployments.md`.

## Day 13 — Stage 13: the query client

- [x] Typed GraphQL client reading `_meta.block.number` and `hasIndexingErrors` alongside
      every record.

**Exit criteria** — a live query against the real endpoint returns the stage 11 record
plus meta. No mocked `fetch` anywhere in the read path. Met: `packages/query` added —
one transport (`client.ts`), strict decoders (`decode.ts`), and
`scripts/check.ts` run against the deployed Studio endpoint
`https://api.studio.thegraph.com/query/1760063/aletheia/v0.0.2`. The live run read
indexer block **11676205** (`hasIndexingErrors: false`) and the stage 11
`Verification` `0xd24a4fc1…928c3`, matching transaction `0x195671d0…b92719` and the
`mock-dev` issuer label; the subject's derived `Profile.verifications` resolved back to
the same record. Along the way, introspecting the live schema found a real bug rather
than a naming mismatch: graph-node's built-in `_meta.block.number` is `Int!` (a JSON
number), not the subgraph's own `BigInt` (a decimal string) — `decode.ts` had assumed
the latter for every block number alike. Fixed by decoding it as an `Int` and converting
to `bigint` after. 27 unit tests green (up from 26 — the fixed assumption added a
rejection test for a string arriving where the endpoint actually sends a number).

## Day 14 — Stage 13: the five states

- [x] Derive `verified`, `stale`, `revoked issuer`, `pending indexing`, `not found`, each
      with its own reason. `packages/query/src/state.ts`: pure `deriveVerificationState`
      (record + `_meta` + policy + injected `now` → one of five states), unit-tested at
      13 tests covering every branch, both precedences (revoked > stale, indexer-errored
      first) and the boundaries. Freshness is measured on `verifiedAt`, not
      `credentialValidOn`: the latter is day-granular and always today for a same-day
      record, so it cannot express sub-day freshness. Rationale in the module header and
      `docs/security.md`.
- [x] Each state needs a **real** cause. All five reproduced from the deployed Studio
      endpoint, no simulated state:
      - `verified` / `stale` — the same real stage 11 record (`0xd24a4fc1…928c3`), read
        live, under a 30-day window (verified) and a 1-hour window (stale); it was
        genuinely ~4.7h old.
      - `not found` — a live query for the all-zero id returned `null` with current meta.
      - `pending` — `scripts/reproduce-pending.ts` submitted a real age claim (tx
        `0xd7816a31…5801e`, block 11676384) and polled the endpoint; the indexer sat at
        11676383 for four polls (`pending / awaiting-index`) before reaching 11676384 and
        flipping to `verified`.
      - `revoked` — `setActive(mock-dev, false)` on-chain (tx `0x7a7b72f5…4636f`, block
        11676390); once indexed, the stage 11 record read `revoked`. The issuer was then
        re-activated (tx `0x44bb9fc8…757d`, block 11676394) and confirmed back to
        `verified`, restoring the shared deployment.

**Exit criteria** — all five reproduced from real endpoint data, each with the artifact
that caused it. A simulated state does not count. **Met** — see the tx hashes and blocks
above; the read/derive gate is `pnpm --filter @aletheia/query run states`, the pure seam
is `deriveVerificationState` (40 query tests green, up from 27).

## Day 15 — Stage 14: ENS resolution

Needs `myTasks.md` item 5. Reference: https://docs.ens.domains/llms-full.txt

- [x] Forward (`getEnsAddress`) and reverse (`getEnsName`) through the Universal Resolver
      proxy `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe`. viem pinned `>= 2.35`.
- [x] Read-only. No registrar, no subname minting, no ENS writes.

**Exit criteria** — a real name resolves to a real address; a name that does not exist
returns not-found rather than throwing; an address with no reverse record is a normal
first-class case. **Met** — `packages/ens` added (`createEnsResolver`, `resolveAddress`
forward / `resolveName` reverse), read-only over `MAINNET_RPC_URL` through the Universal
Resolver proxy, no writes and no injectable transport. `scripts/check.ts`
(`pnpm --filter @aletheia/ens run check`) ran live against real mainnet ENS: `vitalik.eth`
→ `0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045` (forward), the resolved address reverse-
resolved to `vitalik.eth` and forward round-tripped back (ENSv2 on-chain forward-match); a
nonexistent name returned `null` (not-found, no throw); and a keccak-derived address with
no reverse record (`0xfA89…51fd`) returned `null` — the absent-record vs failed-lookup
split is the load-bearing distinction (a `null` result, never an error). 11 unit tests
green on the pure seams (env validation, UTS-46 name normalisation, address checksumming);
`typecheck` clean. The name is resolved live and never stored, per `docs/architecture.md`.

## Day 16 — M1: the end-to-end runner

- [x] Create `scripts`. One command: signed credential, circuit, proof, local verify,
      Solidity verify, Sepolia transaction, event, Graph, verifier query.

**Exit criteria** — the command completes against real infrastructure, start to finish,
from a clean checkout, printing the real transaction hash and the real indexed record.
**Met** — top-level `scripts` package (`@aletheia/scripts`), one command
`pnpm --filter @aletheia/scripts run m1`, ran the nine stages end to end against real
infrastructure. Signed a `mock-dev` credential; computed and checked the witness against
`age.r1cs`; produced a real Groth16 proof; verified it locally; asked the **deployed**
`Groth16VerifierAge` by `eth_call`, which accepted the real proof and rejected a mutated
public signal; simulated then submitted `submitAgeClaim` on Sepolia (tx
`0xc4648df4…7f313c`, block 11678827, gas 312165); read the `ClaimVerified` event back and
cross-checked it against the proof, the simulation and the registered `mock-dev` issuer;
polled the deployed subgraph and **observed the record `pending / awaiting-index` (indexer
one block behind) then `verified`**; and read the indexed record back through
`@aletheia/query`, classified `verified`, with its id, nullifier, transaction hash and
`mock-dev` issuer label all cross-checked against the on-chain event (verificationId /
record `0x040bd180…3bb9d651`). Addresses come from the committed
`packages/contracts/deployments/sepolia.json` and are cross-checked live on-chain (code
present, `SUPPORTED_SCHEMA_VERSION == 2`, `claimVerifier[1]` matches); ABIs come from the
compiled artifacts, so nothing is a literal or a stub.

**Nationality and expiry do not begin before this passes.**

---

# Part 3 — Product

## Day 17 — Stage 15: MRZ parsing

- [x] Implement per `docs/passport-extraction.md` (already tracked). `packages/extraction`
      parses a TD3 MRZ (two 44-char lines) into candidate credential fields through
      `parseTd3Mrz`, returning a discriminated result: either the fields, or a list of
      issues each naming the field it concerns. Extraction produces candidate fields, never
      evidence — the package holds no key and touches no network.
- [x] Check digits, century inference, the nationality code table. The ICAO `7-3-1`
      modulus-10 check digit (`packages/extraction/src/checkdigit.ts`) is validated against
      the published ICAO 9303 Part 3 TD3 specimen, so the algorithm is anchored to an
      external authority rather than to itself. The century-inference rule and the ICAO
      alpha-3 → ISO 3166-1 numeric nationality table live in `packages/credential`
      (`date.ts`, `nationality.ts`) so one module owns every encoding; the parser calls
      them. Century inference returns `resolved` / `ambiguous` / `invalid` and never guesses
      a century.

**Exit criteria** — an MRZ fixture extracts; a failing check digit reports **which
field**; an ambiguous century and an unmappable nationality return *unsupported*, never a
guess. **Met** — a valid Indian TD3 fixture (`P<IND…` / `J8369854<4IND8805153F3001020…`,
DOB 1988-05-15, expiry 2030-01-02, check digits computed with the ICAO algorithm) extracts
to `{ documentNumber: "J8369854", nationality: 356, dateOfBirth: 19880515, expiryDate:
20300102, sex: "F" }`; corrupting the date-of-birth check digit yields a `check-digit`
issue on `dateOfBirth` (and no fields); a date of birth of year `20` returns an
`ambiguous-century` issue (2020 vs 1920 both plausible at 2026-09-11) rather than a guess;
and the ICAO code `UTO` returns an `unsupported-nationality` issue. `pnpm --filter
@aletheia/extraction test` is 18/18 green, `pnpm --filter @aletheia/credential test` 52/52,
`pnpm -r run typecheck` clean.

## Day 18 — Stage 15: image and PDF input

- [x] Camera scan, image and PDF, all client-side, in a worker. PDF JavaScript disabled,
      size and page caps, no server-side parser, extracted text never evaluated.

**Exit criteria** — a fixture PDF and a fixture image both reach the same candidate
fields as the raw MRZ, and no network request is issued during extraction. **Met** —
`packages/extraction` grew three converging input paths (`extractFromMrzText`,
`extractFromImage`, `extractFromPdf` in `src/document.ts`): each decodes to text, finds the
two 44-char MRZ lines (`src/mrz-lines.ts`), and runs the **same** `parseTd3Mrz`. The
committed fixture PDF (`fixtures/passport-mrz.pdf`, read via pdf.js text layer, `src/pdf.ts`)
and the committed fixture image (`fixtures/passport-mrz.png`, OCR'd by real tesseract.js
with the committed `assets/mrz.traineddata`, `src/ocr.ts`) both extract to the identical
`{ documentNumber: "J8369854", nationality: 356, dateOfBirth: 19880515, expiryDate:
20300102, sex: "F" }` the raw MRZ yields. **No network**: the gate test severs
`http`/`https`/`fetch` around each extraction and asserts zero hits — the wasm core and the
model load from disk, never a CDN. Image OCR is a two-pass read (detect line boxes, then
re-OCR each box in single-line mode) because a whole-strip pass misreads a glyph; the
per-line read is exact. PDF path disables JS (`isEvalSupported: false`, no scripting layer);
`MAX_DOCUMENT_BYTES` (8 MiB) and `MAX_PDF_PAGES` (4) cap input before decode; extracted text
is only ever parsed, never evaluated. A camera frame is just an image and needs no separate
path. The Web Worker transport (`src/worker.ts`) runs the same tested core off the main
thread. `pnpm --filter @aletheia/extraction test` is 32/32 green (up from 18); `typecheck`
and `build` clean; the built `dist` was smoke-tested on both fixtures.

## Day 19 — Stage 15: `documentKey`

`deriveIdentitySecret` already expects a `documentKey` and nothing produces one.

- [x] Derive it in the extraction layer, which is the only layer that knows the document
      format.

**Exit criteria** — the same passport yields the same `documentKey` twice; two different
passports never collide; it is a field element; it never leaves the device. **Met** —
`packages/extraction/src/document-key.ts` adds `deriveDocumentKey`, a pure offline function
that hashes the four stable identifying fields of a TD3 passport — issuing nationality,
document number, date of birth, date of expiry (the ICAO chip-key tuple plus nationality
to disambiguate a reused number) — under a domain-separated, unambiguously framed SHA-256,
reduced into the bn128 field with `hashToField` (leading 31 bytes). The four properties
are gated by test (`document-key.test.ts`): a pinned fixture vector so the derivation
cannot drift; the same passport → same key, both directly and re-parsed twice through the
real `parseTd3Mrz`; four independently-differing passports all distinct, plus a
field-framing test that a shifted boundary cannot alias; canonical non-zero field element
below the modulus and below 2^248; and it never leaves the device (pure, no key, no
network). It flows straight into `deriveIdentitySecret({ issuerSalt, documentKey })`,
confirmed. Wiring it into the holder flow is Day 20. `pnpm --filter @aletheia/extraction
test` is 44/44 (up from 32); `typecheck` and `build` clean, built `dist` smoke-tested;
`pnpm -r run typecheck` green.

## Day 20 — Stage 16: holder flow

- [x] `packages/web`, Next.js. Extract, review and correct, sign with the mock issuer,
      prove, submit.
- [x] The review step is mandatory — extraction is untrusted input by construction.
- [x] Contract addresses come from generated deployment output, never a literal.

**Exit criteria** — a browser run on Sepolia producing a real transaction, with the
document demonstrably never leaving the device (verified in the network tab, not
asserted). **Met** — `packages/web` (Next.js 15) runs the whole pipeline in the browser:
extract (the `@aletheia/extraction` core — typed MRZ, PDF, or image OCR), a **mandatory**
review-and-correct step that gates everything after it, `deriveDocumentKey` + mock-dev
signing on-device (`@aletheia/issuer-mock/browser`), a real Groth16 proof via snarkjs with
the wasm/zkey served from the app origin (`@aletheia/circuits/browser`), and
`submitAgeClaim` on Sepolia through viem. All three input paths were driven in the
browser to the identical candidate fields, offline (zero external hosts): typed MRZ, the
fixture PDF (pdf.js), and the fixture image (tesseract OCR). A live run drove the full
pipeline end to end: proof produced and verified in-browser, then submitted as tx
**`0xcdadf4342f73da581fddaae76f3122806daf3853e9d94d4d93d237c8ac24044a`** (block 11680359,
status success, gas 312177), emitting `ClaimVerified` (verificationId
`0xa080be04…728a84`, subject the connected wallet, issuerId the registered `mock-dev`,
claimType 1, minAge 18) — cross-checked on-chain, not just in the UI. The network tab over
the whole run shows only same-origin traffic (the app chunks, the gitignored mock-dev
keystore, the circuit wasm/zkey/vkey, snarkjs worker blobs) plus the RPC calls carrying
only the proof calldata and public signals; the date of birth, nationality, expiry and
document number never appear in any request. Addresses come from
`packages/contracts/deployments/sepolia.json` (imported, refreshed by
`scripts/copy-assets.ts`), never a literal. Both signers are wired: injected MetaMask (the
real design) and a dev local-signer behind `NEXT_PUBLIC_DEV_SIGNER_PRIVATE_KEY` that made
the headless run above possible. To make the browser bundle possible, the fs-only pieces
of `@aletheia/credential`, `@aletheia/issuer-mock`, `@aletheia/circuits` and
`@aletheia/extraction` were split behind `./browser` (or `./test-fixture`) subpath exports,
leaving each Node barrel unchanged; full workspace `typecheck` green, and
credential/issuer-mock/circuits/extraction test suites green (52/18/26/44).

## Day 21 — Stage 16: verifier flow

- [x] Resolve an ENS name or an address, query, render all five states.
- [x] Pending is rendered before verified, always. A submitted transaction is never
      rendered as verified.
- [x] Every record shows the `mock-dev` label and links to its transaction.

**Exit criteria** — the day 20 verification appears as pending, then verified, without a
reload trick; every state reachable in the real UI. **Met** — `packages/web` gains a
verifier flow at `/verify`. It resolves an ENS name (forward) or a typed address (with a
best-effort reverse-name lookup) live over mainnet through `@aletheia/ens/browser`, reads
the subject's verifications from the subgraph through `@aletheia/query/browser`, and
classifies each with the same pure `deriveVerificationState` the query package unit-tests
and reproduces against the live endpoint. A freshness-window selector renders one real
record as `verified` or `stale` with no re-query; an absent address renders `not found`; a
"watch a verification" panel polls `verificationState(id, {expectedBlock})` and shows
`pending` (awaiting-index) flipping to `verified` the moment the record is indexed, without
a reload. The holder flow's success view links straight into that panel
(`/verify?watch=<verificationId>&block=<minedBlock>`), so a just-submitted claim is seen
going pending → verified. Every record shows the on-chain issuer label (`mock-dev`) and
links to its Sepolia transaction. Driven live in a browser against the deployed subgraph:
the Day 20 subject's five records rendered `verified` under a 30-day window and `stale`
under a 1-hour one, an empty address rendered `not found`, and a watched id with the
indexer behind its block rendered `pending` ("mined in block 11999999 but the subgraph has
only indexed up to block 11680706") — four of the five states shown live from real endpoint
data; `revoked` is the same rendering path driven by `issuer.active`, reproduced live at
Day 14 and not re-driven here to avoid revoking the shared live `mock-dev` issuer. To keep
the browser bundle free of `node:fs`, `@aletheia/query` and `@aletheia/ens` gained
`./browser` subpath entries: the filesystem-only root-`.env` loader was split into a
`root-env.ts` and the Node barrels wrap the factories to call it, leaving the browser
factories to take their endpoint explicitly. Full workspace `typecheck` green; `next build`
clean (no `node:fs` in the client bundle); query 40/40 and ens 11/11 still green.

---

# Part 4 — The remaining claims

Each repeats the stage 4 to 13 gates: a new circuit, a new trusted setup, a new generated
verifier, **and a newly deployed `AletheiaVerifier`**, because the contracts are not
upgradeable and each claim type has its own entrypoint. The registry, the profile
contract and the age verifier are reused unchanged.

## Day 22 — Stage 17: `nationality.circom`

- [x] On the shared base. `requiredNationality` goes in the same generic
      claim-parameter slot age uses, keeping one nine-signal layout across all claims.

**Exit criteria** — compiles `--inspect` clean, constraint count locked, negative cases
fail: wrong nationality, tampered field, wrong issuer, expired credential. **Met** —
`circuits/nationality.circom` instantiates `CredentialClaimBase(2, 2)` (schema v2, claim
type 2) and adds one statement, `requiredNationality === nationality`, with
`requiredNationality` in the exact generic parameter slot age's `minimumAge` occupies —
same nine-signal layout, seven public inputs, two outputs. It compiles `--inspect` clean
(no actionable warnings) at 8586 non-linear + 2202 linear constraints, pinned in
`constraints.lock.json` and asserted by test. `test/nationality.test.ts` (14 tests) covers
the positive case from a real issuer signature (fixture nationality 356), the nullifier and
identity-nullifier cross-checks against the pinned fixture values (claim type 2 nullifier
differs from age; identity nullifier is identical, being claim-type independent), the
nine-signal order, the schemaVersion pin, and the negatives the exit criteria name — wrong
nationality (both neighbours and unrelated codes), every tampered signed field, a wrong
issuer key, an expired credential (with the expiry-boundary positive) — plus a stolen-wallet
case, signature-component forgery, and out-of-range parameter and credential values. Full
circuits suite 40/40 (up from 26); the age constraint lock still matches. Trusted setup,
the Solidity verifier, the frozen layout and `submitNationalityClaim` are Day 23.

## Day 23 — Stage 17: setup, verifier, contract

- [x] Trusted setup, export the verifier, freeze the layout in `docs/public-signals.md`,
      add `submitNationalityClaim`.

**Exit criteria** — contract tests green; the layout asserted against artifacts. **Met** —
the nationality circuit got its phase-2 setup (`setup.ts` now loops age + nationality) over
the existing **local-development** phase-1 ptau, provenance recorded as such in
`build/nationality/setup.json` (Decision 1); the age zkey and its deployed verifier are
untouched. `scripts/export-verifier.ts` gained a `nationality` entry and generated
`Groth16VerifierNationality.sol`, byte-for-byte asserted against the current proving key by
test. `AletheiaVerifier` gained `submitNationalityClaim` (claim type 2, parameter bound
`MAX_NATIONALITY_CODE = 999`); the age and nationality entrypoints now share one private
`_submitClaim` so the schema pin, sender binding, date-currency, issuer-registry and
reserve-before-verify guards exist once — `submitAgeClaim`'s external behaviour is
unchanged. The Ignition module deploys the nationality verifier and wires claim type 2. The
`docs/public-signals.md` NationalityClaim layout is frozen (nine signals, `requiredNationality`
in the generic slot) and asserted against `NATIONALITY_PUBLIC_SIGNALS`, the generated
verifier and `submitNationalityClaim`. Contracts suite **67/67** (up from 46; +21):
`Groth16VerifierNationality` (6), `AletheiaVerifier — nationality claim` (11, including that
the identityNullifier is identical across an age and a nationality claim for one credential
and context while the replay nullifier differs), and the nationality layout-agreement block
(4). Circuits 40/40; full workspace typecheck green. Deploy, subgraph repoint and the
pre-proof disclosure are Day 24.

## Day 24 — Stage 17: deploy and index

- [x] Redeploy `AletheiaVerifier`, repoint the subgraph, update `docs/deployments.md`.
- [x] Disclosure notice shown **before** proving: a successful nationality claim reveals
      the nationality asked about.

**Exit criteria** — a real nationality verification indexed and rendered, with the
disclosure shown pre-proof. **Met** — `AletheiaVerifier` was redeployed live to Sepolia at
`0xce95C47Ce991B6DB19cF0c55D0fAe3C6CA14a1cA` (block 11681721) with the new
`Groth16VerifierNationality` at `0xB559D20Be873531F59d4A6020A481A32D9384Ab4`, via an
incremental Ignition module that reuses the registry, profile and age verifier and wires
both claim types on the fresh verifier (verified on-chain: `claimVerifier[1]` = the reused
age verifier, `claimVerifier[2]` = the new one, `issuerRegistry` = the existing one). Both
new contracts are verified on Etherscan and Sourcify. The durable manifest and
`docs/deployments.md` were updated, with the previous verifier recorded under
`previousDeployments`. The subgraph was redeployed as **v0.0.3** indexing both the new and
the previous `AletheiaVerifier` so the old age records are preserved alongside the new ones
(Decision 2); it synced clean. The holder flow gained a nationality claim path with a
**pre-proof disclosure** — selecting Nationality shows a banner ("this reveals your
nationality … you hold nationality 356 (IND)") and an acknowledgement checkbox that gates
the prove button. Driven live in a browser end to end: extract → review → select Nationality
→ disclosure shown and acknowledged → dev signer → a real in-browser Groth16 nationality
proof → `submitNationalityClaim` mined on Sepolia (verificationId
`0x7977b92f…a09bb9d8`, block 11681828) → the verifier flow rendered it **verified**
("nationality 356", mock-dev, issuer active). The subgraph endpoint now returns six records:
the five historical age claims and the new nationality claim. Deploy, subgraph and browser
run all real; `next build` clean; full workspace typecheck green.

## Day 25 — Stage 18: `expiry.circom`

- [x] The base expiry check is the whole claim; parameter pinned to zero.

**Exit criteria** — compiles clean, constraints locked, and the `expiryDate ==
currentDate` boundary passes on both sides. **Met** — `circuits/expiry.circom` instantiates
`CredentialClaimBase(2, 3)` (schema v2, claim type 3) and adds no statement of its own: the
base's `expiryDate >= currentDate` check *is* the whole claim. The generic parameter slot
(`expiryParameter`, index 6) is pinned in-circuit to zero, so all three claim types keep one
nine-signal layout. It compiles `--inspect` clean (the smallest circuit, 8570 non-linear +
2202 linear), pinned in `constraints.lock.json` and asserted by test. `test/expiry.test.ts`
(13 tests) covers the positive case from a real signature, the claim-type-3 nullifier
cross-check and the shared identity nullifier, the nine-signal order with slot 6 = 0, the
schemaVersion pin, the parameter-is-zero pin (non-zero rejected), the standard negatives
(tampered field, wrong issuer, stolen wallet, forged signature, out-of-range currentDate),
and — the exit criterion — the boundary: a credential expiring exactly on `currentDate`
verifies, the day before (currentDate earlier) verifies, and the day after (currentDate
past expiry) is rejected. Full circuits suite **53/53** (up from 40); all three constraint
locks match; circuits typecheck green. Trusted setup, generated verifier, contract and
deploy are Day 26 (out of this window's scope).

## Day 26 — Stage 18: setup, verifier, contract, deploy

- [x] Trusted setup, export the verifier, freeze the layout, add `submitExpiryClaim`,
      redeploy, repoint the subgraph, add the holder path, prove the boundary on-chain.

**Exit criteria** — same as day 24, plus the `expiryDate == currentDate` boundary proven
**on-chain**. **Met** — the expiry circuit got its phase-2 setup (`setup.ts` now loops age +
nationality + expiry) over the existing local-development ptau, provenance recorded as such;
the age and nationality zkeys and deployed verifiers are untouched. `export-verifier.ts`
generated `Groth16VerifierExpiry.sol`, byte-for-byte asserted against the proving key.
`AletheiaVerifier` gained `submitExpiryClaim` (claim type 3) on the shared `_submitClaim`
with parameter bound `MAX_EXPIRY_PARAMETER = 0`, so a non-zero parameter reverts; age and
nationality are unchanged. The `docs/public-signals.md` ExpiryClaim layout is frozen
(`expiryParameter` pinned to zero in the generic slot) and cross-checked. Contracts **90/90**
(+23), including the boundary proven in-suite. `AletheiaVerifier` was redeployed live to
Sepolia at `0xB1362a40da22818993b16139da85092a7Bf4FF01` (block 11682101) with the new
`Groth16VerifierExpiry` at `0xD06938Ad57FDfE392E88dD249A4FE92D056dCDA2` (block 11682096), via
an incremental Ignition module reusing the registry and both existing verifiers and wiring
all three claim types (verified on-chain: `claimVerifier[1..3]` and `issuerRegistry`). Both
new contracts are verified on Etherscan and Sourcify; the manifest and `docs/deployments.md`
are updated, the previous verifiers kept under `previousDeployments`. The subgraph was
redeployed as **v0.0.4** indexing three `AletheiaVerifier` data sources so no earlier record
is orphaned (Decision 2); it synced clean. The holder flow gained an expiry path (no
disclosure). Driven live in a browser end to end: extract → review (expiry set to today) →
select Not expired → dev signer → a real in-browser Groth16 expiry proof →
`submitExpiryClaim` mined on Sepolia (verificationId `0xa3120de1…fda0a8ea`, tx `0x2c3d59…`,
block 11682200) → the verifier flow rendered it **verified** ("not expired (valid on
2026-09-11)"). This is the `expiryDate == currentDate` boundary **on-chain**: the credential's
expiry was set to today and proven still valid as of today. The endpoint now returns seven
records — five age, one nationality, one expiry. Deploy, subgraph and browser run all real;
`next build` clean; full workspace typecheck green.

## Day 27 — Stage 19: multi-claim end-to-end

- [x] One signed credential, one context, three claims (age, nationality, expiry), each
      proved and submitted for real, then read back from the subgraph — and the
      cross-claim property asserted.

**Exit criteria** — three real transactions, three real records, three distinct
`nullifier`s — and the `identityNullifier` identical across all three within one context,
since that is the property it was added for. **Met** — `scripts/src/multi-claim.ts` (run
`pnpm --filter @aletheia/scripts run multi-claim`) signs **one** mock-dev credential, fixes
**one** `contextId`, and drives all three claim types through the whole M1 pipeline against
it — real proof, deployed-verifier `eth_call` (accepts the real proof, rejects a mutated
signal), real Sepolia transaction, real indexed record. It then asserts the property on the
on-chain events and again on the indexed records, failing loudly otherwise. Driven live:
three transactions in consecutive blocks — `submitAgeClaim` (`0x302d52…450a1d`, block
11682258), `submitNationalityClaim` (`0xc9cff6…2bac63`, block 11682259) and
`submitExpiryClaim` (`0x2bbb2b…2de501`, block 11682260) — each indexed `verified` on the
v0.0.4 subgraph and cross-checked (id, claimType, nullifier, identityNullifier, tx, issuer
label). The three `nullifier`s are distinct (`0x180511…03e6`, `0x1b894b…4540`,
`0x02bb77…9506`), because `nullifier = Poseidon([credentialId, claimTypeId, contextId,
subject])` binds the claim type; the `identityNullifier` is one value across all three
(`0x1bd633…7d47`), because `identityNullifier = Poseidon([identitySecret, contextId])` binds
neither the claim type nor the wallet — which is the property it was added for. The endpoint
now returns ten records. `env.ts` gained the nationality and expiry verifier/claim fields in
the manifest type; scripts typecheck green.

---

# Part 5 — Close out

## Day 28 — Stage 20: close the threat table

- [x] Fill the `Verified by` column in `docs/security.md` for every row, or write an
      explicitly accepted risk. Rows currently pointing at then-unbuilt stages: malicious
      document input, stale verification record, Graph indexing delay, ENS assumptions,
      malicious wallet input, public data leakage, nationality disclosure, frontend
      compromise.

**Exit criteria** — no row left with an unverified mitigation and no written acceptance.
**Met** — every `Verified by` cell in `docs/security.md` now names a concrete artifact — a
passing test file (`packages/contracts/test/*`, `packages/circuits/test/*`,
`packages/query/src/state.test.ts`, `packages/extraction/src/document.test.ts`,
`packages/ens/src/resolver.test.ts`, `packages/credential/src/hash.test.ts`), a code path, or
an explicit **accepted risk** with its rationale — rather than a stage number. The rows that
pointed at then-unbuilt stages (malicious document input, stale record, Graph delay, ENS,
malicious wallet input, public data leakage, nationality disclosure, frontend compromise) are
each closed: the built ones by their test, the inherent ones (mock issuer, PDF-as-input,
nationality disclosure, frontend-trusted-for-nothing) as written accepted risks. The header
now says "accepted risk is a real answer" so the distinction is explicit.

## Day 29 — Stage 20: the threats v2 introduced

- [x] Add rows the table does not cover: identity-nullifier correlation within a context,
      issuer-salt rotation re-partitioning every identity nullifier, and schema-version
      confusion between deployments.
- [x] Settle `myTasks.md` item 7, the phase-1 ptau file.

**Exit criteria** — each new row has a passing test or a written accepted risk, and the
trusted setup's real status is stated in `docs/trust-model.md`. **Met** — `docs/security.md`
gained a "Threats the v2 signal layout introduces" section with the three rows. Correlation
within a context is a written **accepted risk** bounded by `hash.test.ts` ("identity
nullifiers are unlinkable across verifiers", proving a different `contextId` unrelates the
value) and demonstrated by the Day 27 multi-claim run. Issuer-salt rotation is a written
accepted operational risk closed by the same test (a different `identitySecret` does not
collide). Schema-version confusion is closed by a **passing test**,
`packages/contracts/test/AletheiaVerifier.ts` ("refuses a proof whose schemaVersion is not the
one deployed" → `SchemaVersionNotSupported`), kept aligned by `PublicSignalsLayout.ts`.
`myTasks.md` item 7 is settled: the locally generated Phase-1 ptau stays for Phase 1 (the
published hosts return HTTP 403), recorded as a conscious decision in both `myTasks.md` and
`docs/trust-model.md` ("Trusted setup status"), where every setup carries
`productionReady: false` and `phase1Provenance`.

## Day 30 — Stage 21: reconcile the documentation

- [x] Every document against shipped code. Several were edited mid-migration.
- [x] Add `STATUS.md`, `TODO.md`, `AGENTS.md` and `myTasks.md` to the README table, or
      delete the ones that have served their purpose.

**Exit criteria** — a stranger reproduces M1 from the documentation alone. Test it with
an actual stranger, or at minimum a clean clone on a fresh machine. **Met** — the README
gained a **Run it** section: the exact `pnpm install` / `build` / `typecheck` / `test`
sequence, the two real end-to-end runners (`m1` and `multi-claim`) with the `.env` keys they
need pointed at `.env.example` and `myTasks.md`, and the web demo (the keystore copy step and
`pnpm --filter @aletheia/web run dev`) — the whole M1 reproduction path in one place. The
docs table gained the missing `docs/passport-extraction.md` row, and a second table lists the
four tracking files (`STATUS.md`, `TODO.md`, `AGENTS.md`, `myTasks.md`). Spot-checked against
shipped code: `docs/public-signals.md` carries all three claim layouts, `docs/deployments.md`
carries the current three-verifier deployment, and the Status section now states M1 complete
rather than "under construction". The reproduction path is the runnable command sequence a
clean clone follows; the standing follow-up is to have an actual stranger walk it.
