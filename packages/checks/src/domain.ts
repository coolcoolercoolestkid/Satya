/** Domain helpers: normalising hostnames and comparing them for lookalikes. */

// Common two-part public suffixes. Not exhaustive; good enough for the brands we check.
const MULTI_PART_SUFFIXES = new Set([
  "co.in", "org.in", "net.in", "gov.in", "ac.in", "edu.in", "firm.in", "gen.in", "ind.in",
  "co.uk", "org.uk", "ac.uk", "gov.uk",
  "com.au", "net.au", "org.au",
  "com.br", "com.sg", "com.my", "co.jp", "co.kr", "com.cn", "com.hk", "co.za",
]);

/** Lowercase hostname without a leading "www." and without a trailing dot. */
export function normalizeHost(input: string): string {
  let host = input.trim().toLowerCase();
  try {
    if (host.includes("://")) host = new URL(host).hostname;
  } catch {
    /* fall through with the raw input */
  }
  host = host.replace(/\.$/, "");
  return host.startsWith("www.") ? host.slice(4) : host;
}

/** "app.uniswap.org" -> "uniswap.org", "x.sbi.co.in" -> "sbi.co.in". */
export function registrableDomain(host: string): string {
  const labels = normalizeHost(host).split(".");
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  if (MULTI_PART_SUFFIXES.has(lastTwo)) return labels.slice(-3).join(".");
  return lastTwo;
}

/** The name part of a registrable domain: "uniswap.org" -> "uniswap". */
export function domainLabel(host: string): string {
  return registrableDomain(host).split(".")[0] ?? "";
}

/** True if `host` is `domain` or a subdomain of it. */
export function isSameOrSubdomain(host: string, domain: string): boolean {
  const h = normalizeHost(host);
  const d = normalizeHost(domain);
  return h === d || h.endsWith(`.${d}`);
}

/** Classic edit distance. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(
        prev[j]! + 1,
        prev[j - 1]! + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

/**
 * Maps characters scammers swap in ("0" for "o", "rn" for "m", Cyrillic "а" for "a")
 * to one canonical form, so "unlswap" and "uniswap" compare as equal.
 */
export function skeleton(label: string): string {
  const confusables: Record<string, string> = {
    "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g",
    i: "l", "|": "l",
    // Cyrillic and Greek lookalikes
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "х": "x", "у": "y", "к": "k",
    "і": "l", "ј": "j", "ѕ": "s", "ԁ": "d", "ɡ": "g", "α": "a", "ο": "o", "ν": "v",
  };
  return label
    .toLowerCase()
    .replace(/rn/g, "m")
    .replace(/vv/g, "w")
    .replace(/cl/g, "d")
    .split("")
    .map((c) => confusables[c] ?? c)
    .join("")
    .replace(/-/g, "");
}

/** Punycode hosts (xn--) often hide non-Latin lookalike letters. */
export function isPunycode(host: string): boolean {
  return normalizeHost(host).split(".").some((l) => l.startsWith("xn--"));
}
