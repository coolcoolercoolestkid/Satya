import type { PageSignals, PageSnapshot } from "./types.js";

/**
 * Kinds of sensitive input, matched against everything that describes a field
 * (name, id, placeholder, aria-label, autocomplete, label text). Shared by the
 * extension's content script and the server-side HTML reader.
 */
export const FIELD_KINDS: [string, RegExp][] = [
  ["otp", /\botp\b|one[- ]?time|verification code|one-time-code/],
  ["cvv", /\bcvv\b|\bcvc\b|security code|cc-csc/],
  ["card", /card ?(number|no)|cc-number|debit card|credit card/],
  ["upi-pin", /upi ?pin|\bmpin\b/],
  ["aadhaar", /aadha?ar/],
  ["pan", /\bpan\b ?(no|number|card)?/],
  ["seed-phrase", /seed|mnemonic|recovery phrase|secret phrase|secret recovery/],
  ["private-key", /private ?key/],
];

/** Inline code that decodes and runs hidden code, or carries huge encoded blobs. */
export function isObfuscatedScript(code: string): boolean {
  if (/\beval\s*\(\s*(atob|unescape|decodeURIComponent|String\.fromCharCode)\s*\(/.test(code)) return true;
  if (/eval\(function\(p,a,c,k,e,[dr]\)/.test(code)) return true; // "packed" code
  if (/document\.write\s*\(\s*(unescape|atob)\s*\(/.test(code)) return true;
  return /[A-Za-z0-9+/=]{4000,}/.test(code) && /\b(eval|Function|atob)\b/.test(code);
}

export const INSTALLER_LINK = /\.(apk|exe|msi|scr|bat|cmd|jar|dmg|pkg|vbs|ps1)(\?|#|$)/i;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", rupee: "₹" };
const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z0-9#]+);/gi, (m, e) => ENTITIES[e.toLowerCase()] ?? m);

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    out[m[1]!.toLowerCase()] = decode(m[3] ?? m[4] ?? m[5] ?? "");
  }
  return out;
}

const resolve = (href: string, base: string) => {
  try {
    return new URL(href, base);
  } catch {
    return undefined;
  }
};

const TEXT_INPUT = (a: Record<string, string>) => !a.type || ["text", "password"].includes(a.type.toLowerCase());

/**
 * Builds a page snapshot from raw HTML, without a browser. Used by the MCP server so AI
 * agents can check a link before opening it. Pages that draw everything with JavaScript
 * will show little text this way; the extension sees the rendered page instead.
 */
export function snapshotFromHtml(html: string, url: string, maxText = 20000): PageSnapshot {
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const body = html.replace(/<!--[\s\S]*?-->/g, " ");

  const labels = new Map<string, string>();
  for (const m of body.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/gi)) {
    const forId = attrs(m[1]!).for;
    if (forId) labels.set(forId, decode(m[2]!.replace(/<[^>]+>/g, " ")));
  }

  const sensitive = new Set<string>();
  let hasPassword = false;
  for (const m of body.matchAll(/<(input|textarea)\b([^>]*)>/gi)) {
    const a = attrs(m[2]!);
    const type = (a.type ?? "").toLowerCase();
    if (["hidden", "submit", "button", "checkbox", "radio"].includes(type)) continue;
    if (type === "password") hasPassword = true;
    const d = [a.name, a.id, a.placeholder, a["aria-label"], a.autocomplete, a.id ? labels.get(a.id) : ""]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    for (const [kind, re] of FIELD_KINDS) if (re.test(d)) sensitive.add(kind);
  }

  const forms: PageSignals["forms"] = [];
  let maxInputs = 0;
  let inFormInputs = 0;
  for (const m of body.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const action = attrs(m[1]!).action;
    forms.push({
      actionHost: action ? resolve(action, url)?.hostname ?? null : null,
      hasPassword: /type\s*=\s*["']?password/i.test(m[2]!),
    });
    const n = [...m[2]!.matchAll(/<input\b([^>]*)>/gi)].filter((i) => TEXT_INPUT(attrs(i[1]!))).length;
    inFormInputs += n;
    maxInputs = Math.max(maxInputs, n);
  }
  const allTextInputs = [...body.matchAll(/<input\b([^>]*)>/gi)].filter((i) => TEXT_INPUT(attrs(i[1]!))).length;
  maxInputs = Math.max(maxInputs, allTextInputs - inFormInputs);

  const downloadLinks = [...body.matchAll(/<a\b([^>]*)>/gi)]
    .map((m) => attrs(m[1]!).href)
    .filter((h): h is string => !!h)
    .map((h) => resolve(h, url)?.href ?? h)
    .filter((h) => INSTALLER_LINK.test(h))
    .slice(0, 20);

  const scriptHosts = [
    ...new Set(
      [...body.matchAll(/<script\b([^>]*)>/gi)]
        .map((m) => attrs(m[1]!).src)
        .filter((s): s is string => !!s)
        .map((s) => resolve(s, url)?.hostname ?? ""),
    ),
  ].filter(Boolean);

  const text = decode(
    body
      .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim()
    .slice(0, maxText);

  const hiddenFrameHosts: string[] = [];
  for (const m of body.matchAll(/<iframe\b([^>]*)>/gi)) {
    const a = attrs(m[1]!);
    const tiny = (a.width === "0" || a.width === "1") && (a.height === "0" || a.height === "1");
    const hiddenStyle = /display\s*:\s*none|visibility\s*:\s*hidden/i.test(a.style ?? "");
    if ((tiny || hiddenStyle || "hidden" in a) && a.src) {
      const h = resolve(a.src, url)?.hostname;
      if (h) hiddenFrameHosts.push(h);
    }
  }
  let obfuscatedScripts = 0;
  for (const m of body.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (isObfuscatedScript(m[1]!)) obfuscatedScripts++;
  }
  const refresh = /<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/i.exec(body)?.[0];
  const metaRefresh = refresh ? /url\s*=\s*['"]?([^'">\s]+)/i.exec(attrs(refresh).content ?? "")?.[1] ?? null : null;
  const pageIsHttps = resolve(url, url)?.protocol === "https:";
  const mixedContent = pageIsHttps
    ? [...body.matchAll(/<(img|script|iframe)\b([^>]*)>/gi)].filter((m) => /^http:\/\//i.test(attrs(m[2]!).src ?? "")).length
    : 0;

  return {
    url,
    title,
    text,
    hasPasswordField: hasPassword,
    signals: {
      protocol: resolve(url, url)?.protocol ?? "https:",
      forms,
      sensitiveFields: [...sensitive],
      maxInputsInOneForm: maxInputs,
      downloadLinks,
      scriptHosts,
      hiddenFrameHosts,
      obfuscatedScripts,
      metaRefresh,
      mixedContent,
    },
  };
}
