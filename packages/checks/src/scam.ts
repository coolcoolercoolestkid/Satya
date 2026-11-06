import type { Finding, PageSnapshot, Severity } from "./types.js";

interface ScamRule {
  id: string;
  title: string;
  detail: string;
  pattern: RegExp;
  severity: Severity;
  weight: number;
}

/**
 * Plain-language rules for the promises and requests scams rely on. They run offline,
 * so nothing about the page leaves the browser.
 */
export const SCAM_RULES: ScamRule[] = [
  {
    id: "seed-phrase",
    title: "Asks for your seed phrase or private key",
    detail: "No real wallet, exchange or support team ever asks for these.",
    pattern:
      /\b(enter|provide|share|type|submit|verify|import|paste|sync)\s+(your\s+)?(wallet'?s?\s+)?(seed|recovery|secret|mnemonic)\s*(phrase|words?)\b|\b(12|24)[- ]word (phrase|recovery)|\b(enter|provide|share|paste)\s+(your\s+)?private key\b/i,
    severity: "danger",
    weight: 50,
  },
  {
    id: "guaranteed-returns",
    title: "Promises guaranteed returns",
    detail: "Real investments can't guarantee profit. SEBI and RBI warn about this promise.",
    pattern: /\bguarant(?:ee|eed|eeing)\s+(?:\w+\s+){0,3}(returns?|profits?|income|earnings?)\b/i,
    severity: "danger",
    weight: 35,
  },
  {
    id: "fixed-daily-returns",
    title: "Promises fixed daily or weekly returns",
    detail: "Fixed high returns per day or week are the hallmark of Ponzi schemes.",
    pattern:
      /\b\d+(?:\.\d+)?\s?%\s*(?:\w+\s+){0,2}(daily|per day|a day|every day|weekly|per week|a week)\b|\b(daily|weekly)\s+(returns?|profits?|roi|income)\s+of\s+\d+(?:\.\d+)?\s?%/i,
    severity: "danger",
    weight: 35,
  },
  {
    id: "multiply-money",
    title: "Promises to multiply your money",
    detail: "Offers to double or triple money are almost always scams.",
    pattern: /\b(double|triple|2x|3x|5x|10x|100x)\s+(your\s+)?(money|investment|crypto|funds|bitcoin|btc|eth|deposit)\b/i,
    severity: "danger",
    weight: 35,
  },
  {
    id: "send-to-receive",
    title: "Asks you to send crypto to receive more back",
    detail: "\"Send 1, get 2\" giveaways are a classic scam.",
    pattern: /\bsend\s+(?:\w+\s+){0,3}(and|to)\s+(get|receive)\s+(?:\w+\s+){0,2}(back|double|2x)\b/i,
    severity: "danger",
    weight: 40,
  },
  {
    id: "risk-free",
    title: "Claims to be risk-free",
    detail: "Every investment carries risk.",
    pattern: /\b(risk[- ]free|zero[- ]risk|no[- ]risk)\s+(investment|trading|returns?|profits?|income)\b/i,
    severity: "warning",
    weight: 20,
  },
  {
    id: "fee-to-withdraw",
    title: "Charges a fee before you can withdraw or get paid",
    detail: "Advance fees to release money or start a job are a common fraud in India.",
    pattern: /\b(pay|deposit)\s+(?:an?\s+|the\s+)?(registration|processing|activation|withdrawal|unlock|tax|clearance)\s+(fee|charge|amount)\b/i,
    severity: "danger",
    weight: 30,
  },
  {
    id: "task-job",
    title: "Looks like a \"task job\" scam",
    detail: "Paid likes, reviews or part-time tasks that later ask for deposits are a major scam in India.",
    pattern: /\b(part[- ]time|work from home|online)\s+(job|task|work)s?\b.{0,80}(\b(earn|income)\s*(₹|rs\.?|inr)?\s?\d|(₹|\brs\.?\s?|\binr\s?)\d)/i,
    severity: "warning",
    weight: 20,
  },
  {
    id: "vip-signals",
    title: "Sells \"VIP\" trading tips",
    detail: "Paid Telegram or WhatsApp tip groups are a frequent source of pump-and-dump scams.",
    pattern: /\b(vip|premium|paid)\s+(trading\s+)?(signals?|tips?|calls?|group)\b/i,
    severity: "warning",
    weight: 15,
  },
  {
    id: "urgency",
    title: "Pressures you to act fast",
    detail: "Countdowns and \"only a few spots left\" push you to skip checking.",
    pattern: /\b(only|just)\s+\d+\s+(minutes?|hours?|spots?|slots?|seats?)\s+(left|remaining)\b|\bact (now|fast|immediately)\b|\boffer (ends|expires) in\s+\d+/i,
    severity: "info",
    weight: 10,
  },
  {
    id: "airdrop-claim",
    title: "Asks you to claim a free airdrop",
    detail: "Fake airdrop pages are the most common way wallets get drained.",
    pattern: /\bclaim\s+(your\s+)?(free\s+)?(airdrop|tokens?|rewards?|nft)\b/i,
    severity: "warning",
    weight: 15,
  },
  {
    id: "tech-support",
    title: "Fake virus or security alert",
    detail: "Real browsers and Microsoft never show pop-ups asking you to call a number.",
    pattern: /\b(your (computer|pc|device|phone) (is|has been) (infected|hacked|blocked|locked)|virus (detected|alert)|call (microsoft|windows|apple) support|do not (close|restart) (this|your) (window|computer|pc))\b/i,
    severity: "danger",
    weight: 40,
  },
  {
    id: "kyc-threat",
    title: "Threatens to block your account unless you update KYC",
    detail: "Banks, Paytm and telecoms don't block accounts through links. This is a common Indian SMS scam.",
    pattern: /\b(kyc|pan|aadhaar)\b.{0,40}\b(expired|pending|suspended|blocked|update (now|immediately|today))\b|\b(account|sim|wallet)\s+(will be|has been)\s+(blocked|suspended|deactivated)\b/i,
    severity: "danger",
    weight: 35,
  },
  {
    id: "utility-cutoff",
    title: "Threatens to cut your electricity or gas tonight",
    detail: "Power companies don't disconnect over a phone call or link. A well-known scam in India.",
    pattern: /\b(electricity|power|gas)\s+(connection|supply)?\s*(will be|to be)\s+(disconnected|cut)\b/i,
    severity: "danger",
    weight: 35,
  },
  {
    id: "digital-arrest",
    title: "Mentions a \"digital arrest\" or parcel held by customs or police",
    detail: "Indian police and CBI never arrest anyone over video call or ask for money to clear a case.",
    pattern: /\bdigital arrest\b|\b(parcel|package|courier)\b.{0,60}\b(seized|held|illegal|drugs|customs)\b|\b(cbi|police|narcotics|ed)\s+(case|officer|notice)\b.{0,60}\b(pay|transfer|verify)\b/i,
    severity: "danger",
    weight: 40,
  },
  {
    id: "too-good-discount",
    title: "Unrealistic discount",
    detail: "Discounts of 80-95% on branded goods are a hallmark of fake shopping sites.",
    pattern: /\b(8\d|9\d)\s?%\s*off\b|\b(flat|upto|up to)\s+(8\d|9\d)\s?%\s*(off|discount)\b/i,
    severity: "warning",
    weight: 20,
  },
  {
    id: "personal-upi",
    title: "Asks you to pay to a personal UPI ID",
    detail: "Real shops use a payment gateway, not \"send money to this UPI ID\".",
    pattern: /\b(pay|send|transfer)\b.{0,40}\b[\w.-]{3,}@(ybl|okaxis|oksbi|okhdfcbank|okicici|paytm|upi|apl|ibl|axl)\b/i,
    severity: "warning",
    weight: 20,
  },
  {
    id: "lottery",
    title: "Says you've won a prize or lottery",
    detail: "You can't win a lottery you never entered. These ask for a \"processing fee\" next.",
    pattern: /\b(you('ve| have)? won|congratulations[!,]? you|lucky (draw|winner))\b.{0,60}\b(prize|lottery|lakh|crore|iphone|reward|cash)\b/i,
    severity: "danger",
    weight: 30,
  },
];

/** Cuts the sentence around a match so the user sees it in context. */
function sentenceAround(text: string, index: number, length: number): string {
  const start = Math.max(
    text.lastIndexOf(".", index) + 1,
    text.lastIndexOf("\n", index) + 1,
    index - 120,
  );
  let end = text.length;
  for (const stop of [".", "!", "?", "\n"]) {
    const i = text.indexOf(stop, index + length);
    if (i !== -1 && i < end) end = i + 1;
  }
  end = Math.min(end, index + length + 120);
  return text.slice(start, end).trim();
}

export function checkScamText(page: PageSnapshot): Finding[] {
  const findings: Finding[] = [];
  const text = `${page.title}\n${page.text}`;
  for (const rule of SCAM_RULES) {
    const match = rule.pattern.exec(text);
    if (!match) continue;
    findings.push({
      check: "scam",
      severity: rule.severity,
      title: rule.title,
      detail: rule.detail,
      source: `Satya scam rule: ${rule.id}`,
      evidence: sentenceAround(text, match.index, match[0].length),
      weight: rule.weight,
    });
  }
  return findings;
}

/**
 * Names of entities on a published list (e.g. the RBI Alert List) mentioned on the page,
 * matched as whole words.
 */
export function checkNamedEntities(
  page: PageSnapshot,
  names: string[],
  source: string,
): Finding[] {
  const haystack = `${page.title}\n${page.text}`;
  const findings: Finding[] = [];
  for (const name of names) {
    if (name.trim().length < 4) continue;
    const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "i");
    const m = re.exec(haystack);
    if (m) {
      findings.push({
        check: "scam",
        severity: "danger",
        title: `Mentions "${name}", which is on ${source}`,
        detail: "This platform has been publicly flagged as not authorised to offer these services in India.",
        source,
        evidence: sentenceAround(haystack, m.index, m[0].length),
        weight: 45,
      });
      if (findings.length >= 3) break;
    }
  }
  return findings;
}
