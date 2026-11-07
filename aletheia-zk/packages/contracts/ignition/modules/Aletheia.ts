import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * The Aletheia deployment.
 *
 * Ignition rather than a script because a deployment that fails halfway on a public
 * network needs to be resumable: it records what it sent, and re-running continues
 * instead of redeploying contracts that already exist.
 *
 * The issuer is deliberately not registered here. Registration needs the mock issuer's
 * public key, which lives in a gitignored local keystore, and a deployment module is
 * the wrong place for something that depends on an operator's local files. It is a
 * separate, explicit step — see scripts/register-issuer.ts.
 */
export default buildModule("Aletheia", (m) => {
  // Account 0 of the configured network: the deployer becomes the initial owner of the
  // registry and the verifier. Never a hardcoded address.
  const owner = m.getAccount(0);

  const issuerRegistry = m.contract("AletheiaIssuerRegistry", [owner]);

  // The snarkjs-generated verifiers, one per claim circuit. Each verification key is baked
  // in, so a verifier contract is only valid for the proving key it was exported from.
  const groth16VerifierAge = m.contract("Groth16VerifierAge");
  const groth16VerifierNationality = m.contract("Groth16VerifierNationality");

  const verifier = m.contract("AletheiaVerifier", [owner, issuerRegistry]);
  const profile = m.contract("AletheiaProfile");

  // Without these the verifier has no verifier for a claim type and every submission of it
  // reverts with NoVerifierForClaim, so they are part of the deployment, not an
  // afterthought. Claim type 1 is age, 2 is nationality.
  m.call(verifier, "setClaimVerifier", [1, groth16VerifierAge], { id: "setAgeVerifier" });
  m.call(verifier, "setClaimVerifier", [2, groth16VerifierNationality], {
    id: "setNationalityVerifier",
  });

  return { issuerRegistry, groth16VerifierAge, groth16VerifierNationality, verifier, profile };
});
