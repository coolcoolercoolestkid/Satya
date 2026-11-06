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
export function scoreFindings(findings: Finding[]): CredibilityResult {
  const seen = new Set<string>();
  const unique = findings.filter((f) => {
    const key = `${f.check}|${f.title}|${f.evidence ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const counted = unique.filter((f) => f.check !== "ai");
  const penalty = counted
    .filter((f) => f.severity !== "good")
    .reduce((sum, f) => sum + f.weight, 0);
  let score = Math.max(0, Math.min(100, 100 - penalty));

  const hasDanger = counted.some((f) => f.severity === "danger");
  const vouched = counted.some((f) => f.severity === "good" && f.check !== "identity");
  const isOfficial = unique.some((f) => f.check === "phishing" && f.severity === "good");
  if (hasDanger) score = Math.min(score, 60);
  else if (isOfficial) score = Math.max(score, 85);

  const level: CredibilityResult["level"] =
    score >= 75 ? (vouched ? "trustworthy" : "unverified") : score >= 45 ? "careful" : "high-risk";
  const label = {
    trustworthy: "Looks trustworthy",
    unverified: "No red flags found",
    careful: "Be careful",
    "high-risk": "High risk",
  }[level];

  unique.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || b.weight - a.weight);
  return { score, level, label, findings: unique };
}
