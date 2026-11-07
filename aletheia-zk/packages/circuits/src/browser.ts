/**
 * Browser-safe surface of the circuits package.
 *
 * The pieces a holder flow needs to build a witness input, decode a proof's public
 * signals, and turn a proof into Solidity calldata — none of which touch the filesystem.
 * The Node barrel (`index.ts`) additionally exports the proving path (`prove.ts`,
 * `paths.ts`), which loads compiled artifacts off disk; the browser fetches those
 * artifacts itself and drives snarkjs directly, so it never imports that path.
 */

export {
  AGE_CLAIM,
  NATIONALITY_CLAIM,
  EXPIRY_CLAIM,
  ageClaimInput,
  assertAgeClaimRequest,
  assertNationalityClaimRequest,
  assertExpiryClaimRequest,
  nationalityClaimInput,
  expiryClaimInput,
  type AgeClaimRequest,
  type CircuitInput,
  type NationalityClaimRequest,
  type ExpiryClaimRequest,
} from "./inputs.ts";

export {
  AGE_PUBLIC_SIGNALS,
  CIRCUIT_SCHEMA_VERSION,
  decodeAgePublicSignals,
  type AgePublicSignals,
} from "./signals.ts";

export {
  NATIONALITY_PUBLIC_SIGNALS,
  decodeNationalityPublicSignals,
  type NationalityPublicSignals,
} from "./nationality-signals.ts";

export {
  EXPIRY_PUBLIC_SIGNALS,
  decodeExpiryPublicSignals,
  type ExpiryPublicSignals,
} from "./expiry-signals.ts";

export {
  toSolidityCalldata,
  type Groth16Proof,
  type ProofResult,
  type SolidityCalldata,
} from "./calldata.ts";
