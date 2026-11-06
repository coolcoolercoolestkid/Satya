import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Satya credentials are issuer-signed statements about one claim each ("is 18+",
 * "nationality is IN", "ID is valid"). One claim per signature means a holder can show
 * "18+" without revealing anything else, and the issuer never signs a date of birth.
 */
export type ClaimId = "age_over_18" | "nationality" | "id_valid";

export const CLAIM_LABELS: Record<ClaimId, (value: string) => string> = {
  age_over_18: () => "18+",
  nationality: (v) => `Nationality: ${v === "IN" ? "Indian" : v}`,
  id_valid: () => "Government ID valid",
};

export interface Attestation {
  holder: Address;
  claim: ClaimId;
  /** "true" for boolean claims, or the value (e.g. "IN"). */
  value: string;
  /** Unix seconds. */
  issuedAt: bigint;
  /** Unix seconds; the claim stops being valid after this. */
  expiresAt: bigint;
}

export interface SignedAttestation {
  attestation: Attestation;
  signature: Hex;
  issuer: Address;
}

export const EIP712_DOMAIN = { name: "Satya Attestation", version: "1" } as const;
export const EIP712_TYPES = {
  Attestation: [
    { name: "holder", type: "address" },
    { name: "claim", type: "string" },
    { name: "value", type: "string" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
  ],
} as const;

export interface TrustedIssuer {
  address: Address;
  name: string;
  /** Shown next to every claim so nobody mistakes demo proofs for real ones. */
  demo: boolean;
}

/**
 * DEMO ONLY. This key is public on purpose: it stands in for DigiLocker, whose API needs
 * government partner approval. Anyone can sign with it, so claims from it are always
 * labelled as demo. A real issuer would keep its key private.
 */
export const MOCK_DIGILOCKER_KEY: Hex =
  "0x9623d6c56ca5ff4806c53754eda07441675043868259847cf36b93914a88859d";

export const MOCK_DIGILOCKER: TrustedIssuer = {
  address: "0x48D49a2bF3766cC742CDeA811a6c40F2f40F9BaB",
  name: "Mock DigiLocker (demo issuer)",
  demo: true,
};

export const TRUSTED_ISSUERS: TrustedIssuer[] = [MOCK_DIGILOCKER];

/** What the mock issuer reads from a document. Stays on the holder's device. */
export interface DocumentDetails {
  dateOfBirth: string; // YYYY-MM-DD
  nationality: string; // ISO 3166 alpha-2, e.g. "IN"
  documentExpiry: string; // YYYY-MM-DD
}

export class ClaimRefusedError extends Error {}

function ageOn(dob: Date, on: Date): number {
  let age = on.getUTCFullYear() - dob.getUTCFullYear();
  const m = on.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && on.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

/**
 * The mock issuer: checks the document details and signs only claims that are true.
 * A minor can't get "18+"; an expired document gets nothing at all.
 */
export async function issueClaim(
  holder: Address,
  claim: ClaimId,
  doc: DocumentDetails,
  now = new Date(),
  issuerKey: Hex = MOCK_DIGILOCKER_KEY,
): Promise<SignedAttestation> {
  const expiry = new Date(`${doc.documentExpiry}T23:59:59Z`);
  const dob = new Date(`${doc.dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(expiry.getTime()) || Number.isNaN(dob.getTime())) {
    throw new ClaimRefusedError("Invalid date in the document.");
  }
  if (expiry <= now) throw new ClaimRefusedError("The document has expired, so no claim can be issued.");

  let value: string;
  if (claim === "age_over_18") {
    if (ageOn(dob, now) < 18) throw new ClaimRefusedError("The holder is under 18, so an 18+ claim can't be issued.");
    value = "true";
  } else if (claim === "nationality") {
    if (!/^[A-Z]{2}$/.test(doc.nationality)) throw new ClaimRefusedError("Unknown nationality code.");
    value = doc.nationality;
  } else {
    value = "true";
  }

  const attestation: Attestation = {
    holder,
    claim,
    value,
    issuedAt: BigInt(Math.floor(now.getTime() / 1000)),
    expiresAt: BigInt(Math.floor(expiry.getTime() / 1000)),
  };
  const account = privateKeyToAccount(issuerKey);
  const signature = await account.signTypedData({
    domain: EIP712_DOMAIN,
    types: EIP712_TYPES,
    primaryType: "Attestation",
    message: attestation,
  });
  return { attestation, signature, issuer: account.address };
}

export type VerifyResult =
  | { ok: true; issuer: TrustedIssuer }
  | { ok: false; reason: string };

/** Checks the signature, the issuer, the holder and the expiry. */
export async function verifyAttestation(
  signed: SignedAttestation,
  expectedHolder?: Address,
  now = new Date(),
  issuers: TrustedIssuer[] = TRUSTED_ISSUERS,
): Promise<VerifyResult> {
  let signer: Address;
  try {
    signer = await recoverTypedDataAddress({
      domain: EIP712_DOMAIN,
      types: EIP712_TYPES,
      primaryType: "Attestation",
      message: signed.attestation,
      signature: signed.signature,
    });
  } catch {
    return { ok: false, reason: "Signature is malformed." };
  }
  const issuer = issuers.find((i) => i.address.toLowerCase() === signer.toLowerCase());
  if (!issuer) return { ok: false, reason: "Signed by an unknown issuer." };
  if (expectedHolder && signed.attestation.holder.toLowerCase() !== expectedHolder.toLowerCase()) {
    return { ok: false, reason: "Issued to a different wallet." };
  }
  if (Number(signed.attestation.expiresAt) * 1000 <= now.getTime()) {
    return { ok: false, reason: "Expired." };
  }
  return { ok: true, issuer };
}

/** JSON can't hold bigint, so numbers are stored as strings. */
export function serializeAttestation(s: SignedAttestation): string {
  return JSON.stringify({
    ...s,
    attestation: {
      ...s.attestation,
      issuedAt: s.attestation.issuedAt.toString(),
      expiresAt: s.attestation.expiresAt.toString(),
    },
  });
}

export function parseAttestation(json: string): SignedAttestation {
  const raw = JSON.parse(json) as {
    attestation: Omit<Attestation, "issuedAt" | "expiresAt"> & { issuedAt: string; expiresAt: string };
    signature: Hex;
    issuer: Address;
  };
  return {
    ...raw,
    attestation: {
      ...raw.attestation,
      issuedAt: BigInt(raw.attestation.issuedAt),
      expiresAt: BigInt(raw.attestation.expiresAt),
    },
  };
}
