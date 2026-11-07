/**
 * Browser-safe surface of the query package.
 *
 * Everything the verifier flow needs to read the subgraph and classify a record, with no
 * filesystem access anywhere in the import graph. The Node barrel (`index.ts`) additionally
 * exports the root-`.env` loader and wraps `createQueryClient` to call it; a browser caller
 * passes the endpoint explicitly (`createQueryClient({ endpoint })`), so it never needs it.
 *
 * The raw `createQueryClient` re-exported here is the same factory `client.ts` defines: it
 * reads `GRAPH_QUERY_URL` from `process.env` only when no endpoint is given, and touches no
 * file. `assertQueryEndpoint` is exported so the app can validate its configured endpoint
 * before constructing a client; `resolveEndpoint` and `loadRootEnv` are deliberately absent
 * because a browser has no repository-root `.env` to read.
 */

export {
  createQueryClient,
  type PageOptions,
  type QueryClient,
  type QueryClientOptions,
} from "./client.ts";

export { assertQueryEndpoint } from "./endpoint.ts";

export {
  EndpointNotConfiguredError,
  GraphQueryError,
  GraphTransportError,
  MalformedResponseError,
} from "./errors.ts";

export type {
  Hex,
  IndexingMeta,
  Issuer,
  Profile,
  ProfileRecord,
  QueryResult,
  Verification,
  VerificationIssuer,
} from "./types.ts";

export {
  deriveVerificationState,
  type DeriveStateInput,
  type FreshnessPolicy,
  type NotFoundState,
  type PendingCause,
  type PendingState,
  type RevokedState,
  type StaleState,
  type VerificationState,
  type VerificationStatus,
  type VerifiedState,
} from "./state.ts";

export {
  decodeIssuer,
  decodeMeta,
  decodeNullable,
  decodeProfile,
  decodeVerification,
  decodeVerifications,
} from "./decode.ts";

export {
  ISSUER_QUERY,
  META_QUERY,
  PROFILE_QUERY,
  RECENT_VERIFICATIONS_QUERY,
  VERIFICATION_QUERY,
} from "./queries.ts";
