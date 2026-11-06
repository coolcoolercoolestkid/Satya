import type { CredibilityResult, Finding } from "./types.js";

const ORDER: Record<Finding["severity"], number> = { danger: 0, warning: 1, info: 2, good: 3 };

/**
 * Combines findings into one score out of 100. Every point lost comes from a finding the
 * user can see, with its source.
 *
 * - The score starts at 100 and loses each warning's and danger's weight.
 * - Any danger caps it at 60; an official brand, government or bank domain lifts it to 85.
 * - 75+ only says "Looks trustworthy" when something positive vouches for the site (official
 *   domain, .gov.in/.bank.in, a company-verified certificate, a domain years old). Otherwise it
 *   says "No red flags found": nothing wrong was seen, but nothing proves the site either.
 * - AI-content findings (AI-written text, AI images) are shown separately and never change the
 *   score: AI-made content isn't a scam by itself.
 */
/** An unknown site starts in the middle: no evidence either way. */
export const BASE = 50;
/** Findings that mean the site is on a published phishing, scam, fraud or sanctions list. */
const LISTED = /^(Known phishing site|Listed as a (scam|fraud|ransomware) site|Wallet on )/;

export function scoreFindings(findings: Finding[]): CredibilityResult {
  const seen = new Set<string>();
  const unique = findings.filter((f) => {
    const key = `${f.check}|${f.title}|${f.evidence ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Site trust only: AI content and people's proofs are shown but don't move it.
  const counted = unique.filter((f) => f.check !== "ai" && f.check !== "identity");
  const trust = counted.filter((f) => f.severity === "good").reduce((sum, f) => sum + f.weight, 0);
  const risk = counted.filter((f) => f.severity === "danger" || f.severity === "warning").reduce((sum, f) => sum + f.weight, 0);
  let score = BASE + trust - risk;

  // Decisive evidence overrides the sum.
  const onList = counted.some((f) => f.severity === "danger" && LISTED.test(f.title));
  const lookalike = counted.some((f) => f.severity === "danger" && /^Looks like .+, but isn't$/.test(f.title));
  const hasDanger = counted.some((f) => f.severity === "danger");
  const official = counted.some((f) => f.check === "phishing" && f.severity === "good");
  if (onList) score = Math.min(score, 5);
  else if (lookalike) score = Math.min(score, 15);
  else if (hasDanger) score = Math.min(score, 35);
  else if (official) score = Math.max(score, 90);
  score = Math.round(Math.max(0, Math.min(100, score)));

  const level: CredibilityResult["level"] =
    score >= 75 ? "trustworthy" : score >= 45 ? "unverified" : score >= 25 ? "careful" : "high-risk";
  const hasWarning = counted.some((f) => f.severity === "warning");
  const label = {
    trustworthy: "Looks trustworthy",
    unverified: hasWarning ? "Mixed signals" : trust > 0 ? "Probably fine" : "No red flags found",
    careful: "Be careful",
    "high-risk": "High risk",
  }[level];

  unique.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || b.weight - a.weight);
  return { score, level, label, findings: unique };
}
