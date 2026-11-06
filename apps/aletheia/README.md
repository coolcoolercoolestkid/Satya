# Aletheia: a Satya demo site with mock DigiLocker sign-in

Aletheia (Greek for "truth", as Satya is in Sanskrit) shows the other side of Satya's identity
work: a website that needs to know a few facts about you, and gets **only those facts**.

```bash
pnpm aletheia   # http://localhost:5175
```

## The flow

1. **Aletheia** asks which wallet the proofs should belong to (MetaMask, or a demo wallet kept in
   the browser), then redirects to the issuer like an OAuth sign-in:
   `#/mock-digilocker/authorize?client_id=aletheia&scope=age_over_18 nationality id_valid&holder=0x…&state=…`
2. **Mock DigiLocker** (labelled on every screen as a demo issuer, not the real DigiLocker): pick a
   fictional resident, review exactly what Aletheia will see, then Allow or Deny.
3. The issuer signs **only the claims that are true** (EIP-712, one signature per claim, bound to
   the wallet, expiring with the ID). A minor gets no 18+ claim; an expired ID gets nothing.
4. Back on Aletheia, the callback checks `state`, then **verifies every signature, issuer, holder
   and expiry** before accepting a claim. The 18+ area unlocks only with a valid 18+ claim.
5. **Publish to Arkiv** (MetaMask): each signed claim becomes a record owned by the wallet, so any
   other site, or Satya's extension, can check it without asking the user again. Public profiles at
   `#/u/<address>` verify those records in the browser.

Aletheia never receives a name, date of birth, ID number or address.

## Fictional residents

| Resident | Result |
|---|---|
| Asha Verma | Adult, India, ID valid: 18+, Indian, ID valid |
| Rohan Mehta | Minor: nationality and ID valid only; 18+ refused |
| Kavya Iyer | ID expired: no claims |
| Daniel Brooks | Adult, USA: 18+, US, ID valid |

## What's mock

The issuer key is public on purpose (`MOCK_DIGILOCKER_KEY` in `packages/identity`): real DigiLocker
access needs government partner approval. Claims from it are always labelled "demo issuer". The
code exchange is simulated in the browser (`sessionStorage`) instead of a server call.
