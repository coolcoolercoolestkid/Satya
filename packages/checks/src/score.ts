import type { CredibilityResult, Finding } from "./types.js";

const ORDER: Record<Finding["severity"], number> = { danger: 0, warning: 1, info: 2, good: 3 };

/**
 * Combines findings into one score out of 100. Every point lost comes from a finding the
 * user can see, with its source.
 */
export function scoreFindings(findings: Finding[]): CredibilityResult {
  const seen = new Set<string>();
  const unique = findings.filter((f) => {
    const key = `${f.check}|${f.title}|${f.evidence ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const penalty = unique
    .filter((f) => f.severity !== "good")
    .reduce((sum, f) => sum + f.weight, 0);
  let score = Math.max(0, Math.min(100, 100 - penalty));

  const hasDanger = unique.some((f) => f.severity === "danger");
  const isOfficial = unique.some((f) => f.check === "phishing" && f.severity === "good");
  if (hasDanger) score = Math.min(score, 60);
  else if (isOfficial) score = Math.max(score, 85);

  const level = score >= 75 ? "trustworthy" : score >= 45 ? "careful" : "high-risk";
  const label =
    level === "trustworthy" ? "Looks trustworthy" : level === "careful" ? "Be careful" : "High risk";

  unique.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || b.weight - a.weight);
  return { score, level, label, findings: unique };
}
