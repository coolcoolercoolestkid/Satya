/**
 * Register the mock-dev issuer in AletheiaIssuerRegistry.
 *
 * Deliberately not part of the Ignition module (see ignition/modules/Aletheia.ts): it
 * reads the issuer's public key from a gitignored local keystore, and a declarative
 * deployment module has no business depending on an operator's local files.
 *
 * This script only ever registers the local *mock* issuer. It refuses any keystore
 * whose label is not `mock-dev`, so it can never be the tool that puts a real issuer
 * key on-chain. Every credential this issuer signs proves issuance by a mock that
 * verifies no identity and nothing more — see docs/trust-model.md.
 *
 * Run against the network holding the deployment:
 *   npx hardhat run scripts/register-issuer.ts --network sepolia
 *   npx hardhat run scripts/register-issuer.ts --network localhost
 *
 * The registry address is read from the Ignition deployment for the connected chain, so
 * the contracts must already be deployed there.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
        "Deploy the contracts to this network before registering the issuer.",
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
      `refusing to register: keystore label is "${file.label}", not "${MOCK_ISSUER_LABEL}". ` +
        "This script only ever registers the local mock issuer.",
    );
  }
  // parseKeystore re-derives the public key from the private key, so a tampered
  // publicKey field cannot register a point the mock issuer cannot actually sign for.
  return parseKeystore(file);
}

async function main(): Promise<void> {
  console.error(
    "!! mock issuer: this key verifies no identity. Registering it makes mock-dev " +
      "credentials verifiable, nothing more. !!",
  );

  const { publicKey } = await loadMockIssuer();

  const { viem, networkName } = await network.getOrCreate();
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  const registryAddress = deployedRegistryAddress(chainId);

  console.log(`network:    ${networkName} (chain id ${chainId})`);
  console.log(`registry:   ${registryAddress}`);
  console.log(`issuer ax:  ${publicKey.ax}`);
  console.log(`issuer ay:  ${publicKey.ay}`);
  console.log(`label:      ${MOCK_ISSUER_LABEL}`);

  const registry = await viem.getContractAt("AletheiaIssuerRegistry", registryAddress);
  const issuerId = await registry.read.issuerId([publicKey.ax, publicKey.ay]);

  // A second run must fail cleanly rather than send a transaction that reverts on-chain
  // and burns gas. The registry keys entries by the key itself, so re-registering the
  // same key is impossible by design; we surface that here instead of relying on it.
  const existing = await registry.read.issuer([issuerId]);
  if (existing.registeredAt !== 0n) {
    throw new Error(
      `issuer ${issuerId} is already registered (label "${existing.label}", ` +
        `active ${existing.active}). Nothing to do.`,
    );
  }

  const [signer] = await viem.getWalletClients();
  if (signer === undefined) {
    throw new Error("no signer available for this network");
  }
  console.log(`owner:      ${signer.account.address}`);

  const hash = await registry.write.register(
    [publicKey.ax, publicKey.ay, MOCK_ISSUER_LABEL],
    { account: signer.account },
  );
  console.log(`register tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`mined in block ${receipt.blockNumber} (status ${receipt.status})`);

  // Read the entry back and require it active, so success means the chain agrees, not
  // that a transaction was merely sent.
  const entry = await registry.read.issuer([issuerId]);
  if (!entry.active || entry.label !== MOCK_ISSUER_LABEL || entry.registeredAt === 0n) {
    throw new Error(`post-registration read-back does not look right: ${JSON.stringify({
      active: entry.active,
      label: entry.label,
      registeredAt: entry.registeredAt.toString(),
    })}`);
  }
  // requireActive reverts unless the key is registered and active; a belt-and-braces
  // confirmation that the very check AletheiaVerifier makes on every proof now passes.
  await registry.read.requireActive([publicKey.ax, publicKey.ay]);

  console.log(`\nissuerId:   ${issuerId}`);
  console.log(`active:     ${entry.active}`);
  console.log("registered. AletheiaVerifier will now accept proofs from this mock issuer.");
}

await main();
