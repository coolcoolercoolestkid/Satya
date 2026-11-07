# Trust model

Aletheia has two layers, stacked and independent. Keeping them apart is the whole design.

```
authenticity layer   an issuer signs a normalized credential   (Phase 1: MOCK issuer)
claim layer          a ZK proof shows a signed credential satisfies a claim
```

The claim layer never learns who the issuer is beyond a public key, so replacing the
issuer does not touch the circuits, contracts, or subgraph.

## The document is input, not evidence

```
scan / photo / PDF  ->  extracted candidate fields  ->  normalized credential  ->  ISSUER SIGNATURE  ->  trusted credential
                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^      ^^^^^^^^^^^^^^^^
                        untrusted, user-correctable, may fail outright              the only source of trust
```

An upload proves nothing whatsoever. Extraction is a convenience that saves typing.
Where a document layout is unsupported or extraction confidence is low, Aletheia says so
and asks for manual entry rather than guessing. Extraction code lives in the web package
and has no ability to sign; the issuer package cannot read documents. The separation is
structural, not a matter of discipline.

This holds with particular force for a **camera-scanned passport**, because that flow
looks the most like verification while being exactly as unverified as the rest. The data
page is not signed by anyone. Optical character recognition converts pixels to text and
adds no authority in the process. The MRZ check digits catch a misread `0` for `O`; they
are computable by anyone and so catch no forgery at all. A photograph of someone else's
passport, or an outright fabrication, yields a signed credential just the same.

What a passport-derived Phase 1 credential means, stated without flattery:

> An image was uploaded to this device, parsed into these fields, confirmed by whoever
> was holding the device, and signed by a mock issuer that verifies nothing.

No UI surface may describe this as a verified passport, a verified identity, or a
verified nationality. The `mock-dev` label exists for precisely this case.

The chip inside an ICAO 9303 e-passport *is* signed by the issuing country, and reading
the MRZ is what derives the key to open it — so the extraction step is the first half of a
real solution rather than a dead end. `docs/passport-extraction.md` covers the mapping and
its limits; the two ways to consume a government signature are Path A and Path B in
`docs/phase2-digilocker.md`.

## What a verification record means

A `ClaimVerified` event means, and only means:

> The wallet that sent this transaction holds a credential carrying a valid signature
> from the issuer public key recorded in this event; that credential's expiry date is not
> before the date recorded in this event; and it satisfies the claim recorded in this
> event.

It does not mean the holder is who they say they are. That depends entirely on how much
the issuer is worth trusting.

### The identity nullifier the record carries

`ClaimVerified` carries `identityNullifier = Poseidon(identitySecret, contextId)`, a v2
signal, and this is deliberate: it is the only reason the signal exists. Within one
context it is stable across every credential and every wallet the same person proves with,
so it is the handle that makes "one identity, N verifications in this context" observable —
the property multi-claim indexing in later stages depends on. It is on-chain in the proof
calldata whether or not the event repeats it; putting it in the event only makes it
indexable by the subgraph rather than recoverable by decoding transactions.

The consequence, stated plainly, is that the record is a **per-context correlation
handle**. Anyone reading the subgraph can group all records sharing an `identityNullifier`
and know they belong to one identity, and — since `subject` is already public in the same
event — can link two *different wallets* used by that one identity within that context.
That linkage is new information the `subject` field alone does not give.

Its scope is bounded by construction, and this is the reason `contextId` is mixed in:

- It **cannot** correlate an identity across contexts. A different `contextId` yields an
  unrelated value, so a verifier in context A learns nothing about the same person's
  records in context B. This is why a per-verifier `contextId` is load-bearing for
  privacy, not a formality.
- It reveals **nothing** about the underlying identity, document, date of birth or issuer
  salt: it is a Poseidon image, not a decodable field.

A verifier that does not want its records grouped this way must not reuse a `contextId`
across the holders it should not be able to link.

## Phase 1 issuer: mock, labelled, isolated

`packages/issuer-mock` generates an EdDSA (BabyJubjub / Poseidon) keypair and signs any
normalized credential handed to it. It performs **no identity verification of any kind**.

Containment measures:

- registered on-chain in `AletheiaIssuerRegistry` with the label `mock-dev`
- that label is carried into the subgraph as `Issuer.label` and rendered in every UI
  surface that shows a record, so a mock-signed record stays distinguishable forever
- private key is generated locally, stored in a gitignored directory, never deployed
- the signer binds to localhost only
- it is the **only** sanctioned mock in this repository

Any claim that a mock-signed credential proves government identity would be false.

## Trusted setup status

- **Phase 1 (universal):** the published Perpetual Powers of Tau file is preferred and is
  verified against the blake2b hash published in the snarkjs README, so any mirror will
  do — the hash is what is trusted, not the host.

  In practice both official hosts (the `zkevm` Google Storage bucket and the legacy
  Hermez S3 bucket) currently return HTTP 403 for every power, so `scripts/setup.ts`
  falls back to **generating a phase 1 locally**, which has no multi-party guarantee at
  all. Which one was used is recorded in `build/<circuit>/setup.json` as
  `phase1Provenance`, so the two can never be confused. Set `ALETHEIA_PTAU` to a local
  copy of the published file to use the real ceremony instead.

  **Decision (Day 29):** for Phase 1 the locally generated file **stays**, precisely because
  the published hosts are unreachable to fetch-and-pin today. This is a conscious, recorded
  choice, not an oversight — `productionReady: false` and `phase1Provenance` make it legible
  in every build. Switching to the published ceremony (via `ALETHEIA_PTAU`) is a prerequisite
  for any real issuer, together with the multi-party phase 2 below.
- **Phase 2 (per circuit):** **single contributor** during development. Whoever ran the
  contribution could forge proofs if they retained the toxic waste. The beacon value in
  `scripts/setup.ts` is a fixed development constant, not public randomness, and is
  labelled as such in the code.

**This blocks production use**, and would even with a perfect phase 1: a multi-party
phase-2 ceremony with published transcripts is required before any real issuer is
registered. Every setup record carries `productionReady: false` for this reason.

What this does *not* undermine: the proofs are real Groth16 proofs, the circuit is real,
and verification genuinely fails for invalid inputs. An unsound setup means someone with
the toxic waste could forge a proof — it does not mean the system is faking proofs.

## Trust anchors, summarised

| Anchor | Trusted for | Failure if compromised |
|---|---|---|
| Issuer signing key | truth of credential fields | forged credentials become provable |
| Phase-2 ceremony contributor | soundness of proofs | forged proofs verify |
| `AletheiaVerifier` owner | which verifier contract serves which claim type, which issuers are active | attacker-chosen verifier accepts anything |
| Ethereum Sepolia | ordering, finality, replay state | — |
| The Graph indexer | availability and freshness of records, never validity | stale or missing records; cannot fabricate one that has no matching event |
| ENS | mapping a name to an address today | wrong address looked up; no effect on any proof |

The frontend is trusted for nothing. Every record it displays is backed by an on-chain
transaction the verifier can inspect independently.
