/**
 * Field-element helpers for the bn128 scalar field used by circom, Groth16 and the
 * Solidity verifiers.
 *
 * Every value that enters a Poseidon hash or a circuit signal must be a canonical
 * element of this field. Values are `bigint` in memory and decimal strings on the wire.
 */

/** bn128 scalar field modulus (`r`), the field circom compiles to by default. */
export const FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * A 31-byte value is always below the modulus, so 31 bytes is the safe size for
 * randomly generated field elements and for hashes reduced into the field.
 */
export const SAFE_FIELD_BYTES = 31;

export function isFieldElement(value: bigint): boolean {
  return value >= 0n && value < FIELD_MODULUS;
}

export function assertFieldElement(value: bigint, label: string): void {
  if (!isFieldElement(value)) {
    throw new RangeError(`${label} is not a canonical bn128 field element: ${value}`);
  }
}

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export function isAddress(value: string): boolean {
  return ADDRESS_PATTERN.test(value);
}

/**
 * An Ethereum address as a field element. Addresses are 160 bits, so they always fit.
 * Case is irrelevant here; EIP-55 checksum validation belongs in the wallet layer.
 */
export function addressToField(address: string): bigint {
  if (!isAddress(address)) {
    throw new TypeError(`not a 20-byte hex address: ${address}`);
  }
  return BigInt(address);
}

/** Inverse of {@link addressToField}, lowercase and zero-padded. */
export function fieldToAddress(value: bigint): string {
  if (value < 0n || value >= 1n << 160n) {
    throw new RangeError(`field element does not fit in an address: ${value}`);
  }
  return `0x${value.toString(16).padStart(40, "0")}`;
}

/** A field element as a left-padded 32-byte hex string, the form contracts log. */
export function fieldToBytes32(value: bigint): string {
  assertFieldElement(value, "value");
  return `0x${value.toString(16).padStart(64, "0")}`;
}

/**
 * Reduce a 32-byte hash into the field by keeping its leading 31 bytes.
 *
 * Used for the verifier-supplied `contextId`: a keccak256 digest can exceed the
 * modulus, and taking the top 248 bits is deterministic, collision-resistant enough for
 * a scoping tag, and trivial to reproduce on any platform. Truncation must happen the
 * same way everywhere, so this is the only sanctioned reduction.
 */
export function hashToField(hash32: string): bigint {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash32)) {
    throw new TypeError(`not a 32-byte hex hash: ${hash32}`);
  }
  return BigInt(hash32) >> 8n;
}

/**
 * A uniformly random 31-byte field element, used for credential ids.
 *
 * Uses the Web Crypto API, which is present in Node 22 and in browsers, so the same
 * code path serves the issuer and the client.
 */
export function randomFieldElement(): bigint {
  const bytes = new Uint8Array(SAFE_FIELD_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}
