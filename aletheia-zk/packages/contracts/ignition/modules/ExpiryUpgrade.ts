import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * The stage-18 expiry upgrade.
 *
 * The contracts are not upgradeable, and the deployed `AletheiaVerifier` (the stage-17
 * redeploy) predates `submitExpiryClaim`, so expiry needs a **newly deployed**
 * `AletheiaVerifier` carrying all three entrypoints, plus the new `Groth16VerifierExpiry`.
 * Everything else is reused unchanged: the issuer registry (so the already-registered
 * `mock-dev` issuer keeps working), and both existing Groth16 verifiers (age and
 * nationality). This mirrors the Day 24 `NationalityUpgrade` one stage on — the existing
 * age and nationality records stay where they are; the subgraph indexes this new verifier
 * alongside the previous ones rather than orphaning them (Decision 2).
 *
 * The reused addresses come from the durable deployment manifest, never a literal, so this
 * module and the app cannot disagree about which registry the new verifier trusts.
 */
const manifestPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "deployments",
  "sepolia.json",
);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
  contracts: Record<string, { address: `0x${string}` }>;
};
const REGISTRY = manifest.contracts["AletheiaIssuerRegistry"]!.address;
const AGE_VERIFIER = manifest.contracts["Groth16VerifierAge"]!.address;
const NATIONALITY_VERIFIER = manifest.contracts["Groth16VerifierNationality"]!.address;

export default buildModule("ExpiryUpgrade", (m) => {
  // Account 0 of the configured network becomes the owner of the new verifier, exactly as
  // the previous deployments did.
  const owner = m.getAccount(0);

  // Reused, not redeployed. `contractAt` records the dependency without a transaction.
  const registry = m.contractAt("AletheiaIssuerRegistry", REGISTRY);
  const groth16VerifierAge = m.contractAt("Groth16VerifierAge", AGE_VERIFIER);
  const groth16VerifierNationality = m.contractAt(
    "Groth16VerifierNationality",
    NATIONALITY_VERIFIER,
  );

  // Newly deployed: the expiry verifier's key is baked in from its own proving key.
  const groth16VerifierExpiry = m.contract("Groth16VerifierExpiry");

  // Newly deployed AletheiaVerifier, constructed against the reused registry so the
  // already-registered mock-dev issuer resolves without re-registration.
  const verifier = m.contract("AletheiaVerifier", [owner, registry]);

  // All three claim types are wired on the fresh verifier: 1 age and 2 nationality (reused
  // Groth16 verifiers), 3 expiry (the new one). Without these every submission reverts
  // NoVerifierForClaim.
  m.call(verifier, "setClaimVerifier", [1, groth16VerifierAge], { id: "setAgeVerifier" });
  m.call(verifier, "setClaimVerifier", [2, groth16VerifierNationality], {
    id: "setNationalityVerifier",
  });
  m.call(verifier, "setClaimVerifier", [3, groth16VerifierExpiry], {
    id: "setExpiryVerifier",
  });

  return { verifier, groth16VerifierExpiry };
});
