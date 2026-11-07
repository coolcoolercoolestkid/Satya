import type { NormalizedCredential, SignedCredential } from "./credential.ts";

/**
 * The only seam between Aletheia and whatever attests to a credential.
 *
 * Phase 1 implements it with a mock issuer (`packages/issuer-mock`). A real credential
 * source implements the same signature, and nothing downstream — witness, circuit,
 * contract, subgraph — changes. See `docs/phase2-digilocker.md`.
 */
export type CredentialSigner = (
  credential: NormalizedCredential,
) => Promise<SignedCredential>;
