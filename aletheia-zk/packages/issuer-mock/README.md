# @aletheia/issuer-mock

> **DEVELOPMENT ONLY. This issuer verifies no identity.**
>
> It signs whatever normalized credential it is handed. A credential signed here proves
> issuance by a mock issuer and nothing else. It is not evidence of a government
> document, a real date of birth, or a real nationality.

This is the only sanctioned mock in the repository. It exists so the rest of Aletheia —
circuits, contracts, subgraph, frontend — can be built and tested against a real
signature scheme while the real credential source is out of scope for Phase 1.

## Containment

- Registered on-chain under the label `mock-dev`, which the subgraph carries as
  `Issuer.label` and every UI surface renders, so mock-signed records stay identifiable.
- Keys are generated locally into `keys/`, which is gitignored. `writeKeystore` refuses
  to overwrite an existing key.
- No PDF dependency and no chain dependency: this package cannot read a document and
  cannot submit a transaction.
- Implements the `CredentialSigner` seam from `@aletheia/credential`. A real credential
  adapter implements the same one-function signature, and nothing downstream changes.
  See `docs/phase2-digilocker.md`.

## Scheme

EdDSA-Poseidon on BabyJubjub, over the seven-field Poseidon message defined in
`docs/credential-schema.md`. Chosen because circomlib verifies it in roughly 4k
constraints, against roughly 150k for secp256k1 ECDSA.

`verifySignedCredential` is the off-circuit twin of the in-circuit
`EdDSAPoseidonVerifier` check. It lets a client reject a bad credential before spending
time on a witness; it is not a substitute for the in-circuit constraint, which is what
actually makes a proof mean anything.

## Usage

```bash
# create the development key (once)
pnpm --filter @aletheia/issuer-mock run keygen

# sign a normalized credential
pnpm --filter @aletheia/issuer-mock run sign -- credential.json signed.json

# verify a signed credential
pnpm --filter @aletheia/issuer-mock run verify -- signed.json
```

`ALETHEIA_ISSUER_KEYSTORE` overrides the keystore path.
