import { aiFindings, analyzePage, buildEvidence, credentialFindings, metadataFindings, scoreFindings, type CredibilityResult, type Finding } from "@satya/checks";
import { checkIdentity, checkSiteEns, defaultIdentityDeps, ensNamesOnPage } from "@satya/identity";
import { checkRegistry, lookupVerifiedContracts, SOURCIFY_ON_ARKIV, type RegistryResult, type VerifiedContract } from "@satya/registry";
import { freeHostOf } from "@satya/checks";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { checkImageCredentials, type ImageCheck } from "./c2pa";
import { DETECTOR_NAME, detectAiText } from "./aiText";
import { BUNDLED_TO_REGISTRY, cachedBucket, loadContext } from "./data";
import type { ContentRequest, SnapshotResponse } from "./messages";

declare const __ARKIV_ACCESS_KEY__: string;
declare const __SATYA_WEB_URL__: string;
declare const __BUILD_TIME__: string;

const identityDeps = defaultIdentityDeps(__ARKIV_ACCESS_KEY__);
const EXPLORER = "https://rabdi.explorer.arkiv.network";

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
  const lists = s.registry.lookups.length ? new Set(s.registry.lookups.flatMap((l) => l.records.map((r) => r.source))).size : 0;
  rows.push({
    label: `Scam, phishing & sanctions lists${lists ? ` (${lists} on Arkiv)` : ""}`,
    status: listed.length ? "fail" : "pass",
    value: listed.length ? "Listed" : s.registry.reachable ? "Not listed" : "Not listed (offline copy)",
  });
  const brand = pick("phishing", /^(Looks like|Page says|Claims to be the Government|Bank login page|Site has no domain)/);
  rows.push({ label: "Pretends to be a known brand or government", status: sev(brand), value: brand.length ? "Yes" : "No" });
  const words = f.filter((x) => x.check === "scam" && x.severity !== "info" && x.severity !== "good");
  rows.push({ label: "Scam, threat or extortion wording", status: sev(words), value: words.length ? `${words.length} found` : "None" });
  const forms = pick("page", /^(Asks you to type|Form sends|Collects|Asks for passwords|Asks you to type your wallet)/);
  rows.push({ label: "Asks for OTP, PIN, card, Aadhaar or seed phrase", status: sev(forms), value: forms.length ? "Yes" : "No" });
  const malware = pick("page", /(miner|invisible frames|scrambled code|download|app \(\.apk\)|installer)/i);
  rows.push({ label: "Malware signs (miners, hidden frames, downloads)", status: sev(malware), value: malware.length ? `${malware.length} found` : "None" });
  const plain = pick(null, /without encryption/);
  rows.push({ label: "Encrypted connection (HTTPS)", status: plain.length ? "fail" : s.page.url.startsWith("https:") ? "pass" : "warn", value: plain.length || !s.page.url.startsWith("https:") ? "No" : "Yes" });

  const shared = f.find((x) => /^Hosted on .+, where anyone can make a site$/.test(x.title));
  const deepRow = (label: string, re: RegExp) => {
    if (!s.deep) return rows.push({ label, status: "skip", value: "Full check" });
    const hit = pick("records", re)[0];
    if (shared && hit?.severity === "info" && /hosting service/.test(hit.detail ?? "")) return rows.push({ label, status: "value", value: "Belongs to the host" });
    rows.push({ label, status: hit ? (hit.severity === "good" ? "pass" : hit.severity === "info" ? "value" : sev([hit])) : "value", value: hit ? shortValue(hit.title) : "Unknown" });
  };
  deepRow("Domain age", /^Domain is/);
  deepRow("Certificate", /certificate/i);
  deepRow("History online", /^(Online since|Online for|First seen|The Internet Archive has never)/);
  if (s.deep) {
    const ens = f.find((x) => / links to this site$/.test(x.title));
    rows.push({ label: "Its ENS name links back here", status: ens ? "pass" : "value", value: ens ? ens.title.replace(" links to this site", "") : "No" });
  }
  if (s.contracts) {
    rows.push({
      label: "Contracts on page verified (Sourcify on Arkiv)",
      status: "value",
      value: `${s.contracts.verified.length} of ${s.contracts.asked}`,
    });
  }
  if (s.deep && s.images) {
    rows.push({ label: "Images with AI / camera labels", status: "value", value: `${s.images.creds.length + s.images.metadata.length} of ${s.images.checked}` });
  }
  return rows;
}

/** Short values for the checks list. */
function shortValue(title: string): string {
  if (/only proves domain control/.test(title)) return "Domain-only (DV)";
  const ov = /verifies the company behind the site ((OV|EV))/.exec(title);
  if (ov) return `Company-verified (${ov[1]})`;
  if (/only d+ days? old/.test(title)) return title.replace(/^HTTPS certificate is /, "");
  if (/^No valid HTTPS certificate/.test(title)) return "None found";
  if (/never captured/.test(title)) return "Never archived";
  return title.replace(/^Domain is /, "").replace(/^Online since (d{4}).*/, "since $1").replace(/^First seen online /, "");
}

const STATUS_MARK: Record<Status, string> = { pass: "✓", fail: "✕", warn: "!", value: "·", skip: "…" };

function Checks({ rows }: { rows: Row[] }) {
  return (
    <section className="sec">
      <div className="eyebrow">Checks</div>
      <ul className="checks">
        {rows.map((r) => (
          <li key={r.label} className={`chk ${r.status}`}>
            <span className="chk-mark" aria-hidden>{STATUS_MARK[r.status]}</span>
            <span className="chk-label">{r.label}</span>
            <span className="chk-value">{r.value}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One sentence on why the score is what it is. */
function reason(s: Done): string {
  const f = s.result.findings;
  const shared = f.find((x) => /^Hosted on .+, where anyone can make a site$/.test(x.title));
  const vouch = f.filter((x) => x.severity === "good" && x.check !== "ai" && x.check !== "identity");
  const bad = f.filter((x) => x.check !== "ai" && x.check !== "identity" && (x.severity === "danger" || x.severity === "warning"));
  if (f.some((x) => LISTED.test(x.title))) return "It's on a published scam or sanctions list.";
  if (bad.length) return `${bad.length} warning sign${bad.length > 1 ? "s" : ""} below.`;
  if (vouch.length) return `Vouched for by: ${vouch.map((x) => x.title.toLowerCase()).slice(0, 2).join("; ")}.`;
  if (shared) return `${shared.title.replace(/^Hosted on /, "Hosted on ").replace(/, where anyone can make a site$/, "")}, where anyone can make a site, so nothing vouches for this one yet.`;
  return s.deep ? "Nothing wrong, but no independent evidence (age, company certificate, history) vouches for it." : "Nothing wrong so far, but the quick check can't vouch for a site. Run the full check.";
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
  const ai = [...(aiText.status === "done" ? aiText.findings : []), ...result.findings.filter((f) => f.check === "ai" && !f.title.startsWith("Checked "))];
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
            <p className="meaning">{MEANING[result.level]}</p>
            <div className="meta">
              <span className={`conf ${conf.tone}`}>{conf.label}</span>
              <span className="mode">{s.deep ? "Full check" : "Quick check"}</span>
            </div>
          </div>
        </div>
        <p className="why">{reason(s)}</p>
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
    const host = new URL(page.url).hostname;
    const addresses = [...new Set((page.text.match(/\b0x[a-fA-F0-9]{40}\b/g) ?? []).map((a) => a.toLowerCase()))].slice(0, 5);
    const [base, identity, images, siteEns, verified] = await Promise.all([
      analyzePage(page, { ...localCtx, network: deep }),
      deep ? checkIdentity(page, identityDeps).catch(() => [] as Finding[]) : Promise.resolve([] as Finding[]),
      deep
        ? checkImageCredentials(page.images ?? []).catch((e): ImageCheck => ({ creds: [], found: 0, checked: 0, errors: [String(e)], metadata: [] }))
        : Promise.resolve(undefined),
      // The brand's own ENS name linking here is strong proof; never on shared hosts.
      deep && !freeHostOf(host) ? checkSiteEns(host, identityDeps.ens).catch(() => [] as Finding[]) : Promise.resolve([] as Finding[]),
      deep && addresses.length ? lookupVerifiedContracts(addresses).catch(() => [] as VerifiedContract[]) : Promise.resolve([] as VerifiedContract[]),
    ]);
    const contractFindings: Finding[] = verified.map((c) => ({
      check: "records",
      severity: "info",
      title: `Contract ${c.address.slice(0, 8)}…${c.address.slice(-4)} is verified as “${c.name}”`,
      detail: `Its source code is public and verified (${c.match} match, compiler ${c.compiler}). Check the name matches what the page claims.`,
      source: "Sourcify, mirrored on Arkiv",
      evidence: c.address,
      weight: 0,
    }));
    const imageFindings = images
      ? [...credentialFindings(images.creds, images.checked), ...metadataFindings(images.metadata.filter((m) => !images.creds.some((c) => c.url === m.url)))]
      : [];
    const result = scoreFindings([...base.findings, ...registry.findings, ...identity, ...imageFindings, ...siteEns, ...contractFindings]);
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
      contracts: deep && addresses.length ? { asked: addresses.length, verified } : undefined,
    });
    if (deep) void checkAiText(page.mainText || page.text, myRun);
    await sendToTab(tab.id, {
      type: "highlight",
      items: result.findings
        .filter((f) => f.evidence && f.check !== "phishing" && (f.severity === "danger" || f.severity === "warning"))
        .map((f) => ({ evidence: f.evidence!, severity: f.severity, title: f.title })),
    });
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
