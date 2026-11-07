# scripts — the M1 end-to-end runner

The cross-package runner named in `docs/architecture.md`. One command drives the whole
Aletheia pipeline against **real** infrastructure and fails if any link is not genuine:

```
signed credential → circuit → proof → local verify → Solidity verify
  → Sepolia transaction → event → Graph → verifier query
```

Nothing is stubbed. The credential is really signed by the `mock-dev` issuer, the proof is
a real Groth16 proof, the deployed on-chain verifier really checks it, the transaction is
really mined on Sepolia, and the record is really read back from the deployed subgraph and
classified `verified`. Where a value can be cross-checked against the chain — the manifest
addresses, the emitted event, the indexed record's id, nullifier and transaction — it is.

## Run it

```bash
pnpm --filter @aletheia/scripts run m1
```

It submits one real `submitAgeClaim` transaction (gas ~312k, well under a cent of Sepolia
faucet ETH) and prints the transaction hash and the indexed record.

## Prerequisites

All of these are the normal project setup; none is optional, because exercising them is the
point of the runner.

1. **Built workspace packages.** The runner imports the built `@aletheia/*` packages:

   ```bash
   pnpm -r run build
   ```

   This includes the circuit artifacts (`age.wasm`, the proving and verification keys) and
   the compiled Hardhat artifacts, from which the runner reads the real contract ABIs.

2. **The mock issuer keystore**, and its key registered on-chain as the `mock-dev` issuer.
   The runner refuses any keystore not labelled `mock-dev`. See
   `packages/issuer-mock` and `packages/contracts/scripts/register-issuer.ts`.

3. **A funded Sepolia signer and the endpoints**, in the repository-root `.env`
   (see `.env.example`):

   | Variable | Used for |
   |---|---|
   | `SEPOLIA_RPC_URL` | the read/write client for Sepolia |
   | `SEPOLIA_PRIVATE_KEY` | the throwaway signer (faucet ETH only) |
   | `GRAPH_QUERY_URL` | the deployed subgraph the record is read back from |

## Where its inputs come from

- **Secrets and endpoints** — the root `.env`, loaded the same way the query client and
  `hardhat.config.ts` load it.
- **Deployed addresses** — `packages/contracts/deployments/sepolia.json`, the committed,
  machine-readable copy of the Ignition deployment output (the Ignition directory itself is
  gitignored, so on a clean checkout this file is the only source). The runner then
  cross-checks each address live on-chain, so a stale manifest fails loudly.
- **Contract ABIs** — the compiled Hardhat artifacts, so the runner drives exactly the
  interface the deployed bytecode was built from. There is no hand-written ABI to drift.

## What a green run proves

The M1 gate (TODO.md, day 16): the command completes against real infrastructure, start to
finish, from a clean checkout, printing the real transaction hash and the real indexed
record. A recorded run is in `STATUS.md`.
