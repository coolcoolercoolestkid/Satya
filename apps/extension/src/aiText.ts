import type { AiDetection } from "@satya/checks";

/** Runs the on-device AI-text detector (see aiWorker.ts) over the page's main text. */
/** Shown as the source: "On-device TMR AI detector". */
export const DETECTOR_NAME = "On-device TMR AI detector";
const CHUNK = 1200;
const MAX_CHUNKS = 16;
const MIN_CHARS = 300;

/** Splits text into ~1,200-character pieces on sentence boundaries. */
export function chunkText(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  const sentences = clean.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [clean];
  const chunks: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur.length + s.length > CHUNK && cur.length >= 200) {
      chunks.push(cur.trim());
      cur = "";
    }
    cur += s;
  }
  if (cur.trim().length >= 120 || !chunks.length) chunks.push(cur.trim());
  return chunks.filter((c) => c.length >= 120).slice(0, MAX_CHUNKS);
}

let worker: Worker | undefined;
let nextId = 1;

export async function detectAiText(
  text: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<AiDetection | { tooShort: true }> {
  const chunks = chunkText(text);
  if (text.replace(/\s+/g, " ").trim().length < MIN_CHARS || !chunks.length) return { tooShort: true };
  worker ??= new Worker(chrome.runtime.getURL("ai-worker.js"));
  const id = nextId++;
  const probs = await new Promise<number[]>((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data as { id: number; type: string; loaded?: number; total?: number; probs?: number[]; message?: string };
      if (m.id !== id) return;
      if (m.type === "progress") return onProgress?.(m.loaded!, m.total!);
      worker!.removeEventListener("message", onMsg);
      if (m.type === "result") resolve(m.probs!);
      else reject(new Error(m.message));
    };
    worker!.addEventListener("message", onMsg);
    worker!.postMessage({ id, chunks, base: chrome.runtime.getURL("") });
  });
  // Share of the text (by length) in pieces the model judges AI-written.
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const aiChars = chunks.reduce((s, c, i) => s + (probs[i] >= 0.5 ? c.length : 0), 0);
  const fractionAi = aiChars / total;
  return {
    detector: "On-device TMR",
    fractionAi,
    label: fractionAi >= 0.5 ? "AI" : fractionAi >= 0.2 ? "Mixed" : "Human",
    aiSegments: chunks.filter((_, i) => probs[i] >= 0.5).map((c) => (c.match(/^[^.!?]{20,160}[.!?]?/)?.[0] ?? c.slice(0, 140)).trim()),
  };
}
