import { CLAIM_LABELS, fetchProofRecords, verifyAttestation, type ClaimId } from "@satya/identity";
import type { Address } from "viem";
import { ARKIV_KEY } from "./wallet";

export interface CheckedProof {
  key: string;
  claim: ClaimId;
  label: string;
  ok: boolean;
  detail: string;
  expiresAt?: Date;
}

/** Loads a wallet's proof records from Arkiv and verifies every signature locally. */
export async function loadVerifiedProofs(holder: Address): Promise<CheckedProof[]> {
  const records = await fetchProofRecords(holder, ARKIV_KEY);
  const out: CheckedProof[] = [];
  for (const r of records) {
    if (!r.signed) continue;
    const a = r.signed.attestation;
    const v = await verifyAttestation(r.signed, holder);
    out.push({
      key: r.key,
      claim: a.claim,
      label: CLAIM_LABELS[a.claim]?.(a.value) ?? a.claim,
      ok: v.ok,
      detail: v.ok ? `${v.issuer.name}` : v.reason,
      expiresAt: new Date(Number(a.expiresAt) * 1000),
    });
  }
  return out;
}
