import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * The stage-17 nationality upgrade.
 *
 * The contracts are not upgradeable, and the deployed `AletheiaVerifier` predates
 * `submitNationalityClaim`, so nationality needs a **newly deployed** `AletheiaVerifier`
 * carrying both entrypoints, plus the new `Groth16VerifierNationality`. Everything else is
 * reused unchanged: the issuer registry (so the already-registered `mock-dev` issuer keeps
 * working), the profile contract, and the age Groth16 verifier — see the Part 4 note in
 * TODO.md. The existing age records stay where they are; the subgraph indexes this new
 * verifier alongside them rather than orphaning them (Decision 2).
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

export default buildModule("NationalityUpgrade", (m) => {
  // Account 0 of the configured network becomes the owner of the new verifier, exactly as
  // the original deployment did.
  const owner = m.getAccount(0);

  // Reused, not redeployed. `contractAt` records the dependency without a transaction.
  const registry = m.contractAt("AletheiaIssuerRegistry", REGISTRY);
  const groth16VerifierAge = m.contractAt("Groth16VerifierAge", AGE_VERIFIER);

  // Newly deployed: the nationality verifier's key is baked in from its own proving key.
  const groth16VerifierNationality = m.contract("Groth16VerifierNationality");

  // Newly deployed AletheiaVerifier, constructed against the reused registry so the
  // already-registered mock-dev issuer resolves without re-registration.
  const verifier = m.contract("AletheiaVerifier", [owner, registry]);

  // Both claim types are wired on the fresh verifier: 1 age (reused Groth16 verifier),
  // 2 nationality (the new one). Without these every submission reverts NoVerifierForClaim.
  m.call(verifier, "setClaimVerifier", [1, groth16VerifierAge], { id: "setAgeVerifier" });
  m.call(verifier, "setClaimVerifier", [2, groth16VerifierNationality], {
    id: "setNationalityVerifier",
  });

  return { verifier, groth16VerifierNationality };
});
