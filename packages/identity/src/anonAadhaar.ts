// The package's TypeScript sources don't pass strict checks, so we use its compiled build
// and describe the few functions Satya calls.
// @ts-expect-error -- the compiled build ships without type declarations
import * as aaBuild from "@anon-aadhaar/core/dist/index.js";
import type { Address } from "viem";
import { ANON_AADHAAR_TEST_CERTIFICATE } from "./anonAadhaarTestCert.js";

interface AnonAadhaarProofFields {
  pubkeyHash: string;
  nullifier: string;
  timestamp: string;
  ageAbove18: string;
  gender: string;
  pincode: string;
  state: string;
  nullifierSeed: string;
  signalHash: string;
}
interface AnonAadhaarPcd {
  type: string;
  id: string;
  claim: unknown;
  proof: AnonAadhaarProofFields;
}
type FieldKey = "revealAgeAbove18" | "revealGender" | "revealState" | "revealPinCode";
interface Core {
  artifactUrls: { v2: { wasm: string; zkey: string; vk: string; chunked: string } };
  ArtifactsOrigin: { server: number; local: number; chunked: number };
  init(args: { wasmURL: string; zkeyURL: string; vkeyURL: string; artifactsOrigin: number }): Promise<void>;
  generateArgs(args: {
    qrData: string;
    certificateFile: string;
    nullifierSeed: bigint | number;
    fieldsToRevealArray?: FieldKey[];
    signal?: string;
  }): Promise<unknown>;
  prove(args: unknown, updateState?: (s: unknown) => void): Promise<AnonAadhaarPcd>;
  verify(pcd: AnonAadhaarPcd, useTestAadhaar?: boolean): Promise<boolean>;
  serialize(pcd: AnonAadhaarPcd): Promise<{ type: string; pcd: string }>;
  deserialize(serialized: string): Promise<AnonAadhaarPcd>;
  hash(message: string | bigint | number): string;
  productionPublicKeyHash: string;
  testPublicKeyHash: string;
  convertBigIntToByteArray(n: bigint): Uint8Array;
  decompressByteArray(bytes: Uint8Array): Uint8Array;
  timestampToUTCUnix(raw: Uint8Array): number;
}
const core = ((aaBuild as { default?: Core }).default ?? aaBuild) as Core;

/**
 * Anon Aadhaar (by the Ethereum Foundation's PSE team) proves facts from the UIDAI-signed QR
 * on an Aadhaar card with a zero-knowledge proof, such as "over 18" or "lives in Maharashtra",
 * without revealing the Aadhaar number, name or date of birth.
 *
 * Satya binds each proof to the holder's wallet by using the wallet address as the proof's
 * signal, so a proof copied to another wallet fails verification.
 */

/**
 * Satya only accepts Aadhaar QR codes signed in the last 3 days. Getting a fresh QR from the
 * mAadhaar app or the myAadhaar portal needs an OTP sent to the card owner's registered phone,
 * so an old photo or printout of someone else's card isn't enough.
 */
export const MAX_QR_AGE_DAYS = 3;
const DAY_MS = 86_400_000;

/** When UIDAI (or the test key) signed an Aadhaar QR, read from the QR itself. Hour precision. */
export function qrSignedAt(qrData: string): Date {
  const raw = core.decompressByteArray(core.convertBigIntToByteArray(BigInt(qrData)));
  return new Date(core.timestampToUTCUnix(raw) * 1000);
}

/** Why a QR signed at `signedAt` is too old, or undefined if it's fresh enough. */
export function qrTooOld(signedAt: Date, now = new Date(), maxDays = MAX_QR_AGE_DAYS): string | undefined {
  const age = now.getTime() - signedAt.getTime();
  if (age <= maxDays * DAY_MS) return undefined;
  const days = Math.floor(age / DAY_MS);
  return `This Aadhaar QR was signed ${days} days ago (${signedAt.toISOString().slice(0, 10)}). Satya only accepts QR codes from the last ${maxDays} days. Download a fresh one from the mAadhaar app or myAadhaar portal; that needs an OTP sent to the card owner's phone.`;
}

/** Satya's app-wide nullifier seed. The nullifier stops one Aadhaar card proving for many wallets. */
export const SATYA_NULLIFIER_SEED = 236470799660911371785784n;

/** A stand-in address for the Arkiv `issuer` column, meaning "UIDAI via Anon Aadhaar". */
export const ANON_AADHAAR_ISSUER: Address = "0x000000000000000000000000000000000000aada";

let initialised = false;
/**
 * Browsers download the proving key in chunks (cached locally); Node can fetch it whole, or use
 * files already on disk (`local`, with paths to the three artifacts).
 */
export async function initAnonAadhaar(
  origin: "chunked" | "server" | "local" = "chunked",
  localPaths?: { wasm: string; zkey: string; vkey: string },
): Promise<void> {
  if (initialised) return;
  const urls = core.artifactUrls.v2;
  await core.init({
    wasmURL: localPaths?.wasm ?? urls.wasm,
    zkeyURL: localPaths?.zkey ?? (origin === "chunked" ? urls.chunked : urls.zkey),
    vkeyURL: localPaths?.vkey ?? urls.vk,
    artifactsOrigin: core.ArtifactsOrigin[origin],
  });
  initialised = true;
}

/**
 * Makes a proof from Anon Aadhaar TEST QR data (UIDAI's sample data re-signed with Anon
 * Aadhaar's public test key). Runs fully in the browser; the QR data never leaves the device.
 * Real Aadhaar QRs use the same circuit with UIDAI's certificate instead.
 */
export async function proveAnonAadhaarTest(
  qrData: string,
  holder: Address,
  onProgress?: (state: unknown) => void,
): Promise<string> {
  await initAnonAadhaar();
  const args = await core.generateArgs({
    qrData,
    certificateFile: ANON_AADHAAR_TEST_CERTIFICATE,
    nullifierSeed: SATYA_NULLIFIER_SEED,
    fieldsToRevealArray: ["revealAgeAbove18", "revealState"],
    signal: holder,
  });
  const pcd = await core.prove(args, onProgress);
  return (await core.serialize(pcd)).pcd;
}

export type AnonAadhaarCheck =
  | {
      ok: true;
      /** True when the proof was made from Anon Aadhaar's test data, not a real Aadhaar card. */
      test: boolean;
      ageAbove18: boolean;
      state?: string;
      nullifier: string;
      signedAt: Date;
    }
  | { ok: false; reason: string };

function decodeReveal(value: string | undefined): string | undefined {
  if (!value || value === "0") return undefined;
  let n = BigInt(value);
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.push(Number(n & 0xffn)); // revealed text is packed least significant byte first
    n >>= 8n;
  }
  return new TextDecoder().decode(new Uint8Array(bytes)).trim() || undefined;
}

/** Verifies a serialized Anon Aadhaar proof and checks it belongs to `holder`. */
export async function verifyAnonAadhaar(
  serialized: string,
  holder: Address,
  opts: { maxQrAgeDays?: number; now?: Date } = {},
): Promise<AnonAadhaarCheck> {
  let pcd: AnonAadhaarPcd;
  try {
    pcd = await core.deserialize(serialized);
  } catch {
    return { ok: false, reason: "Proof is unreadable." };
  }
  const p = pcd.proof;
  const test = p.pubkeyHash === core.testPublicKeyHash;
  if (!test && p.pubkeyHash !== core.productionPublicKeyHash) {
    return { ok: false, reason: "Not signed by UIDAI or the Anon Aadhaar test key." };
  }
  if (BigInt(p.nullifierSeed) !== SATYA_NULLIFIER_SEED) {
    return { ok: false, reason: "Proof was made for a different app." };
  }
  if (String(p.signalHash) !== core.hash(holder)) {
    return { ok: false, reason: "Proof was made for a different wallet." };
  }
  if (opts.maxQrAgeDays !== undefined) {
    const old = qrTooOld(new Date(Number(p.timestamp) * 1000), opts.now, opts.maxQrAgeDays);
    if (old) return { ok: false, reason: old };
  }
  try {
    await initAnonAadhaar();
    if (!(await core.verify(pcd, test))) return { ok: false, reason: "Zero-knowledge proof is invalid." };
  } catch (e) {
    return { ok: false, reason: `Couldn't verify the proof: ${e instanceof Error ? e.message : String(e)}` };
  }
  return {
    ok: true,
    test,
    ageAbove18: String(p.ageAbove18) === "1",
    state: decodeReveal(String(p.state)),
    nullifier: String(p.nullifier),
    signedAt: new Date(Number(p.timestamp) * 1000),
  };
}

/** The nullifier inside a serialized proof (same card + Satya's seed = same nullifier). */
export async function anonAadhaarNullifier(serialized: string): Promise<string> {
  return String((await core.deserialize(serialized)).proof.nullifier);
}
