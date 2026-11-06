import { createPublicClient, http, isAddress, type Address, type EIP1193Provider } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { normalize } from "viem/ens";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export const ARKIV_KEY = import.meta.env.VITE_ARKIV_ACCESS_KEY ?? "";
export const ARKIV_EXPLORER = "https://rabdi.explorer.arkiv.network";
export const ARKIV_FAUCET = "https://hub.arkiv.network/faucet";

export function provider(): EIP1193Provider {
  if (!window.ethereum) throw new Error("No browser wallet found. Install MetaMask or another wallet.");
  return window.ethereum;
}

export async function connect(): Promise<Address> {
  const accounts = (await provider().request({ method: "eth_requestAccounts" })) as Address[];
  if (!accounts[0]) throw new Error("No account selected.");
  return accounts[0];
}

const ensClients = [
  createPublicClient({ chain: mainnet, transport: http("https://ethereum-rpc.publicnode.com") }),
  createPublicClient({ chain: sepolia, transport: http("https://ethereum-sepolia-rpc.publicnode.com") }),
];

export async function ensNameOf(address: Address): Promise<string | null> {
  for (const c of ensClients) {
    try {
      const name = await c.getEnsName({ address });
      if (name) return name;
    } catch {
      /* next network */
    }
  }
  return null;
}

/** Accepts an address or an ENS name and returns the address. */
export async function resolveTarget(input: string): Promise<{ address: Address; name?: string } | null> {
  const value = input.trim();
  if (isAddress(value)) return { address: value };
  if (!value.endsWith(".eth")) return null;
  for (const c of ensClients) {
    try {
      const address = await c.getEnsAddress({ name: normalize(value) });
      if (address) return { address, name: value.toLowerCase() };
    } catch {
      /* next network */
    }
  }
  return null;
}

export async function ensText(name: string, key: string): Promise<string | null> {
  for (const c of ensClients) {
    try {
      const v = await c.getEnsText({ name: normalize(name), key });
      if (v) return v;
    } catch {
      /* next network */
    }
  }
  return null;
}

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
