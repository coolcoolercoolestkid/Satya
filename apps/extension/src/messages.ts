import type { PageSnapshot, Severity } from "@satya/checks";

export type ContentRequest =
  | { type: "snapshot" }
  | { type: "highlight"; items: { evidence: string; severity: Severity; title: string }[] }
  | { type: "scrollTo"; evidence: string }
  | { type: "clearHighlights" };

export type SnapshotResponse = PageSnapshot;

/** Max characters of page text we read. Enough for every check, small enough to be fast. */
export const MAX_TEXT = 20000;
