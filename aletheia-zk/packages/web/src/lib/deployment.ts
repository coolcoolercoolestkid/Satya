/**
 * The deployed contract facts the holder flow submits against.
 *
 * Addresses and the claim type come from the generated deployment manifest
 * (`packages/contracts/deployments/sepolia.json`, refreshed into `src/abi` by
 * `scripts/copy-assets.ts`), never a literal in the app — a redeploy changes the manifest
 * and the app follows. The ABI is the committed copy of the compiled artifact.
 */

import deployment from "@/abi/sepolia-deployment.json";
import verifierAbi from "@/abi/AletheiaVerifier.json";
import type { Abi } from "viem";

export const ALETHEIA_VERIFIER_ABI = verifierAbi as Abi;

export interface DeploymentInfo {
  chainId: number;
  schemaVersion: number;
  verifierAddress: `0x${string}`;
  ageClaimType: number;
  nationalityClaimType: number;
  expiryClaimType: number;
  mockIssuerId: `0x${string}`;
  mockIssuerLabel: string;
}

export const DEPLOYMENT: DeploymentInfo = {
  chainId: deployment.chainId,
  schemaVersion: deployment.schemaVersion,
  verifierAddress: deployment.contracts.AletheiaVerifier.address as `0x${string}`,
  ageClaimType: deployment.ageClaim.claimType,
  nationalityClaimType: deployment.nationalityClaim.claimType,
  expiryClaimType: deployment.expiryClaim.claimType,
  mockIssuerId: deployment.mockIssuer.issuerId as `0x${string}`,
  mockIssuerLabel: deployment.mockIssuer.label,
};

/** Etherscan tx link for the deployed chain (Sepolia). */
export function etherscanTx(hash: string): string {
  return `https://sepolia.etherscan.io/tx/${hash}`;
}
