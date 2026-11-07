export {
  SCHEMA_VERSION,
  MAX_SCHEMA_VERSION,
  CLAIM_TYPE,
  MIN_DATE_YYYYMMDD,
  MAX_DATE_YYYYMMDD,
  type ClaimTypeName,
  type ClaimTypeId,
} from "./constants.ts";

export {
  FIELD_MODULUS,
  SAFE_FIELD_BYTES,
  addressToField,
  assertFieldElement,
  fieldToAddress,
  fieldToBytes32,
  hashToField,
  isAddress,
  isFieldElement,
  randomFieldElement,
} from "./field.ts";

export {
  MAX_DOCUMENT_HOLDER_AGE,
  MAX_MINIMUM_AGE,
  ageThresholdYyyymmdd,
  assertValidYyyymmdd,
  completedYears,
  dateToYyyymmdd,
  daysInMonth,
  expandExpiryYymmdd,
  inferBirthYymmdd,
  isLeapYear,
  isUnexpired,
  isValidYyyymmdd,
  parseYyyymmdd,
  satisfiesMinimumAge,
  splitYyyymmdd,
  todayUtcYyyymmdd,
  toYyyymmdd,
  yyyymmddToDate,
  type BirthCenturyInference,
  type CalendarDate,
} from "./date.ts";

export {
  alpha3ToCountryCode,
  isSupportedAlpha3,
} from "./nationality.ts";

export {
  MAX_COUNTRY_CODE,
  MIN_COUNTRY_CODE,
  assertNormalizedCredential,
  credentialSupportsDate,
  isCountryCode,
  isNormalizedCredential,
  parseSignedCredential,
  serializeSignedCredential,
  type CredentialSignature,
  type IssuerPublicKey,
  type NormalizedCredential,
  type SignedCredential,
  type SignedCredentialJson,
} from "./credential.ts";

export {
  claimNullifier,
  credentialMessageHash,
  identityNullifier,
  poseidonHash,
  type IdentityNullifierInput,
  type NullifierInput,
} from "./hash.ts";

export type { CredentialSigner } from "./issuer.ts";

// Test support (`loadCredentialFixture`) is deliberately NOT re-exported here: it reads a
// fixture file with `node:fs`, which would drag the filesystem into any browser bundle
// that imports this barrel. It lives at the `@aletheia/credential/test-fixture` subpath,
// so tests import it explicitly and the runtime surface stays browser-safe.
