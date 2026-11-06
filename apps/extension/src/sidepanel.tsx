import { analyzePage, buildEvidence, credentialFindings, metadataFindings, scoreFindings, type CredibilityResult, type Finding } from "@satya/checks";
import { checkIdentity, defaultIdentityDeps, ensNamesOnPage } from "@satya/identity";
import { checkRegistry, type RegistryResult } from "@satya/registry";
import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { checkImageCredentials, type ImageCheck } from "./c2pa";
import { BUNDLED_TO_REGISTRY, cachedBucket, loadContext } from "./data";
import type { ContentRequest, SnapshotResponse } from "./messages";

declare const __ARKIV_ACCESS_KEY__: string;
declare const __SATYA_WEB_URL__: string;
declare const __BUILD_TIME__: string;

const identityDeps = defaultIdentityDeps(__ARKIV_ACCESS_KEY__);
const EXPLORER = "https://rabdi.explorer.arkiv.network";

const STAMP: Record<CredibilityResult["level"], string> = {
  trustworthy: "Verified",
  unverified: "No red flags",
  careful: "Caution",
  "high-risk": "Flagged",
};
const MEANING: Record<CredibilityResult["level"], string> = {
  trustworthy: "Independent evidence vouches for this site.",
  unverified: "Nothing wrong found, but nothing vouches for it yet.",
  careful: "Warning signs. Don't enter passwords, OTPs or card details.",
  "high-risk": "Likely a scam. Don't pay, log in or type anything here.",
};

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToTab<T>(tabId: number, msg: ContentRequest): Promise<T | undefined> {
  try {
    return (await chrome.tabs.sendMessage(tabId, msg)) as T;
  } catch {
    return undefined;
  }
}

interface Done {
  status: "done";
  host: string;
  result: CredibilityResult;
  tabId: number;
  windowId: number;
  deep: boolean;
  ensNames: number;
  page: SnapshotResponse;
  registry: RegistryResult;
  images?: ImageCheck;
}
type State = { status: "loading" } | { status: "unsupported"; url?: string } | Done;

const short = (h: string, n = 4) => (h.length > 2 * n + 2 ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : h);
/** The source without the long "mirrored on Arkiv…" tail: the pointer stays short. */
const shortSource = (s: string) => s.replace(/, mirrored on Arkiv.*$/, " · Arkiv").replace(/^Satya /, "");

function Pointer({ f, tabId }: { f: Finding; tabId: number }) {
  const sign = f.severity === "good" ? "+" : "−";
  return (
    <li className={`ptr ${f.severity}`} title={f.detail}>
      <span className="ptr-dot" aria-hidden />
      <div className="ptr-body">
        <span className="ptr-title">{f.title}</span>
        {f.evidence && f.check !== "phishing" && (
          <button className="ptr-quote" onClick={() => sendToTab(tabId, { type: "scrollTo", evidence: f.evidence! })} title="Show on the page">
            “{f.evidence.length > 70 ? `${f.evidence.slice(0, 70)}…` : f.evidence}”
          </button>
        )}
        <span className="ptr-src">{shortSource(f.source)}</span>
      </div>
      {f.weight > 0 && f.check !== "ai" && f.check !== "identity" && (
        <span className={`ptr-pts ${f.severity}`}>{sign}{f.weight}</span>
      )}
    </li>
  );
}

function Section({ title, items, tabId }: { title: string; items: Finding[]; tabId: number }) {
  if (!items.length) return null;
  return (
    <section className="sec">
      <div className="eyebrow">{title}</div>
      <ul>{items.map((f, i) => <Pointer key={i} f={f} tabId={tabId} />)}</ul>
    </section>
  );
}

/** Collapsed by default: what was hashed, what Arkiv was asked, which records answered. */
function HowChecked({ s, notes }: { s: Done; notes: Finding[] }) {
  return (
    <details className="how">
      <summary>How this was checked</summary>
      {s.registry.reachable ? (
        s.registry.lookups.map((l) => (
          <div key={l.kind + l.value} className="how-block">
            <div className="mono">sha256({l.value}) → bucket {l.bucket}</div>
            <div className="how-note">Only “{l.bucket}” was sent to Arkiv; matching ran on this computer.</div>
            {l.records.map((r) => (
              <div key={r.key} className={`rec ${r.matched ? "hit" : ""}`}>
                <b>{r.matched ? "MATCH" : "clear"}</b> {r.label} · {r.entries.toLocaleString()} entries · {r.date} ·{" "}
                <a href={`${EXPLORER}/entity/${r.key}`} target="_blank" rel="noreferrer">{short(r.key)} ↗</a>
              </div>
            ))}
          </div>
        ))
      ) : (
        <div className="how-note">Arkiv unreachable: used the lists bundled with Satya.</div>
      )}
      {s.deep && s.images && (
        <div className="how-note">
          Images: {s.images.found} found, {s.images.checked} read, {s.images.creds.length} with Content Credentials.
          {s.images.errors.map((e) => <div key={e} className="err">⚠ {e}</div>)}
        </div>
      )}
      {notes.map((f, i) => (
        <div key={i} className="how-note">· {f.title}</div>
      ))}
      <div className="how-note">Score = 50 + trust − risk. On a scam list: at most 5. Impersonating a brand: at most 15.</div>
    </details>
  );
}

function Actions({ s, onDeep }: { s: Done; onDeep: () => void }) {
  const [saved, setSaved] = useState<string>();
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const screenshot = await chrome.tabs.captureVisibleTab(s.windowId, { format: "png" }).catch(() => null);
      const ev = await buildEvidence({
        url: s.page.url,
        title: s.page.title,
        text: s.page.text,
        screenshot,
        score: s.result.score,
        label: s.result.label,
        findings: s.result.findings.filter((f) => f.severity === "danger" || f.severity === "warning").map((f) => f.title),
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(ev, null, 1)], { type: "application/json" }));
      a.download = `satya-evidence-${s.host}-${ev.header.capturedAt.slice(0, 19).replace(/[:T]/g, "-")}.json`;
      a.click();
      setSaved(ev.fingerprint);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="actions">
      <div className="row">
        {!s.deep && (
          <button
            className="btn"
            onClick={onDeep}
            title={`Sends the domain to its registry (age), Cert Spotter (certificates) and the Internet Archive (history), and re-reads page images for Content Credentials${s.ensNames ? ", plus ENS names to Ethereum/Arkiv" : ""}.`}
          >
            Deeper check
          </button>
        )}
        <button className="btn ghost" onClick={() => void save()} disabled={busy} title="Save the page text, a screenshot and this receipt to a file; anchor only its fingerprint on Arkiv.">
          {busy ? "Saving…" : "Save evidence"}
        </button>
      </div>
      {!s.deep && <div className="hint">Deeper check adds age, certificate, history and image checks. Off by default for privacy.</div>}
      {saved && (
        <div className="hint">
          Saved · <span className="mono">{saved.slice(0, 12)}…</span>{" "}
          <a href={`${__SATYA_WEB_URL__}/#evidence=${saved}`} target="_blank" rel="noreferrer">anchor on Arkiv →</a>
        </div>
      )}
    </section>
  );
}

function Receipt({ s, onDeep }: { s: Done; onDeep: () => void }) {
  const { result } = s;
  const wrong = result.findings.filter((f) => f.check !== "ai" && f.check !== "identity" && (f.severity === "danger" || f.severity === "warning"));
  const vouches = result.findings.filter((f) => f.check !== "ai" && f.check !== "identity" && f.severity === "good");
  const ai = result.findings.filter((f) => f.check === "ai" && !f.title.startsWith("Checked "));
  const people = result.findings.filter((f) => f.check === "identity" && f.severity !== "info");
  const notes = result.findings.filter((f) => f.check !== "ai" && f.check !== "identity" && f.severity === "info");
  return (
    <>
      <article className="receipt">
        <div className="site">{s.host}</div>
        <div className="verdict">
          <div className={`seal ${result.level}`}>
            <div>
              <div className="seal-score">{result.score}</div>
              <div className="seal-of">/ 100</div>
            </div>
          </div>
          <div>
            <span className={`stamp ${result.level}`}>{STAMP[result.level]}</span>
            <p className="meaning">{MEANING[result.level]}</p>
          </div>
        </div>
        <Section title={wrong.length ? `What's wrong (${wrong.length})` : "What's wrong"} items={wrong} tabId={s.tabId} />
        {!wrong.length && <p className="none">Nothing wrong found on this page.</p>}
        <Section title="What vouches for it" items={vouches} tabId={s.tabId} />
        <Section title="People on this page" items={people} tabId={s.tabId} />
        <Section title="AI content · not scored" items={ai} tabId={s.tabId} />
        <HowChecked s={s} notes={notes} />
      </article>
      <Actions s={s} onDeep={onDeep} />
    </>
  );
}

function App() {
  const [state, setState] = useState<State>({ status: "loading" });

  const run = useCallback(async (deep = false) => {
    setState({ status: "loading" });
    const tab = await activeTab();
    if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
      setState({ status: "unsupported", url: tab?.url });
      return;
    }
    const page = await sendToTab<SnapshotResponse>(tab.id, { type: "snapshot" });
    if (!page) {
      setState({ status: "unsupported", url: tab.url });
      return;
    }
    // Default check: the only network request is one Arkiv bucket id (often answered from cache).
    const [ctx, registry] = await Promise.all([loadContext(), checkRegistry(page, cachedBucket)]);
    // Lists the Arkiv registry answered for are not checked again from the bundled copy.
    const covered = new Set([...registry.covered.domain, ...registry.covered.address]);
    const localCtx = {
      ...ctx,
      phishing: { ...ctx.phishing, lists: ctx.phishing.lists.filter((l) => !covered.has(BUNDLED_TO_REGISTRY[l.source] ?? "")) },
      addressLists: registry.covered.address.includes("*")
        ? []
        : (ctx.addressLists ?? []).filter((l) => !covered.has(BUNDLED_TO_REGISTRY[l.source] ?? "")),
    };
    const [base, identity, images] = await Promise.all([
      analyzePage(page, { ...localCtx, network: deep }),
      deep ? checkIdentity(page, identityDeps).catch(() => [] as Finding[]) : Promise.resolve([] as Finding[]),
      deep
        ? checkImageCredentials(page.images ?? []).catch((e): ImageCheck => ({ creds: [], found: 0, checked: 0, errors: [String(e)], metadata: [] }))
        : Promise.resolve(undefined),
    ]);
    const imageFindings = images
      ? [...credentialFindings(images.creds, images.checked), ...metadataFindings(images.metadata.filter((m) => !images.creds.some((c) => c.url === m.url)))]
      : [];
    const result = scoreFindings([...base.findings, ...registry.findings, ...identity, ...imageFindings]);
    setState({
      status: "done",
      host: new URL(page.url).hostname,
      result,
      tabId: tab.id,
      windowId: tab.windowId,
      deep,
      ensNames: ensNamesOnPage(page).length,
      page,
      registry,
      images,
    });
    await sendToTab(tab.id, {
      type: "highlight",
      items: result.findings
        .filter((f) => f.evidence && f.check !== "phishing" && (f.severity === "danger" || f.severity === "warning"))
        .map((f) => ({ evidence: f.evidence!, severity: f.severity, title: f.title })),
    });
  }, []);

  useEffect(() => {
    void run(false);
    const onActivated = () => void run(false);
    const onUpdated = (_id: number, info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (info.status === "complete" && tab.active) void run(false);
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [run]);

  return (
    <main>
      <header className="top">
        <div className="brand">Satya <span className="brand-hi">सत्य</span></div>
        <button className="icon" onClick={() => void run(false)} aria-label="Re-check this page" title="Re-check">↻</button>
      </header>
      {state.status === "loading" && <div className="receipt loading"><div className="eyebrow">Checking…</div></div>}
      {state.status === "unsupported" && (
        <div className="receipt"><p className="none">Open a website to check it. If you just reloaded Satya, reload the page too.</p></div>
      )}
      {state.status === "done" && <Receipt s={state} onDeep={() => void run(true)} />}
      <footer className="build">build {__BUILD_TIME__}</footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
