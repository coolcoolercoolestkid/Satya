import { createC2pa, Reader } from "@contentauth/c2pa-web";

type C2pa = Awaited<ReturnType<typeof createC2pa>>;
import { aiMetadataMarker, readCredential, type ImageCredential, type ManifestStoreLike } from "@satya/checks";

/** Images larger than this are skipped (a label is read from the whole file). */
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

let c2pa: Promise<C2pa> | undefined;

/**
 * The SDK only accepts an https: worker URL, a guard meant for web pages. An extension's own
 * files are served from chrome-extension://, which is just as trustworthy (packaged with the
 * extension, same origin as the side panel), so we hand it the extension URL in a form that
 * passes that guard. The worker itself is still created from the extension's own file.
 */
export function extensionUrl(href: string): URL {
  return { protocol: "https:", href, toString: () => href } as unknown as URL;
}

/**
 * The C2PA SDK runs in a worker with its WebAssembly, both shipped inside the extension
 * (Chrome extensions can't load code from elsewhere or start workers from blob: URLs).
 */
function sdk(): Promise<C2pa> {
  c2pa ??= createC2pa({
    wasmSrc: chrome.runtime.getURL("c2pa/c2pa_bg.wasm"),
    workerSrc: extensionUrl(chrome.runtime.getURL("c2pa/c2pa_worker.js")),
  });
  return c2pa;
}

/**
 * Reads Content Credentials from the page's images. Only runs in the deeper check: the
 * images are fetched again from the sites that served them (usually straight from the
 * browser cache), without cookies.
 */
export interface ImageCheck {
  creds: ImageCredential[];
  /** Images found on the page. */
  found: number;
  /** Images actually read. */
  checked: number;
  errors: string[];
  /** Images whose plain metadata names an AI tool (unsigned). */
  metadata: { url: string; tool: string }[];
}

export async function checkImageCredentials(urls: string[]): Promise<ImageCheck> {
  if (!urls.length) return { creds: [], found: 0, checked: 0, errors: [], metadata: [] };
  const errors: string[] = [];
  let c: C2pa;
  try {
    c = await sdk();
  } catch (e) {
    c2pa = undefined;
    return { creds: [], found: urls.length, checked: 0, metadata: [], errors: [`C2PA reader failed to start: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const creds: ImageCredential[] = [];
  const metadata: { url: string; tool: string }[] = [];
  let checked = 0;
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "force-cache", credentials: "omit" });
      if (!res.ok) {
        errors.push(`${url.split("/").pop()}: HTTP ${res.status}`);
        continue;
      }
      const blob = await res.blob();
      if (blob.size > MAX_IMAGE_BYTES || !blob.type.startsWith("image/")) continue;
      checked++;
      const tool = aiMetadataMarker(new Uint8Array(await blob.slice(0, 256 * 1024).arrayBuffer()));
      if (tool) metadata.push({ url, tool });
      let store: ManifestStoreLike | null = null;
      try {
        const reader = await Reader.fromBlob(c, blob.type, blob);
        if (reader) {
          store = (await reader.manifestStore()) as unknown as ManifestStoreLike;
          await reader.free();
        }
      } catch {
        store = null; // no label, or one the SDK can't read
      }
      const cred = readCredential(url, store);
      if (cred) creds.push(cred);
    } catch (e) {
      errors.push(`${url.split("/").pop()}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { creds, found: urls.length, checked, errors, metadata };
}
