import type { Finding } from "./types.js";

/** Result of an AI-content check, independent of which detector produced it. */
export interface AiDetection {
  detector: string;
  /** Share of the text judged AI-generated or AI-assisted, 0 to 1. */
  fractionAi: number;
  /** Detector's short verdict, e.g. "AI", "Human", "Mixed". */
  label: string;
  /** Passages the detector marked as AI, for highlighting. */
  aiSegments: string[];
}

export interface AiDetector {
  name: string;
  detect(text: string): Promise<AiDetection>;
}

/** Keep requests small: detectors bill per word, and a page sample is enough. */
export const MAX_AI_CHARS = 5000;
const MIN_AI_CHARS = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Pangram (pangram.com). Async API: create a task, then poll it.
 * Docs: https://docs.pangram.com/api-reference/ai-detection
 */
export function pangramDetector(
  apiKey: string,
  opts: { model?: string; fetchImpl?: typeof fetch; pollMs?: number; maxPolls?: number } = {},
): AiDetector {
  const base = "https://text.external-api.pangram.com";
  const f = opts.fetchImpl ?? fetch;
  return {
    name: "Pangram",
    async detect(text) {
      const body: Record<string, unknown> = { text: text.slice(0, MAX_AI_CHARS) };
      if (opts.model) body.model = opts.model;
      const created = await f(`${base}/task`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify(body),
      });
      if (!created.ok) throw new Error(`Pangram returned ${created.status}`);
      const { task_id } = (await created.json()) as { task_id: string };

      for (let i = 0; i < (opts.maxPolls ?? 30); i++) {
        const res = await f(`${base}/task/${task_id}`, { headers: { "x-api-key": apiKey } });
        if (!res.ok) throw new Error(`Pangram returned ${res.status}`);
        const r = (await res.json()) as {
          stage?: string;
          headline?: string;
          prediction_short?: string;
          fraction_ai?: number;
          fraction_ai_assisted?: number;
          windows?: { text: string; label: string; confidence?: string }[];
        };
        if (r.stage === "STAGE_FAILED") throw new Error(`Pangram failed: ${r.headline ?? "unknown"}`);
        if (r.stage === "STAGE_SUCCESS") {
          return {
            detector: "Pangram",
            fractionAi: (r.fraction_ai ?? 0) + (r.fraction_ai_assisted ?? 0),
            label: r.prediction_short ?? r.headline ?? "Unknown",
            aiSegments: (r.windows ?? [])
              .filter((w) => w.label !== "Human Written" && w.confidence !== "Low")
              .map((w) => w.text.trim())
              .filter(Boolean),
          };
        }
        await sleep(opts.pollMs ?? 1000);
      }
      throw new Error("Pangram timed out");
    },
  };
}

/**
 * GPTZero (gptzero.me). Docs: https://docs.gptzero.me/
 */
export function gptZeroDetector(apiKey: string, fetchImpl: typeof fetch = fetch): AiDetector {
  return {
    name: "GPTZero",
    async detect(text) {
      const res = await fetchImpl("https://api.gptzero.me/v2/predict/text", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({ document: text.slice(0, MAX_AI_CHARS) }),
      });
      if (!res.ok) throw new Error(`GPTZero returned ${res.status}`);
      const r = (await res.json()) as {
        documents?: {
          predicted_class?: string;
          class_probabilities?: { ai?: number; mixed?: number; human?: number };
        }[];
      };
      const doc = r.documents?.[0];
      const p = doc?.class_probabilities ?? {};
      return {
        detector: "GPTZero",
        fractionAi: (p.ai ?? 0) + (p.mixed ?? 0) / 2,
        label: doc?.predicted_class ?? "unknown",
        aiSegments: [],
      };
    },
  };
}

/** Turns a detection into card findings. Always worded as a signal, never a verdict. */
export function aiFindings(d: AiDetection): Finding[] {
  const pct = Math.round(d.fractionAi * 100);
  const source = `${d.detector} AI detector`;
  if (d.fractionAi >= 0.5) {
    const findings: Finding[] = [
      {
        check: "ai",
        severity: "warning",
        title: `Likely AI-generated text (${pct}%)`,
        detail: "AI detectors can be wrong, so treat this as a signal, not proof.",
        source,
        weight: 10,
      },
    ];
    for (const seg of d.aiSegments.slice(0, 3)) {
      findings.push({
        check: "ai",
        severity: "info",
        title: "Passage flagged as AI-written",
        source,
        evidence: seg.slice(0, 300),
        weight: 0,
      });
    }
    return findings;
  }
  if (d.fractionAi >= 0.2) {
    return [{
      check: "ai",
      severity: "info",
      title: `Some text may be AI-assisted (${pct}%)`,
      detail: "AI detectors can be wrong, so treat this as a signal, not proof.",
      source,
      weight: 0,
    }];
  }
  return [{
    check: "ai",
    severity: "good",
    title: "Text reads as human-written",
    source,
    weight: 0,
  }];
}

/** Runs a detector if there's enough text, and never lets a detector error break the card. */
export async function checkAiContent(text: string, detector?: AiDetector): Promise<Finding[]> {
  if (!detector) return [];
  const sample = text.replace(/\s+/g, " ").trim();
  if (sample.length < MIN_AI_CHARS) return [];
  try {
    return aiFindings(await detector.detect(sample));
  } catch (err) {
    return [{
      check: "ai",
      severity: "info",
      title: "AI check unavailable",
      detail: err instanceof Error ? err.message : String(err),
      source: `${detector.name} AI detector`,
      weight: 0,
    }];
  }
}
