/**
 * Pre-deployment checks.
 *
 * Answers the questions worth answering before spending real testnet funds: is this
 * actually Sepolia, which address will sign, and can it pay for the deployment.
 *
 * Deliberately prints no secret. The RPC URL is withheld because it usually embeds an
 * API key, and the deployer key is only ever used to derive its public address — the
 * one piece of it that is safe to show.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createPublicClient, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const rootEnv = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env");
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

const EXPECTED_CHAIN_ID = sepolia.id;
/** Enough for four contracts plus a configuration call, with room to spare. */
const MINIMUM_BALANCE_WEI = 10_000_000_000_000_000n; // 0.01 ETH

/** Describe what a malformed key looks like, without revealing any of it. */
function describeKeyShape(value: string): string {
  if (/^["'].*["']$/.test(value)) return "it is wrapped in quotes; remove them";
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) {
    return "this is an ADDRESS (0x + 40 hex), not a private key";
  }
  if (/^[0-9a-fA-F]{64}$/.test(value)) return "64 hex characters but no 0x prefix; add 0x";
  if (/^[0-9a-fA-F]{40}$/.test(value)) return "an address with no 0x prefix, not a private key";
  if (!value.startsWith("0x")) return "it does not start with 0x";
  if (/[^0-9a-fA-Fx]/.test(value)) return "it contains non-hexadecimal characters";
  return value.length < 66 ? "too short" : "too long";
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Put it in the repository-root .env file.`);
  }
  return value;
}

async function main(): Promise<void> {
  // The endpoint is checked first so that a malformed key does not hide whether the RPC
  // is the network we think it is.
  const rpcUrl = requireEnv("SEPOLIA_RPC_URL");
  const client = createPublicClient({ transport: http(rpcUrl) });
  const chainId = await client.getChainId();
  console.log(`chain id:        ${chainId}`);
  if (chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(
      `refusing to continue: expected Sepolia (${EXPECTED_CHAIN_ID}), the endpoint is ${chainId}`,
    );
  }
  console.log("network:         Sepolia (confirmed by the endpoint, not by configuration)");
  console.log(`block:           ${await client.getBlockNumber()}`);

  const rawKey = requireEnv("SEPOLIA_PRIVATE_KEY").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(rawKey)) {
    // Diagnose the shape precisely, because "invalid key" sends people hunting in the
    // wrong place. Nothing about the value itself is echoed.
    throw new Error(
      `SEPOLIA_PRIVATE_KEY must be 0x followed by 64 hex characters (66 in total). ` +
        `Found ${rawKey.length} characters: ${describeKeyShape(rawKey)}`,
    );
  }

  const account = privateKeyToAccount(rawKey as `0x${string}`);
  console.log(`deployer:        ${account.address}`);

  const balance = await client.getBalance({ address: account.address });
  console.log(`balance:         ${formatEther(balance)} ETH`);

  if (balance < MINIMUM_BALANCE_WEI) {
    throw new Error(
      `balance is below ${formatEther(MINIMUM_BALANCE_WEI)} ETH; fund the deployer from a Sepolia faucet first`,
    );
  }
  console.log("\npre-flight checks passed.");
}

await main();
