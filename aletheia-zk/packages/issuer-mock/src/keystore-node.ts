/**
 * Filesystem I/O for the mock issuer keystore. Node only.
 *
 * Split out of `keys.ts` so the key logic there — generate, serialize, parse, derive the
 * public key — stays free of `node:fs` and can be bundled into a browser holder flow,
 * where the Phase 1 mock issuer runs on the holder's own device. The reading and writing
 * of a keystore file belongs to tools and scripts, never to the browser.
 */

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { serializeKeystore, parseKeystore, type IssuerKeypair, type KeystoreFile } from "./keys.ts";

/** Default keystore location. The whole directory is gitignored. */
export function defaultKeystorePath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return process.env.ALETHEIA_ISSUER_KEYSTORE ?? join(here, "..", "keys", "issuer-mock.json");
}

export function writeKeystore(keypair: IssuerKeypair, path = defaultKeystorePath()): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(serializeKeystore(keypair), null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx", // never silently overwrite an existing issuer key
  });
  return path;
}

export async function readKeystore(path = defaultKeystorePath()): Promise<IssuerKeypair> {
  return parseKeystore(JSON.parse(readFileSync(path, "utf8")) as KeystoreFile);
}
