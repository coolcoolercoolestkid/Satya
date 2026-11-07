import { createQueryClient as createClient, type QueryClient, type QueryClientOptions } from "./client.ts";
import { loadRootEnv } from "./root-env.ts";

export type { PageOptions, QueryClient, QueryClientOptions } from "./client.ts";

/**
 * The Node client factory: like `client.ts`'s, but it first loads the repository-root
 * `.env` when no endpoint is passed, so scripts and the end-to-end runner keep the
 * zero-config `createQueryClient()` they have always had. The browser entry
 * (`@aletheia/query/browser`) exports the raw, filesystem-free factory instead.
 */
export function createQueryClient(options: QueryClientOptions = {}): QueryClient {
  if (options.endpoint === undefined) loadRootEnv();
  return createClient(options);
}

export {
  assertQueryEndpoint,
  resolveEndpoint,
} from "./endpoint.ts";

export { loadRootEnv } from "./root-env.ts";

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

// The five verification states: the read layer's actual product. `deriveVerificationState`
// is pure and is the unit-tested seam; the states it names are only ever produced from
// real endpoint data (scripts/states.ts).
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

// The decoders are exported because they are the honest seam of this package: pure,
// total, and the only part a test can exercise without the network. Nothing downstream
// needs them to read the subgraph.
export {
  decodeIssuer,
  decodeMeta,
  decodeNullable,
  decodeProfile,
  decodeVerification,
  decodeVerifications,
} from "./decode.ts";

// The GraphQL documents, exported so a caller can see exactly what is sent rather than
// take this package's word for it.
export {
  ISSUER_QUERY,
  META_QUERY,
  PROFILE_QUERY,
  RECENT_VERIFICATIONS_QUERY,
  VERIFICATION_QUERY,
} from "./queries.ts";
