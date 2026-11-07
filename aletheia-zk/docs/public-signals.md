# Public signal order (normative)

snarkjs emits public signals as **circuit outputs first, then public inputs in
declaration order**. Contracts and clients decode by index, so this order is frozen here
and asserted by tests against the generated artifacts. Changing a circuit's signal order
is a breaking change to `AletheiaVerifier`.

Filled in and locked at stage 6, per circuit, as each is built.

## AgeClaim (`claimTypeId = 1`, schema version 2)

Verified empirically against the compiled artifacts, not assumed: the witness layout is
asserted in `packages/circuits/test/age.test.ts`, the decoded order in
`packages/circuits/test/prove.test.ts`, and the agreement of this table with
`AGE_PUBLIC_SIGNALS`, the generated verifier and `AletheiaVerifier` in
`packages/contracts/test/PublicSignalsLayout.ts`.

| Index | Signal | Kind | Notes |
|---|---|---|---|
| 0 | `nullifier` | output | `Poseidon(credentialId, 1, contextId, subject)`; per credential, claim type and context, so replay is detectable while records stay unlinkable across contexts |
| 1 | `identityNullifier` | output | `Poseidon(identitySecret, contextId)`; stable across every credential and wallet one identity proves with in this context, unrelated across contexts. A per-context correlation handle by design — see `docs/trust-model.md` |
| 2 | `schemaVersion` | input | pinned in-circuit to the compiled constant (`2`), so a proof cannot carry any other value; `AletheiaVerifier` refuses a version it was not deployed for |
| 3 | `issuerAx` | input | issuer BabyJubjub key x; checked against `AletheiaIssuerRegistry` |
| 4 | `issuerAy` | input | issuer BabyJubjub key y |
| 5 | `currentDate` | input | YYYYMMDD; contract accepts only today or yesterday UTC |
| 6 | `minimumAge` | input | the verifier's threshold, `0..120`; the generic claim-parameter slot every claim type shares |
| 7 | `contextId` | input | verifier scope tag, reduced into the field |
| 8 | `subject` | input | holder address as `uint160`; contract requires `== msg.sender` |

Nine signals total, which is why the generated verifier takes `uint[9]`. None of them is
a private credential field: the date of birth, nationality, expiry, issuance date,
credential id, `identitySecret` and signature stay in the witness. A test asserts each
private value is absent from the public signals.

`minimumAge` occupies the generic claim-parameter slot at index 6; nationality and expiry
reuse this same nine-signal layout with a different name for that slot, so every claim
type decodes identically.

## NationalityClaim (`claimTypeId = 2`, schema version 2)

The same nine-signal v2 layout as AgeClaim, so a proof decodes identically on-chain — only
the generic claim-parameter slot at index 6 is renamed, from `minimumAge` to
`requiredNationality`. Verified empirically against the compiled artifacts, not assumed: the
witness layout is asserted in `packages/circuits/test/nationality.test.ts`, and the
agreement of this table with `NATIONALITY_PUBLIC_SIGNALS`, the generated verifier
`Groth16VerifierNationality` and `AletheiaVerifier.submitNationalityClaim` in
`packages/contracts/test/PublicSignalsLayout.ts`.

Unlike age, a nationality proof **discloses** the value in the parameter slot: a successful
proof establishes that the holder's nationality is exactly `requiredNationality`. It reveals
nothing else in the credential. The holder is shown this before proving — see the Day 24
disclosure notice and `docs/trust-model.md`.

| Index | Signal | Kind | Notes |
|---|---|---|---|
| 0 | `nullifier` | output | `Poseidon(credentialId, 2, contextId, subject)`; per credential, claim type and context. Claim type 2 makes it distinct from the same credential's age nullifier |
| 1 | `identityNullifier` | output | `Poseidon(identitySecret, contextId)`; identical to the age claim's for one identity in one context, because no claim type enters it — see `docs/trust-model.md` |
| 2 | `schemaVersion` | input | pinned in-circuit to the compiled constant (`2`); `AletheiaVerifier` refuses a version it was not deployed for |
| 3 | `issuerAx` | input | issuer BabyJubjub key x; checked against `AletheiaIssuerRegistry` |
| 4 | `issuerAy` | input | issuer BabyJubjub key y |
| 5 | `currentDate` | input | YYYYMMDD; contract accepts only today or yesterday UTC |
| 6 | `requiredNationality` | input | the ISO 3166-1 numeric code the verifier is asking about, `1..999`; the generic claim-parameter slot age uses for `minimumAge`. The circuit forces it equal to the credential's signed nationality, so a successful proof discloses it |
| 7 | `contextId` | input | verifier scope tag, reduced into the field |
| 8 | `subject` | input | holder address as `uint160`; contract requires `== msg.sender` |

Nine signals total, decoded as `uint[9]` by the generated verifier, exactly like AgeClaim.
No private credential field appears: the date of birth, expiry, issuance date, credential
id and `identitySecret` stay in the witness. The nationality is the one value the claim is
designed to reveal, and it appears only because the verifier put it in `requiredNationality`
and the proof confirmed it — the credential's own nationality field never leaves the witness.

## ExpiryClaim (`claimTypeId = 3`, schema version 2)

The same nine-signal v2 layout as AgeClaim and NationalityClaim, so a proof decodes
identically on-chain — the generic claim-parameter slot at index 6 is named
`expiryParameter` and is **pinned to zero** by the circuit, because an expiry claim has no
parameter of its own. Verified empirically against the compiled artifacts, not assumed: the
witness layout is asserted in `packages/circuits/test/expiry.test.ts`, and the agreement of
this table with `EXPIRY_PUBLIC_SIGNALS`, the generated verifier `Groth16VerifierExpiry` and
`AletheiaVerifier.submitExpiryClaim` in `packages/contracts/test/PublicSignalsLayout.ts`.

Expiry is the thinnest claim of the three. Its statement — that the credential was not
expired as of `currentDate` — is the `expiryDate >= currentDate` check every claim already
inherits from the shared base, so ExpiryClaim adds nothing beyond claiming that base for
claim type 3. A successful proof discloses **only** that the credential was valid on the
date asked about; the expiry date itself, like every other credential field, stays in the
witness.

| Index | Signal | Kind | Notes |
|---|---|---|---|
| 0 | `nullifier` | output | `Poseidon(credentialId, 3, contextId, subject)`; per credential, claim type and context. Claim type 3 makes it distinct from the same credential's age and nationality nullifiers |
| 1 | `identityNullifier` | output | `Poseidon(identitySecret, contextId)`; identical to the age and nationality claims' for one identity in one context, because no claim type enters it — see `docs/trust-model.md` |
| 2 | `schemaVersion` | input | pinned in-circuit to the compiled constant (`2`); `AletheiaVerifier` refuses a version it was not deployed for |
| 3 | `issuerAx` | input | issuer BabyJubjub key x; checked against `AletheiaIssuerRegistry` |
| 4 | `issuerAy` | input | issuer BabyJubjub key y |
| 5 | `currentDate` | input | YYYYMMDD; contract accepts only today or yesterday UTC. The date the credential is proven unexpired on — the substance of the claim |
| 6 | `expiryParameter` | input | pinned to `0` in-circuit (`expiryParameter === 0`); the generic claim-parameter slot age uses for `minimumAge`, unused by an expiry claim. `AletheiaVerifier` bounds it to `0`, so a non-zero value reverts `ClaimParameterOutOfRange` |
| 7 | `contextId` | input | verifier scope tag, reduced into the field |
| 8 | `subject` | input | holder address as `uint160`; contract requires `== msg.sender` |

Nine signals total, decoded as `uint[9]` by the generated verifier, exactly like AgeClaim
and NationalityClaim. No private credential field appears: the date of birth, nationality,
**expiry date**, issuance date, credential id and `identitySecret` all stay in the witness.
The claim reveals nothing but the fact of validity on `currentDate`; the expiry date is
never a public signal.
