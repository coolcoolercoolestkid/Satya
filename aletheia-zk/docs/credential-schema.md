# Normalized credential (schema version 2)

Normative field list and signed-message layout. `packages/credential` is the executable
form of this document, and `packages/credential/fixtures/credential-v2.json` pins the
resulting hashes so an accidental change fails a test instead of silently invalidating
every credential in existence.

Every field below is **private**. None of them is ever transmitted to Ethereum, the
subgraph, or ENS.

Schema version 2 added the private `identitySecret` field and promoted `schemaVersion`
from a circom template parameter to a public signal. Version 1 is retired: its circuits
produced seven public signals and no verifier for them is deployed.

## Fields

| Field | Type | Encoding | Notes |
|---|---|---|---|
| `schemaVersion` | `number` | `2` | first input to the signed hash, so a version change cannot be replayed; also a public signal so the contract can route on it |
| `credentialId` | `bigint` | 31 random bytes | private; identifies one credential *instance*, and is the entropy behind every claim nullifier. Never leaves the device, never derived from document data |
| `subject` | `string` | `0x` + 20 bytes | the wallet the credential is bound to; hashed as a `uint160` field element |
| `dateOfBirth` | `number` | YYYYMMDD, UTC | see `docs/date-format.md` |
| `nationality` | `number` | ISO 3166-1 numeric | India = `356`; range 1-999 |
| `expiryDate` | `number` | YYYYMMDD, UTC | inclusive: valid *through* this date |
| `issuedAt` | `number` | YYYYMMDD, UTC | |
| `identitySecret` | `bigint` | field element | issuer-derived, `Poseidon([issuerSalt, documentKey])`; stable across credentials the same issuer derives from the same document, and the sole input to `identityNullifier`. Never leaves the device, and rejected if equal to `credentialId` |

Validity rules enforced before signing and after parsing: real calendar dates inside
`19000101..21001231`, `credentialId` a non-zero bn128 field element, `identitySecret` a
field element distinct from `credentialId`, `dateOfBirth` not after `issuedAt`, and
`expiryDate` not before `issuedAt`.

## Signed message

```
msgHash = Poseidon([
  schemaVersion,      // 2
  credentialId,
  uint160(subject),
  dateOfBirth,
  nationality,
  expiryDate,
  issuedAt,
  identitySecret
])

signature = EdDSA-Poseidon-sign(issuerPrivateKey, msgHash)   // BabyJubjub
```

Eight inputs, in exactly this order. The circuit recomputes this hash from private
inputs and verifies the signature against it with circomlib's `EdDSAPoseidonVerifier`, so
a credential the issuer never signed cannot produce a witness.

`identitySecret` is signed rather than holder-supplied so that the issuer, not the
prover, decides which credentials share one.

Why BabyJubjub EdDSA rather than secp256k1 ECDSA: roughly 4k constraints instead of
roughly 150k, for the same job.

Why `subject` is inside the signed message: it binds the credential to one wallet, so a
leaked credential cannot be used from another address.

## Nullifier

```
nullifier = Poseidon([credentialId, claimTypeId, contextId, uint160(subject)])
```

A circuit **output**, therefore public. It does three jobs:

- the contract rejects a repeat of the same claim in the same context, learning nothing
  about the credential
- it binds the proof to one wallet and one claim type, so a proof cannot be lifted
- because `credentialId` is private and high-entropy, records for one credential under
  different verifier contexts cannot be linked to each other

`claimTypeId` is `1` age, `2` nationality, `3` expiry. Ids are never renumbered.

## What the nullifier does not do

The nullifier prevents **replay**: one credential cannot answer one question twice for
one verifier. It does not, and must not be made to, enforce **one person, one
verification**. The two are separate problems and conflating them costs privacy.

`credentialId` is 31 random bytes per credential *instance*. A holder who discards a
credential and has another issued from the same passport gets a fresh `credentialId`,
therefore a fresh nullifier, therefore a second verification in the same context. That is
a consequence of the privacy choice, and it is accepted deliberately.

The tempting fix is to derive `credentialId` from something stable, such as
`Poseidon([documentNumber, issuerSalt])`. **Do not.** `credentialId` is an input to every
nullifier the credential ever produces. Making it stable makes each context's nullifier a
persistent pseudonym for one human, and any two verifiers who compare notes — or one
verifier observing the same holder over time — gain a correlation handle that the random
form denies them. A per-instance identifier is the whole reason records for one credential
under different contexts cannot be linked.

Where uniqueness within a context is wanted, it lives in a **second, separate public
signal**, not in `credentialId`. Schema version 2 adds exactly that.

## Identity nullifier

```
identityNullifier = Poseidon([identitySecret, contextId])
```

A second circuit **output**, therefore public, carried alongside the claim nullifier by
every claim circuit. `identitySecret` is a signed credential field, issuer-derived as
`Poseidon([issuerSalt, documentKey])`, stable across every credential the same issuer
derives from the same document.

Note what is **not** in it. No `credentialId`, so it survives re-issuance; no `subject`,
so it survives a change of wallet; no `claimTypeId`, so it is the same value across every
claim the holder proves to one verifier. Being scoped to `contextId` and containing no
credential-instance entropy, it is constant for one identity within one verifier and
uncorrelated across verifiers.

What it establishes, exactly: two proofs carrying the same value were built from
credentials the issuer gave the same `identitySecret`, within the same `contextId`. It is
a per-context correlation handle by design — it links an identity's wallets and
credentials within one context, and nothing across contexts. That consequence is written
into `docs/trust-model.md`.

What it does **not** establish: it is not proof of a distinct human, and it is not Sybil
resistance. `identitySecret` is issuer- and document-bound, so it inherits every limit of
the issuer that derived it. Under the Phase 1 mock issuer, which verifies nothing and runs
on the holder's own machine, it establishes no real-world uniqueness whatsoever.

Adding it was not retrofittable onto v1: it is a new signed field (`Poseidon(8)`, hence a
new `schemaVersion`) and a new public signal, widening the generated verifier from
`uint256[7]` to nine signals and therefore requiring new circuits, a new trusted setup,
and a newly deployed `AletheiaVerifier`. That is why it landed as schema version 2 rather
than an amendment to version 1.

## Context id

The verifier's scope tag. A 32-byte digest is reduced into the field by keeping its
leading 31 bytes (`hashToField`, i.e. `digest >> 8`). Truncation must be identical
everywhere, so that is the only sanctioned reduction. Consequence, accepted: digests that
differ only in their final byte collide. A `contextId` is a scoping tag, not a
commitment.

## Wire format

`serializeSignedCredential` emits field elements as decimal strings, because JSON numbers
cannot hold a 254-bit integer:

```json
{
  "schemaVersion": 2,
  "credentialId": "1780731860627700044960722568376592200742329637303199754547598369979440671",
  "issuer": { "ax": "...", "ay": "..." },
  "subject": "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
  "dateOfBirth": 20040314,
  "nationality": 356,
  "expiryDate": 20340314,
  "issuedAt": 20260909,
  "identitySecret": "18483862657355469472300725842073750700687809601674521742857333827345986714902",
  "signature": { "r8x": "...", "r8y": "...", "s": "..." }
}
```

## Compatibility rule

`schemaVersion` is the first input to the signed message. Any change to the field list,
their order, or their encodings requires a new `schemaVersion`, recompiled circuits, and
newly deployed verifiers.

Since schema version 2, `schemaVersion` is both the first signed input **and** a public
signal, pinned in-circuit to the compiled constant. That lets the contract *see* the
version rather than decode a mismatched layout blindly: `AletheiaVerifier` holds
`SUPPORTED_SCHEMA_VERSION` and refuses any proof carrying a different value with a named
`SchemaVersionNotSupported` error.

Being able to see the version does not make two versions co-livable. `AletheiaVerifier`
holds `mapping(uint8 claimType => address verifier)`, one verifier per claim type, and
each generated verifier is fixed to one signal count. Pointing that mapping at a v2
verifier stops every v1 credential from verifying, and the version check refuses them
explicitly rather than letting them fail an opaque pairing check. **Two schema versions
cannot be live for one claim type on one deployed `AletheiaVerifier`.**

Supporting both would require keying the mapping by `(claimType, schemaVersion)` and a
verifier per version. Until that exists, a schema migration means deploying a new
`AletheiaVerifier` and treating the old one as the archive for credentials issued under
the old version — the contracts are not upgradeable, which is intentional, and this is one
of its costs. This is exactly why the v1 Sepolia deployment is retired rather than
extended.
