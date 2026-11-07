/**
 * Submitting the age claim to Sepolia.
 *
 * Two signers, one code path after the account is chosen:
 * - **injected** — a wallet extension (MetaMask). This is the real product design: the
 *   holder connects their wallet and signs the transaction. `subject` in the credential
 *   must equal this address or the contract reverts with `SubjectIsNotSender`.
 * - **dev** — a local account from the funded throwaway `SEPOLIA_PRIVATE_KEY`, enabled by
 *   `NEXT_PUBLIC_DEV_SIGNER_PRIVATE_KEY`. It exists so the whole flow, including the real
 *   transaction, can run without a wallet extension for testing; it is not the real UX.
 *
 * Only the proof calldata and public signals go on-chain. No passport field is in the
 * transaction.
 */

import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseEventLogs,
  type Abi,
  type Account,
  type PublicClient,
  type WalletClient,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

import { ALETHEIA_VERIFIER_ABI, DEPLOYMENT } from "./deployment";
import type { SolidityCalldata } from "@aletheia/circuits/browser";

export type SignerKind = "injected" | "dev";

interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

const DEV_KEY = process.env.NEXT_PUBLIC_DEV_SIGNER_PRIVATE_KEY as `0x${string}` | undefined;
const RPC_URL = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL;

/** Whether the dev local-signer is configured (a key and an RPC endpoint are present). */
export const devSignerAvailable = Boolean(DEV_KEY && RPC_URL);

export interface Signer {
  kind: SignerKind;
  address: `0x${string}`;
  /**
   * What viem signs with. A local {@link Account} (dev signer) makes viem sign in-process
   * and broadcast via `eth_sendRawTransaction`; a bare address (injected wallet) routes
   * `eth_sendTransaction` to the extension, which holds the key. Passing the address for
   * the dev path would send `eth_sendTransaction` to a plain RPC, which rejects it.
   */
  account: Account | `0x${string}`;
  publicClient: PublicClient;
  walletClient: WalletClient;
}

/** Connect the injected wallet, making sure it is on Sepolia. */
export async function connectInjected(): Promise<Signer> {
  const provider = window.ethereum;
  if (!provider) throw new Error("no injected wallet found. Install MetaMask, or use the dev signer.");

  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as `0x${string}`[];
  const address = accounts[0];
  if (!address) throw new Error("the wallet returned no account");

  const chainIdHex = (await provider.request({ method: "eth_chainId" })) as string;
  if (Number.parseInt(chainIdHex, 16) !== DEPLOYMENT.chainId) {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${DEPLOYMENT.chainId.toString(16)}` }],
    });
  }

  const transport = custom(provider);
  return {
    kind: "injected",
    address,
    account: address,
    publicClient: createPublicClient({ chain: sepolia, transport }),
    walletClient: createWalletClient({ account: address, chain: sepolia, transport }),
  };
}

/** Build the dev local-signer from the throwaway key. */
export function connectDevSigner(): Signer {
  if (!DEV_KEY || !RPC_URL) {
    throw new Error("dev signer not configured (NEXT_PUBLIC_DEV_SIGNER_PRIVATE_KEY / NEXT_PUBLIC_SEPOLIA_RPC_URL)");
  }
  const account = privateKeyToAccount(DEV_KEY);
  const transport = http(RPC_URL);
  return {
    kind: "dev",
    address: account.address,
    account,
    publicClient: createPublicClient({ chain: sepolia, transport }),
    walletClient: createWalletClient({ account, chain: sepolia, transport }),
  };
}

export interface ClaimVerifiedEvent {
  verificationId: `0x${string}`;
  subject: `0x${string}`;
  claimType: number;
  issuerId: `0x${string}`;
  claimParameter: bigint;
  nullifier: `0x${string}`;
  identityNullifier: `0x${string}`;
  verifiedAt: bigint;
}

export interface SubmitResult {
  hash: `0x${string}`;
  verificationId: `0x${string}`;
  receipt: TransactionReceipt;
  event: ClaimVerifiedEvent;
}

/** The AletheiaVerifier entrypoints this app can submit to; all take the same calldata shape. */
type ClaimFunction = "submitAgeClaim" | "submitNationalityClaim" | "submitExpiryClaim";

/**
 * Simulate the claim submission (reading back the verificationId and failing before gas if
 * anything is wrong), send it, wait for the receipt, and pull the `ClaimVerified` event.
 * Age, nationality and expiry share this path — only the entrypoint name differs.
 */
async function submitClaim(
  signer: Signer,
  calldata: SolidityCalldata,
  functionName: ClaimFunction,
): Promise<SubmitResult> {
  const signals = calldata.publicSignals as readonly bigint[];
  const args = [calldata.a, calldata.b, calldata.c, signals] as const;

  const { result: verificationId, request } = await signer.publicClient.simulateContract({
    address: DEPLOYMENT.verifierAddress,
    abi: ALETHEIA_VERIFIER_ABI as Abi,
    functionName,
    args,
    account: signer.account,
  });

  const hash = await signer.walletClient.writeContract(request);
  const receipt = await signer.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`${functionName} reverted on-chain (status ${receipt.status})`);
  }

  const events = parseEventLogs({
    abi: ALETHEIA_VERIFIER_ABI as Abi,
    logs: receipt.logs,
    eventName: "ClaimVerified",
  });
  const event = events[0] as { args: ClaimVerifiedEvent } | undefined;
  if (!event) throw new Error("the transaction was mined but emitted no ClaimVerified event");

  return { hash, verificationId: verificationId as `0x${string}`, receipt, event: event.args };
}

export async function submitAgeClaim(signer: Signer, calldata: SolidityCalldata): Promise<SubmitResult> {
  return submitClaim(signer, calldata, "submitAgeClaim");
}

export async function submitNationalityClaim(
  signer: Signer,
  calldata: SolidityCalldata,
): Promise<SubmitResult> {
  return submitClaim(signer, calldata, "submitNationalityClaim");
}

export async function submitExpiryClaim(
  signer: Signer,
  calldata: SolidityCalldata,
): Promise<SubmitResult> {
  return submitClaim(signer, calldata, "submitExpiryClaim");
}
