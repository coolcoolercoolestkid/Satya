/** Scoring for the CRE workflow. No SDK imports, so it can be tested with plain Node. */

/** Facts each node returns. 0 means "unknown" (lookup failed or no record). Times are Unix seconds. */
export type Facts = {
  registeredAt: number;
  firstCertAt: number;
  firstArchivedAt: number;
  resolves: number;
};

const SECONDS_PER_DAY = 86400;

export type Signal = { points: number; reason: string };

/** Same weights as the Satya extension (packages/checks): start at 50, evidence moves it. */
export function score(f: Facts, now: number): { score: number; signals: Signal[] } {
  const signals: Signal[] = [];
  if (f.registeredAt) {
    const days = (now - f.registeredAt) / SECONDS_PER_DAY;
    const years = days / 365;
    if (days < 30) signals.push({ points: -25, reason: `Domain registered only ${Math.floor(days)} days ago` });
    else if (days < 180) signals.push({ points: -10, reason: `Domain registered ${Math.floor(days)} days ago` });
    else if (years >= 10) signals.push({ points: 25, reason: "Domain is 10+ years old" });
    else if (years >= 5) signals.push({ points: 20, reason: "Domain is 5+ years old" });
    else if (years >= 2) signals.push({ points: 15, reason: "Domain is 2+ years old" });
    else if (years >= 1) signals.push({ points: 8, reason: "Domain is 1+ year old" });
  }
  if (f.firstCertAt) {
    const days = (now - f.firstCertAt) / SECONDS_PER_DAY;
    if (days < 7) signals.push({ points: -15, reason: `First HTTPS certificate only ${Math.floor(days)} days old` });
  }
  if (f.firstArchivedAt) {
    const years = (now - f.firstArchivedAt) / SECONDS_PER_DAY / 365;
    if (years >= 10) signals.push({ points: 10, reason: "Internet Archive has seen it for 10+ years" });
    else if (years >= 3) signals.push({ points: 6, reason: "Internet Archive has seen it for 3+ years" });
    else if (years >= 1) signals.push({ points: 3, reason: "Internet Archive has seen it for 1+ year" });
  }
  if (!f.resolves) signals.push({ points: 0, reason: "Domain doesn't resolve in DNS (offline, or taken down)" });
  const goods = signals.filter((s) => s.points > 0).length;
  let total = 50 + signals.reduce((s, x) => s + x.points, 0);
  // As in the extension: one weak signal alone can't make a site "trustworthy".
  if (goods < 2 && signals.every((s) => s.points >= 0)) total = Math.min(total, 74);
  return { score: Math.max(0, Math.min(100, total)), signals };
}

