# Aletheia: the people side of the Satya network

Satya is two halves that share Arkiv:

- **The Satya extension** verifies **websites** (0–100 trust score with reasons).
- **Aletheia** verifies **people**, and lets anyone look them up.

When a page shows a wallet that belongs to someone verified on Aletheia, the extension's full
check says so by name ("0x0D34…E736 belongs to Asha Verma").

```bash
pnpm aletheia   # http://localhost:5175
```

## Get verified

1. **Aletheia** asks which wallet the record belongs to (MetaMask, or a demo wallet kept in the
   browser), then redirects to the issuer like an OAuth sign-in.
2. **Mock DigiLocker** (labelled on every screen as a demo issuer, not the real DigiLocker):
   - pick a fictional resident;
   - **upload a document** (any file, or a generated sample). It's fingerprinted with SHA-256 in
     the browser and never uploaded;
   - review what will be public, then Allow or Deny.
3. The issuer signs one record (EIP-712): **name, document type, document fingerprint, facts**
   (18+ only if true, nationality, ID valid), bound to the wallet, expiring with the ID. An
   expired ID gets nothing.
4. Back on Aletheia, the callback checks `state`, then **verifies the signature, issuer, wallet
   and expiry** before accepting the record.
5. **Publish to Arkiv** (MetaMask): one `satya_identity_v1` entity owned by the wallet
   ([schema](../../arkiv/schema.md#5-satya_identity_v1-verified-people-searchable)).

## Look up, and check a document

- **Look up** by full name (exact match, not case-sensitive), wallet address, or document
  fingerprint. Queries go straight to Arkiv; no indexer.
- **Check a document**: drop a file; it's fingerprinted on your device and matched against
  Arkiv. "Was this exact file the one that was verified, and for whom?"
- **Profiles** at `#/u/<wallet>` show the wallet in full so the extension can recognise it.

Every result is checked in the browser: the record must be owned by the wallet it names and
signed by a trusted issuer.

## What's public, what's not

- **On Arkiv (public):** name, wallet, document type, document fingerprint, the issuer's
  signature, the facts.
- **Never stored or sent:** the document, date of birth, ID number, address, photo.

## What's mock

The issuer key is public on purpose (`MOCK_DIGILOCKER_KEY` in `packages/identity`): real
DigiLocker access needs government partner approval. Its residents are fictional and every
record from it is labelled "Mock DigiLocker (demo)". The OAuth code exchange is simulated in the
browser (`sessionStorage`) instead of a server call.

## Design

A consumer trust-check site, after ScamAdviser's layout (not its brand): a floating white
nav card with a search pill, a dark hero with our own headline ("Trust the proof, not the profile.") and one big search, and results on white cards.
Each person's report has a gauge of the checks that passed (owner, issuer signature, expiry),
green **positive highlights**, a red **watch out for** list (always including that the issuer
is a demo with fictional residents), document details and a barcode drawn from the document's
SHA-256. The "How this was checked" box prints the real Arkiv query and each check it ran, and
the nav shows Arkiv's live block height.

The mock DigiLocker deliberately looks different (plain, light) so it reads as a separate service.
