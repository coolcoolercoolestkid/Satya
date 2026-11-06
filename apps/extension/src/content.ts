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

function snapshot() {
  const text = (document.body?.innerText ?? "").slice(0, MAX_TEXT);
  return {
    url: location.href,
    title: document.title,
    text,
    hasPasswordField: !!document.querySelector('input[type="password"]'),
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
