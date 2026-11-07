import {
  createEnsResolver as createResolver,
  type EnsResolver,
  type EnsResolverOptions,
} from "./resolver.ts";
import { loadRootEnv } from "./root-env.ts";

export {
  normalizeAddressInput,
  normalizeEnsName,
  UNIVERSAL_RESOLVER_ADDRESS,
  type EnsResolver,
  type EnsResolverOptions,
} from "./resolver.ts";

/**
 * The Node resolver factory: like `resolver.ts`'s, but it first loads the repository-root
 * `.env` when no RPC URL is passed, so scripts keep the zero-config `createEnsResolver()`
 * they have always had. The browser entry (`@aletheia/ens/browser`) exports the raw,
 * filesystem-free factory instead.
 */
export function createEnsResolver(options: EnsResolverOptions = {}): EnsResolver {
  if (options.rpcUrl === undefined) loadRootEnv();
  return createResolver(options);
}

export {
  assertMainnetRpc,
  resolveMainnetRpc,
} from "./endpoint.ts";

export { loadRootEnv } from "./root-env.ts";

export {
  EnsResolutionError,
  InvalidAddressError,
  InvalidEnsNameError,
  MainnetRpcNotConfiguredError,
} from "./errors.ts";
