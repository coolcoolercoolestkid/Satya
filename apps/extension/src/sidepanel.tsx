import { analyzePage, scoreFindings, type CredibilityResult, type Finding } from "@satya/checks";
import { checkIdentity, defaultIdentityDeps } from "@satya/identity";

declare const __ARKIV_ACCESS_KEY__: string;
const identityDeps = defaultIdentityDeps(__ARKIV_ACCESS_KEY__);
import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { detectorFor, getSettings, loadContext, saveSettings, type Settings } from "./data";
import type { ContentRequest, SnapshotResponse } from "./messages";

const ICON: Record<Finding["severity"], string> = { danger: "✕", warning: "!", info: "i", good: "✓" };
const CHECK_NAMES: Record<Finding["check"], string> = {
  phishing: "Is this site real?",
  page: "What is it asking for?",
  records: "Past records",
  scam: "What is it saying?",
  ai: "Possibly AI",
  identity: "Who is this?",
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

type State =
  | { status: "loading" }
  | { status: "unsupported"; url?: string }
  | { status: "done"; host: string; result: CredibilityResult; tabId: number };

function ScoreRing({ score, level }: { score: number; level: CredibilityResult["level"] }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <svg className={`ring ${level}`} width="88" height="88" viewBox="0 0 88 88" aria-label={`Score ${score} out of 100`}>
      <circle cx="44" cy="44" r={r} className="ring-bg" />
      <circle cx="44" cy="44" r={r} className="ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
      <text x="44" y="50" textAnchor="middle" className="ring-text">{score}</text>
    </svg>
  );
}

function FindingRow({ f, tabId }: { f: Finding; tabId: number }) {
  return (
    <li className={`finding ${f.severity}`}>
      <span className="badge" aria-hidden>{ICON[f.severity]}</span>
      <div className="body">
        <div className="title">{f.title}</div>
        {f.detail && <div className="detail">{f.detail}</div>}
        {f.evidence && (
          <button className="evidence" onClick={() => sendToTab(tabId, { type: "scrollTo", evidence: f.evidence! })}>
            “{f.evidence.length > 140 ? `${f.evidence.slice(0, 140)}…` : f.evidence}”
          </button>
        )}
        <div className="source">Source: {f.source}</div>
      </div>
    </li>
  );
}

function SettingsPanel({ onSaved }: { onSaved: () => void }) {
  const [s, setS] = useState<Settings>({ detector: "none", apiKey: "" });
  useEffect(() => void getSettings().then(setS), []);
  return (
    <details className="settings">
      <summary>AI detector settings</summary>
      <p className="muted">
        Optional. Page text is sent to the detector you pick, using your own API key. Off by default.
      </p>
      <label>
        Detector
        <select value={s.detector} onChange={(e) => setS({ ...s, detector: e.target.value as Settings["detector"] })}>
          <option value="none">Off</option>
          <option value="pangram">Pangram</option>
          <option value="gptzero">GPTZero</option>
        </select>
      </label>
      <label>
        API key
        <input type="password" value={s.apiKey} onChange={(e) => setS({ ...s, apiKey: e.target.value })} placeholder="Stored only in this browser" />
      </label>
      <button className="primary" onClick={async () => { await saveSettings(s); onSaved(); }}>Save and re-check</button>
    </details>
  );
}

function App() {
  const [state, setState] = useState<State>({ status: "loading" });

  const run = useCallback(async () => {
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
    const [ctx, settings] = await Promise.all([loadContext(), getSettings()]);
    const [base, identity] = await Promise.all([
      analyzePage(page, { ...ctx, aiDetector: detectorFor(settings) }),
      checkIdentity(page, identityDeps).catch(() => [] as Finding[]),
    ]);
    const result = scoreFindings([...base.findings, ...identity]);
    setState({ status: "done", host: new URL(page.url).hostname, result, tabId: tab.id });
    await sendToTab(tab.id, {
      type: "highlight",
      items: result.findings
        .filter(
          (f) =>
            f.evidence &&
            f.check !== "phishing" &&
            f.severity !== "good" &&
            !(f.check === "identity" && f.severity === "info"),
        )
        .map((f) => ({ evidence: f.evidence!, severity: f.severity, title: f.title })),
    });
  }, []);

  useEffect(() => {
    void run();
    const onActivated = () => void run();
    const onUpdated = (_id: number, info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (info.status === "complete" && tab.active) void run();
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
      <header>
        <h1>Satya <span className="muted">सत्य</span></h1>
        <button className="ghost" onClick={() => void run()} aria-label="Re-check this page">↻</button>
      </header>

      {state.status === "loading" && <p className="muted">Checking this page…</p>}
      {state.status === "unsupported" && (
        <p className="muted">Open a website to check it. (Browser pages and the Chrome Web Store can't be checked; try reloading the page if you just installed Satya.)</p>
      )}
      {state.status === "done" && (
        <>
          <section className={`summary ${state.result.level}`}>
            <ScoreRing score={state.result.score} level={state.result.level} />
            <div>
              <div className="verdict">{state.result.label}</div>
              <div className="host">{state.host}</div>
            </div>
          </section>
          {(Object.keys(CHECK_NAMES) as Finding["check"][]).map((check) => {
            const items = state.result.findings.filter((f) => f.check === check);
            if (!items.length) return null;
            return (
              <section key={check} className="group">
                <h2>{CHECK_NAMES[check]}</h2>
                <ul>{items.map((f, i) => <FindingRow key={i} f={f} tabId={state.tabId} />)}</ul>
              </section>
            );
          })}
          {state.result.findings.length === 0 && (
            <p className="muted">No warnings found. That isn't a guarantee; stay careful with money and passwords.</p>
          )}
        </>
      )}
      <SettingsPanel onSaved={() => void run()} />
      <footer className="muted">Every point lost comes from a finding above, with its source.</footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
