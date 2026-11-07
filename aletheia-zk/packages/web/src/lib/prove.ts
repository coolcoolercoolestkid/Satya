/**
 * Browser Groth16 proving for the age, nationality and expiry claims.
 *
 * The witness input is assembled by the shared claim-input builders (so the browser sends
 * the circuit exactly what the Node path does), then snarkjs produces and verifies a real
 * proof against the artifacts served from the app origin — the wasm witness generator and
 * the final zkey under `/circuits`. Only public data crosses into these files; the
 * credential's private fields stay in memory and never leave the device.
 *
 * The proof is verified here before it is returned, the same habit the Node prover keeps:
 * a proof that was never checked is how "verified" comes to mean nothing.
 */

import {
  ageClaimInput,
  decodeAgePublicSignals,
  decodeExpiryPublicSignals,
  decodeNationalityPublicSignals,
  expiryClaimInput,
  nationalityClaimInput,
  toSolidityCalldata,
  type AgeClaimRequest,
  type AgePublicSignals,
  type ExpiryClaimRequest,
  type ExpiryPublicSignals,
  type Groth16Proof,
  type NationalityClaimRequest,
  type NationalityPublicSignals,
  type SolidityCalldata,
} from "@aletheia/circuits/browser";
import { SCHEMA_VERSION, type SignedCredential } from "@aletheia/credential";
import * as snarkjs from "snarkjs";

const AGE_WASM_URL = "/circuits/age.wasm";
const AGE_ZKEY_URL = "/circuits/age_final.zkey";
const AGE_VKEY_URL = "/circuits/age_vkey.json";

const NATIONALITY_WASM_URL = "/circuits/nationality.wasm";
const NATIONALITY_ZKEY_URL = "/circuits/nationality_final.zkey";
const NATIONALITY_VKEY_URL = "/circuits/nationality_vkey.json";

const EXPIRY_WASM_URL = "/circuits/expiry.wasm";
const EXPIRY_ZKEY_URL = "/circuits/expiry_final.zkey";
const EXPIRY_VKEY_URL = "/circuits/expiry_vkey.json";

export interface BrowserProof<Decoded> {
  proof: Groth16Proof;
  publicSignals: string[];
  decoded: Decoded;
  calldata: SolidityCalldata;
}

const vkeyCache = new Map<string, unknown>();

async function verificationKey(url: string): Promise<unknown> {
  const cached = vkeyCache.get(url);
  if (cached !== undefined) return cached;
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) throw new Error(`could not load the verification key (${response.status})`);
  const vkey = await response.json();
  vkeyCache.set(url, vkey);
  return vkey;
}

/**
 * Prove an age claim entirely in the browser. Produces a real proof, verifies it locally
 * against the verification key, checks the public signals say what was asked, and returns
 * the proof plus the Solidity calldata the verifier contract consumes.
 */
export async function proveAgeInBrowser(
  signed: SignedCredential,
  request: AgeClaimRequest,
): Promise<BrowserProof<AgePublicSignals>> {
  const input = ageClaimInput(signed, request);

  const { proof, publicSignals } = (await snarkjs.groth16.fullProve(
    input,
    AGE_WASM_URL,
    AGE_ZKEY_URL,
  )) as { proof: Groth16Proof; publicSignals: string[] };

  if (!(await snarkjs.groth16.verify(await verificationKey(AGE_VKEY_URL), publicSignals, proof))) {
    throw new Error("produced a proof that does not verify locally; refusing to return it");
  }

  const decoded = decodeAgePublicSignals(publicSignals);
  if (decoded.minimumAge !== request.minimumAge || decoded.currentDate !== request.currentDate) {
    throw new Error("public signals do not match the requested claim");
  }
  if (decoded.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `proof declares schemaVersion ${decoded.schemaVersion}, expected ${SCHEMA_VERSION}`,
    );
  }

  const calldata = await toSolidityCalldata(proof, publicSignals);
  return { proof, publicSignals, decoded, calldata };
}

/**
 * Prove an expiry claim entirely in the browser, mirroring the age path but with the
 * expiry circuit's artifacts. The claim reveals only that the credential was unexpired as
 * of `currentDate`; the expiry date itself, like every other field, stays on the device.
 */
export async function proveExpiryInBrowser(
  signed: SignedCredential,
  request: ExpiryClaimRequest,
): Promise<BrowserProof<ExpiryPublicSignals>> {
  const input = expiryClaimInput(signed, request);

  const { proof, publicSignals } = (await snarkjs.groth16.fullProve(
    input,
    EXPIRY_WASM_URL,
    EXPIRY_ZKEY_URL,
  )) as { proof: Groth16Proof; publicSignals: string[] };

  if (!(await snarkjs.groth16.verify(await verificationKey(EXPIRY_VKEY_URL), publicSignals, proof))) {
    throw new Error("produced a proof that does not verify locally; refusing to return it");
  }

  const decoded = decodeExpiryPublicSignals(publicSignals);
  if (decoded.currentDate !== request.currentDate) {
    throw new Error("public signals do not match the requested claim");
  }
  if (decoded.expiryParameter !== 0) {
    throw new Error(`proof carries a non-zero expiryParameter (${decoded.expiryParameter})`);
  }
  if (decoded.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `proof declares schemaVersion ${decoded.schemaVersion}, expected ${SCHEMA_VERSION}`,
    );
  }

  const calldata = await toSolidityCalldata(proof, publicSignals);
  return { proof, publicSignals, decoded, calldata };
}

/**
 * Prove a nationality claim entirely in the browser, mirroring the age path but with the
 * nationality circuit's artifacts. A successful proof discloses the nationality asked
 * about — the caller shows the holder that before this runs.
 */
export async function proveNationalityInBrowser(
  signed: SignedCredential,
  request: NationalityClaimRequest,
): Promise<BrowserProof<NationalityPublicSignals>> {
  const input = nationalityClaimInput(signed, request);

  const { proof, publicSignals } = (await snarkjs.groth16.fullProve(
    input,
    NATIONALITY_WASM_URL,
    NATIONALITY_ZKEY_URL,
  )) as { proof: Groth16Proof; publicSignals: string[] };

  if (
    !(await snarkjs.groth16.verify(await verificationKey(NATIONALITY_VKEY_URL), publicSignals, proof))
  ) {
    throw new Error("produced a proof that does not verify locally; refusing to return it");
  }

  const decoded = decodeNationalityPublicSignals(publicSignals);
  if (
    decoded.requiredNationality !== request.requiredNationality ||
    decoded.currentDate !== request.currentDate
  ) {
    throw new Error("public signals do not match the requested claim");
  }
  if (decoded.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `proof declares schemaVersion ${decoded.schemaVersion}, expected ${SCHEMA_VERSION}`,
    );
  }

  const calldata = await toSolidityCalldata(proof, publicSignals);
  return { proof, publicSignals, decoded, calldata };
}
