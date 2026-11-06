/** Which of Satya's checks produced a finding. */
export type CheckId = "phishing" | "scam" | "records" | "ai" | "identity";

/** danger = likely harmful, warning = be careful, info = worth knowing, good = positive signal. */
export type Severity = "danger" | "warning" | "info" | "good";

export interface Finding {
  check: CheckId;
  severity: Severity;
  /** Short, plain-language headline shown on the card. */
  title: string;
  /** One-sentence explanation. */
  detail?: string;
  /** Where the information came from (list name, API, rule). Always shown to the user. */
  source: string;
  /** Exact text on the page that triggered the finding, used for highlighting. */
  evidence?: string;
  /** Points subtracted from the credibility score (0 for good/info-only findings). */
  weight: number;
}

/** What the content script reads from the page. */
export interface PageSnapshot {
  url: string;
  title: string;
  /** Visible text, trimmed to a reasonable length by the caller. */
  text: string;
  hasPasswordField?: boolean;
}

export interface CredibilityResult {
  score: number;
  level: "trustworthy" | "careful" | "high-risk";
  label: string;
  findings: Finding[];
}
