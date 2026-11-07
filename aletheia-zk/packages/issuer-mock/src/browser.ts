/**
 * Browser-safe surface of the mock issuer.
 *
 * Everything the Phase 1 holder flow needs to sign a credential on the holder's own
 * device — key parsing, public-key derivation, identity-secret derivation and signing —
 * without dragging in `node:fs`. The Node barrel (`index.ts`) additionally exports the
 * keystore file I/O, which the browser never uses.
 *
 * DEVELOPMENT ONLY, unchanged from the Node side: this issuer verifies no identity.
 */

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
