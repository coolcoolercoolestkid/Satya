/**
 * Credential signing and signature verification with EdDSA-Poseidon on BabyJubjub.
 *
 * DEVELOPMENT ONLY on the signing side: this issuer verifies no identity and signs
 * whatever it is given. The verification side is real, and the same check runs inside
 * the circuits.
 */

import {
  assertNormalizedCredential,
  credentialMessageHash,
  type CredentialSigner,
  type IssuerPublicKey,
  type NormalizedCredential,
  type SignedCredential,
} from "@aletheia/credential";
import { eddsa } from "./eddsa.ts";

/**
 * Sign a normalized credential.
 *
 * The credential is validated first, and the resulting signature is verified before it
 * is returned: an issuer that emits a signature nobody can verify is worse than one that
 * fails loudly.
 */
export async function signCredential(
  privateKey: Uint8Array,
  credential: NormalizedCredential,
): Promise<SignedCredential> {
  assertNormalizedCredential(credential);
  const instance = await eddsa();
  const messageHash = await credentialMessageHash(credential);
  const signature = instance.signPoseidon(privateKey, instance.F.e(messageHash));
  const point = instance.prv2pub(privateKey);

  const signed: SignedCredential = {
    credential,
    issuer: {
      ax: instance.F.toObject(point[0]),
      ay: instance.F.toObject(point[1]),
    },
    signature: {
      r8x: instance.F.toObject(signature.R8[0]),
      r8y: instance.F.toObject(signature.R8[1]),
      s: signature.S,
    },
  };

  if (!(await verifySignedCredential(signed))) {
    throw new Error("produced a signature that does not verify; refusing to return it");
  }
  return signed;
}

/**
 * Verify an issuer signature over a credential.
 *
 * This is the off-circuit twin of the `EdDSAPoseidonVerifier` constraint in
 * `packages/circuits`. It exists so clients can reject a bad credential before spending
 * time on a witness, not as a substitute for the in-circuit check.
 */
export async function verifySignedCredential(signed: SignedCredential): Promise<boolean> {
  const instance = await eddsa();
  let messageHash: bigint;
  try {
    messageHash = await credentialMessageHash(signed.credential);
  } catch {
    return false; // a malformed credential has no valid signature by definition
  }
  return instance.verifyPoseidon(
    instance.F.e(messageHash),
    {
      R8: [instance.F.e(signed.signature.r8x), instance.F.e(signed.signature.r8y)],
      S: signed.signature.s,
    },
    [instance.F.e(signed.issuer.ax), instance.F.e(signed.issuer.ay)],
  );
}

/** Bind a private key into the {@link CredentialSigner} seam a real issuer also fills. */
export function createMockIssuer(privateKey: Uint8Array): CredentialSigner {
  return (credential) => signCredential(privateKey, credential);
}

/** Whether a signature was produced by this specific issuer key. */
export function isSignedBy(signed: SignedCredential, publicKey: IssuerPublicKey): boolean {
  return signed.issuer.ax === publicKey.ax && signed.issuer.ay === publicKey.ay;
}
