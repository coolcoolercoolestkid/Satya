/**
 * One named error per failure mode, matching how the contracts are written: a caller
 * should never have to parse a message string to find out what went wrong.
 *
 * The distinction that matters most is between "the endpoint said no" and "the endpoint
 * said yes and the body was not what the schema promises". The first is an operational
 * problem — wrong URL, subgraph undeployed, network down. The second means the schema
 * and this client have drifted apart, which is a code problem and must never be silently
 * coerced into a missing field or a NaN.
 */

/** The request never produced a usable HTTP response, or produced a non-2xx one. */
export class GraphTransportError extends Error {
  override readonly name = "GraphTransportError";
  readonly endpoint: string;
  readonly status: number | undefined;

  constructor(message: string, endpoint: string, status?: number) {
    super(message);
    this.endpoint = endpoint;
    if (status !== undefined) this.status = status;
  }
}

/** The endpoint returned HTTP 200 with a GraphQL `errors` array. */
export class GraphQueryError extends Error {
  override readonly name = "GraphQueryError";
  /** The `message` of every error the server reported, in order. */
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(`the subgraph rejected the query: ${errors.join("; ")}`);
    this.errors = errors;
  }
}

/**
 * The response was well-formed GraphQL but did not match `schema.graphql`.
 *
 * Thrown by the decoders rather than returning a partial object, because a `Verification`
 * missing its `nullifier` is not a verification — and a caller that receives one will
 * make a decision on it.
 */
export class MalformedResponseError extends Error {
  override readonly name = "MalformedResponseError";
  /** Dotted path to the offending field, e.g. `verification.issuer.active`. */
  readonly path: string;

  constructor(path: string, detail: string) {
    super(`${path}: ${detail}`);
    this.path = path;
  }
}

/** `GRAPH_QUERY_URL` is absent, empty, or not a usable https endpoint. */
export class EndpointNotConfiguredError extends Error {
  override readonly name = "EndpointNotConfiguredError";

  constructor(detail: string) {
    super(
      `GRAPH_QUERY_URL ${detail}. Put the Subgraph Studio query endpoint in the ` +
        `repository-root .env — the current one is recorded in docs/deployments.md.`,
    );
  }
}
