# Architecture

## Layers

```
USER DEVICE (everything private stays here)
  camera scan / image / PDF ---- OCR + MRZ parse, in a worker ----> candidate fields (untrusted input)
  candidate fields ---- user review and correction ----> confirmed fields
  confirmed fields ---- normalizer ----> normalized credential (YYYYMMDD, ISO 3166-1 numeric)
  normalized credential ---- MOCK ISSUER (localhost, dev only) ----> signed credential
  signed credential + chosen claim ---- snarkjs in browser ----> Groth16 proof + public signals

ETHEREUM SEPOLIA
  AletheiaVerifier.submitAgeClaim(proof, publicSignals)        // one entrypoint per claim type
    issuer active?  subject == msg.sender?  currentDate fresh?  param in range?
    nullifier unused?  Groth16Verifier<Claim>.verifyProof()
    -> emit ClaimVerified

THE GRAPH (Subgraph Studio, network: sepolia)
  ClaimVerified -> Verification entity, Profile counters, Issuer link

VERIFIER BROWSER
  ENS name -> wallet address (mainnet Universal Resolver, read-only)
  wallet address -> GraphQL query + _meta -> verified | stale | revoked | pending | not found
```

Identity flow, stated once: **ENS name -> wallet address -> Aletheia verification
records.** ENS is a human-readable lookup layer only. The Graph is the record layer.
Ethereum is the only authority. The frontend is authoritative for nothing.

## Packages

| Path | Role |
|---|---|
| `packages/credential` | shared TypeScript: credential types, YYYYMMDD codec, Poseidon message hash, nullifier derivation, signature verification. Holds no keys. |
| `packages/issuer-mock` | **dev-only, quarantined:** keygen, signing CLI, localhost signer. Implements the one interface a real issuer adapter will implement. No PDF or chain dependency. |
| `packages/circuits` | circom 2.x sources (`lib/credential.circom` shared base + one file per claim), build and setup scripts, circuit tests. |
| `packages/contracts` | Hardhat 3 project: snarkjs-generated Groth16 verifiers (verbatim), `AletheiaVerifier`, `AletheiaIssuerRegistry`, `AletheiaProfile`, `DateLib`, tests, Ignition modules. |
| `packages/subgraph` | schema, manifest, mappings, matchstick tests. |
| `packages/web` | Next.js app: holder flow (extract, review, sign, prove, submit) and verifier flow (resolve, query, render states). Also owns document extraction — camera scan, image and PDF — which runs client-side only and holds no signing capability. |
| `scripts` | cross-package end-to-end runner. |
| `docs` | this directory. |

## Credential model

See `docs/credential-schema.md` for the normative field list and signed-message layout,
and `docs/date-format.md` for the date encoding.

Documents reach this model through extraction, which is untrusted by construction:
`docs/passport-extraction.md` gives the MRZ field mapping, the century-inference rule, the
nationality code table policy, and what a camera scan can and cannot establish. A
passport supplies `dateOfBirth`, `nationality` and `expiryDate` directly, with no schema
change, which is why all three Phase 1 claims are reachable from one scan.

Private, never transmitted: PDF, extracted text, date of birth, nationality value,
expiry date, issued-at date, credential ID, issuer signature.

Public by design (per proof): issuer public key, `currentDate`, the verifier's own claim
parameter, `contextId`, holder address, nullifier.

Never on Ethereum, in the subgraph, or in ENS: anything in the private list.

## ZK architecture

circom 2.2.3, circomlib 2.0.5, snarkjs 0.7.6, Groth16 over bn128.

`lib/credential.circom` is shared by every claim circuit and enforces, once:

1. range checks on every date and code (`Num2Bits`), plus `currentDate` bounds
2. `msgHash = Poseidon(7)` over the credential fields, recomputed from private inputs
3. `EdDSAPoseidonVerifier(enabled = 1)` against the issuer public key
4. expiry: `expiryDate >= currentDate`
5. `nullifier = Poseidon(4)[credentialId, claimTypeId, contextId, subject]`

So every claim also proves the credential is issuer-signed and unexpired.

| Claim | id | Extra public input | Extra constraint |
|---|---|---|---|
| Age | 1 | `minimumAge` | `dateOfBirth <= currentDate - minimumAge * 10000` |
| Nationality | 2 | `requiredNationality` | `nationality == requiredNationality` |
| Expiry | 3 | — | base expiry check is the whole claim |

Public-signal order is frozen in `docs/public-signals.md` and asserted by tests, because
regenerating a circuit can silently reorder signals and break contract decoding.

## Smart contracts

- **`Groth16VerifierAge` / `...Nationality` / `...Expiry`** — snarkjs output, committed
  verbatim, never hand-edited. A test asserts each matches its verification key.
- **`AletheiaIssuerRegistry`** — `issuerId => {ax, ay, active, label}`, `Ownable2Step`.
  Issuer keys live here rather than in circuits, so rotation and revocation need no
  recompile.
- **`AletheiaVerifier`** — the only place cryptographic truth is decided. Validates
  signal count, `subject == msg.sender`, date freshness against `DateLib`, claim
  parameter ranges, issuer activity, and nullifier novelty, then calls the claim's
  Groth16 verifier and emits `ClaimVerified`. No `bool result` field exists: an invalid
  proof reverts, so no record can be false.

  There is one entrypoint per claim type, each typed to its circuit's signal count, and
  the contracts are not upgradeable. The deployment recorded in `docs/deployments.md`
  therefore serves age claims only: stages 17 and 18 add `submitNationalityClaim` and
  `submitExpiryClaim`, which means deploying a new `AletheiaVerifier`. The registry, the
  profile contract and the age verifier are unaffected and are reused as they are.
- **`AletheiaProfile`** — deliberately tiny (`register()` plus an event). Separate from
  the verifier so the verifier holds no identity state. Stores **no ENS name**; an
  unverified name string on-chain would be exactly the kind of fake record this project
  forbids.
- **`DateLib`** — pure `timestamp -> YYYYMMDD`.

## ENS (Phase 1: resolution only)

- Resolution goes through the ENS Universal Resolver proxy
  `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe`, which is the canonical entrypoint at the
  same address on mainnet and testnets, using viem `>= 2.35` (ENSv2-ready).
- Forward (`getEnsAddress`) and reverse (`getEnsName`) resolution, read-only. ENSv2
  enforces the forward-match during reverse resolution on-chain.
- **No registrar, no subname minting, no ENS writes, no ENS state on-chain.** An
  address-only flow is first-class; nobody needs to own a name to use Aletheia.
- **The ENS name is never stored — not on-chain, not in the subgraph.** The wallet
  address is the sole stored anchor a proof binds to (`subject` on every `Verification`);
  the ENS name is resolved **live at read/display time** and joined to a record's proof
  status by that address. Forward (name → address) queries the subgraph by the resolved
  address; reverse (address → name) labels a record for display. Indexing the name is
  rejected for three reasons: the subgraph does no `eth_call` and so cannot resolve at
  index time; ENS reverse records are mutable, so an indexed name would go stale
  silently; and resolution is on mainnet while the subgraph indexes Sepolia, so a stored
  name would cross chains for a value that is cheap to resolve live. Confirmed decision,
  2026-09-10.
- Rationale and the requirements for issuing subnames later: `docs/phase2-ens-subnames.md`.

## The Graph

Entities: `Profile` (keyed by address), `Verification` (immutable, keyed by
`verificationId`), `Issuer` (keyed by `issuerId`, carries the `mock-dev` label).
Relationships are stored on the many side with `@derivedFrom`. `Bytes` ids throughout.
No `eth_call` in mappings — the event carries everything.

The event carries no private field, so the subgraph physically cannot leak one.

Verifier queries read `_meta.block.number` and `hasIndexingErrors` alongside the records,
which is what turns "pending indexing" into a real state instead of a guess.

## Implementation stages

Each stage has a gate that must pass before the next begins. Gates involving proofs,
chain, or indexing are closed by real artifacts — a proof file, a transaction hash, an
indexed entity — never by a unit test alone.

| # | Stage | Gate |
|---|---|---|
| 0 | Toolchain verification | `circom compiler 2.2.3`; test circuit compiles `--inspect` clean; circom 1.x removed |
| 1 | Repository foundation | workspace builds and tests green; no secret path trackable |
| 2 | Credential data model | date codec property-tested 1900-2100; `msgHash` reproducible from fixture |
| 3 | Mock trusted issuer | fixture signature verifies; any field mutation fails; key gitignored |
| 4 | AgeClaim circuit | compiles `--inspect` clean; constraint count snapshotted; negative cases fail |
| 5 | Local witness generation | witness from real issuer output, no hand-edited fields |
| 6 | Local Groth16 proof | real `proof.json`; signal order matches `docs/public-signals.md` |
| 7 | Local proof verification | true for valid; false for every signal and proof mutation |
| 8 | Solidity verifier | on-chain `verifyProof` true for real proof, false for mutations |
| 9 | Contract tests | full negative suite; `DateLib` matches TS codec over 10k dates |
| 10 | Sepolia deployment | real verified addresses recorded in `docs/deployments.md` |
| 11 | Real `ClaimVerified` event | real tx hash; nullifier reuse reverts on-chain |
| 12 | Subgraph | the stage-11 tx queryable as a real entity; matchstick green |
| 13 | GraphQL query layer | all five states reproduced from real endpoint data |
| 14 | ENS resolution | real name resolves; missing name is not-found, not an error |
| — | **M1: end-to-end milestone** | one command: signed credential -> circuit -> proof -> local verify -> Solidity verify -> Sepolia tx -> event -> Graph -> verifier query |
| 15 | Document extraction (camera scan, image, PDF) | MRZ fixture extracts; failing check digit reports which field; ambiguous century and unmappable nationality return *unsupported*, never a guess |
| 16 | Frontend (age only) | browser run on Sepolia; the document never leaves the device; pending shown before verified |
| 17 | NationalityClaim | stages 4-13 gates repeated; disclosure notice shown pre-proof |
| 18 | ExpiryClaim | same, plus `expiryDate == currentDate` boundary on-chain |
| 19 | Multi-claim end-to-end | three real transactions, three real records, distinct nullifiers |
| 20 | Security testing | every threat row maps to a passing test or a written accepted risk |
| 21 | Documentation | a stranger reproduces M1 from docs alone |

Nationality and expiry begin only after M1 passes: one claim is proven end to end first.

## Anti-fake rules

- No hardcoded proof output, transaction hash, verification result, GraphQL response,
  ENS record, or contract address in `packages/web`, `packages/subgraph`, or `scripts`.
- No mocked `fetch`, stubbed provider, or simulated chain success in the verifier read
  path or the holder submit path. Test doubles are confined to unit tests of pure
  functions.
- `packages/issuer-mock` is the only sanctioned mock, and it is labelled on-chain.
- "Verified" is never inferred from a submitted transaction. Only an indexed
  `ClaimVerified` record renders as verified; the interval renders as pending.
