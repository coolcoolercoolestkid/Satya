/**
 * The Web Worker transport for extraction.
 *
 * Stage 15 requires extraction to run client-side, off the main thread, so a large image
 * or PDF never freezes the holder's UI while it is decoded and OCR'd. This module is that
 * worker: it runs the very same {@link extractFromImage}/{@link extractFromPdf}/
 * {@link extractFromMrzText} core the tests exercise directly, so the worker is transport,
 * not logic — there is nothing here that the Node tests do not already cover through the
 * core.
 *
 * It is deliberately typed against a tiny local shape of the worker and `Worker` APIs
 * rather than the DOM lib, so it type-checks under the repository's Node-only tsconfig. In
 * the browser it is loaded as a module worker; `registerExtractionWorker` wires it to the
 * global scope, and {@link createDocumentExtractorClient} is the main-thread side.
 *
 * Assets are passed in by the caller (`config`) and must be same-origin local paths — the
 * offline guarantee is the caller's to keep by not pointing them at a CDN.
 */

import {
  extractFromImage,
  extractFromMrzText,
  extractFromPdf,
  type DocumentExtractionResult,
  type ExtractOptions,
  type ExtractPdfOptions,
} from "./document.ts";
import { createTesseractMrzEngine, type TesseractMrzConfig } from "./ocr.ts";

/** A request sent to the worker. `id` correlates the reply. */
export type ExtractionRequest =
  | {
      id: number;
      kind: "mrz-text";
      text: string;
      options?: ExtractOptions;
    }
  | {
      id: number;
      kind: "image";
      bytes: Uint8Array;
      config: TesseractMrzConfig;
      options?: ExtractOptions;
    }
  | {
      id: number;
      kind: "pdf";
      bytes: Uint8Array;
      options?: ExtractPdfOptions;
    };

/** The worker's reply: the extraction result, or the message of an error it threw. */
export type ExtractionResponse =
  | { id: number; ok: true; result: DocumentExtractionResult }
  | { id: number; ok: false; error: string };

interface WorkerGlobalLike {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown): void;
}

interface WorkerLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

/** Run one request against the extraction core. */
async function handle(request: ExtractionRequest): Promise<DocumentExtractionResult> {
  switch (request.kind) {
    case "mrz-text":
      return extractFromMrzText(request.text, request.options ?? {});
    case "pdf":
      return extractFromPdf(request.bytes, request.options ?? {});
    case "image": {
      // A fresh engine per image keeps the worker stateless and is plenty for the holder
      // flow, which extracts one document at a time.
      const engine = await createTesseractMrzEngine(request.config);
      try {
        return await extractFromImage(request.bytes, engine, request.options ?? {});
      } finally {
        await engine.close();
      }
    }
  }
}

/**
 * Attach the extraction handler to a worker global. Called with no argument inside a Web
 * Worker (it finds `self`); a scope can be passed explicitly for testing. Returns `false`
 * when there is no worker global to attach to, so importing this module on the main thread
 * is harmless.
 */
export function registerExtractionWorker(scope?: WorkerGlobalLike): boolean {
  const target =
    scope ??
    (typeof (globalThis as { postMessage?: unknown }).postMessage === "function"
      ? (globalThis as unknown as WorkerGlobalLike)
      : null);
  if (target === null) return false;

  target.onmessage = (event: { data: unknown }): void => {
    const request = event.data as ExtractionRequest;
    handle(request).then(
      (result) => {
        const response: ExtractionResponse = { id: request.id, ok: true, result };
        target.postMessage(response);
      },
      (error: unknown) => {
        const response: ExtractionResponse = {
          id: request.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
        target.postMessage(response);
      },
    );
  };
  return true;
}

/**
 * Main-thread client: wraps a `Worker` in a promise-returning API. Each call posts a
 * request and resolves when the matching reply arrives.
 */
export function createDocumentExtractorClient(worker: WorkerLike): {
  extract(request: Omit<ExtractionRequest, "id">): Promise<DocumentExtractionResult>;
} {
  let nextId = 1;
  return {
    extract(request: Omit<ExtractionRequest, "id">): Promise<DocumentExtractionResult> {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const listener = (event: { data: unknown }): void => {
          const response = event.data as ExtractionResponse;
          if (response.id !== id) return;
          worker.removeEventListener("message", listener);
          if (response.ok) resolve(response.result);
          else reject(new Error(response.error));
        };
        worker.addEventListener("message", listener);
        worker.postMessage({ ...request, id } as ExtractionRequest);
      });
    },
  };
}

// Loaded as the worker entry: wire up automatically. No-op on the main thread.
registerExtractionWorker();
