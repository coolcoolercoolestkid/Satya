/**
 * One named error per failure mode, matching `@aletheia/query` and the contracts: a
 * caller should never parse a message string to find out what went wrong.
 *
 * The load-bearing distinction here is between an *absent* record and a *failed* lookup.
 * A name with no address, or an address with no reverse name, is not an error — it is a
 * `null` result, a first-class outcome of the read (`docs/architecture.md`, ENS section).
 * An error is thrown only when the resolution could not be performed at all: the RPC is
 * unreachable, the Universal Resolver reverted for a reason other than "no record", or
 * the input was not a resolvable name or address in the first place. Collapsing "the
 * name has no address" into "the lookup failed" is exactly the confusion that makes a
 * verifier UI show an error where it should show "no ENS name".
 */

/** `MAINNET_RPC_URL` is absent, empty, or not a usable https endpoint. */
export class MainnetRpcNotConfiguredError extends Error {
  override readonly name = "MainnetRpcNotConfiguredError";

  constructor(detail: string) {
    super(
      `MAINNET_RPC_URL ${detail}. Put a read-only mainnet endpoint in the ` +
        `repository-root .env — it is used solely to resolve ENS names through the ` +
        `Universal Resolver, and Aletheia never writes to ENS.`,
    );
  }
}

/** The input string is not a well-formed ENS name (empty, or fails UTS-46 normalisation). */
export class InvalidEnsNameError extends Error {
  override readonly name = "InvalidEnsNameError";

  constructor(detail: string) {
    super(`not a resolvable ENS name: ${detail}`);
  }
}

/** The input string is not a 20-byte hex address. */
export class InvalidAddressError extends Error {
  override readonly name = "InvalidAddressError";

  constructor(detail: string) {
    super(`not an Ethereum address: ${detail}`);
  }
}

/**
 * The resolution call itself failed — the RPC was unreachable, timed out, or the
 * Universal Resolver reverted for a reason that is not "no such record".
 *
 * This is the operational failure, kept apart from a `null` result so a caller can tell
 * "mainnet is down / the RPC URL is wrong" from "this name simply has no address". The
 * originating error is carried as `cause` for a full stack while `message` stays a single
 * line that never leaks the RPC URL (it usually embeds an API key).
 */
export class EnsResolutionError extends Error {
  override readonly name = "EnsResolutionError";
  /** `"forward"` (name → address) or `"reverse"` (address → name). */
  readonly direction: "forward" | "reverse";
  /** The name or address the lookup was for. Never the RPC URL. */
  readonly subject: string;

  constructor(direction: "forward" | "reverse", subject: string, detail: string, cause?: unknown) {
    super(`ENS ${direction} resolution of ${JSON.stringify(subject)} failed: ${detail}`, {
      ...(cause !== undefined ? { cause } : {}),
    });
    this.direction = direction;
    this.subject = subject;
  }
}
