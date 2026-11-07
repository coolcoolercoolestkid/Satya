/**
 * Browser-safe surface of the ENS package.
 *
 * Forward and reverse resolution with no filesystem access anywhere in the import graph.
 * The Node barrel (`index.ts`) additionally exports the root-`.env` loader and wraps
 * `createEnsResolver` to call it; a browser caller passes the RPC URL explicitly
 * (`createEnsResolver({ rpcUrl })`), so it never needs it. `resolveMainnetRpc` and
 * `loadRootEnv` are deliberately absent: a browser has no repository-root `.env` to read.
 */

export {
  createEnsResolver,
  normalizeAddressInput,
  normalizeEnsName,
  UNIVERSAL_RESOLVER_ADDRESS,
  type EnsResolver,
  type EnsResolverOptions,
} from "./resolver.ts";

export { assertMainnetRpc } from "./endpoint.ts";

export {
  EnsResolutionError,
  InvalidAddressError,
  InvalidEnsNameError,
  MainnetRpcNotConfiguredError,
} from "./errors.ts";
