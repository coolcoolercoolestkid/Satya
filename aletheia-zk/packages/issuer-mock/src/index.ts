export {
  MOCK_ISSUER_LABEL,
  PRIVATE_KEY_BYTES,
  generateKeypair,
  parseKeystore,
  publicKeyFor,
  serializeKeystore,
  type IssuerKeypair,
  type KeystoreFile,
} from "./keys.ts";

export { defaultKeystorePath, readKeystore, writeKeystore } from "./keystore-node.ts";

export {
  deriveIdentitySecret,
  randomIdentitySalt,
  type IdentitySecretInput,
} from "./identity.ts";

export {
  createMockIssuer,
  isSignedBy,
  signCredential,
  verifySignedCredential,
} from "./sign.ts";
