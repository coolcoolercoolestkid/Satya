import type { CredibilityResult, Finding, ScoreStep } from "./types.js";

const ORDER: Record<Finding["severity"], number> = { danger: 0, warning: 1, info: 2, good: 3 };

/**
 * Combines findings into one score out of 100. Every point comes from a finding the user can
 * see, with its source, and the result carries the full breakdown so the panel can chart it.
 *
 * - An unknown site starts at 50: no evidence either way.
 * - Each good finding adds its weight; each warning or danger subtracts its weight.
 * - Decisive evidence overrides the sum: on a scam/sanctions list → at most 5; imitating a
 *   brand → at most 15; any other danger → at most 35; an official domain with no danger → at
 *   least 90.
 * - "Looks trustworthy" (75+) needs a strong signal (official, .gov.in/.bank.in, the brand's own
 *   ENS name) or two independent good signals; one weak signal alone tops out at 74.
 * - AI-content findings and people's proofs are shown separately and never change the score.
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
  const steps: ScoreStep[] = counted
    .filter((f) => f.weight > 0 && f.severity !== "info")
    .map((f) => ({ label: f.title, points: f.severity === "good" ? f.weight : -f.weight, source: f.source }))
    .sort((a, b) => b.points - a.points);
  const trust = steps.filter((s) => s.points > 0).reduce((sum, s) => sum + s.points, 0);
  const risk = steps.filter((s) => s.points < 0).reduce((sum, s) => sum - s.points, 0);
  const sum = BASE + trust - risk;
  let score = sum;
  let rule: string | undefined;
  const limit = (to: number, why: string, lower = false) => {
    const next = lower ? Math.max(score, to) : Math.min(score, to);
    if (next !== score) rule = why;
    score = next;
  };

  // Decisive evidence overrides the sum.
  const onList = counted.some((f) => f.severity === "danger" && LISTED.test(f.title));
  const lookalike = counted.some((f) => f.severity === "danger" && /^Looks like .+, but isn't$/.test(f.title));
  const hasDanger = counted.some((f) => f.severity === "danger");
  const official = counted.some((f) => f.check === "phishing" && f.severity === "good");
  if (onList) limit(5, "On a published scam or sanctions list: at most 5");
  else if (lookalike) limit(15, "Imitates a known brand: at most 15");
  else if (hasDanger) limit(35, "A serious red flag: at most 35");
  else if (official) limit(90, "Official domain with no red flags: at least 90", true);
  // One weak signal (e.g. domain age alone) can't make a site "trustworthy": hacked old domains
  // host phishing too. It takes a strong signal (official, .gov.in/.bank.in, the brand's own ENS
  // name) or at least two independent ones.
  const goods = counted.filter((f) => f.severity === "good");
  const strong = goods.some((f) => f.check === "phishing");
  if (!onList && !lookalike && !hasDanger && !strong && goods.length < 2) limit(74, "Only one thing vouches for it: at most 74");
  if (score > 100) { score = 100; rule ??= "Capped at 100"; }
  if (score < 0) { score = 0; rule ??= "Floored at 0"; }
  score = Math.round(score);

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
  return { score, level, label, findings: unique, breakdown: { base: BASE, steps, sum, rule } };
}
