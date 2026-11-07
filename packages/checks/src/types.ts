/** Which of Satya's checks produced a finding. */
export type CheckId = "phishing" | "page" | "scam" | "records" | "ai" | "identity";

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
  /** Where to see the raw evidence yourself (registry record, archive snapshot, log search). */
  link?: string;
}

/** Structural facts about the page, read by the content script (no page text). */
export interface PageSignals {
  protocol: "http:" | "https:" | string;
  /** Forms on the page: where they submit, and whether they ask for a password. */
  forms: { actionHost: string | null; hasPassword: boolean }[];
  /** Kinds of sensitive inputs found, e.g. "otp", "cvv", "card", "upi-pin", "aadhaar", "pan". */
  sensitiveFields: string[];
  /** Number of small text inputs in one form: 12 or 24 suggests a seed-phrase grid. */
  maxInputsInOneForm: number;
  /** Links to installable files (.apk, .exe…). */
  downloadLinks: string[];
  /** Hosts that serve scripts on this page. */
  scriptHosts: string[];
  /** Hosts of invisible (0-size or hidden) frames: a classic way to load malware or ad fraud. */
  hiddenFrameHosts?: string[];
  /** Inline scripts that decode and run hidden code (eval of base64, packed code, huge encoded strings). */
  obfuscatedScripts?: number;
  /** Address a meta refresh sends the visitor to, if any. */
  metaRefresh?: string | null;
  /** Images, scripts or frames loaded over plain http on an https page. */
  mixedContent?: number;
}

/** What the content script reads from the page. */
export interface PageSnapshot {
  url: string;
  title: string;
  /** Visible text, trimmed to a reasonable length by the caller. */
  text: string;
  hasPasswordField?: boolean;
  signals?: PageSignals;
  /** Main readable text (paragraphs, not menus or footers), for AI-text detection. */
  mainText?: string;
  /** Addresses of the larger images on the page, for the Content Credentials check. */
  images?: string[];
}

export interface CredibilityResult {
  score: number;
  level: "trustworthy" | "unverified" | "careful" | "high-risk";
  label: string;
  findings: Finding[];
  /** How the score was reached: start, each finding's points, the raw sum and any rule that overrode it. */
  breakdown?: { base: number; steps: ScoreStep[]; sum: number; rule?: string };
}

export interface ScoreStep {
  label: string;
  points: number;
  source: string;
}
