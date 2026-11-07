# Security model

Mitigations are listed per threat. The `Verified by` column names the concrete artifact
that closes the row — a passing test, a code path, or a written acceptance — not a stage
number. Stage 20 (Days 28–29) audited that no row is left with an unverified mitigation and
no written accepted risk; this file is the result of that audit.

"Accepted risk" is a real answer, used where a property is inherent to Phase 1 or to the
design and cannot be tested away — it is stated plainly rather than dressed up as a
mitigation.

## Credential and issuance

| Threat | Mitigation | Verified by |
|---|---|---|
| Self-asserted / forged credential fields | in-circuit `EdDSAPoseidonVerifier` over `Poseidon` of all signed fields; no signature means no witness | `packages/circuits/test/age.test.ts`, `nationality.test.ts`, `expiry.test.ts` — the forged-signature and tampered-field cases are unsatisfiable |
| Forged issuer signature | BabyJubjub EdDSA; issuer public key is a public signal checked against `AletheiaIssuerRegistry`; unknown key reverts | `packages/contracts/test/AletheiaVerifier.ts` (unregistered / revoked issuer reverts) + the circuit signature check above |
| Tampered PDF or edited extracted fields | trust derives only from the issuer signature; the PDF is never evidence | Accepted by design: extraction is untrusted input, stated in `docs/trust-model.md` ("the document is input, not evidence"); the review step forces confirmation before signing |
| **Mock issuer signs anything** | inherent to Phase 1 and documented, not mitigated: label `mock-dev` on-chain, surfaced in the subgraph and every UI record | Accepted risk (Phase 1): `docs/trust-model.md`; the `mock-dev` label is asserted through to the subgraph in `packages/subgraph/tests` and rendered in both web flows |
| Malicious PDF / image input | parsing only in a browser worker, PDF JavaScript disabled, size and page caps, no server-side parser, no evaluation of extracted text | `packages/extraction/src/document.test.ts` severs `http`/`https`/`fetch` around each run and asserts zero network hits; the wasm core and OCR model load from disk |
| Mock issuer key theft | key generated locally, gitignored, signer bound to localhost, never deployed; label keeps mock records distinguishable | `packages/issuer-mock` keystore is `.gitignore`d; `scripts/register-issuer.ts` refuses any keystore not labelled `mock-dev` before touching the chain |

## Proof soundness

| Threat | Mitigation | Verified by |
|---|---|---|
| Invalid or malformed proof | snarkjs-generated verifier reverts; contract validates array shape and signal count first | `packages/contracts/test/Groth16VerifierAge.ts` (+ nationality, expiry) — accepts a real proof, rejects every mutation |
| Manipulated public signals | contract independently checks issuer, subject, date freshness and parameter ranges; the circuit range-checks the same values so field wraparound cannot forge a threshold | `packages/contracts/test/AletheiaVerifier.ts` negative suite (out-of-range parameter, stale/future date, wrong subject) |
| Public-signal reordering after a recompile | order frozen in `docs/public-signals.md` and asserted against generated artifacts | `packages/contracts/test/PublicSignalsLayout.ts` — the doc, `*_PUBLIC_SIGNALS`, the generated verifier and `AletheiaVerifier` are asserted to agree |
| Under-constrained circuit | `--inspect` must be clean; constraint count snapshotted; no `<--` without a matching `===` | `packages/circuits` builds `--inspect` clean and asserts each `constraints.lock.json`; checked in the circuits test run |
| Trusted-setup toxic waste | published Perpetual Powers of Tau for phase 1 when obtainable, hash-verified, otherwise a locally generated phase 1 recorded as such; single-contributor phase 2 in development is a documented blocker for production | Accepted risk (Phase 1): `docs/trust-model.md`, "Trusted setup status" — every `setup.json` carries `productionReady: false` and `phase1Provenance`; a multi-party phase-2 ceremony is required before any real issuer |

## Replay and identity binding

| Threat | Mitigation | Verified by |
|---|---|---|
| Replaying another holder's proof | `subject` bound into the signed message and into the nullifier; contract requires `subject == msg.sender` | `packages/contracts/test/AletheiaVerifier.ts` (`SubjectIsNotSender`); `packages/credential/src/hash.test.ts` binds `subject` into the message and the nullifier |
| Duplicate verification / nullifier grinding | `keccak256(claimType, contextId, nullifier)` marked used before verification | `packages/contracts/test/AletheiaVerifier.ts` — reuse reverts with `VerificationAlreadyRecorded`, and the used-before-verify ordering (reentrancy defence) is asserted; demonstrated on Sepolia (Day 9) |
| Credential shared between wallets | `subject` is part of the issuer-signed message | `packages/credential/src/hash.test.ts` — the message hash changes when `subject` changes |
| Expired credential | expiry checked inside every claim circuit against the contract-validated `currentDate` | `packages/circuits/test/expiry.test.ts` — the `expiryDate == currentDate` boundary holds on both sides; inherited by age and nationality |
| Backdated or future-dated proof | contract derives today's UTC date from `block.timestamp` and accepts only `{today, today - 1}` | `packages/contracts/test/AletheiaVerifier.ts` (stale / future date) + `packages/contracts/test/DateLib.ts` (~47,800-day sweep vs. the TypeScript codec) |
| Stale verification record | `verifiedAt` (the event's `block.timestamp`) drives a verifier-side freshness policy that renders `stale` distinctly from `verified`; `credentialValidOn` is also on the record for a coarser, credential-oriented check | `packages/query/src/state.test.ts` — the same record classifies `verified` under a generous window and `stale` under a tight one |

## Infrastructure and display

| Threat | Mitigation | Verified by |
|---|---|---|
| Unauthorized issuer or verifier-mapping changes | `Ownable2Step`; every change emits an indexed event | `packages/contracts/test/AletheiaIssuerRegistry.ts`, `AletheiaVerifier.ts` (owner-gated `setClaimVerifier`, active-set events) |
| Graph indexing delay or errors | `_meta.block.number` and `hasIndexingErrors` drive an explicit `pending` state; a submitted transaction is never rendered as verified | `packages/query/src/state.test.ts` (`pending` from indexer lag); the holder→verifier handoff shows pending→verified live without a reload |
| ENS assumptions | resolution only through the Universal Resolver proxy with viem ≥ 2.35; nothing is trusted about a name beyond "resolves to this address now"; no ENS state on-chain | `packages/ens/src/resolver.test.ts`; live forward/reverse round-trip closed against real mainnet ENS (Day 15) |
| Malicious wallet or address input | checksum and `isAddress` validation, chain id asserted before writes, contract addresses never taken from user input | `packages/web/src/lib/verify.ts` / `submit.ts` — addresses validated, chain id asserted, addresses read from the generated manifest, never user input |
| Public data leakage | the event carries only issuer id, claim type, claim parameter, validity date, context id, nullifier and subject — no date of birth, no document number, no expiry date | Accepted, minimised: the `ClaimVerified` field set is fixed in `AletheiaVerifier.sol` and asserted in `packages/contracts/test/AletheiaVerifier.ts`; the nationality parameter is the one deliberately disclosed value (its own row) |
| Nationality-claim disclosure | inherent: a successful claim reveals the nationality asked about. Shown before proving, not buried | Accepted risk (by design): the web holder flow gates proving on an explicit disclosure acknowledgement (`packages/web/app/page.tsx`) |
| Frontend compromise | frontend is authoritative for nothing; every record links to its transaction for independent inspection | Accepted by design: `docs/trust-model.md` ("the frontend is trusted for nothing"); every record in the verifier flow links to its Etherscan transaction |

## Threats the v2 signal layout introduces

The v2 schema added `identityNullifier` and moved every claim onto one nine-signal layout.
That buys multi-claim correlation and one shared verifier path, and it introduces three
threats the v1 table did not have. Each is closed here.

| Threat | Mitigation | Verified by |
|---|---|---|
| Identity-nullifier correlation within a context | `identityNullifier = Poseidon(identitySecret, contextId)` is deliberately stable within one context, so a verifier can group one holder's records. `contextId` is mixed in so the value is unrelated across contexts; a verifier that must not link two holders must not reuse a `contextId` for them | Accepted risk (by design), bounded: `docs/trust-model.md` ("the identity nullifier the record carries") states the correlation and its bound; `packages/credential/src/hash.test.ts` ("identity nullifiers are unlinkable across verifiers") proves a different `contextId` yields an unrelated value; Day 27's on-chain multi-claim run demonstrates the intended within-context sharing |
| Issuer-salt rotation re-partitions every identity nullifier | `identitySecret` is derived from the issuer salt; rotating the salt gives the same person a new `identitySecret`, hence a new `identityNullifier`, so records issued before and after a rotation no longer correlate | Accepted risk (operational): `packages/credential/src/hash.test.ts` ("identity nullifiers are unlinkable across verifiers") shows a different `identitySecret` does not collide — the same mechanism that gives cross-context privacy also means a salt rotation silently re-partitions history. An issuer must treat the salt as long-lived; stated in `docs/trust-model.md` |
| Schema-version confusion between deployments | a proof built for schema vN must not be accepted by a contract deployed for vM. The circuit pins `schemaVersion` as a public signal and the contract refuses any value it was not deployed for | `packages/contracts/test/AletheiaVerifier.ts` ("refuses a proof whose schemaVersion is not the one deployed" → `SchemaVersionNotSupported`); `PublicSignalsLayout.ts` keeps the pinned index aligned across artifacts |
