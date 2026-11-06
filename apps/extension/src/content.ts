import { FIELD_KINDS, INSTALLER_LINK } from "@satya/checks/src/html.js";
import type { Severity } from "@satya/checks";
import { MAX_TEXT, type ContentRequest } from "./messages";

const ATTR = "data-satya";
const COLORS: Record<Severity, string> = {
  danger: "#dc2626",
  warning: "#d97706",
  info: "#2563eb",
  good: "#16a34a",
};

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Describes an input using everything that hints at what it's for. */
function describeInput(el: HTMLInputElement | HTMLTextAreaElement): string {
  const label = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent ?? "" : "";
  return [el.name, el.id, el.getAttribute("placeholder"), el.getAttribute("aria-label"), el.getAttribute("autocomplete"), label]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function signals() {
  const inputs = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].filter(
    (el) => !["hidden", "submit", "button", "checkbox", "radio"].includes((el as HTMLInputElement).type),
  );
  const sensitive = new Set<string>();
  for (const el of inputs) {
    const d = describeInput(el);
    for (const [kind, re] of FIELD_KINDS) if (re.test(d)) sensitive.add(kind);
  }
  const forms = [...document.forms].map((f) => {
    let actionHost: string | null = null;
    try {
      actionHost = f.getAttribute("action") ? new URL(f.action, location.href).hostname : null;
    } catch {
      /* ignore */
    }
    return { actionHost, hasPassword: !!f.querySelector('input[type="password"]') };
  });
  const textInputs = (root: ParentNode) =>
    root.querySelectorAll('input[type="text"], input[type="password"], input:not([type])').length;
  const looseInputs = [...document.querySelectorAll('input[type="text"], input[type="password"], input:not([type])')].filter(
    (el) => !(el as HTMLInputElement).form,
  ).length;
  const downloadLinks = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")]
    .map((a) => a.href)
    .filter((h) => INSTALLER_LINK.test(h))
    .slice(0, 20);
  const scriptHosts = [
    ...new Set(
      [...document.querySelectorAll<HTMLScriptElement>("script[src]")].map((s) => {
        try {
          return new URL(s.src).hostname;
        } catch {
          return "";
        }
      }),
    ),
  ].filter(Boolean);
  return {
    protocol: location.protocol,
    forms,
    sensitiveFields: [...sensitive],
    maxInputsInOneForm: Math.max(looseInputs, ...[...document.forms].map(textInputs), 0),
    downloadLinks,
    scriptHosts,
  };
}

/** Paragraph text from the page's main content, skipping menus, headers and footers. */
function mainText(): string {
  const root = document.querySelector("main, article, [role=main]") ?? document.body;
  if (!root) return "";
  const parts: string[] = [];
  for (const el of root.querySelectorAll<HTMLElement>("p, li, blockquote, h1, h2, h3, td")) {
    if (el.closest("nav, header, footer, aside, script, style, noscript, [aria-hidden=true]")) continue;
    const t = el.innerText?.replace(/\s+/g, " ").trim() ?? "";
    if (t.length >= 40 && !parts.includes(t)) parts.push(t);
  }
  return parts.join("\n").slice(0, 20000);
}

/** The larger images actually shown on the page (icons and tracking pixels skipped). */
function images(): string[] {
  const out = new Set<string>();
  for (const img of document.images) {
    const src = img.currentSrc || img.src;
    if (!/^https?:/.test(src) || img.naturalWidth < 150 || img.naturalHeight < 150) continue;
    out.add(src);
    if (out.size >= 8) break;
  }
  return [...out];
}

function snapshot() {
  const text = (document.body?.innerText ?? "").slice(0, MAX_TEXT);
  return {
    url: location.href,
    title: document.title,
    text,
    hasPasswordField: !!document.querySelector('input[type="password"]'),
    signals: signals(),
    mainText: mainText(),
    images: images(),
  };
}

/** Short pieces of the evidence sentence to look for in the page's text nodes. */
function probes(evidence: string): string[] {
  const e = norm(evidence);
  const out = [e];
  if (e.length > 40) out.push(e.slice(0, 40), e.slice(-40), e.slice(Math.floor(e.length / 2) - 20, Math.floor(e.length / 2) + 20));
  return out.filter((p) => p.length >= 6);
}

function findElement(evidence: string): HTMLElement | null {
  const ps = probes(evidence);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let fallback: HTMLElement | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || parent.closest("script,style,noscript")) continue;
    const t = norm(node.textContent ?? "");
    if (!t) continue;
    if (t.includes(ps[0]!)) return parent;
    if (!fallback && ps.slice(1).some((p) => t.includes(p))) fallback = parent;
  }
  return fallback;
}

function clearHighlights() {
  document.querySelectorAll<HTMLElement>(`[${ATTR}]`).forEach((el) => {
    el.style.outline = el.dataset.satyaOutline ?? "";
    el.style.backgroundColor = el.dataset.satyaBg ?? "";
    el.removeAttribute(ATTR);
    if (el.dataset.satyaTitle !== undefined) el.title = el.dataset.satyaTitle;
  });
}

function highlight(items: { evidence: string; severity: Severity; title: string }[]) {
  clearHighlights();
  for (const item of items) {
    const el = findElement(item.evidence);
    if (!el || el === document.body) continue;
    el.dataset.satyaOutline = el.style.outline;
    el.dataset.satyaBg = el.style.backgroundColor;
    el.dataset.satyaTitle = el.title;
    el.setAttribute(ATTR, item.severity);
    el.style.outline = `2px solid ${COLORS[item.severity]}`;
    el.style.backgroundColor = `${COLORS[item.severity]}22`;
    el.title = `Satya: ${item.title}`;
  }
}

chrome.runtime.onMessage.addListener((msg: ContentRequest, _sender, sendResponse) => {
  switch (msg.type) {
    case "snapshot":
      sendResponse(snapshot());
      break;
    case "highlight":
      highlight(msg.items);
      sendResponse(true);
      break;
    case "scrollTo": {
      const el = findElement(msg.evidence);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      sendResponse(!!el);
      break;
    }
    case "clearHighlights":
      clearHighlights();
      sendResponse(true);
      break;
  }
  return false;
});
