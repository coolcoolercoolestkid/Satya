import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

/**
 * Load the repository-root .env, if there is one.
 *
 * Hardhat 3 resolves `configVariable` from real environment variables and does not read
 * .env files on its own. Loading the root .env into `process.env` here is what lets
 * `SEPOLIA_PRIVATE_KEY`, `SEPOLIA_RPC_URL` and `ETHERSCAN_API_KEY` come from that file.
 * Node's own loader is used rather than adding a dependency for it. The file is
 * gitignored and never read by anything that prints.
 *
 * The deployer key lives in .env (see .env.example), matching scripts/preflight.ts. It
 * must be a throwaway key that only ever holds Sepolia faucet ETH.
 */
const rootEnv = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env");
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

/**
 * The optimizer is enabled in both profiles on purpose: the snarkjs-generated Groth16
 * verifiers are assembly-heavy, and test gas numbers should reflect what is deployed
 * rather than an unoptimised build nobody will use.
 */
const settings = {
  optimizer: { enabled: true, runs: 200 },
} as const;

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: { version: "0.8.28", settings },
      production: { version: "0.8.28", settings },
    },
  },
  // Source verification, so anyone can read the deployed bytecode's source rather than
  // taking our word for what is running. Sourcify needs no key and is enabled as well.
  verify: {
    etherscan: { apiKey: configVariable("ETHERSCAN_API_KEY") },
    sourcify: { enabled: true },
  },
  networks: {
    // Local simulated chain used by the test suite.
    hardhat: {
      type: "edr-simulated",
      chainType: "l1",
    },
    // A standalone `npx hardhat node`. State persists across invocations, so the
    // register-issuer script can be exercised end to end — register, read back, and a
    // second run refusing to double-register — without spending Sepolia funds. Accounts
    // are the node's own unlocked dev accounts.
    localhost: {
      type: "http",
      chainType: "l1",
      url: "http://127.0.0.1:8545",
      accounts: "remote",
    },
    // Secrets are loaded from the repository-root .env into the environment above, then
    // resolved through configVariable. See .env.example.
    sepolia: {
      type: "http",
      chainType: "l1",
      // Pinned so a mis-set RPC URL cannot silently deploy somewhere else. Hardhat
      // aborts if the endpoint reports a different chain id, which makes an accidental
      // mainnet deployment impossible rather than merely unlikely.
      chainId: 11155111,
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("SEPOLIA_PRIVATE_KEY")],
    },
  },
});
