/**
 * The read path.
 *
 * One transport function, five typed reads on top of it, and every one of them returns
 * the indexer's block and error state alongside the records.
 *
 * **There is no way to inject a `fetch` here, and that is the point.** The obvious
 * convenience — an optional `fetch` option "for testing" — is exactly the mocked read
 * path `.cursor/rules/ethereum.mdc` forbids, and once the seam exists a test suite grows
 * into it and the client is never again exercised against the real subgraph. So the
 * transport uses the platform `fetch` and nothing else, the decoders in `decode.ts` hold
 * everything that can be unit-tested, and the endpoint is proven to work by
 * `scripts/check.ts` running a real query against the deployed subgraph.
 */

import {
  decodeIssuer,
  decodeMeta,
  decodeNullable,
  decodeProfile,
  decodeVerification,
  decodeVerifications,
} from "./decode.ts";
import { GraphQueryError, GraphTransportError, MalformedResponseError } from "./errors.ts";
import { resolveEndpoint } from "./endpoint.ts";
import {
  ISSUER_QUERY,
  META_QUERY,
  PROFILE_QUERY,
  RECENT_VERIFICATIONS_QUERY,
  VERIFICATION_QUERY,
} from "./queries.ts";
import {
  deriveVerificationState,
  type FreshnessPolicy,
  type VerificationState,
} from "./state.ts";
import type {
  IndexingMeta,
  Issuer,
  ProfileRecord,
  QueryResult,
  Verification,
} from "./types.ts";

/** How many records a list read returns when the caller does not say. */
const DEFAULT_PAGE_SIZE = 100;
/** graph-node refuses a larger `first`. Rejected here so the error names the cause. */
const MAX_PAGE_SIZE = 1000;
/** A read that has not answered in this long is not going to. */
const DEFAULT_TIMEOUT_MS = 15_000;

export interface QueryClientOptions {
  /**
   * The subgraph query endpoint. Defaults to `GRAPH_QUERY_URL`, loaded from the
   * repository-root `.env` if it is not already in the environment.
   */
  endpoint?: string;
  /** Abort a request after this many milliseconds. Defaults to 15000. */
  timeoutMs?: number;
}

export interface PageOptions {
  /** Records to return, 1 to 1000. Defaults to 100. */
  first?: number;
  /** Records to skip. Defaults to 0. */
  skip?: number;
}

export interface VerificationStateOptions {
  /** The verifier's freshness policy. Required: a freshness window is never defaulted. */
  policy: FreshnessPolicy;
  /**
   * The block a just-submitted transaction was mined in, when waiting on a specific
   * record. Makes an absent record read `pending` rather than `not-found` while the
   * indexer catches up. Omit when not waiting on anything.
   */
  expectedBlock?: bigint;
  /** "Now" in Unix seconds. Defaults to this machine's clock. */
  nowSeconds?: number;
}

function assertPage(options: PageOptions | undefined): { first: number; skip: number } {
  const first = options?.first ?? DEFAULT_PAGE_SIZE;
  const skip = options?.skip ?? 0;
  if (!Number.isSafeInteger(first) || first < 1 || first > MAX_PAGE_SIZE) {
    throw new RangeError(`first must be an integer in 1..${MAX_PAGE_SIZE}, received ${first}`);
  }
  if (!Number.isSafeInteger(skip) || skip < 0) {
    throw new RangeError(`skip must be a non-negative integer, received ${skip}`);
  }
  return { first, skip };
}

/**
 * Normalise an id for lookup.
 *
 * The subgraph stores `Bytes` ids lower-cased, so a checksummed address queried verbatim
 * returns null — a "not found" that is really a "wrong case". Lower-casing here means a
 * caller can pass whichever form they have.
 */
function normalizeId(value: string, label: string): string {
  const trimmed = value.trim();
  if (!/^0x[0-9a-fA-F]*$/.test(trimmed) || trimmed.length % 2 !== 0) {
    throw new TypeError(
      `${label} must be a 0x-prefixed hex string with an even number of digits, received ${JSON.stringify(value)}`,
    );
  }
  return trimmed.toLowerCase();
}

function normalizeAddress(value: string): string {
  const id = normalizeId(value, "address");
  if (id.length !== 42) {
    throw new TypeError(`address must be 20 bytes (0x + 40 hex digits), received ${value}`);
  }
  return id;
}

function normalizeBytes32(value: string, label: string): string {
  const id = normalizeId(value, label);
  if (id.length !== 66) {
    throw new TypeError(`${label} must be 32 bytes (0x + 64 hex digits), received ${value}`);
  }
  return id;
}

/** A GraphQL read client for one deployed Aletheia subgraph. */
export interface QueryClient {
  /** The endpoint this client reads from. Useful in error reports and in the check script. */
  readonly endpoint: string;

  /** The indexer's own state: last indexed block, and whether it has errored. */
  meta(): Promise<IndexingMeta>;

  /** One verification by `verificationId`. Null when no such record is indexed. */
  verification(verificationId: string): Promise<QueryResult<Verification | null>>;

  /**
   * One verification by id, classified into one of the five states in a single round trip.
   *
   * This is the read layer's product: a caller never has to hold a record and the
   * indexer's meta side by side and reason about the gap themselves. The query is live;
   * the classification is the pure `deriveVerificationState`. `now` defaults to this
   * machine's clock — the one impure part, and the reason the classification is factored
   * out as a pure function that a test can pin a clock into.
   */
  verificationState(
    verificationId: string,
    options: VerificationStateOptions,
  ): Promise<VerificationState>;

  /** Recent verifications across every subject, newest first. */
  recentVerifications(options?: PageOptions): Promise<QueryResult<Verification[]>>;

  /**
   * One address with its verifications, newest first. Null when the address has neither
   * registered nor ever been a verification subject.
   */
  profile(address: string, options?: PageOptions): Promise<QueryResult<ProfileRecord | null>>;

  /** One issuer by registry `issuerId`, with its on-chain label and revocation state. */
  issuer(issuerId: string): Promise<QueryResult<Issuer | null>>;
}

/**
 * Build a read client for one deployed subgraph.
 *
 * Browser-safe: it touches no filesystem. When `endpoint` is omitted it reads
 * `GRAPH_QUERY_URL` from `process.env` but never loads a `.env` file — that is the Node
 * barrel's job (`index.ts` wraps this to `loadRootEnv()` first), which keeps `node:fs`
 * out of the browser bundle. A browser caller passes `endpoint` explicitly.
 */
export function createQueryClient(options: QueryClientOptions = {}): QueryClient {
  const endpoint = options.endpoint ?? resolveEndpoint();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  /**
   * Execute one document and return its `data` object.
   *
   * The three failure modes are kept apart deliberately: the request not completing, the
   * server reporting GraphQL errors, and the body not matching the schema. Collapsing
   * them into one error would leave a caller unable to tell "the subgraph is down" from
   * "this client and the schema have drifted".
   */
  async function execute(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new GraphTransportError(
        `the subgraph endpoint could not be reached: ${detail}`,
        endpoint,
      );
    }

    if (!response.ok) {
      // The body of a non-2xx is usually the useful part (an expired deploy key, a
      // subgraph name that no longer exists), so a bounded amount of it is carried.
      const body = await response.text().catch(() => "");
      throw new GraphTransportError(
        `the subgraph endpoint returned HTTP ${response.status}${body === "" ? "" : `: ${body.slice(0, 500)}`}`,
        endpoint,
        response.status,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new GraphTransportError(`the response was not JSON: ${detail}`, endpoint, 200);
    }

    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new MalformedResponseError("response", "expected a JSON object");
    }
    const body = payload as Record<string, unknown>;

    // GraphQL reports query-level failures in `errors` with HTTP 200. A response with
    // errors is never partially trusted here: the whole read fails.
    const errors = body["errors"];
    if (Array.isArray(errors) && errors.length > 0) {
      throw new GraphQueryError(
        errors.map((entry) => {
          if (typeof entry === "object" && entry !== null && "message" in entry) {
            const message = (entry as { message: unknown }).message;
            if (typeof message === "string") return message;
          }
          return JSON.stringify(entry);
        }),
      );
    }

    const data = body["data"];
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new MalformedResponseError("response.data", "expected an object");
    }
    return data as Record<string, unknown>;
  }

  /** Every read goes through here, so `_meta` is never accidentally dropped. */
  async function read<T>(
    query: string,
    variables: Record<string, unknown>,
    select: (data: Record<string, unknown>) => T,
  ): Promise<QueryResult<T>> {
    const data = await execute(query, variables);
    return { meta: decodeMeta(data["_meta"]), data: select(data) };
  }

  return {
    endpoint,

    async meta(): Promise<IndexingMeta> {
      const data = await execute(META_QUERY, {});
      return decodeMeta(data["_meta"]);
    },

    async verification(verificationId: string): Promise<QueryResult<Verification | null>> {
      const id = normalizeBytes32(verificationId, "verificationId");
      return read(VERIFICATION_QUERY, { id }, (data) =>
        decodeNullable(data["verification"], "verification", decodeVerification),
      );
    },

    async verificationState(
      verificationId: string,
      options: VerificationStateOptions,
    ): Promise<VerificationState> {
      const result = await this.verification(verificationId);
      return deriveVerificationState({
        verification: result.data,
        meta: result.meta,
        policy: options.policy,
        nowSeconds: options.nowSeconds ?? Math.floor(Date.now() / 1000),
        ...(options.expectedBlock !== undefined ? { expectedBlock: options.expectedBlock } : {}),
      });
    },

    async recentVerifications(options?: PageOptions): Promise<QueryResult<Verification[]>> {
      const page = assertPage(options);
      return read(RECENT_VERIFICATIONS_QUERY, page, (data) =>
        decodeVerifications(data["verifications"]),
      );
    },

    async profile(
      address: string,
      options?: PageOptions,
    ): Promise<QueryResult<ProfileRecord | null>> {
      const id = normalizeAddress(address);
      const page = assertPage(options);
      return read(PROFILE_QUERY, { id, ...page }, (data) =>
        decodeNullable(data["profile"], "profile", (raw, path) => {
          const profile = decodeProfile(raw, path);
          const verifications = decodeVerifications(
            (raw as Record<string, unknown>)["verifications"],
            `${path}.verifications`,
          );
          return { ...profile, verifications };
        }),
      );
    },

    async issuer(issuerId: string): Promise<QueryResult<Issuer | null>> {
      const id = normalizeBytes32(issuerId, "issuerId");
      return read(ISSUER_QUERY, { id }, (data) =>
        decodeNullable(data["issuer"], "issuer", decodeIssuer),
      );
    },
  };
}

/** Exported for the unit tests; the client normalises ids on the caller's behalf. */
export const __internal = { assertPage, normalizeAddress, normalizeBytes32 };
