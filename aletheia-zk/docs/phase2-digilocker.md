# Phase 2: replacing the mock issuer (not implemented)

Phase 1 ships a mock issuer. Phase 2 replaces it with a real credential source. The point
of the two-layer design is that this swap does not touch the circuits, the contracts, or
the subgraph.

## The seam

`packages/credential` owns the credential schema and the signed-message layout.
`packages/issuer-mock` implements one interface:

```
(normalized credential) -> { issuerPubKey, signature }
```

A Phase 2 adapter implements the same interface. Everything downstream — witness, proof,
public signals, `submitVerification`, `ClaimVerified`, subgraph entities — is unchanged.

## Two migration paths

**Path A — re-attestation (recommended first step).** A server-side adapter fetches the
government-signed credential (for example a DigiLocker issued document), verifies the
government signature with the government's published key, maps the fields into the
normalized credential, and re-signs it with an Aletheia attestation key. On-chain, only
the registry entry changes: a new `issuerId` with a real label replaces `mock-dev`.
Circuits untouched.

Trust shifts from "a mock signs anything" to "the attestation service verified a real
government signature". The attestation service becomes a trusted component and must be
listed in `docs/trust-model.md` as such.

**Path B — in-circuit verification of the government signature.** Removes the
attestation service from the trust set, at the cost of verifying an RSA or secp256k1
signature inside the circuit — orders of magnitude more constraints than the current
BabyJubjub EdDSA check, plus canonicalisation of the signed document bytes. A real
project, not a variation.

## Prerequisites before any of this

- An organisation account and onboarding on the relevant credential API, including
  sandbox access. This is an approval process, not a signup form.
- A multi-party Groth16 phase-2 ceremony. Registering a real issuer while the phase-2
  contribution is single-party would put real credentials behind a forgeable proof
  system.
- A written data-handling position for Path A: the attestation service necessarily sees
  credential fields, so its retention, logging, and jurisdiction all matter.
- Label and UI work so a verifier can tell a real-issuer record from a `mock-dev` record
  at a glance. The registry label and `Issuer.label` in the subgraph already carry this.

## What must not change

The privacy boundary. Even with a real issuer, no date of birth, nationality value,
document number, credential id, or raw document may reach Ethereum, the subgraph, or ENS.
