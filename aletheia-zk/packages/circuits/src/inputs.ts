/**
 * Witness input builders.
 *
 * These are the only place raw circuit inputs are assembled, so the client, the tests
 * and the end-to-end script all send the circuit the same shape. The public-signal
 * order that comes out of it is frozen in docs/public-signals.md.
 */

import {
  CLAIM_TYPE,
  MAX_COUNTRY_CODE,
  MAX_MINIMUM_AGE,
  MIN_COUNTRY_CODE,
  assertNormalizedCredential,
  assertValidYyyymmdd,
  isCountryCode,
  isFieldElement,
  type SignedCredential,
} from "@aletheia/credential";

export type CircuitInput = Record<string, string | number | bigint>;

export interface AgeClaimRequest {
  /** What the verifier asked: "at least this many years old". */
  minimumAge: number;
  /** The date the claim is evaluated against, YYYYMMDD UTC. */
  currentDate: number;
  /** The verifier's scope tag, already reduced into the field. */
  contextId: bigint;
}

/** Reject a request the circuit would reject anyway, with a readable message. */
export function assertAgeClaimRequest(request: AgeClaimRequest): void {
  if (
    !Number.isInteger(request.minimumAge) ||
    request.minimumAge < 0 ||
    request.minimumAge > MAX_MINIMUM_AGE
  ) {
    throw new RangeError(
      `minimumAge must be an integer in 0..${MAX_MINIMUM_AGE}, got ${request.minimumAge}`,
    );
  }
  assertValidYyyymmdd(request.currentDate, "currentDate");
  if (!isFieldElement(request.contextId)) {
    throw new RangeError("contextId must be a bn128 field element");
  }
}

/**
 * Build the witness input for `age.circom`.
 *
 * Private inputs are the credential and the issuer's signature over it. Public inputs
 * are the issuer key, the date, the threshold the verifier chose, the context tag and
 * the holder's address.
 */
export function ageClaimInput(
  signed: SignedCredential,
  request: AgeClaimRequest,
): CircuitInput {
  assertNormalizedCredential(signed.credential);
  assertAgeClaimRequest(request);
  return {
    // private: the credential
    credentialId: signed.credential.credentialId,
    dateOfBirth: signed.credential.dateOfBirth,
    nationality: signed.credential.nationality,
    expiryDate: signed.credential.expiryDate,
    issuedAt: signed.credential.issuedAt,
    identitySecret: signed.credential.identitySecret,
    // private: the issuer signature
    sigR8x: signed.signature.r8x,
    sigR8y: signed.signature.r8y,
    sigS: signed.signature.s,
    // public. schemaVersion comes from the credential rather than the request: the
    // circuit pins it to the version it was compiled for, so a mismatch is an
    // unsatisfiable witness rather than a silently wrong proof.
    schemaVersion: signed.credential.schemaVersion,
    issuerAx: signed.issuer.ax,
    issuerAy: signed.issuer.ay,
    currentDate: request.currentDate,
    minimumAge: request.minimumAge,
    contextId: request.contextId,
    subject: BigInt(signed.credential.subject),
  };
}

/** Circuit name and claim type id, kept together so they cannot drift apart. */
export const AGE_CLAIM = { circuit: "age", claimTypeId: CLAIM_TYPE.AGE } as const;

export interface NationalityClaimRequest {
  /** What the verifier asked: "holds this nationality" (ISO 3166-1 numeric). */
  requiredNationality: number;
  /** The date the claim is evaluated against, YYYYMMDD UTC. */
  currentDate: number;
  /** The verifier's scope tag, already reduced into the field. */
  contextId: bigint;
}

/** Reject a request the circuit would reject anyway, with a readable message. */
export function assertNationalityClaimRequest(request: NationalityClaimRequest): void {
  if (!isCountryCode(request.requiredNationality)) {
    throw new RangeError(
      `requiredNationality must be an ISO 3166-1 numeric code in ` +
        `${MIN_COUNTRY_CODE}..${MAX_COUNTRY_CODE}, got ${request.requiredNationality}`,
    );
  }
  assertValidYyyymmdd(request.currentDate, "currentDate");
  if (!isFieldElement(request.contextId)) {
    throw new RangeError("contextId must be a bn128 field element");
  }
}

/**
 * Build the witness input for `nationality.circom`.
 *
 * Identical in shape to {@link ageClaimInput}; only the generic parameter slot differs —
 * `requiredNationality` instead of `minimumAge`. A successful proof discloses that the
 * credential's nationality equals `requiredNationality`; nothing else in the credential is
 * revealed.
 */
export function nationalityClaimInput(
  signed: SignedCredential,
  request: NationalityClaimRequest,
): CircuitInput {
  assertNormalizedCredential(signed.credential);
  assertNationalityClaimRequest(request);
  return {
    // private: the credential
    credentialId: signed.credential.credentialId,
    dateOfBirth: signed.credential.dateOfBirth,
    nationality: signed.credential.nationality,
    expiryDate: signed.credential.expiryDate,
    issuedAt: signed.credential.issuedAt,
    identitySecret: signed.credential.identitySecret,
    // private: the issuer signature
    sigR8x: signed.signature.r8x,
    sigR8y: signed.signature.r8y,
    sigS: signed.signature.s,
    // public
    schemaVersion: signed.credential.schemaVersion,
    issuerAx: signed.issuer.ax,
    issuerAy: signed.issuer.ay,
    currentDate: request.currentDate,
    requiredNationality: request.requiredNationality,
    contextId: request.contextId,
    subject: BigInt(signed.credential.subject),
  };
}

export const NATIONALITY_CLAIM = {
  circuit: "nationality",
  claimTypeId: CLAIM_TYPE.NATIONALITY,
} as const;

export interface ExpiryClaimRequest {
  /** The date the claim is evaluated against, YYYYMMDD UTC. */
  currentDate: number;
  /** The verifier's scope tag, already reduced into the field. */
  contextId: bigint;
}

/** Reject a request the circuit would reject anyway, with a readable message. */
export function assertExpiryClaimRequest(request: ExpiryClaimRequest): void {
  assertValidYyyymmdd(request.currentDate, "currentDate");
  if (!isFieldElement(request.contextId)) {
    throw new RangeError("contextId must be a bn128 field element");
  }
}

/**
 * Build the witness input for `expiry.circom`.
 *
 * Identical in shape to {@link ageClaimInput} and {@link nationalityClaimInput}, with one
 * difference: the generic parameter slot has no meaning for an expiry claim, so it is pinned
 * to zero — `expiryParameter: 0`. The circuit enforces that pin (`expiryParameter === 0`), so
 * any other value is an unsatisfiable witness. A successful proof discloses only that the
 * credential was unexpired on `currentDate`; the expiry date itself, and every other field,
 * stay in the witness.
 */
export function expiryClaimInput(
  signed: SignedCredential,
  request: ExpiryClaimRequest,
): CircuitInput {
  assertNormalizedCredential(signed.credential);
  assertExpiryClaimRequest(request);
  return {
    // private: the credential
    credentialId: signed.credential.credentialId,
    dateOfBirth: signed.credential.dateOfBirth,
    nationality: signed.credential.nationality,
    expiryDate: signed.credential.expiryDate,
    issuedAt: signed.credential.issuedAt,
    identitySecret: signed.credential.identitySecret,
    // private: the issuer signature
    sigR8x: signed.signature.r8x,
    sigR8y: signed.signature.r8y,
    sigS: signed.signature.s,
    // public. The parameter slot is pinned to zero by the circuit; sending anything else
    // produces an unsatisfiable witness rather than a silently different proof.
    schemaVersion: signed.credential.schemaVersion,
    issuerAx: signed.issuer.ax,
    issuerAy: signed.issuer.ay,
    currentDate: request.currentDate,
    expiryParameter: 0,
    contextId: request.contextId,
    subject: BigInt(signed.credential.subject),
  };
}

export const EXPIRY_CLAIM = {
  circuit: "expiry",
  claimTypeId: CLAIM_TYPE.EXPIRY,
} as const;
