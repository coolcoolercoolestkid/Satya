/**
 * Scam evidence that can't be quietly changed later.
 *
 * Scam pages vanish within days. "Save evidence" freezes what the page looked like into a file
 * the user keeps: the page's text, a screenshot, and Satya's findings. The file's header holds
 * SHA-256 hashes of the text and screenshot; the SHA-256 of the header is the evidence
 * **fingerprint**. Only that fingerprint is anchored on Arkiv (never the URL or content), so the
 * user's browsing stays private while anyone holding the file can later prove it existed by then,
 * unchanged.
 *
 * What it proves: this exact file existed when the fingerprint was anchored. What it doesn't:
 * that the website really served it (a zkTLS proof would add that; see docs/zktls.md).
 */

export const EVIDENCE_VERSION = "satya-evidence-1";

export interface EvidenceHeader {
  version: typeof EVIDENCE_VERSION;
  url: string;
  title: string;
  capturedAt: string;
  textSha256: string;
  screenshotSha256: string | null;
  score: number;
  label: string;
  findings: string[];
  /** Each outside source consulted: what fact, its URL, SHA-256 of the response as received, and when. Covered by the fingerprint. */
  sources?: { fact: string; url: string; sha256: string; fetchedAt: string }[];
}

export interface EvidenceFile {
  header: EvidenceHeader;
  /** SHA-256 of the canonical header. This is what gets anchored. */
  fingerprint: string;
  text: string;
  /** Screenshot as a data: URL (PNG), or null if it couldn't be taken. */
  screenshot: string | null;
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha = async (data: Uint8Array) => hex(await crypto.subtle.digest("SHA-256", new Uint8Array(data)));

/** JSON with keys sorted at every level, so the same header always hashes the same way. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function dataUrlBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function evidenceFingerprint(header: EvidenceHeader): Promise<string> {
  return sha(new TextEncoder().encode(canonicalJson(header)));
}

export async function buildEvidence(input: {
  url: string;
  title: string;
  text: string;
  screenshot: string | null;
  score: number;
  label: string;
  findings: string[];
  sources?: { fact: string; url: string; sha256: string; fetchedAt: string }[];
  capturedAt?: Date;
}): Promise<EvidenceFile> {
  const header: EvidenceHeader = {
    version: EVIDENCE_VERSION,
    url: input.url,
    title: input.title,
    capturedAt: (input.capturedAt ?? new Date()).toISOString(),
    textSha256: await sha(new TextEncoder().encode(input.text)),
    screenshotSha256: input.screenshot ? await sha(dataUrlBytes(input.screenshot)) : null,
    score: input.score,
    label: input.label,
    findings: input.findings,
    ...(input.sources?.length ? { sources: input.sources } : {}),
  };
  return { header, fingerprint: await evidenceFingerprint(header), text: input.text, screenshot: input.screenshot };
}

/** Re-checks a saved evidence file: every hash must match its content. */
export async function checkEvidenceFile(file: EvidenceFile): Promise<{ ok: true; fingerprint: string } | { ok: false; reason: string }> {
  if (file?.header?.version !== EVIDENCE_VERSION) return { ok: false, reason: "Not a Satya evidence file." };
  if ((await sha(new TextEncoder().encode(file.text ?? ""))) !== file.header.textSha256) {
    return { ok: false, reason: "The page text in this file was changed after it was saved." };
  }
  if (file.header.screenshotSha256) {
    if (!file.screenshot || (await sha(dataUrlBytes(file.screenshot))) !== file.header.screenshotSha256) {
      return { ok: false, reason: "The screenshot in this file was changed after it was saved." };
    }
  }
  const fingerprint = await evidenceFingerprint(file.header);
  if (fingerprint !== file.fingerprint) return { ok: false, reason: "The evidence details were changed after it was saved." };
  return { ok: true, fingerprint };
}
