import { CLAIM_LABELS, fetchProofRecords, verifyAnonAadhaar, verifyAttestation, type ClaimId } from "@satya/identity";
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

/** Loads a wallet's proof records from Arkiv and verifies every one locally. */
export async function loadVerifiedProofs(holder: Address): Promise<CheckedProof[]> {
  const records = await fetchProofRecords(holder, ARKIV_KEY);
  const out: CheckedProof[] = [];
  for (const r of records) {
    if (r.anonAadhaar) {
      const v = await verifyAnonAadhaar(r.anonAadhaar, holder);
      out.push({
        key: r.key,
        claim: "age_over_18",
        label: v.ok
          ? `${v.ageAbove18 ? "18+" : "Not 18+"} Aadhaar holder${v.state ? ` · ${v.state}` : ""}`
          : "Aadhaar proof",
        ok: v.ok && v.ageAbove18,
        detail: v.ok
          ? `Anon Aadhaar zero-knowledge proof${v.test ? " (TEST data, not a real card)" : ""}`
          : v.reason,
      });
      continue;
    }
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
