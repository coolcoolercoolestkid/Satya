/**
 * Flip the mock-dev issuer's on-chain `active` flag — the real cause behind the `revoked`
 * verification state (Day 14).
 *
 * `AletheiaIssuerRegistry.setActive(id, false)` is how an issuer key is revoked, emitting
 * `IssuerActiveSet(id, false)`, which the subgraph indexes onto the `Issuer` entity. A
 * `Verification` proven against that key is immutable and stays true — see
 * docs/trust-model.md — but a verifier reading it afterwards sees `issuer.active == false`
 * and the read layer renders it `revoked` rather than `verified`. That transition is the
 * Day 14 gate for `revoked`: it must come from an actual on-chain revocation, never a
 * simulated flag.
 *
 * This is reversible and, on the shared Sepolia deployment, MUST be reversed: while the
 * issuer is inactive, AletheiaVerifier rejects every new proof (requireActive reverts).
 * So the intended sequence is `false` (capture `revoked`), then `true` (restore), each
 * confirmed by a read-back.
 *
 * Refuses any issuer whose on-chain label is not `mock-dev`: this script only ever
 * touches the sanctioned mock, never a real issuer key.
 *
 * Run against the network holding the deployment:
 *   ISSUER_ACTIVE=false npx hardhat run scripts/set-issuer-active.ts --network sepolia
 *   ISSUER_ACTIVE=true  npx hardhat run scripts/set-issuer-active.ts --network sepolia
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  MOCK_ISSUER_LABEL,
  defaultKeystorePath,
  parseKeystore,
  type KeystoreFile,
} from "@aletheia/issuer-mock";
import { network } from "hardhat";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The registry address Ignition recorded for this chain, or a clear failure. */
function deployedRegistryAddress(chainId: number): `0x${string}` {
  const file = join(
    HERE,
    "..",
    "ignition",
    "deployments",
    `chain-${chainId}`,
    "deployed_addresses.json",
  );
  let addresses: Record<string, string>;
  try {
    addresses = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
  } catch {
    throw new Error(
      `no Ignition deployment for chain ${chainId} (${file} is missing). ` +
        "Deploy the contracts to this network first.",
    );
  }
  const address = addresses["Aletheia#AletheiaIssuerRegistry"];
  if (address === undefined) {
    throw new Error(
      `chain ${chainId} has an Ignition deployment but no AletheiaIssuerRegistry in it.`,
    );
  }
  return address as `0x${string}`;
}

/** Load the mock keystore, refusing anything that is not the mock issuer. */
async function loadMockIssuer() {
  const path = defaultKeystorePath();
  let file: KeystoreFile;
  try {
    file = JSON.parse(readFileSync(path, "utf8")) as KeystoreFile;
  } catch {
    throw new Error(
      `no issuer keystore at ${path}. Generate one with ` +
        "`pnpm --filter @aletheia/issuer-mock run keygen` first.",
    );
  }
  if (file.label !== MOCK_ISSUER_LABEL) {
    throw new Error(
      `refusing to touch a keystore labelled "${file.label}", not "${MOCK_ISSUER_LABEL}". ` +
        "This script only ever flips the local mock issuer.",
    );
  }
  return parseKeystore(file);
}

/** Parse ISSUER_ACTIVE strictly: `true` or `false`, nothing else. */
function desiredActive(): boolean {
  const raw = process.env["ISSUER_ACTIVE"];
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(
    `set ISSUER_ACTIVE to "true" or "false" (received ${JSON.stringify(raw)}). ` +
      "This says which way to flip the mock-dev issuer.",
  );
}

async function main(): Promise<void> {
  const active = desiredActive();
  const { publicKey } = await loadMockIssuer();

  const { viem, networkName } = await network.getOrCreate();
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  const registryAddress = deployedRegistryAddress(chainId);
  const registry = await viem.getContractAt("AletheiaIssuerRegistry", registryAddress);
  const issuerId = await registry.read.issuerId([publicKey.ax, publicKey.ay]);

  console.log(`network:   ${networkName} (chain id ${chainId})`);
  console.log(`registry:  ${registryAddress}`);
  console.log(`issuerId:  ${issuerId}`);
  console.log(`target:    active = ${active}`);

  const before = await registry.read.issuer([issuerId]);
  if (before.registeredAt === 0n) {
    throw new Error(`issuer ${issuerId} is not registered; nothing to flip.`);
  }
  // Refuse to touch anything but the mock, checking the on-chain label too, not only the
  // local keystore's.
  if (before.label !== MOCK_ISSUER_LABEL) {
    throw new Error(
      `refusing: on-chain issuer label is "${before.label}", not "${MOCK_ISSUER_LABEL}".`,
    );
  }
  console.log(`current:   active = ${before.active} (label "${before.label}")`);

  if (before.active === active) {
    console.log(`\nalready active = ${active}; nothing to do.`);
    return;
  }

  const [signer] = await viem.getWalletClients();
  if (signer === undefined) throw new Error("no signer available for this network");
  console.log(`owner:     ${signer.account.address}`);

  const hash = await registry.write.setActive([issuerId, active], { account: signer.account });
  console.log(`\nsetActive tx: ${hash}`);
  console.log(`              https://sepolia.etherscan.io/tx/${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`setActive reverted on-chain (status ${receipt.status})`);
  }
  console.log(`mined in block ${receipt.blockNumber} (status ${receipt.status})`);

  const after = await registry.read.issuer([issuerId]);
  if (after.active !== active) {
    throw new Error(
      `read-back mismatch: on-chain active is ${after.active}, expected ${active}.`,
    );
  }
  console.log(`\nread back: active = ${after.active}. The subgraph will pick this up once`);
  console.log(`it indexes block ${receipt.blockNumber}; poll _meta.block.number until then.`);
}

await main();
