// Browser stand-in for Node's "crypto". The Anon Aadhaar build only needs it for proving;
// verification in the extension uses Web Crypto (globalThis.crypto).
export default globalThis.crypto;
export const webcrypto = globalThis.crypto;
export const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
