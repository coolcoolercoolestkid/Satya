/**
 * Everything the M1 runner needs from the outside world, in one place.
 *
 * Three sources, each loaded the honest way and none of them a literal in the runner:
 *
 *   - **Secrets and endpoints** come from the repository-root `.env`, loaded through the
 *     same `loadRootEnv` the query client and `hardhat.config.ts` use.
 *   - **Deployed addresses** come from the committed deployment manifest
 *     (`packages/contracts/deployments/sepolia.json`), the durable copy of the Ignition
 *     output. The runner then cross-checks them live on-chain (`m1.ts`), so a stale
 *     manifest fails loudly rather than sending a transaction to the wrong contract.
 *   - **Contract ABIs** are read from the compiled Hardhat artifacts, so the runner drives
 *     exactly the interface the deployed bytecode was built from. There is no hand-written
 *     ABI here to drift out of sync with the Solidity.
 *
 * A missing input is reported as a named prerequisite ("build the contracts", "set
 * SEPOLIA_RPC_URL"), never worked around with a stub.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadRootEnv } from "@aletheia/query";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Account,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

/** The repository root, resolved from this file rather than the process cwd. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Load the root `.env` into `process.env`. Idempotent, non-overriding. */
export function loadEnv(): void {
  loadRootEnv();
}

/** A required environment variable, or a clear failure naming it. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `${name} is not set. The M1 runner talks to real infrastructure; it has no ` +
        `default for ${name}. Put it in the repository-root .env (see .env.example).`,
    );
  }
  return value.trim();
}

/** One deployed contract: its address and the block it was deployed in. */
export interface DeployedContract {
  address: `0x${string}`;
  deployBlock: number;
}

/** One claim type as recorded in the manifest. */
export interface ManifestClaim {
  claimType: number;
  setClaimVerifierBlock: number;
}

/** The committed Sepolia deployment manifest. */
export interface DeploymentManifest {
  network: string;
  chainId: number;
  schemaVersion: number;
  contracts: {
    AletheiaIssuerRegistry: DeployedContract;
    Groth16VerifierAge: DeployedContract;
    Groth16VerifierNationality: DeployedContract;
    Groth16VerifierExpiry: DeployedContract;
    AletheiaVerifier: DeployedContract;
    AletheiaProfile: DeployedContract;
  };
  ageClaim: ManifestClaim;
  nationalityClaim: ManifestClaim;
  expiryClaim: ManifestClaim;
  mockIssuer: { issuerId: `0x${string}`; label: string; registeredBlock: number };
}

/**
 * The committed Sepolia deployment manifest.
 *
 * This is the durable, machine-readable copy of the Ignition deployment output. The
 * Ignition directory itself is gitignored, so on a clean checkout it is the only source of
 * the addresses — which is why it is committed and why the runner cross-checks it on-chain
 * rather than trusting it blindly.
 */
export function loadDeployment(): DeploymentManifest {
  const path = join(REPO_ROOT, "packages", "contracts", "deployments", "sepolia.json");
  let manifest: DeploymentManifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8")) as DeploymentManifest;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`could not read the deployment manifest at ${path}: ${detail}`);
  }
  if (manifest.chainId !== sepolia.id) {
    throw new Error(
      `the deployment manifest is for chain ${manifest.chainId}, but the runner targets ` +
        `Sepolia (${sepolia.id}).`,
    );
  }
  return manifest;
}

/**
 * The compiled ABI for one contract, read from the Hardhat artifacts.
 *
 * `solDir` is the artifact subdirectory (e.g. `AletheiaVerifier.sol` or
 * `verifiers/Groth16VerifierAge.sol`); `name` is the contract. A missing artifact means
 * the contracts have not been compiled, which is a named prerequisite, not a stub point.
 */
export function loadArtifactAbi(solDir: string, name: string): Abi {
  const path = join(
    REPO_ROOT,
    "packages",
    "contracts",
    "artifacts",
    "contracts",
    solDir,
    `${name}.json`,
  );
  let artifact: { abi?: Abi };
  try {
    artifact = JSON.parse(readFileSync(path, "utf8")) as { abi?: Abi };
  } catch {
    throw new Error(
      `no compiled artifact for ${name} at ${path}. Build the contracts first:\n` +
        `  pnpm --filter @aletheia/contracts run build`,
    );
  }
  if (artifact.abi === undefined) {
    throw new Error(`artifact ${path} has no abi`);
  }
  return artifact.abi;
}

/** A read-only client and a signing client for Sepolia, plus the signer's account. */
export interface SepoliaClients {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Account;
}

/**
 * Build the Sepolia clients from `SEPOLIA_RPC_URL` and `SEPOLIA_PRIVATE_KEY`.
 *
 * The private key is a throwaway Sepolia key (see myTasks.md); it only ever holds faucet
 * ETH. It is normalised to the `0x`-prefixed form viem requires.
 */
export function sepoliaClients(): SepoliaClients {
  const rpcUrl = requireEnv("SEPOLIA_RPC_URL");
  const rawKey = requireEnv("SEPOLIA_PRIVATE_KEY");
  const key = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`;

  const account = privateKeyToAccount(key);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain: sepolia, transport });
  const walletClient = createWalletClient({ account, chain: sepolia, transport });
  return { publicClient, walletClient, account };
}
