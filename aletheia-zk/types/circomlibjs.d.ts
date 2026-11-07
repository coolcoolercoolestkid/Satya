/**
 * Minimal ambient types for `circomlibjs@0.1.7`, which ships none.
 *
 * Only the surface Aletheia uses is declared: Poseidon (credential hashing and
 * nullifiers) and EdDSA-Poseidon (issuer signatures). `F` is the finite field wrapper;
 * its values are opaque internal representations, so anything crossing into application
 * code goes through `F.toObject` to become a `bigint`.
 */
declare module "circomlibjs" {
  export type FieldValue = unknown;

  export interface FiniteField {
    /** Internal representation to `bigint`. */
    toObject(value: FieldValue): bigint;
    /** `bigint` to internal representation. */
    e(value: bigint | number | string): FieldValue;
  }

  export interface Poseidon {
    (inputs: readonly (bigint | number | string)[]): FieldValue;
    F: FiniteField;
  }

  export function buildPoseidon(): Promise<Poseidon>;

  export interface EddsaSignature {
    R8: [FieldValue, FieldValue];
    S: bigint;
  }

  export interface Eddsa {
    prv2pub(privateKey: Uint8Array): [FieldValue, FieldValue];
    signPoseidon(privateKey: Uint8Array, message: FieldValue): EddsaSignature;
    verifyPoseidon(
      message: FieldValue,
      signature: EddsaSignature,
      publicKey: [FieldValue, FieldValue],
    ): boolean;
    babyJub: { F: FiniteField };
    F: FiniteField;
  }

  export function buildEddsa(): Promise<Eddsa>;
}
