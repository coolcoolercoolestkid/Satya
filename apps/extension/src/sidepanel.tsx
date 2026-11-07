import { aiFindings, analyzePage, buildEvidence, credentialFindings, metadataFindings, scoreFindings, type CredibilityResult, type Finding } from "@satya/checks";
import { checkRegistry, lookupVerifiedContracts, SOURCIFY_ON_ARKIV, type RegistryResult, type VerifiedContract } from "@satya/registry";
import { freeHostOf } from "@satya/checks";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ImageCheck } from "./c2pa";
import { DETECTOR_NAME, detectAiText } from "./aiText";
import { BUNDLED_DOMAIN_SOURCES, BUNDLED_TO_REGISTRY, cachedBucket, loadContext } from "./data";
import type { ContentRequest, SnapshotResponse } from "./messages";

declare const __ARKIV_ACCESS_KEY__: string;
declare const __SATYA_WEB_URL__: string;
declare const __BUILD_TIME__: string;

/** Identity (Anon Aadhaar, ENS) and image code is large, so it loads only when a full check runs. */
let identityModule: Promise<typeof import("@satya/identity")> | undefined;
const loadIdentity = () => (identityModule ??= import("@satya/identity"));
/** A full-check lookup never holds up the panel longer than this. */
const LOOKUP_MS = 8000;
function withTimeout<T>(p: Promise<T>, fallback: T, ms = LOOKUP_MS): Promise<T> {
  return Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}
/** fetch with a time limit, for the domain age, certificate and archive lookups. */
const timedFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(LOOKUP_MS - 1000) });
const EXPLORER = "https://rabdi.explorer.arkiv.network";


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
  /** The quick result is showing and the full check is still running. */
  pending?: boolean;
  page: SnapshotResponse;
  registry: RegistryResult;
  images?: ImageCheck;
  /** Contract addresses on the page, and which of them Sourcify (on Arkiv) knows. */
  contracts?: { asked: number; verified: VerifiedContract[] };
}
/** On-device AI-text check: runs after the receipt shows, so a first-time model download never blocks it. */
type AiText =
  | { status: "off" }
  | { status: "running"; loaded?: number; total?: number }
  | { status: "done"; findings: Finding[] };
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
        {f.link ? (
          <a className="ptr-src" href={f.link} target="_blank" rel="noreferrer">
            {shortSource(f.source)} ↗
          </a>
        ) : (
          <span className="ptr-src">{shortSource(f.source)}</span>
        )}
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
            Run full check
          </button>
        )}
        <button className="btn ghost" onClick={() => void save()} disabled={busy} title="Save the page text, a screenshot and this receipt to a file; anchor only its fingerprint on Arkiv.">
          {busy ? "Saving…" : "Save evidence"}
        </button>
      </div>
      {!s.deep && <div className="hint">Full check adds domain age, certificate, history, ENS and image checks.</div>}
      {saved && (
        <div className="hint">
          Saved · <span className="mono">{saved.slice(0, 12)}…</span>{" "}
          <a href={`${__SATYA_WEB_URL__}/#evidence=${saved}`} target="_blank" rel="noreferrer">anchor on Arkiv →</a>
        </div>
      )}
    </section>
  );
}

type Status = "pass" | "fail" | "warn" | "value" | "skip";
interface Row {
  label: string;
  status: Status;
  value: string;
  /** Shown on hover: what exactly was checked. */
  hint?: string;
  /** Where the answer came from, and a link to see the raw evidence. */
  via?: string;
  link?: string;
}

const LISTED = /^(Known phishing site|Listed as a |Wallet on )/;
const sev = (fs: Finding[]): Status =>
  fs.some((f) => f.severity === "danger") ? "fail" : fs.some((f) => f.severity === "warning") ? "warn" : "pass";

/** One row per thing Satya checked, so the receipt shows what passed, not just a number. */
function checklist(s: Done): Row[] {
  const f = s.result.findings;
  const pick = (check: Finding["check"] | null, re: RegExp) => f.filter((x) => (check === null || x.check === check) && re.test(x.title));
  const rows: Row[] = [];

  const listed = f.filter((x) => LISTED.test(x.title));
  const listNames = [...new Set(s.registry.lookups.flatMap((l) => l.records.map((r) => r.label)))];
  const domainLookup = s.registry.lookups.find((l) => l.kind === "domain");
  const firstRecord = domainLookup?.records[0];
  rows.push({
    label: "Scam & phishing lists",
    status: listed.length ? "fail" : "pass",
    value: listed.length ? "LISTED" : s.registry.reachable ? `Clear · ${listNames.length}` : "Clear (offline)",
    hint: s.registry.reachable
      ? `Checked against ${listNames.length} public lists mirrored on Arkiv: ${listNames.join("; ")}. Only bucket ${domainLookup?.bucket ?? ""} was requested; matching ran on this computer.`
      : "Arkiv didn't answer, so the copy bundled with Satya was used.",
    via: s.registry.reachable && domainLookup ? `Arkiv · bucket ${domainLookup.bucket}` : "Bundled lists",
    link: firstRecord ? `${EXPLORER}/entity/${firstRecord.key}` : undefined,
  });
  const brand = pick("phishing", /^(Looks like|Page says|Claims to be the Government|Bank login page|Site has no domain)/);
  rows.push({ label: "Impersonation", status: sev(brand), value: brand.length ? "Yes" : "No", hint: "Lookalike of a known brand, or claims to be government or a bank off an official domain." });
  const words = f.filter((x) => x.check === "scam" && x.severity !== "info" && x.severity !== "good");
  rows.push({ label: "Scam wording", status: sev(words), value: words.length ? `${words.length} found` : "None", hint: "Fake jobs, fees to withdraw, sextortion, ransom notes, fake fines, seed-phrase requests." });
  const forms = pick("page", /^(Asks you to type|Form sends|Collects|Asks for passwords|Asks you to type your wallet)/);
  rows.push({ label: "Asks for secrets", status: sev(forms), value: forms.length ? "Yes" : "No", hint: "OTP, PIN, card number, Aadhaar, password or seed phrase fields." });
  const malware = pick("page", /(miner|invisible frames|scrambled code|download|app \(\.apk\)|installer)/i);
  rows.push({ label: "Malware signs", status: sev(malware), value: malware.length ? `${malware.length} found` : "None", hint: "Crypto miners, hidden frames, obfuscated code, risky downloads." });
  const plain = pick(null, /without encryption/);
  const https = !plain.length && s.page.url.startsWith("https:");
  rows.push({ label: "HTTPS", status: plain.length ? "fail" : https ? "pass" : "warn", value: https ? "Yes" : "No" });

  const shared = f.find((x) => /^Hosted on .+, where anyone can make a site$/.test(x.title));
  /** Rows answered by an outside service: value, plus where it came from and a link to check it. */
  const sourced = (label: string, re: RegExp, value: (hit: Finding) => string, via: string) => {
    if (!s.deep) return rows.push({ label, status: "skip", value: "Full check" });
    if (s.pending) return rows.push({ label, status: "skip", value: "…" });
    const hit = pick("records", re)[0];
    if (!hit) return rows.push({ label, status: "value", value: "No answer", via });
    if (shared && hit.severity === "info" && /hosting service/.test(hit.detail ?? "")) return rows.push({ label, status: "value", value: "Host's, not this site's", via });
    rows.push({
      label,
      status: hit.severity === "good" ? "pass" : hit.severity === "info" ? "value" : sev([hit]),
      value: value(hit),
      hint: hit.detail,
      via: shortVia(hit.source),
      link: hit.link,
    });
  };
  const dateIn = (t?: string) => /\d{4}-\d{2}-\d{2}/.exec(t ?? "")?.[0];
  sourced("Registered", /^Domain is/, (h) => dateIn(h.detail) ?? shortValue(h.title), "RDAP");
  sourced("Certificate", /certificate/i, (h) => shortValue(h.title), "Cert Spotter");
  sourced("First archived", /^(Online since|Online for|First seen|The Internet Archive has never)/, (h) => dateIn(h.detail) ?? "Never", "Internet Archive");
  if (s.deep && !s.pending) {
    const ens = f.find((x) => / links to this site$/.test(x.title));
    rows.push({
      label: "Brand's ENS name",
      status: ens ? "pass" : "value",
      value: ens ? ens.title.replace(" links to this site", "") : "None",
      hint: "Whether <brand>.eth lists this site as its website. Only the name's owner can set that.",
      via: ens ? "ENS" : undefined,
      link: ens?.link,
    });
  }
  if (s.contracts) {
    rows.push({ label: "Contracts verified", status: "value", value: `${s.contracts.verified.length}/${s.contracts.asked}`, via: "Sourcify on Arkiv" });
  }
  if (s.deep && s.images && s.images.checked > 0) {
    rows.push({ label: "Image labels", status: "value", value: `${s.images.creds.length + s.images.metadata.length}/${s.images.checked}`, via: "C2PA" });
  }
  return rows;
}

/** One-line source names for the checks list. */
function shortVia(source: string): string {
  if (/^RDAP · /.test(source)) return `RDAP · ${source.slice(7).replace(/^rdap\./, "")}`;
  if (/Cert Spotter/.test(source)) return "CT logs · Cert Spotter";
  if (/Internet Archive|Wayback/.test(source)) return "web.archive.org";
  return source;
}

/** Short values for the checks list. */
function shortValue(title: string): string {
  if (/only proves domain control/.test(title)) return "DV (domain only)";
  const ov = /verifies the company behind the site \((OV|EV)\)/.exec(title);
  if (ov) return `${ov[1]} (company checked)`;
  const young = /only (\d+) days? old/.exec(title);
  if (young) return `New: ${young[1]}d old`;
  if (/^No valid HTTPS certificate/.test(title)) return "None found";
  if (/never captured/.test(title)) return "Never";
  return title.replace(/^Domain is /, "").replace(/^Online since (\d{4}).*/, "$1").replace(/^First seen online /, "");
}

const STATUS_MARK: Record<Status, string> = { pass: "✓", fail: "✕", warn: "!", value: "·", skip: "…" };

function Checks({ rows }: { rows: Row[] }) {
  return (
    <section className="sec">
      <div className="eyebrow">Checks</div>
      <ul className="checks">
        {rows.map((r) => (
          <li key={r.label} className={`chk ${r.status}`} title={r.hint}>
            <span className="chk-mark" aria-hidden>{STATUS_MARK[r.status]}</span>
            <span className="chk-label">
              {r.label}
              {r.via &&
                (r.link ? (
                  <a className="chk-via" href={r.link} target="_blank" rel="noreferrer" title="Open the source record">
                    {r.via} ↗
                  </a>
                ) : (
                  <span className="chk-via">{r.via}</span>
                ))}
            </span>
            <span className="chk-value">{r.value}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}


/** Score as a ring: the arc is the score out of 100. */
function ScoreRing({ score, level }: { score: number; level: CredibilityResult["level"] }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <svg className={`ring ${level}`} viewBox="0 0 84 84" width="84" height="84" role="img" aria-label={`Score ${score} out of 100`}>
      <circle cx="42" cy="42" r={r} className="ring-track" />
      <circle cx="42" cy="42" r={r} className="ring-arc" strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 42 42)" />
      <text x="42" y="44" className="ring-num">{score}</text>
      <text x="42" y="58" className="ring-of">/ 100</text>
    </svg>
  );
}

/** How much evidence the score rests on: the number of findings that moved it. */
function confidence(s: Done): { label: string; tone: "low" | "mid" | "high" } {
  const n = s.result.breakdown?.steps.length ?? 0;
  // Decisive evidence: on a list, imitating a brand, or an official / .gov.in / .bank.in / brand ENS domain.
  const decisive = s.result.findings.some(
    (f) => (f.check === "phishing" && f.severity === "good") || (f.severity === "danger" && /^(Known phishing site|Listed as a |Wallet on |Looks like .+, but isn't$)/.test(f.title)),
  );
  if (decisive) return { label: n > 1 ? `High confidence · ${n} signals` : "High confidence", tone: "high" };
  if (n >= 3) return { label: `High confidence · ${n} signals`, tone: "high" };
  if (n === 2) return { label: "Medium confidence · 2 signals", tone: "mid" };
  return { label: n === 1 ? "Low confidence · 1 signal" : "Low confidence · no evidence yet", tone: "low" };
}

/** The score built up step by step: start, each finding's points as a bar, any overriding rule, result. */
function Breakdown({ s }: { s: Done }) {
  const b = s.result.breakdown;
  if (!b) return null;
  const max = Math.max(25, ...b.steps.map((x) => Math.abs(x.points)));
  return (
    <section className="sec">
      <div className="eyebrow">Why {s.result.score}</div>
      <table className="bd">
        <tbody>
          <tr className="bd-row base">
            <td className="bd-label">Every site starts at</td>
            <td className="bd-bar" />
            <td className="bd-pts">{b.base}</td>
          </tr>
          {b.steps.map((x, i) => (
            <tr key={i} className={`bd-row ${x.points > 0 ? "up" : "down"}`} title={`${x.label} · ${x.source}`}>
              <td className="bd-label">{x.label}</td>
              <td className="bd-bar">
                <span style={{ width: `${(Math.abs(x.points) / max) * 100}%` }} />
              </td>
              <td className="bd-pts">{x.points > 0 ? `+${x.points}` : `−${-x.points}`}</td>
            </tr>
          ))}
          {!b.steps.length && (
            <tr className="bd-row empty">
              <td className="bd-label" colSpan={3}>
                {s.deep ? "Nothing found for or against it: no age, company certificate, history or red flag." : "Quick check found nothing for or against it. Full check looks up age, certificate and history."}
              </td>
            </tr>
          )}
          {b.rule && (
            <tr className="bd-row rule">
              <td className="bd-label" colSpan={2}>{b.rule}</td>
              <td className="bd-pts">{b.sum}→{s.result.score}</td>
            </tr>
          )}
          <tr className="bd-row total">
            <td className="bd-label">Score</td>
            <td className="bd-bar" />
            <td className="bd-pts">{s.result.score}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function AiTextStatus({ ai }: { ai: AiText }) {
  if (ai.status !== "running") return null;
  const mb = (n?: number) => (n ? Math.round(n / 1e6) : 0);
  return (
    <div className="hint">
      {ai.total && ai.loaded! < ai.total
        ? `Loading the AI-text detector: ${mb(ai.loaded)} of ${mb(ai.total)} MB (downloaded once, then cached). Your page text stays on this device.`
        : "Reading the page's text for AI writing, on this device…"}
    </div>
  );
}

function Receipt({ s, onDeep, aiText }: { s: Done; onDeep: () => void; aiText: AiText }) {
  const { result } = s;
  const wrong = result.findings.filter((f) => f.check !== "ai" && f.check !== "identity" && (f.severity === "danger" || f.severity === "warning"));
  const ai = [...(aiText.status === "done" ? aiText.findings : []), ...result.findings.filter((f) => f.check === "ai" && !f.title.startsWith("Checked "))].filter(
    (f) => !/^Not enough text/.test(f.title),
  );
  const people = result.findings.filter((f) => f.check === "identity" && f.severity !== "info");
  const notes = result.findings.filter((f) => f.check !== "ai" && f.check !== "identity" && f.severity === "info");
  const conf = confidence(s);
  return (
    <>
      <article className="receipt">
        <div className="site">{s.host}</div>
        <div className="verdict">
          <ScoreRing score={result.score} level={result.level} />
          <div className="verdict-text">
            <div className={`chip ${result.level}`}>{result.label}</div>
            <div className="meta">
              <span className={`conf ${conf.tone}`}>{conf.label}</span>
              <span className="mode">{s.pending ? "Full check running…" : s.deep ? "Full check" : "Quick check"}</span>
            </div>
          </div>
        </div>
        <Breakdown s={s} />
        <Section title={`What's wrong (${wrong.length})`} items={wrong} tabId={s.tabId} />
        <Checks rows={checklist(s)} />
        <Section title="People on this page" items={people} tabId={s.tabId} />
        <Section title="AI content · not scored" items={ai} tabId={s.tabId} />
        {aiText.status === "running" && (
          <section className="sec">
            <div className="eyebrow">AI content · not scored</div>
            <AiTextStatus ai={aiText} />
          </section>
        )}
        <HowChecked s={s} notes={notes} />
      </article>
      <Actions s={s} onDeep={onDeep} />
    </>
  );
}

/** Asked once: may Satya run the full check on every page? */
function Consent({ onChoose }: { onChoose: (full: boolean) => void }) {
  return (
    <div className="consent">
      <b>Run full checks automatically?</b>
      <p>
        A quick check only sends Arkiv a bucket number, so it can catch scams but can't vouch for a site. A full check
        also looks up the domain's age (its registry), certificates (Cert Spotter), history (Internet Archive) and ENS name.
        Those services see the site's name.
      </p>
      <div className="row">
        <button className="btn" onClick={() => onChoose(true)}>Turn on full checks</button>
        <button className="btn ghost" onClick={() => onChoose(false)}>Keep it private</button>
      </div>
    </div>
  );
}

function App() {
  const [state, setState] = useState<State>({ status: "loading" });
  /** undefined until the user chooses; then remembered. */
  const [full, setFull] = useState<boolean | undefined | null>(null);
  const fullRef = useRef(false);
  const [aiText, setAiText] = useState<AiText>({ status: "off" });
  const runId = useRef(0);

  const run = useCallback(async (deep = false) => {
    const myRun = ++runId.current;
    setState({ status: "loading" });
    setAiText({ status: "off" });
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
    const registry = await checkRegistry(page, cachedBucket);
    // The bundled domain lists are needed only for lists Arkiv didn't answer for.
    const bundledNeeded = BUNDLED_DOMAIN_SOURCES.some((src) => !registry.covered.domain.includes(src));
    const ctx = await loadContext(bundledNeeded);
    // Lists the Arkiv registry answered for are not checked again from the bundled copy.
    const covered = new Set([...registry.covered.domain, ...registry.covered.address]);
    const localCtx = {
      ...ctx,
      phishing: { ...ctx.phishing, lists: ctx.phishing.lists.filter((l) => !covered.has(BUNDLED_TO_REGISTRY[l.source] ?? "")) },
      addressLists: registry.covered.address.includes("*")
        ? []
        : (ctx.addressLists ?? []).filter((l) => !covered.has(BUNDLED_TO_REGISTRY[l.source] ?? "")),
    };
    const host = new URL(page.url).hostname;
    const highlight = (result: CredibilityResult) =>
      sendToTab(tab.id!, {
        type: "highlight",
        items: result.findings
          .filter((f) => f.evidence && f.check !== "phishing" && (f.severity === "danger" || f.severity === "warning"))
          .map((f) => ({ evidence: f.evidence!, severity: f.severity, title: f.title })),
      });

    // 1. Quick check: local rules plus the Arkiv lists. Shown straight away.
    const quick = await analyzePage(page, { ...localCtx, network: false });
    if (runId.current !== myRun) return;
    const quickResult = scoreFindings([...quick.findings, ...registry.findings]);
    const base: Done = {
      status: "done",
      host,
      result: quickResult,
      tabId: tab.id,
      windowId: tab.windowId,
      deep,
      pending: deep,
      ensNames: 0,
      page,
      registry,
    };
    setState(base);
    void highlight(quickResult);
    if (!deep) return;

    // 2. Full check: every lookup runs at once, each with a time limit, then the receipt updates.
    void checkAiText(page.mainText || page.text, myRun);
    const addresses = [...new Set((page.text.match(/\b0x[a-fA-F0-9]{40}\b/g) ?? []).map((a) => a.toLowerCase()))].slice(0, 5);
    const noImages: ImageCheck = { creds: [], found: 0, checked: 0, errors: [], metadata: [] };
    const [full, identity, images, siteEns, verified, ensNames, people] = await Promise.all([
      withTimeout(analyzePage(page, { ...localCtx, network: true, fetchImpl: timedFetch }), quick, LOOKUP_MS + 1000),
      withTimeout(
        loadIdentity().then((id) => id.checkIdentity(page, id.defaultIdentityDeps(__ARKIV_ACCESS_KEY__))),
        [] as Finding[],
      ),
      withTimeout(
        import("./c2pa").then((m) => m.checkImageCredentials(page.images ?? [])),
        { ...noImages, errors: ["Image check took too long"] },
        LOOKUP_MS + 4000,
      ),
      // The brand's own ENS name linking here is strong proof; never on shared hosts.
      freeHostOf(host)
        ? Promise.resolve([] as Finding[])
        : withTimeout(
            loadIdentity().then((id) => id.checkSiteEns(host, id.defaultIdentityDeps(__ARKIV_ACCESS_KEY__).ens)),
            [] as Finding[],
          ),
      addresses.length ? withTimeout(lookupVerifiedContracts(addresses), [] as VerifiedContract[]) : Promise.resolve([] as VerifiedContract[]),
      withTimeout(loadIdentity().then((id) => id.ensNamesOnPage(page).length), 0),
      // Wallets on the page that belong to people verified on Aletheia (identity records on Arkiv).
      addresses.length
        ? withTimeout(
            loadIdentity().then(async (id) =>
              (await Promise.all(addresses.map((a) => id.findIdentities({ holder: a as `0x${string}` }, __ARKIV_ACCESS_KEY__, 3)))).flat(),
            ),
            [] as import("@satya/identity").FoundIdentity[],
          )
        : Promise.resolve([] as import("@satya/identity").FoundIdentity[]),
    ]);
    if (runId.current !== myRun) return;
    const contractFindings: Finding[] = verified.map((c) => ({
      check: "records",
      severity: "info",
      title: `Contract ${c.address.slice(0, 8)}…${c.address.slice(-4)} is verified as “${c.name}”`,
      detail: `Its source code is public and verified (${c.match} match, compiler ${c.compiler}). Check the name matches what the page claims.`,
      source: "Sourcify, mirrored on Arkiv",
      evidence: c.address,
      weight: 0,
    }));
    const peopleFindings: Finding[] = people.map((f) => {
      const r = f.signed.record;
      const w = `${r.holder.slice(0, 6)}…${r.holder.slice(-4)}`;
      return f.check.ok
        ? {
            check: "identity",
            severity: "good",
            title: `${w} belongs to ${r.name}`,
            detail: `Verified by Mock DigiLocker (demo issuer) against a ${r.docType}: ${r.claims.replace(/,/g, ", ")}. Record on Arkiv ${f.key.slice(0, 10)}….`,
            source: "Aletheia identity record on Arkiv",
            evidence: r.holder,
            weight: 0,
          }
        : {
            check: "identity",
            severity: "warning",
            title: `${w} claims to be ${r.name}, but the record isn't valid`,
            detail: f.check.reason,
            source: "Aletheia identity record on Arkiv",
            evidence: r.holder,
            weight: 0,
          };
    });
    const imageFindings = [
      ...credentialFindings(images.creds, images.checked),
      ...metadataFindings(images.metadata.filter((m) => !images.creds.some((c) => c.url === m.url))),
    ];
    const result = scoreFindings([...full.findings, ...registry.findings, ...identity, ...peopleFindings, ...imageFindings, ...siteEns, ...contractFindings]);
    setState({
      ...base,
      result,
      pending: false,
      ensNames,
      images,
      contracts: addresses.length ? { asked: addresses.length, verified } : undefined,
    });
    void highlight(result);
  }, []);

  /** Runs the on-device detector; ignores results from a page the user has since left. */
  const checkAiText = async (text: string, myRun: number) => {
    setAiText({ status: "running" });
    try {
      const d = await detectAiText(text, (loaded, total) => {
        if (runId.current === myRun) setAiText({ status: "running", loaded, total });
      });
      if (runId.current !== myRun) return;
      const findings: Finding[] =
        "tooShort" in d
          ? [{ check: "ai", severity: "info", title: "Not enough text to judge if it's AI-written", source: DETECTOR_NAME, weight: 0 }]
          : aiFindings(d);
      setAiText({ status: "done", findings });
    } catch (err) {
      if (runId.current !== myRun) return;
      setAiText({
        status: "done",
        findings: [{ check: "ai", severity: "info", title: "AI-text check unavailable", detail: err instanceof Error ? err.message : String(err), source: DETECTOR_NAME, weight: 0 }],
      });
    }
  };

  const choose = (v: boolean) => {
    fullRef.current = v;
    setFull(v);
    void chrome.storage.local.set({ fullChecks: v });
    void run(v);
  };

  useEffect(() => {
    void chrome.storage.local.get("fullChecks").then((o) => {
      const v = o.fullChecks as boolean | undefined;
      fullRef.current = v === true;
      setFull(v);
      void run(v === true);
    });
    const onActivated = () => void run(fullRef.current);
    const onUpdated = (_id: number, info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (info.status === "complete" && tab.active) void run(fullRef.current);
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
        <button className="icon" onClick={() => void run(fullRef.current)} aria-label="Re-check this page" title="Re-check">↻</button>
      </header>
      {full === undefined && <Consent onChoose={choose} />}
      {state.status === "loading" && <div className="receipt loading"><div className="eyebrow">Checking…</div></div>}
      {state.status === "unsupported" && (
        <div className="receipt"><p className="none">Open a website to check it. If you just reloaded Satya, reload the page too.</p></div>
      )}
      {state.status === "done" && <Receipt s={state} onDeep={() => void run(true)} aiText={aiText} />}
      <footer className="build">
        {full !== null && full !== undefined && (
          <button className="link" onClick={() => choose(!full)}>
            Full checks: {full ? "on" : "off"} · turn {full ? "off" : "on"}
          </button>
        )}
        <div>build {__BUILD_TIME__}</div>
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
