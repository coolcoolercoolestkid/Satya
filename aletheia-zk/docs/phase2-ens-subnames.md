# Phase 2: ENS subnames (not implemented)

Phase 1 is **resolution only**: `getEnsAddress` and `getEnsName` through the Universal
Resolver proxy `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe`, read-only, with viem
`>= 2.35`. Aletheia creates no ENS names, writes no ENS records, and stores no ENS state
on-chain. Users without a name use their address, which is a first-class path everywhere.

## Why nothing is issued in Phase 1

- Issuing `name.aletheia.eth` requires owning the parent name and running registrar
  infrastructure. That is real operational work that buys no verifiable security here —
  ENS is a lookup convenience in this protocol, not a trust anchor.
- The correct registrar shape is changing right now. ENSv2 replaces the single flat
  registry with per-name hierarchical registries and is in public beta on Sepolia, with
  mainnet timing dependent on beta results. A registrar written against ENSv1 semantics
  today would likely be rewritten.
- ENS also cancelled Namechain and will deploy ENSv2 exclusively on Ethereum L1, so any
  L2-subname design would have been rework too.

## What issuing subnames would require

**L1, ENSv1 shape:** own `aletheia.eth`; issue via `setSubnodeOwner` (or NameWrapper);
set a resolver; pay mainnet gas per name.

**L1, ENSv2 shape:** own `aletheia.eth`; deploy a `PermissionedRegistry` for it; deploy a
registrar holding the mint role; call `setSubregistry()` on the parent (needs
`ROLE_SET_SUBREGISTRY`, held from registration); set a resolver. Until the parent points
at the registry, registered names mint tokens but never resolve.

**Offchain / L2, gasless:** a CCIP-Read (EIP-3668) gateway plus ENSIP-10 wildcard
resolution on the parent, with the gateway signing key as a new operational trust
dependency. Durin packages the L1-resolver and gateway parts.

## Non-negotiable constraint

Whatever is chosen later, ENS records must never contain a date of birth, nationality,
passport or document number, credential, credential id, signature, proof, witness, or any
private ZK input. ENS maps a name to an address. Nothing more.
