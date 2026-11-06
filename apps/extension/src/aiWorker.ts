/**
 * Runs the AI-text detector inside the extension, in a worker so the panel stays responsive.
 * The page's text never leaves the browser: only the model files are downloaded (once, from
 * Hugging Face) and then cached.
 *
 * Model: TMR (Target Mining RoBERTa), MIT licence, by Oxidane; ONNX build by onnx-community.
 * Evaluated on the public RAID benchmark (raid-bench.xyz).
 */
import { env, pipeline, type TextClassificationPipeline } from "@huggingface/transformers";

export const MODEL = "onnx-community/tmr-ai-text-detector-ONNX";

type In = { id: number; chunks: string[]; base: string };
type Out =
  | { id: number; type: "progress"; loaded: number; total: number }
  | { id: number; type: "result"; probs: number[] }
  | { id: number; type: "error"; message: string };

let classifier: Promise<TextClassificationPipeline> | undefined;
const post = (m: Out) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (e: MessageEvent<In>) => {
  const { id, chunks, base } = e.data;
  try {
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    // The ONNX runtime's WebAssembly ships inside the extension (no remote code).
    env.backends.onnx.wasm!.wasmPaths = `${base}ort/`;
    env.backends.onnx.wasm!.numThreads = 1;
    const files = new Map<string, { loaded: number; total: number }>();
    // Cast: transformers.js's overloads are too large for TypeScript to resolve here.
    const load = pipeline as unknown as (task: string, model: string, opts: object) => Promise<TextClassificationPipeline>;
    classifier ??= load("text-classification", MODEL, {
      dtype: "q8",
      device: "wasm",
      progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status !== "progress" || !p.file) return;
        files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
        const all = [...files.values()];
        post({ id, type: "progress", loaded: all.reduce((s, f) => s + f.loaded, 0), total: all.reduce((s, f) => s + f.total, 0) });
      },
    });
    const clf = await classifier;
    const probs: number[] = [];
    for (const c of chunks) {
      const out = (await clf(c, { top_k: null, truncation: true, max_length: 512 } as never)) as unknown as { label: string; score: number }[];
      probs.push(out.find((o) => o.label === "ai")?.score ?? 0);
    }
    post({ id, type: "result", probs });
  } catch (err) {
    classifier = undefined;
    post({ id, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
