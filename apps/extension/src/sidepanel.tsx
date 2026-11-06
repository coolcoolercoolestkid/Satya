import { analyzePage, buildEvidence, credentialFindings, scoreFindings, type CredibilityResult, type Finding } from "@satya/checks";
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

const GROUPS: [Finding["check"], string][] = [
  ["phishing", "Is this site real?"],
  ["page", "What is it asking for?"],
  ["scam", "What is it saying?"],
  ["records", "Past records"],
  ["identity", "Who is this?"],
  ["ai", "AI content · not part of the score"],
];
const GLYPH: Record<Finding["severity"], string> = { danger: "✕", warning: "!", info: "·", good: "✓" };
const STAMP: Record<CredibilityResult["level"], string> = {
  trustworthy: "Verified",
  unverified: "No red flags",
  careful: "Caution",
  "high-risk": "Flagged",
};
const MEANING: Record<CredibilityResult["level"], string> = {
  trustworthy: "Something independent vouches for this site, and nothing wrong was found.",
  unverified: "Nothing wrong was found, but nothing proves this site is legitimate either.",
  careful: "Some warning signs. Don't enter passwords, OTPs or card details without checking.",
  "high-risk": "Strong signs of a scam. Don't pay, log in or type anything here.",
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
  checkedAt: Date;
}
type State = { status: "loading" } | { status: "unsupported"; url?: string } | Done;

const short = (h: string, n = 6) => (h.length > 2 * n + 2 ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : h);

function Seal({ result }: { result: CredibilityResult }) {
  return (
    <div className={`seal ${result.level}`} aria-label={`Score ${result.score} out of 100`}>
      <div>
        <div className="seal-score">{result.score}</div>
        <div className="seal-of">of 100</div>
      </div>
    </div>
  );
}

function Line({ f, tabId }: { f: Finding; tabId: number }) {
  return (
    <li className={`line ${f.severity}`}>
      <span className="glyph" aria-hidden>{GLYPH[f.severity]}</span>
      <div className="line-body">
        <div className="line-title">{f.title}</div>
        {f.detail && <div className="line-detail">{f.detail}</div>}
        {f.evidence && (
          <button className="quote" onClick={() => sendToTab(tabId, { type: "scrollTo", evidence: f.evidence! })} title="Show on the page">
            “{f.evidence.length > 140 ? `${f.evidence.slice(0, 140)}…` : f.evidence}”
          </button>
        )}
        <div className="line-source">src · {f.source}</div>
      </div>
      {f.weight > 0 && f.check !== "ai" && <span className="points">−{f.weight}</span>}
    </li>
  );
}

/** The part that shows the work: what was hashed, what Arkiv was asked, which records answered. */
function Proof({ s }: { s: Done }) {
  return (
    <section className="proof">
      <div className="eyebrow">How this was verified</div>
      {s.registry.reachable ? (
        s.registry.lookups.map((l) => (
          <div key={l.kind + l.value} className="proof-block">
            <div className="hash">
              sha256(<b>{l.value}</b>) → bucket <b>{l.bucket}</b>
            </div>
            <div className="proof-note">
              Only “{l.bucket}” was sent to Arkiv. The {l.kind === "domain" ? "site" : "wallet"} itself never left this computer.
            </div>
            <ul className="records">
              {l.records.map((r) => (
                <li key={r.key} className={r.matched ? "hit" : ""}>
                  <span className="rec-mark">{r.matched ? "MATCH" : "clear"}</span>
                  <span className="rec-label">{r.label}</span>
                  <span className="rec-meta">
                    {r.entries.toLocaleString()} hashed entries · {r.date} ·{" "}
                    <a href={`${EXPLORER}/entity/${r.key}`} target="_blank" rel="noreferrer">record {short(r.key, 4)} ↗</a>
                  </span>
                </li>
              ))}
              {!l.records.length && <li className="rec-meta">No registry records for this bucket.</li>}
            </ul>
          </div>
        ))
      ) : (
        <div className="proof-note">Arkiv couldn't be reached, so the copy of the lists bundled with Satya was used instead.</div>
      )}
      <div className="proof-block">
        <div className="proof-note">
          <b>On this computer:</b> lookalike domains, scam wording, risky forms (OTP, UPI PIN, card, seed phrase), gov/bank
          domain rules.
        </div>
        {s.deep ? (
          <div className="proof-note">
            <b>Deeper check:</b> domain age from rdap.org, certificates from Cert Spotter
            {s.ensNames ? ", ENS names and proofs from Ethereum and Arkiv" : ""}.{" "}
            {s.images && (
              <>
                Images: {s.images.found} found, {s.images.checked} read, {s.images.creds.length} with Content Credentials.
                {s.images.found === 0 && " (If this page has large images, reload the page so Satya's page reader updates.)"}
              </>
            )}
            {s.images?.errors.map((e) => (
              <div key={e} className="proof-error">⚠ {e}</div>
            ))}
          </div>
        ) : (
          <div className="proof-note"><b>Not run yet:</b> domain age, certificates, image Content Credentials, ENS proofs.</div>
        )}
      </div>
    </section>
  );
}

function DeeperCheck({ ensNames, onRun }: { ensNames: number; onRun: () => void }) {
  return (
    <section className="action">
      <button className="btn" onClick={onRun}>Run deeper check</button>
      <p className="fine">
        Sends the site's domain to rdap.org (age) and Cert Spotter (certificates), re-reads this page's larger images from
        the sites that served them to read Content Credentials
        {ensNames ? `, and the ${ensNames} ENS name${ensNames > 1 ? "s" : ""} on this page to an Ethereum node and Arkiv` : ""}.
        Those services can see your IP address.
      </p>
    </section>
  );
}

/**
 * Freezes the page as evidence: its text, a screenshot and Satya's findings go into a file the
 * user keeps. Only the file's fingerprint (a SHA-256 hash) is anchored on Arkiv, from the web
 * app with the user's own wallet, so nobody learns which page it was.
 */
function SaveEvidence({ s }: { s: Done }) {
  const [saved, setSaved] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const save = async () => {
    setBusy(true);
    setError(undefined);
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
      const blob = new Blob([JSON.stringify(ev, null, 1)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `satya-evidence-${s.host}-${ev.header.capturedAt.slice(0, 19).replace(/[:T]/g, "-")}.json`;
      a.click();
      setSaved(ev.fingerprint);
      if (!screenshot) setError("Saved without a screenshot (Chrome didn't allow capturing this tab).");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="action">
      <button className="btn ghost" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save evidence"}</button>
      <p className="fine">
        Scam pages vanish fast. Saves the page text, a screenshot and this receipt to a file on your computer. Anchor its
        fingerprint on Arkiv (only the hash, never the page) to prove later that it existed, unchanged.
      </p>
      {saved && (
        <div className="saved">
          <div className="eyebrow">Evidence fingerprint</div>
          <div className="hash">{saved}</div>
          <a className="btn small" href={`${__SATYA_WEB_URL__}/#evidence=${saved}`} target="_blank" rel="noreferrer">Anchor on Arkiv →</a>
        </div>
      )}
      {error && <p className="fine warn">{error}</p>}
    </section>
  );
}

function Receipt({ s }: { s: Done }) {
  const { result } = s;
  const shown = result.findings.filter((f) => !(f.check === "records" && f.title.startsWith("Checked privately")));
  return (
    <article className="receipt">
      <div className="receipt-head">
        <div className="eyebrow">Satya · Site receipt</div>
        <div className="site">{s.host}</div>
        <div className="meta">
          {s.checkedAt.toLocaleString()} · {s.deep ? "deeper check" : "private check"}
        </div>
      </div>
      <div className="verdict">
        <Seal result={result} />
        <div className="verdict-text">
          <span className={`stamp ${result.level}`}>{STAMP[result.level]}</span>
          <p>{MEANING[result.level]}</p>
        </div>
      </div>
      <hr className="dash" />
      {GROUPS.map(([check, name]) => {
        const items = shown.filter((f) => f.check === check);
        if (!items.length) return null;
        return (
          <section key={check} className="group">
            <div className="eyebrow">{name}</div>
            <ul>{items.map((f, i) => <Line key={i} f={f} tabId={s.tabId} />)}</ul>
          </section>
        );
      })}
      {!shown.length && <p className="fine">No warnings on this page. That isn't a guarantee: stay careful with money and passwords.</p>}
      <hr className="dash" />
      <Proof s={s} />
      <div className="receipt-foot">
        Score = 100 − the points shown above. Every point comes from a line with its source.
      </div>
    </article>
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
        ? checkImageCredentials(page.images ?? []).catch((e): ImageCheck => ({ creds: [], found: 0, checked: 0, errors: [String(e)] }))
        : Promise.resolve(undefined),
    ]);
    const imageFindings = images ? credentialFindings(images.creds, images.checked) : [];
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
      checkedAt: new Date(),
    });
    await sendToTab(tab.id, {
      type: "highlight",
      items: result.findings
        .filter((f) => f.evidence && f.check !== "phishing" && f.severity !== "good" && !(f.check === "identity" && f.severity === "info"))
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
        <div className="brand">
          Satya <span className="brand-hi">सत्य</span>
        </div>
        <button className="icon" onClick={() => void run(false)} aria-label="Re-check this page" title="Re-check">↻</button>
      </header>
      {state.status === "loading" && <div className="receipt loading"><div className="eyebrow">Checking this page…</div></div>}
      {state.status === "unsupported" && (
        <div className="receipt">
          <p className="fine">
            Open a website to check it. Browser pages and the Chrome Web Store can't be checked. If you just installed or
            reloaded Satya, reload the page too.
          </p>
        </div>
      )}
      {state.status === "done" && (
        <>
          <Receipt s={state} />
          {!state.deep && <DeeperCheck ensNames={state.ensNames} onRun={() => void run(true)} />}
          <SaveEvidence s={state} />
        </>
      )}
      <footer className="build">Satya build {__BUILD_TIME__} · no trackers · no Satya server</footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
