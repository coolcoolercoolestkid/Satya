# @aletheia/web — Phase 1 holder and verifier flows

Two browser surfaces, both running entirely on the device:

- **Holder flow** (`/`) — takes a passport MRZ, lets the holder review and correct the
  extracted fields, signs a `mock-dev` credential, proves an **age or nationality** claim,
  and submits it to Sepolia. The passport (its MRZ, date of birth, nationality, expiry,
  number) never leaves the browser; only the proof and its public signals go on-chain. An
  age proof reveals only that the threshold is met; a **nationality** proof discloses the
  nationality it asserts, so the flow shows a disclosure notice and requires an explicit
  acknowledgement **before** proving.
- **Verifier flow** (`/verify`) — resolves an ENS name or a wallet address, reads what it
  has proven from the subgraph, and renders each record as one of five honest states
  (`verified`, `stale`, `revoked`, `pending`, `not found`). ENS is resolved live over
  mainnet and never stored; the subgraph read carries the indexer's block on every query,
  so indexing lag shows as `pending` rather than a silent wrong answer.

`mock-dev` is labelled everywhere it appears: this issuer verifies no identity. A
credential signed here proves issuance by a mock issuer and nothing more, and a verifier
record reading `verified` means a real proof was accepted on-chain — never that a
real-world identity was checked.

## What runs where

| Step | Where | Package |
|---|---|---|
| Extract MRZ (text / PDF / image) | browser, on-device | `@aletheia/extraction` |
| Review & correct (mandatory) | browser | this app |
| Derive `documentKey`, sign credential | browser (mock issuer on the holder's device) | `@aletheia/issuer-mock/browser`, `@aletheia/extraction/browser` |
| Prove age (Groth16) | browser (snarkjs + wasm/zkey from this origin) | `@aletheia/circuits/browser` + snarkjs |
| Submit `submitAgeClaim` | wallet → Sepolia | `viem` |
| Resolve ENS name / address | browser → mainnet (read-only) | `@aletheia/ens/browser` |
| Read verifications, classify state | browser → subgraph | `@aletheia/query/browser` |

Contract addresses come from the generated deployment manifest
(`packages/contracts/deployments/sepolia.json`), never a literal. The verifier flow reads
the subgraph and mainnet ENS through the packages' `./browser` entries, which carry no
filesystem access — the endpoints are passed in from `NEXT_PUBLIC_*` env vars, never a
repository-root `.env`.

## Setup

1. **Build the circuit artifacts** (the wasm and zkey the browser proves with):

   ```bash
   pnpm --filter @aletheia/circuits run build
   ```

   `predev`/`prebuild` copy them into `public/circuits` (they are gitignored, ~10 MB).

2. **Copy the mock-dev issuer keystore** into the app so the browser can sign. The
   keystore is the gitignored one the Node tools use; the app fetches it from its own
   origin and refuses anything not labelled `mock-dev`:

   ```bash
   cp packages/issuer-mock/keys/issuer-mock.json packages/web/public/mock-issuer-keystore.json
   ```

   (Generate it first with `pnpm --filter @aletheia/issuer-mock run keygen` if you have
   none, and register it as the `mock-dev` issuer.)

3. **Configure `.env.local`** (gitignored). The Sepolia RPC is used by the dev signer and
   for reads; the dev signer key is optional and only enables the no-extension path. The
   subgraph and mainnet endpoints power the verifier flow — the same values as the root
   `.env` `GRAPH_QUERY_URL` / `MAINNET_RPC_URL`. Both are `NEXT_PUBLIC_*`, so they ship to
   the browser exactly as the Sepolia RPC already does (the mainnet RPC is read-only and
   used only for ENS resolution):

   ```
   NEXT_PUBLIC_SEPOLIA_RPC_URL=<your Sepolia RPC url>
   NEXT_PUBLIC_DEV_SIGNER_PRIVATE_KEY=<0x… throwaway funded key>   # optional
   NEXT_PUBLIC_GRAPH_QUERY_URL=<the subgraph query endpoint>       # verifier flow
   NEXT_PUBLIC_MAINNET_RPC_URL=<a mainnet RPC url>                 # verifier flow, ENS (address lookup works without it)
   ```

## Run

```bash
pnpm --filter @aletheia/web dev
```

Then, at <http://localhost:3000>: load a passport (the "Use sample MRZ" button fills a
specimen MRZ), confirm the fields, connect a wallet, and submit. After a successful submit,
the outcome links to `/verify?watch=<verificationId>&block=<minedBlock>`, where the record
shows `pending` and turns `verified` the moment the subgraph indexes that block — no reload.

The **verifier flow** at <http://localhost:3000/verify> is reachable independently: paste an
ENS name or address to list its verifications and their states, adjust the freshness window
to see one record read `verified` or `stale`, or watch a verificationId go from `pending` to
`verified` as it is indexed.

## Signing the transaction

- **Injected wallet (MetaMask)** — the real design. Connect your wallet; `subject` in the
  credential must equal the connected address or the contract reverts with
  `SubjectIsNotSender`.
- **Dev signer** — appears only when `NEXT_PUBLIC_DEV_SIGNER_PRIVATE_KEY` is set. Signs
  with the throwaway Sepolia key locally (no extension), so the whole flow including the
  real transaction can run headless. Not the real UX; a testing convenience.
