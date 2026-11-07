import type { SourceProof } from "./types.js";

/** SHA-256 of a string's UTF-8 bytes, 0x-prefixed. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `0x${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Fetches a source and keeps a record of exactly what came back: the URL, the SHA-256 of the
 * raw body and the time. The record goes on the finding, into saved evidence and onto Arkiv,
 * so the answer can be shown later even if the source changes or disappears.
 */
export async function fetchRecorded(
  fetchImpl: typeof fetch,
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; body: string; proof: SourceProof }> {
  const res = await fetchImpl(url, init);
  const body = await res.text();
  return { ok: res.ok, body, proof: { url, sha256: await sha256Hex(body), fetchedAt: new Date().toISOString() } };
}
