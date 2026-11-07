# Status

Snapshot taken 2026-09-11. The **credential schema v1 to v2 migration (Part 0, Days
1–4)** is complete and committed as reviewable per-area commits on top of `0ad8687`
("Add the Solidity verifier and the contracts that decide a claim on-chain").

This file describes what is true right now. `TODO.md` describes what is left. Neither
records anything aspirational: if something is not built, it says so.

## One paragraph

Committed history now reaches the end of **Part 0**: the schema v2 migration is finished
and committed across `packages/credential`, `packages/circuits`, `packages/contracts`,
`packages/issuer-mock` and the normative documents. The full workspace test run is green
and `pnpm -r run typecheck` is green. The nine-signal AgeClaim layout is asserted to agree
across `docs/public-signals.md`, `AGE_PUBLIC_SIGNALS`, the generated verifier and
`AletheiaVerifier` by `packages/contracts/test/PublicSignalsLayout.ts`. The v2 contracts
are now **deployed to Sepolia (Day 8 done)**: four fresh verified addresses, the retired
v1 deployment dropped, and the `mock-dev` issuer registered and reading back active.
Nothing downstream of the contracts — subgraph, web frontend, end-to-end runner — exists
yet. Day 6 is done: `DateLib.toYyyymmdd` is compared directly against the TypeScript codec
on every day from 1970-01-01 to 2100-12-31 (~47,800 samples) with zero divergence, plus an
explicit leap-year-boundary sweep. Day 7 is done:
`packages/contracts/scripts/register-issuer.ts` reads the mock issuer key from the
gitignored keystore, refuses any keystore not labelled `mock-dev`, reads the registry
address from the Ignition deployment for the connected chain, registers the issuer as
`mock-dev`, reads it back active, and refuses a second run rather than double-registering.
Day 9 is done: a genuine age proof was submitted on Sepolia and the identical proof, on
resubmission, reverted on-chain with `VerificationAlreadyRecorded`. Day 10 is done:
`packages/subgraph` now exists with the designed schema (`Profile`, immutable
`Verification`, `Issuer`; `Bytes` ids; `@derivedFrom` on the one side of each relation)
and a three-dataSource manifest on `sepolia` starting at the stage 10 deploy blocks;
`graph codegen` and `graph build` run clean with no `eth_call` anywhere. Day 11 is now
done: the four event handlers (`ClaimVerified`, `IssuerRegistered`, `IssuerActiveSet`,
`ProfileRegistered`) are implemented and matchstick is green — six tests covering a first
verification, a second in a different context, an issuer revocation, the `mock-dev` label
reaching the `Issuer`, the unknown-issuer guard, and `ProfileRegistered`. Day 12 is now
done: the subgraph is deployed to Subgraph Studio on Sepolia (slug `aletheia`, version
`v0.0.2`, deployment `QmNu6wYNr71…gpVEL`), synced with `hasIndexingErrors: false`, and the
stage 11 `ClaimVerified` is queryable as a real `Verification` entity from the Studio
endpoint. Day 13 is now done: `packages/query` is a typed GraphQL read client — one
`fetch`-based transport, strict decoders, five typed reads, every one returning
`_meta.block.number` and `hasIndexingErrors` alongside its records — and
`scripts/check.ts` ran it live against the deployed Studio endpoint, reading indexer
block **11676205** (`hasIndexingErrors: false`) and the stage 11 `Verification`
`0xd24a4fc1…928c3`, confirmed against transaction `0x195671d0…b92719` and the `mock-dev`
issuer label, with the subject's derived `Profile.verifications` resolving back to the
same record. Introspecting the live schema surfaced a genuine bug before the gate closed:
graph-node's built-in `_meta.block.number` is `Int!` (a JSON number), unlike the
subgraph's own `BigInt` fields (decimal strings), and `decode.ts` had assumed the latter
for both. Fixed in the decoder, not worked around. No mocked `fetch` anywhere in the read
path. Day 14 is now done: `packages/query` derives the **five verification states**
(`verified`, `stale`, `revoked`, `pending`, `not-found`) from a real read via the pure
`deriveVerificationState`, and all five were reproduced against the live Studio endpoint
with real artifacts — including an actual on-chain issuer revocation and re-activation for
`revoked`, and a real submit-and-poll for `pending`. Day 15 is now done: `packages/ens` is
a read-only ENS resolver — `createEnsResolver` with `resolveAddress` (forward, name →
address) and `resolveName` (reverse, address → name), both through the ENS Universal
Resolver proxy `0xeEeE…EeEe` over `MAINNET_RPC_URL` using viem 2.56, with no writes, no
registrar and no injectable transport. `scripts/check.ts` ran live against real mainnet
ENS and closed all three exit criteria: `vitalik.eth` resolved to
`0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045` (never hardcoded, never special-cased), that
address reverse-resolved to `vitalik.eth` and forward round-tripped back (ENSv2 enforces
the forward-match on-chain), a nonexistent name returned `null` rather than throwing, and a
keccak-derived address with no reverse record returned `null` as a first-class outcome. The
name is resolved live and stored nowhere — not on-chain, not in the subgraph
(`docs/architecture.md`, ENS section). Day 16 is now done: the **M1 end-to-end runner**
exists as the top-level `scripts` package and ran the whole pipeline against real
infrastructure in one command — a `mock-dev` credential, a checked witness, a real Groth16
proof, a local verify, a Solidity verify against the **deployed** verifier (accepts the
real proof, rejects a mutated signal), a real `submitAgeClaim` on Sepolia (tx
`0xc4648df4…7f313c`, block 11678827), the `ClaimVerified` event cross-checked, the subgraph
observed `pending` then `verified`, and the indexed record read back through
`@aletheia/query` and cross-checked against the on-chain event. Day 17 is now done: MRZ
parsing (Part 3, product). `packages/extraction` turns an untrusted TD3 passport MRZ into
candidate credential fields — ICAO `7-3-1` check digits (validated against the published
ICAO 9303 specimen, not against themselves), century inference that reports *ambiguous*
rather than guessing, and the sex code — while the ICAO alpha-3 → ISO 3166-1 numeric
**nationality table** and the century-inference rule live in `packages/credential` so one
module owns every encoding. A valid Indian fixture extracts all fields; a corrupted check
digit reports **which** field failed; a would-be-centenarian date of birth returns
*ambiguous* and an ICAO code with no ISO numeric (e.g. the specimen's `UTO`) returns
*unsupported* — neither is ever guessed. Extraction produces candidate fields, never
evidence: it holds no key and touches no network. Day 18 is now done: **image and PDF
input** (Part 3, product). `packages/extraction` grew three converging input paths — typed
MRZ text, an image (real tesseract.js OCR with a committed MRZ-specific model), and a PDF
(pdf.js text layer, document JavaScript disabled) — that each decode to text, locate the two
44-character MRZ lines, and run the **same** `parseTd3Mrz`. A committed fixture image and a
committed fixture PDF of one Indian specimen both extract to the identical candidate fields
the raw MRZ yields, and the gate test severs `http`/`https`/`fetch` around each run and
asserts zero network hits: the wasm core and the model load from disk, never a CDN. Byte and
page caps bound a hostile file before decode, and extracted text is only ever parsed, never
evaluated. Extraction runs off the main thread through a Web Worker transport over the same
tested core. Day 19 is now done: **`documentKey` derivation** (Part 3, product).
`packages/extraction/src/document-key.ts` adds `deriveDocumentKey`, a pure offline function
that turns the four stable identifying fields of a TD3 passport — issuing nationality,
document number, date of birth, date of expiry (the ICAO chip-key tuple, plus nationality
to disambiguate a number reused across issuers) — into the stable field element
`deriveIdentitySecret({ issuerSalt, documentKey })` expects and nothing produced before.
It hashes a domain-separated, unambiguously framed canonical string with SHA-256 and
reduces it into the bn128 field with `hashToField` (leading 31 bytes). All four
exit-criteria properties are gated by test: a pinned fixture vector so the derivation
cannot drift; the same passport → the same key (directly, and re-parsed twice through the
real `parseTd3Mrz`); four independently-differing passports all distinct plus a
field-framing test that a shifted boundary cannot alias another; a canonical non-zero
element below the modulus; and it never leaves the device (pure, holds no key, issues no
request). The value flows straight into `deriveIdentitySecret`, confirmed end to end.
Day 20 is now done: the **holder flow** (`packages/web`, Next.js 15) runs the whole
pipeline in the browser — extract, a **mandatory** review-and-correct step, `documentKey`
derivation and mock-dev signing on-device, a real Groth16 proof via snarkjs (wasm/zkey
served from the app origin), and `submitAgeClaim` on Sepolia through viem (injected wallet,
or a dev local-signer for headless runs). A live run produced tx
`0xcdadf4342f73da581fddaae76f3122806daf3853e9d94d4d93d237c8ac24044a` (block 11680359,
success), cross-checked on-chain: `ClaimVerified` with the connected wallet as subject, the
registered `mock-dev` issuer, claimType 1, minAge 18. The network tab over the run shows
only same-origin traffic (app chunks, the gitignored mock-dev keystore, the circuit
wasm/zkey/vkey, snarkjs worker blobs) plus RPC calls carrying only the proof calldata — the
date of birth, nationality, expiry and document number never leave the device. Making the
browser bundle possible needed `./browser` (and `@aletheia/credential/test-fixture`)
subpath exports splitting the fs-only pieces out of four packages, leaving every Node
barrel unchanged.

Days 22–24 added the **nationality claim** end to end: `nationality.circom` on the shared
base (Day 22), its trusted setup, generated verifier and `submitNationalityClaim` on a
shared `_submitClaim` with the layout frozen (Day 23), then a live redeploy — a new
`AletheiaVerifier` (`0xce95C4…`) and `Groth16VerifierNationality` (`0xB559D2…`), both
Etherscan/Sourcify-verified, the subgraph redeployed as v0.0.3 indexing the new and previous
verifiers together (Decision 2), and a holder-flow nationality path with a pre-proof
disclosure (Day 24). A live browser run proved and submitted a real nationality claim
(`0x7977b9…`, block 11681828) and the verifier flow rendered it `verified`; the subgraph now
returns the five historical age records and the new nationality record.

Days 25–26 added the **expiry claim** end to end. Day 25 was `expiry.circom` on the shared
base — the inherited `expiryDate >= currentDate` check is the whole claim, the generic
parameter slot pinned to zero to keep one nine-signal layout, constraints locked, and the
`expiryDate == currentDate` boundary verified on both sides. Day 26 added its trusted setup
(phase-2 over the local-development ptau), the generated `Groth16VerifierExpiry.sol`, and
`submitExpiryClaim` on the shared `_submitClaim` (age and nationality unchanged; the expiry
parameter bound is zero, so a non-zero parameter reverts). A new `AletheiaVerifier`
(`0xB1362a…`) and `Groth16VerifierExpiry` (`0xD06938…`) were deployed live, both
Etherscan/Sourcify-verified, wiring all three claim types; the subgraph was redeployed as
**v0.0.4** indexing three verifier data sources so no earlier record is orphaned (Decision 2),
and the holder flow gained an expiry path. A live browser run proved the boundary **on-chain**
— a credential whose expiry was set to today, proven still valid as of today — submitted
`0x2c3d59…` (block 11682200), indexed and rendered `verified` ("not expired (valid on
2026-09-11)"). The endpoint now returns seven records: five age, one nationality, one expiry.

Day 27 (Stage 19) tied the three claims together. `scripts/src/multi-claim.ts` signs **one**
mock-dev credential, fixes **one** `contextId`, and drives age, nationality and expiry each
through the full M1 pipeline against that one credential — real proof, deployed-verifier
`eth_call`, real Sepolia transaction, real indexed record. A live run submitted three
transactions in consecutive blocks (`0x302d52…` age / 11682258, `0xc9cff6…` nationality /
11682259, `0x2bbb2b…` expiry / 11682260), all three indexed `verified` on the v0.0.4
subgraph. It asserts — on the on-chain events and again on the indexed records — the property
the second nullifier was added for: the three `nullifier`s are **distinct** (claim-type-bound,
`Poseidon([credentialId, claimTypeId, contextId, subject])`) while the `identityNullifier` is
**one value** across all three (`0x1bd633…7d47`, `Poseidon([identitySecret, contextId])`, bound
to neither claim type nor wallet). The endpoint now returns ten records.
Contracts are 90/90, circuits 53/53.

Days 28–30 (Stages 20–21) closed the project out. Day 28 filled every `Verified by` cell in
`docs/security.md` with a concrete artifact — a passing test, a code path, or an explicit
written accepted risk — so no row points at a stage number. Day 29 added the three threats the
v2 signal layout introduces (identity-nullifier correlation within a context, issuer-salt
rotation re-partitioning identity nullifiers, schema-version confusion between deployments),
each closed by a test or a written acceptance, and settled `myTasks.md` item 7: the locally
generated Phase-1 ptau stays (the published hosts return HTTP 403), recorded as a conscious
decision in `docs/trust-model.md`. Day 30 reconciled the docs against shipped code and gave the
README a runnable **Run it** section (the M1 reproduction path end to end), added the missing
`docs/passport-extraction.md` row and a tracking-files table. **M1 is complete** — the whole
pipeline runs end to end against real infrastructure across three claim types, with a browser
holder flow, a verifier flow, a deployed subgraph, and live ENS. Remaining before production
is unchanged and documented: a published phase-1 ceremony and a multi-party phase 2.

Day 21 is now done: the **verifier flow** (`packages/web`, `/verify`). It resolves an ENS
name (forward) or a typed address (with a best-effort reverse-name lookup) live over
mainnet through `@aletheia/ens/browser`, reads the subject's verifications from the subgraph
through `@aletheia/query/browser`, and classifies each record with the same pure
`deriveVerificationState` the query package unit-tests. A freshness-window selector renders
one real record as `verified` or `stale` with no re-query; an absent address renders `not
found`; a watch panel polls `verificationState(id, {expectedBlock})` and shows `pending`
(awaiting-index) flipping to `verified` the instant the record is indexed, without a reload;
the holder flow links straight into it after a submit. Every record shows the `mock-dev`
label and links to its Sepolia transaction. Driven live against the deployed subgraph:
`verified`, `stale`, `not found` and `pending` all reproduced in the real UI from real
endpoint data (`revoked` is the same rendering path, driven by `issuer.active`, reproduced
live at Day 14). To keep `node:fs` out of the browser bundle, `@aletheia/query` and
`@aletheia/ens` gained `./browser` entries: the root-`.env` loader was split into a
`root-env.ts`, the Node barrels wrap the client/resolver factories to call it, and the
browser factories take their endpoint explicitly. `next build` is clean with no `node:fs`
in the client bundle.

## Build status

`pnpm -r run typecheck` is green. Per-package test state:

| Package | Result |
|---|---|
| `packages/credential` | **52 of 52 passing** (Day 1 done; +16 for Day 17 — the nationality alpha-3 → ISO 3166-1 table and the century-inference rule) |
| `packages/issuer-mock` | **18 passing** (a stale v1 malformed-credential test was fixed during Day 4) |
| `packages/circuits` | **53 of 53 passing**. Day 22 added `nationality.circom` on the shared base (+14: `requiredNationality === nationality`, full negative suite); Day 25 added `expiry.circom` (+13): the base `expiryDate >= currentDate` check is the whole claim, the generic parameter slot pinned to zero, 8570+2202 constraints locked, and the `expiryDate == currentDate` boundary verified on both sides. All three circuits compile `--inspect` clean; all three constraint locks asserted. Both nationality (Day 23) and expiry (Day 26) have their phase-2 setup, generated verifier and contract entrypoint; the expiry proving path (`expiryClaimInput`, `expiry-signals.ts`, `expiry.ts`) mirrors age and nationality |
| `packages/contracts` | **90 passing** (Day 26 added the expiry claim, +23): `submitExpiryClaim` on the shared `_submitClaim` (age and nationality unchanged; the parameter bound is zero, so a non-zero parameter reverts), `Groth16VerifierExpiry.sol` generated and asserted against the proving key, the nine-signal layout frozen and cross-checked, the shared identityNullifier proven identical across an age and an expiry claim in one context, and — the exit criterion — the `expiryDate == currentDate` boundary proven on-chain (a credential expiring exactly on the date proven verifies; one that expired the day before is unprovable). Day 23 added the nationality claim (+21). Day 6 `DateLib` sweep still green |
| `packages/subgraph` | **6 matchstick tests passing** (Day 11); `graph codegen`/`graph build` clean, no `eth_call`. Redeployed to Studio as **v0.0.4** (Day 26): three `AletheiaVerifier` data sources — the new stage-18 verifier, the stage-17 verifier and the stage-8..16 verifier — share one mapping so every earlier record survives the redeploy (Decision 2). Synced clean, no indexing errors. After the Day 27 multi-claim run the endpoint returns ten records — six age, two nationality, two expiry — including the three claims (one of each type) submitted against one credential in one context, sharing a single `identityNullifier` |
| `packages/query` | **40 of 40 passing** (Day 14 done, +13 for the five-state derivation); `scripts/check.ts` and `scripts/states.ts` pass live against the deployed Studio endpoint. Day 21 added a `./browser` entry (the root-`.env` loader split into `root-env.ts`, the Node barrel wraps the factory to call it) so the verifier flow can read the subgraph in the browser |
| `packages/ens` | **11 of 11 passing** (Day 15 done); pure seams unit-tested (env validation, UTS-46 name normalisation, address checksumming); `scripts/check.ts` passes live against real mainnet ENS through the Universal Resolver. Day 21 added a `./browser` entry the same way, so the verifier flow resolves ENS on-device |
| `packages/extraction` | **44 of 44 passing** (Days 17–19 done): Day 17 TD3 MRZ parsing (check digits anchored to the ICAO 9303 specimen, century inference, sex); Day 18 image and PDF input — `extractFromMrzText`/`extractFromImage`/`extractFromPdf` converge on the one parser, a committed fixture image (real offline OCR, MRZ model) and fixture PDF (pdf.js text layer, JS disabled) reach the same fields as the raw MRZ, the gate test proves zero network by blocking every socket, and byte/page caps bound input before decode; Day 19 `deriveDocumentKey` — a stable, on-device field element identifying one passport (SHA-256 over the four stable MRZ identity fields, reduced with `hashToField`), +12 tests covering a pinned vector, determinism through the real parser, cross-document distinctness and field element-ness. `typecheck`/`build` clean; built `dist` smoke-tested. |
| `scripts` | **no unit tests by design** (Day 16 done): it is the cross-package end-to-end runner, and its whole product is a live run against real infrastructure, `pnpm --filter @aletheia/scripts run m1`. `typecheck` clean. A recorded green run is below. |
| `packages/web` | **Days 20–21 done** — the Next.js holder flow (`/`) and verifier flow (`/verify`). No unit tests by design; its product is a live browser run. Day 20: a recorded run submitted tx `0xcdadf4…24044a` (block 11680359) from a browser-produced proof, with the passport never leaving the device (network-tab verified). Day 21: the verifier flow resolves ENS/address, reads the subgraph, and renders the five states — `verified`, `stale`, `not found` and `pending` all driven live in a browser against the deployed subgraph, `revoked` the same rendering path. Day 24: the holder flow gained a nationality claim path with a pre-proof disclosure (an acknowledgement gates proving), a real nationality proof was produced in-browser and submitted (`submitNationalityClaim`, block 11681828), and the verifier flow rendered it `verified`. Day 26: the holder flow gained an expiry path (no disclosure — nothing is revealed but the fact of validity), a real expiry proof was produced in-browser and submitted (`submitExpiryClaim`, tx `0x2c3d59…`, block 11682200) proving the `expiryDate == currentDate` boundary on-chain, and the verifier flow rendered it `verified` ("not expired (valid on 2026-09-11)"). `next build` clean with no `node:fs` in the client bundle. Reuses the shared packages through their `./browser` entries. Setup, both signer paths and both flows in `packages/web/README.md`. |

`packages/web` is named in `docs/architecture.md` and does not exist yet (Day 20);
`packages/extraction` (Days 17–18) is what it will consume — the MRZ parser plus the
image/PDF input paths and their Web Worker transport, all browser-capable and offline, and
still buildable and testable under Node without a browser. The top-level `scripts` M1
runner exists (Day 16). `packages/subgraph` exists with its
schema, manifest, four implemented event handlers and matchstick coverage (Days 10–11), and
is deployed to Studio (Day 12, slug `aletheia` v0.0.2, synced clean).

## The schema v2 migration

### What it changes

Three things, all interlocking:

1. A new private credential field, `identitySecret`, issuer-derived as
   `Poseidon([issuerSalt, documentKey])`. It is stable across credentials the same issuer
   derives from the same document, deliberately unlike the per-instance random
   `credentialId`.
2. `schemaVersion` is promoted from a circom template parameter to a **public signal**,
   pinned in-circuit to the compiled constant, so `AletheiaVerifier` can route on it
   instead of being silently unable to distinguish a v1 proof from a v2 proof.
3. A second circuit output, `identityNullifier = Poseidon([identitySecret, contextId])`,
   carrying no `credentialId`, no `subject` and no `claimTypeId`.

The signed message goes from `Poseidon(7)` to `Poseidon(8)`, and the age circuit's public
signals go from **seven to nine**:

```
0 nullifier          output
1 identityNullifier  output      <- new
2 schemaVersion      public in   <- new
3 issuerAx
4 issuerAy
5 currentDate
6 minimumAge
7 contextId
8 subject
```

Constraints moved with it: 8421 non-linear / 1872 linear under v1, **8685 / 2216** under
v2, recorded in `packages/circuits/constraints.lock.json`.

### What is done

- `packages/circuits` is fully migrated. `lib/credential.circom` pins the version, hashes
  eight inputs, and emits both nullifiers; `age.circom` instantiates `AgeClaim(2)` and
  declares the new public signal. The circuit compiles `--inspect` clean, the constraint
  lock is updated with a written rationale, and all 26 tests pass — including a real
  Groth16 proof, the decoded signal order, altered-signal rejection and tampered-proof
  rejection. A new proving key and verification key have been generated.
- `packages/credential` carries the v2 field, the widened hash, the `identityNullifier`
  derivation, JSON serialization for `identitySecret`, and a guard rejecting
  `identitySecret == credentialId`.
- `packages/issuer-mock/src/identity.ts` (untracked) derives `identitySecret` and
  documents, at length, that it is neither a person identifier nor Sybil resistance.
- `docs/credential-schema.md` and `docs/trust-model.md` carry the reasoning: why
  `credentialId` must stay random, why uniqueness belongs in a separate signal, and why
  two schema versions cannot be live for one claim type on one deployed verifier.

### What is not done

- ~~`packages/credential` has two stale test expectations.~~ **Done (Day 1).** The
  constant assertion and the seven-input `field order is load-bearing` vector were
  updated to v2, `MAX_SCHEMA_VERSION` is now pinned, and coverage the migration had left
  untested was added: an `identitySecret` mutation row, an arity check that a v1 message
  is not a v2 message, and three `identityNullifier` tests (pinned value, survives
  re-issuance and a change of wallet, unlinkable across contexts). 31 to 36 tests, all
  green, and the new pinned tests were confirmed to fail on a deliberately swapped hash
  order before being kept.
- **`packages/contracts` is fully migrated.** `Groth16VerifierAge.sol` was re-exported
  from the new v2 zkey (Day 2): it takes `uint[9]`, carries IC0–IC9, and
  `test/Groth16VerifierAge.ts` passes all seven cases, with the committed `.sol` asserted
  byte-for-byte against a fresh export of the current proving key. `AletheiaVerifier` is
  now v2 (Day 3): it declares `IGroth16Verifier9`, `submitAgeClaim(..., uint256[9])`, and
  the nine-signal indices (`nullifier` 0, `identityNullifier` 1, `schemaVersion` 2,
  `issuerAx` 3, `issuerAy` 4, `currentDate` 5, `minimumAge` 6, `contextId` 7, `subject`
  8). It refuses any `schemaVersion != 2` with a named `SchemaVersionNotSupported` error
  before the pairing check (constant `SUPPORTED_SCHEMA_VERSION`, a `uint16`), and
  `ClaimVerified` now carries `identityNullifier` — non-indexed, with the per-context
  correlation consequence written into `docs/trust-model.md` first. Full suite: 39
  passing. The negative suite was then completed (Day 5): every failure mode — wrong
  subject, stale date, future date, out-of-range parameter, unregistered issuer, revoked
  issuer, nullifier reuse, malformed proof, wrong schema version — has its own test and
  its own named error, none asserting a generic revert, and a `ReserveOrderingProbe`
  test-only adversarial verifier proves the nullifier is reserved *before* the external
  verifier call (the reentrancy defence). The probe reads back the reservation at the
  moment it is invoked and reverts carrying it; the assertion was confirmed to fail when
  the observed value was flipped, so it is a real regression guard rather than a vacuous
  decode. Full contracts suite: 45 passing.
- ~~`docs/public-signals.md` is still stale.~~ **Done (Day 4).** It now freezes the
  nine-signal v2 layout, and `packages/contracts/test/PublicSignalsLayout.ts` asserts
  that layout agrees with `AGE_PUBLIC_SIGNALS`, the generated verifier and
  `AletheiaVerifier` — so the normative document cannot silently drift from the code
  again. `docs/credential-schema.md` was re-read against shipped code and carried to v2:
  the `identitySecret` field, the eight-input signed message, the `identityNullifier`
  section, the v2 wire format, and the schema-version-as-public-signal routing rule.

## The Sepolia deployment

The **v2** contracts are live on Sepolia, deployed 2026-09-10 by
`0xA66f7fc3F125b06a5fd4f107D31a400103866cAe`. Full record in `docs/deployments.md`:

| Contract | Address | Deploy block |
|---|---|---|
| `AletheiaIssuerRegistry` | `0xC3F1ee25b47BbFD25B359B2301ABbDF27d987286` | 11674698 |
| `Groth16VerifierAge` | `0x369b25B54a7829dE4343eA3625f0FC7D8A2D6eb7` | 11674698 |
| `AletheiaVerifier` | `0x110BB3af042ecbeA118d399e300a4358DC9b993c` | 11674703 |
| `AletheiaProfile` | `0x64C2c9974B5f6960E9671C0D843a29Be499dB534` | 11674698 |

`setClaimVerifier(1, Groth16VerifierAge)` confirmed in block 11674709; an on-chain read
confirms `SUPPORTED_SCHEMA_VERSION == 2` and `claimVerifier[1]` points at the deployed
`Groth16VerifierAge`. All four are verified on Etherscan and Sourcify.

The old v1 deployment (`0x51623fDD…`, `0x96888b28…`, `0x899DC043…`, `0x906c2D20…`) was
obsolete — seven-signal, not upgradeable, no v2 proof submittable. Its Ignition state for
`chain-11155111` was wiped and it was redeployed fresh; the retired addresses are dropped.

The `mock-dev` issuer is registered and active:
`issuerId 0xfee4bdf6ec605973cbc4ae331ef4c92cfc89ce43fb42da6d4d6517a164be2588` (register tx
`0xe58167bb6d5ddc0dbf4c67aad0982f026d85efda7e14df01a2afc00a70cee2dc`, block 11674721),
read back active on-chain. It verifies no identity — see `docs/trust-model.md`.

The deployer key now lives in the repository-root `.env` (`SEPOLIA_PRIVATE_KEY`),
resolved via `hardhat.config.ts` loading `.env` into the environment — matching
`preflight.ts`. `.env.example` and the config comments were updated to remove the earlier
keystore contradiction (`myTasks.md` item 2).

## The first real `ClaimVerified` event (Day 9)

`packages/contracts/scripts/submit-age-claim.ts` ran the whole pipeline against Sepolia
for the first time: a credential the `mock-dev` issuer actually signed, bound to the
submitting wallet; a real Groth16 proof over `age.circom`; a real `submitAgeClaim`
transaction; and the emitted event read back from the mined receipt.

| | Transaction | Block | Result |
|---|---|---|---|
| Success | `0x195671d0f3d105a5401656b7ad35d0cd6d94190fd17061dd6d70833524b92719` | 11674993 | `ClaimVerified` emitted (gas used 312165) |
| Replay | `0x8aaf3b5ee12af4ad7386265578efae83e374905c5cc4c11b3682373889d1088c` | 11674994 | reverted on-chain, `VerificationAlreadyRecorded` |

The emitted event carried `verificationId`
`0xd24a4fc1052a1b7753e1fffd825666a3946fd2ee5c88e8f472fb743fab6928c3`, `claimType 1`,
`issuerId 0xfee4bdf6…be2588` (the `mock-dev` issuer), `claimParameter 18`,
`credentialValidOn 20260910`, and both nullifiers. The replay is a **real failed
transaction**, not a local `to.be.reverted`: gas was supplied explicitly so the node
broadcast and mined it (`status reverted`) rather than the RPC rejecting it during
estimation, and the custom error name was decoded from a live `eth_call` against the same
state. `credentialId` and `identitySecret` are freshly random per run, so the success
path never collides with a record a previous run left behind.

## The five verification states (Day 14)

`packages/query/src/state.ts` adds `deriveVerificationState` — pure (record + `_meta` +
freshness policy + injected `now` in, one of five named states out), the unit-tested seam
the same way the decoders are. Precedence is fixed: `pending / indexer-errored` first
(nothing an errored indexer returns can be trusted), then `pending / awaiting-index`
(absent but a newer block was expected), then `not-found`, then `revoked` (issuer inactive
outranks an old record), then `stale`, then `verified`. Freshness is measured on
`verifiedAt`, not `credentialValidOn`: the latter is day-granular and always today for a
same-day record, so it cannot express sub-day freshness — the module header and
`docs/security.md` carry the reasoning. `createQueryClient().verificationState(id, …)`
composes the live query with the derivation in one round trip; `scripts/states.ts` is the
read/derive gate.

All five were reproduced against the deployed Studio endpoint — no simulated state:

| State | Real cause / artifact |
|---|---|
| `verified` | the stage 11 record `0xd24a4fc1…928c3`, read live under a 30-day freshness window |
| `stale` | the *same* record read under a 1-hour window; it was genuinely ~4.7h old (`verifiedAt` 1789043940) |
| `not-found` | a live query for the all-zero id returned `null` with current meta |
| `pending` | `reproduce-pending.ts` submitted a real claim (tx `0xd7816a31…5801e`, block 11676384); the indexer sat at 11676383 for four polls (`awaiting-index`) then reached 11676384 and the same lookup flipped to `verified` |
| `revoked` | `setActive(mock-dev, false)` on-chain (tx `0x7a7b72f5…4636f`, block 11676390); once indexed the stage 11 record read `revoked` |

The revocation was reversed immediately: `setActive(mock-dev, true)` (tx `0x44bb9fc8…757d`,
block 11676394), confirmed back to `verified` once indexed, so the shared Sepolia
deployment is left exactly as it was — issuer active, both records verifiable. The extra
`pending` submit left a second real `Verification` on-chain
(`0x0053414b…47312`, block 11676384); it is a genuine record, not a fixture.

`packages/contracts` gained `@aletheia/query` as a devDependency (workspace) so
`reproduce-pending.ts` can both submit on-chain and derive the state from the live read in
one process. `scripts/set-issuer-active.ts` (refuses any issuer but `mock-dev`) is the
revoke/restore tool.

## The M1 end-to-end runner (Day 16)

The top-level `scripts` package (`@aletheia/scripts`) is the cross-package runner named in
`docs/architecture.md`. One command — `pnpm --filter @aletheia/scripts run m1` — drives the
whole pipeline against real infrastructure, in nine stages, and fails if any link is not
genuine: signed credential, circuit (witness), proof, local verify, Solidity verify,
Sepolia transaction, event, Graph, verifier query. It composes the shipped packages
(`@aletheia/credential`, `@aletheia/issuer-mock`, `@aletheia/circuits`, `@aletheia/query`)
and drives Sepolia with viem directly.

Its inputs come from honest sources, never a literal: deployed addresses from the committed
`packages/contracts/deployments/sepolia.json` (the durable copy of the gitignored Ignition
output), cross-checked live on-chain before anything is spent; contract ABIs from the
compiled Hardhat artifacts, so the runner drives exactly the deployed interface; secrets and
endpoints from the root `.env`. The `mock-dev` keystore is refused if its label is anything
else.

Recorded green run (2026-09-11):

| Stage | Result |
|---|---|
| Solidity verify | deployed `Groth16VerifierAge` (`0x369b25B5…`) accepted the real proof and rejected a mutated public signal, by `eth_call` |
| Sepolia transaction | `submitAgeClaim` tx `0xc4648df4bd85b029bea9c4f80a3e32f0d989916ed97cbf6eac30a7cb667f313c`, block 11678827, gas 312165 |
| event | `ClaimVerified` for verificationId `0x040bd180135e14c53028e3b80184a74f7c635f81ad1a9c0cb0b67f1b3bb9d651`, cross-checked against the proof, the simulation and the `mock-dev` issuer |
| Graph | observed `pending / awaiting-index` (indexer at 11678826, one block behind) then `verified` once the indexer reached 11678827 |
| verifier query | the indexed record read back `verified`, its id, nullifier, transaction hash and `mock-dev` label all matching the on-chain event |

The submit left one real `Verification` on Sepolia and in the subgraph
(`0x040bd180…3bb9d651`); it is a genuine record, not a fixture. `credentialId` and
`identitySecret` are fresh per run, so re-running never collides with a prior record.

## Stage gates

| # | Stage | State |
|---|---|---|
| 0 | Toolchain verification | closed — circom 2.2.3 asserted by the build script |
| 1 | Repository foundation | closed |
| 2 | Credential data model | **closed under v2** — 36 tests green, both nullifiers and the widened hash pinned by the v2 fixture |
| 3 | Mock trusted issuer | closed; `identitySecret` derivation added and untracked |
| 4 | AgeClaim circuit | **closed under v2** — `--inspect` clean, constraints locked, negative cases fail |
| 5 | Local witness generation | closed under v2 |
| 6 | Local Groth16 proof | **closed under v2** — `docs/public-signals.md` updated and asserted to match the artifacts |
| 7 | Local proof verification | closed under v2 |
| 8 | Solidity verifier | **closed under v2** — re-exported to `uint[9]`, 7 tests green, committed `.sol` asserted against the current proving key |
| 9 | Contract tests | **closed under v2** — `AletheiaVerifier` migrated to nine signals, 46 passing; full negative suite complete (Day 5), each failure mode named, reserve-before-verify ordering asserted; `DateLib` proven against the TS codec on every day 1970–2100 (Day 6) |
| 10 | Sepolia deployment | **closed** — v2 deployed, four addresses verified on Etherscan, `mock-dev` issuer registered and active, `docs/deployments.md` filled |
| 11 | Real `ClaimVerified` event | **closed** — genuine age proof submitted on Sepolia (tx `0x195671d0…`), replay reverted on-chain with `VerificationAlreadyRecorded` (tx `0x8aaf3b5e…`) |
| 12 | Subgraph | **closed** — schema, manifest, mappings and matchstick done (Days 10–11): 6 tests green, `graph codegen`/`graph build` clean, no `eth_call`; deployed to Studio (Day 12), slug `aletheia` v0.0.2, synced with no indexing errors, stage 11 `ClaimVerified` queryable as a real `Verification` |
| 13 | GraphQL query layer | **closed** — `packages/query` reads live from the Studio endpoint: `scripts/check.ts` returned indexer block 11676205, the stage 11 `Verification` matched against its transaction hash and `mock-dev` issuer label, and the derived `Profile.verifications` side; the **five verification states** are now derived by the pure `deriveVerificationState` and all five reproduced from real endpoint data (Day 14) — a real on-chain revoke/restore for `revoked`, a real submit-and-poll for `pending`; 40 unit tests green, no mocked `fetch` (next: Day 15, ENS) |
| 14 | ENS resolution | **closed** — `packages/ens` resolves forward and reverse through the Universal Resolver proxy over mainnet, read-only, viem 2.56: `scripts/check.ts` ran live and `vitalik.eth` → `0xd8dA…6045` with the reverse round-trip, a nonexistent name returned not-found without throwing, and a keccak-derived address with no reverse record returned null; 11 unit tests green, the name resolved live and stored nowhere |
| — | **M1 end-to-end** | **closed** — the top-level `scripts` runner drives all nine stages against real infrastructure in one command; a green run submitted tx `0xc4648df4…7f313c` (block 11678827) and read the record back `verified` from the deployed subgraph, observing `pending` then `verified` |
| 15 | Document extraction | **closed** — `packages/extraction` parses a TD3 MRZ into candidate fields (Day 17: Indian fixture extracts, a failing check digit names its field, an ambiguous century and unmapped nationality return without guessing; ICAO 9303 specimen anchor), converges typed/image/PDF input on the one parser in a worker with zero network and input caps (Day 18), and derives `documentKey` — a stable on-device field element identifying one passport, feeding `deriveIdentitySecret` (Day 19); 44 tests green |
| 16 | Frontend (age only) | **closed (Days 20–21)** — `packages/web` (Next.js). Holder flow: extracts, enforces a mandatory review, signs mock-dev on-device, proves age in-browser (snarkjs), and submits to Sepolia; a live run produced tx `0xcdadf4…24044a` (block 11680359) with the passport never leaving the device. Verifier flow (`/verify`): resolves ENS/address, reads the subgraph, renders the five verification states — `verified`, `stale`, `not found` and `pending` driven live in a browser against the deployed subgraph, `revoked` the same rendering path; pending is shown before verified and a submitted tx is never rendered verified before its record exists |
| 17 | NationalityClaim | **closed (Days 22–24)** — `nationality.circom` on the shared base (14 tests), phase-2 setup over the local-development ptau, `Groth16VerifierNationality.sol` generated and asserted against the proving key, `submitNationalityClaim` on a shared `_submitClaim` (age unchanged), layout frozen and cross-checked; contracts 67/67. Day 24: `AletheiaVerifier` redeployed live (`0xce95C4…`) with the new nationality verifier (`0xB559D2…`), both Etherscan/Sourcify-verified; subgraph redeployed as v0.0.3 indexing the new and previous verifiers so old age records survive (Decision 2); the holder flow proves nationality with a pre-proof disclosure. Driven live end to end: a real in-browser nationality proof submitted (`0x7977b9…`, block 11681828) and rendered `verified` — the endpoint now returns five age records and one nationality record |
| 18 | ExpiryClaim | **closed (Days 25–26)** — `expiry.circom` on the shared base (13 tests): the inherited `expiryDate >= currentDate` check is the whole claim, the generic parameter slot pinned to zero, nine-signal layout, constraints locked, `--inspect` clean. Day 26: phase-2 setup over the local-development ptau, `Groth16VerifierExpiry.sol` generated and asserted against the proving key, `submitExpiryClaim` on the shared `_submitClaim` (parameter bound zero; age and nationality unchanged), layout frozen and cross-checked; contracts 90/90. A new `AletheiaVerifier` (`0xB1362a…`) and expiry verifier (`0xD06938…`) deployed live wiring all three claim types, both Etherscan/Sourcify-verified; subgraph redeployed as v0.0.4 indexing three verifiers so no earlier record is orphaned (Decision 2); the holder flow proves expiry with no disclosure. Driven live end to end: a real in-browser expiry proof submitted (`0x2c3d59…`, block 11682200) proving the `expiryDate == currentDate` boundary **on-chain** and rendered `verified` — the endpoint now returns five age, one nationality and one expiry record |
| 19 | Multi-claim end-to-end | **closed (Day 27)** — `scripts/src/multi-claim.ts`: one mock-dev credential, one `contextId`, all three claim types each driven through the full M1 pipeline (real proof, deployed-verifier `eth_call`, real tx, indexed record). Live run submitted three transactions in consecutive blocks (age `0x302d52…`/11682258, nationality `0xc9cff6…`/11682259, expiry `0x2bbb2b…`/11682260), all indexed `verified` on v0.0.4. Asserts — on events and indexed records — three **distinct** nullifiers (claim-type-bound) and **one** shared `identityNullifier` (`0x1bd633…7d47`), the property it was added for. Endpoint now returns ten records |
| 20 | Security testing | **closed (Days 28–29)** — every `docs/security.md` row's `Verified by` cell names a concrete artifact (a passing test, a code path, or an explicit written accepted risk) instead of a stage number, and a new section adds the three threats the v2 layout introduces (within-context identity-nullifier correlation, issuer-salt rotation re-partitioning, schema-version confusion) each with a test or written acceptance. `myTasks.md` item 7 settled: local Phase-1 ptau stays, recorded in `docs/trust-model.md` |
| 21 | Documentation | **closed (Day 30)** — docs reconciled against shipped code; README gained a runnable **Run it** section (the M1 reproduction path: build/typecheck/test, `m1` + `multi-claim` runners, and the web demo), the missing `docs/passport-extraction.md` row, and a tracking-files table (`STATUS.md`, `TODO.md`, `AGENTS.md`, `myTasks.md`); Status section now states M1 complete |

## Working tree

Everything through Day 12 — the schema v2 migration, the Sepolia deployment, the Day 9
`submit-age-claim.ts` run, and the subgraph (schema, mappings, matchstick tests, the
Docker-backed test runner, and the Day 12 Studio deploy) — is committed, most recently as
`8b8016d`. Day 13 added `packages/query` (transport, decoders, typed reads,
`scripts/check.ts`), committed as `ea0d43f`. Day 14 adds the five-state derivation
(`src/state.ts`, `src/state.test.ts`, the `verificationState` client method and the new
exports), the `scripts/states.ts` read/derive gate, the on-chain
`packages/contracts/scripts/set-issuer-active.ts` and `reproduce-pending.ts`, the
`@aletheia/query` devDependency on `packages/contracts` with its `pnpm-lock.yaml` entry,
and the `docs/security.md` freshness refinement, committed as `53f1f36`. Day 15 adds
`packages/ens` — `src/endpoint.ts` (the `MAINNET_RPC_URL` seam), `src/errors.ts`,
`src/resolver.ts` (the forward/reverse resolver), `src/index.ts`, the two unit-test files,
`scripts/check.ts` (the live gate), the package manifest and tsconfigs — plus the new
`viem` workspace entry in `pnpm-lock.yaml`, committed as `03db988`. Day 16 adds the
top-level `scripts` package — `src/env.ts` (the Sepolia clients, the deployment-manifest
loader and the compiled-ABI loader), `src/m1.ts` (the nine-stage runner), `package.json`,
`tsconfig.json` and `README.md` — the committed deployment manifest
`packages/contracts/deployments/sepolia.json`, and the `- scripts` entry in
`pnpm-workspace.yaml` (with its `pnpm-lock.yaml` workspace entry), committed alongside this
file and `TODO.md`. Day 17 adds `packages/extraction` — `src/checkdigit.ts` (the ICAO
`7-3-1` scheme), `src/mrz.ts` (the TD3 parser and its result type), `src/index.ts`, the two
unit-test files, and the package manifest and tsconfigs — plus, in `packages/credential`,
`src/nationality.ts` (the alpha-3 → ISO 3166-1 table), the century-inference functions in
`src/date.ts`, their tests (`nationality.test.ts`, `century.test.ts`), and the new
`src/index.ts` exports. `docs/passport-extraction.md` was already tracked. The subgraph's
`generated/` and `build/`, the `dist/` of each package, the Ignition deployment artifacts
and all other build output remain gitignored.

**Toolchain note (Day 11):** the subgraph's `@graphprotocol/graph-ts` was pinned down from
`0.38.2` to `0.35.0`. matchstick 0.6.0 is the newest matchstick release and it compiles
with `assemblyscript` 0.19.23 (its bundled `bin/asc` layout); graph-ts 0.36+ moved to
assemblyscript 0.27.31, which matchstick 0.6.0 cannot invoke. 0.35.0 is the last graph-ts
on asc 0.19.x, and `graph codegen`/`graph build` still run clean on it. The subgraph also
gains `assemblyscript@0.19.23` and `matchstick-as@0.6.0` as devDependencies.
