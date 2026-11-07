import {
  arkivBrowserWriter,
  ClaimRefusedError,
  describeFacts,
  findIdentities,
  fingerprint,
  issueIdentity,
  parseIdentity,
  publishIdentity,
  serializeIdentity,
  verifyIdentity,
  type FoundIdentity,
  type DocumentDetails,
  type SignedIdentity,
} from "@satya/identity";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { isAddress, type Address, type EIP1193Provider, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

const ARKIV_KEY = import.meta.env.VITE_ARKIV_ACCESS_KEY ?? "";
const ARKIV_EXPLORER = "https://rabdi.explorer.arkiv.network";
const short = (a: string, n = 4) => `${a.slice(0, n + 2)}…${a.slice(-n)}`;
const day = (t: bigint) => new Date(Number(t) * 1000).toISOString().slice(0, 10);

/* ------------------------------------------------------------------ routing */

function useRoute() {
  const read = () => {
    const h = location.hash.replace(/^#/, "") || "/";
    const [path, query = ""] = h.split("?");
    return { path: path!, params: new URLSearchParams(query) };
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => {
      setRoute(read());
      scrollTo(0, 0);
    };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return route;
}
const go = (to: string) => {
  location.hash = to;
};

/* ------------------------------------------------------------- residents */

/** Fictional residents of the mock DigiLocker. Invented people; no real data. */
const RESIDENTS: { id: string; name: string; note: string; docType: string; doc: DocumentDetails }[] = [
  { id: "asha", name: "Asha Verma", note: "Adult · India · ID valid", docType: "Aadhaar card", doc: { dateOfBirth: "1999-04-12", nationality: "IN", documentExpiry: "2031-06-30" } },
  { id: "rohan", name: "Rohan Mehta", note: "Minor · India (born 2010)", docType: "Aadhaar card", doc: { dateOfBirth: "2010-01-20", nationality: "IN", documentExpiry: "2030-01-01" } },
  { id: "kavya", name: "Kavya Iyer", note: "Adult · India · ID expired in 2024", docType: "PAN card", doc: { dateOfBirth: "1988-07-07", nationality: "IN", documentExpiry: "2024-03-31" } },
  { id: "daniel", name: "Daniel Brooks", note: "Adult · USA · passport valid", docType: "Passport", doc: { dateOfBirth: "1992-09-03", nationality: "US", documentExpiry: "2029-02-14" } },
];

/** A small text file standing in for a scanned document, so anyone can try the flow. */
function sampleDocument(name: string, docType: string): File {
  const text = `SATYA DEMO DOCUMENT - NOT A REAL ID\n${docType} (fictional)\nName: ${name}\nIssued by: Mock DigiLocker (demo issuer)\n`;
  return new File([text], `${name.toLowerCase().replace(/\s+/g, "-")}-demo-${docType.toLowerCase().replace(/\s+/g, "-")}.txt`, { type: "text/plain" });
}

/* ---------------------------------------------------------------- session */

interface Session {
  holder: Address;
  wallet: "metamask" | "demo";
  identity?: string;
  refused?: string;
}
const loadSession = (): Session | null => {
  const s = JSON.parse(sessionStorage.getItem("aletheia-session") ?? "null") as (Session & { claims?: unknown }) | null;
  // Sessions from the earlier claims-only version have no identity record: start fresh.
  return s && !("claims" in s) ? s : null;
};
const saveSession = (s: Session | null) =>
  s ? sessionStorage.setItem("aletheia-session", JSON.stringify(s)) : sessionStorage.removeItem("aletheia-session");

function demoWallet(): Address {
  let key = localStorage.getItem("aletheia-demo-key") as Hex | null;
  if (!key) {
    key = generatePrivateKey();
    localStorage.setItem("aletheia-demo-key", key);
  }
  return privateKeyToAccount(key).address;
}

async function metamask(): Promise<Address> {
  if (!window.ethereum) throw new Error("No browser wallet found. Install MetaMask, or use a demo wallet.");
  const [a] = (await window.ethereum.request({ method: "eth_requestAccounts" })) as Address[];
  if (!a) throw new Error("No account selected.");
  return a;
}

/* ------------------------------------------------------------------ shell */

const ARKIV_RPC = "https://rpc.rabdi.db-chain.testnet.arkiv.network";

/** Live Arkiv block height, read every few seconds. Real data, not decoration. */
function useArkivBlock() {
  const [block, setBlock] = useState<number>();
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(ARKIV_RPC, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
        });
        const j = (await r.json()) as { result?: string };
        if (!stop && j.result) setBlock(parseInt(j.result, 16));
      } catch {
        /* keep the last value */
      }
    };
    void tick();
    const i = setInterval(tick, 4000);
    return () => {
      stop = true;
      clearInterval(i);
    };
  }, []);
  return block;
}

function Logo() {
  return (
    <a className="logo" href="#/">
      <span className="logo-mark" aria-hidden>
        <svg viewBox="0 0 24 24" width="18" height="18">
          <path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z" fill="currentColor" />
          <path d="m8.5 12 2.4 2.4L15.8 9.5" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="logo-word">
        ALETHEIA<span className="logo-by">by Satya</span>
      </span>
    </a>
  );
}

function SearchPill({ big = false, initial = "", onSearch }: { big?: boolean; initial?: string; onSearch?: (q: string) => void }) {
  const [q, setQ] = useState(initial);
  return (
    <form
      className={`pill ${big ? "big" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (onSearch) onSearch(q);
        else go(`/lookup?q=${encodeURIComponent(q)}`);
      }}
    >
      <svg className="pill-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden>
        <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" fill="none" />
        <path d="m20 20-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Paste a name, wallet address or document fingerprint" spellCheck={false} />
      <button aria-label="Check">{big ? "Check" : "→"}</button>
    </form>
  );
}

function Nav({ session }: { session: Session | null }) {
  const block = useArkivBlock();
  return (
    <div className="nav-wrap">
      <header className="nav">
        <Logo />
        <div className="nav-search">
          <SearchPill />
        </div>
        <nav className="nav-links">
          <a href="#/verify">Get verified</a>
          <a href="#/lookup">Look up</a>
          <a href="#/document">Check a document</a>
        </nav>
        <span className="live" title="Arkiv Rabdi testnet, read live">
          <span className="pulse" aria-hidden />
          Arkiv {block ? `#${block.toLocaleString()}` : "…"}
        </span>
        {session ? (
          <a className="nav-me" href="#/account">
            {short(session.holder)}
          </a>
        ) : (
          <a className="nav-cta" href="#/verify">
            Sign in
          </a>
        )}
      </header>
    </div>
  );
}

function Shell({ session, dark, children }: { session: Session | null; dark?: boolean; children: ReactNode }) {
  return (
    <div className={`site ${dark ? "has-hero" : ""}`}>
      <div className="demo-bar">Demo network · identities come from a mock DigiLocker with fictional residents · records on Arkiv testnet</div>
      <Nav session={session} />
      <main>{children}</main>
      <footer className="foot">
        <div className="foot-in">
          <Logo />
          <p>People are verified here. Websites are verified by the Satya browser extension. Every record lives on Arkiv and is re-checked in your browser.</p>
          <span>No server · no indexer · ETHGlobal Mumbai 2026</span>
        </div>
      </footer>
    </div>
  );
}

/* ---------------------------------------------------------- identity card */

/** The document fingerprint drawn as bars: each hex digit sets one bar's width. */
function Barcode({ hash }: { hash: string }) {
  const digits = hash.replace(/^0x/, "").split("");
  let x = 0;
  const bars = digits.map((d, i) => {
    const w = 1 + (parseInt(d, 16) % 4);
    const bar = <rect key={i} x={x} y={0} width={w} height={28} />;
    x += w + 1 + ((parseInt(d, 16) >> 2) % 2);
    return bar;
  });
  return (
    <svg className="barcode" viewBox={`0 0 ${x} 28`} preserveAspectRatio="none" aria-label={`Document fingerprint ${hash}`}>
      {bars}
    </svg>
  );
}

/** Semicircle gauge: how many of the three checks passed (owner, signature, expiry). */
function Gauge({ passed, total, ok }: { passed: number; total: number; ok: boolean }) {
  const r = 52;
  const len = Math.PI * r;
  return (
    <div className={`gauge ${ok ? "ok" : "bad"}`}>
      <svg viewBox="0 0 128 72" width="128" height="72" aria-label={`${passed} of ${total} checks passed`}>
        <path d="M12 66 A52 52 0 0 1 116 66" className="g-track" />
        <path d="M12 66 A52 52 0 0 1 116 66" className="g-arc" strokeDasharray={`${(passed / total) * len} ${len}`} />
      </svg>
      <div className="g-num">
        {passed}/{total}
      </div>
      <div className="g-label">{ok ? "Verified" : "Not valid"}</div>
    </div>
  );
}

function IdentityCard({ found, compact }: { found: { signed: SignedIdentity; ok: boolean; reason?: string; key?: string }; compact?: boolean }) {
  const r = found.signed.record;
  const initials = r.name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2);
  const positives = found.ok
    ? [
        "Signed by Mock DigiLocker (demo issuer)",
        "Record is owned by the wallet it names",
        `Valid until ${day(r.expiresAt)}`,
        `Checked against ${/^[AEIOU]/i.test(r.docType) ? "an" : "a"} ${r.docType} (SHA-256 fingerprint)`,
      ]
    : [];
  const negatives = [
    ...(found.ok ? [] : [found.reason ?? "Failed verification"]),
    "Demo issuer: fictional resident, not a real-world identity check",
  ];
  return (
    <article className={`card idc ${found.ok ? "ok" : "bad"} ${compact ? "compact" : ""}`}>
      <div className="idc-top">
        <div className="avatar" aria-hidden>
          {initials}
        </div>
        <div className="idc-who">
          <div className="idc-name">
            {r.name}
            <span className={`badge ${found.ok ? "ok" : "bad"}`}>{found.ok ? "✓ Verified" : "✕ Invalid"}</span>
          </div>
          <div className="idc-wallet mono">{compact ? short(r.holder, 6) : r.holder}</div>
          <div className="facts">
            {describeFacts(r.claims).map((f) => (
              <span key={f} className="fact">
                {f}
              </span>
            ))}
          </div>
        </div>
        <Gauge passed={found.ok ? 3 : 0} total={3} ok={found.ok} />
      </div>
      {!compact && (
        <div className="hl">
          <div className="hl-col">
            <div className="hl-head pos">Positive highlights</div>
            <ul>
              {positives.map((p) => (
                <li key={p} className="pos">
                  {p}
                </li>
              ))}
            </ul>
          </div>
          <div className="hl-col">
            <div className="hl-head neg">Watch out for</div>
            <ul>
              {negatives.map((p) => (
                <li key={p} className="neg">
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {!compact && (
        <dl className="idc-meta">
          <div>
            <dt>Document</dt>
            <dd>{r.docType}</dd>
          </div>
          <div>
            <dt>Valid until</dt>
            <dd>{day(r.expiresAt)}</dd>
          </div>
          <div className="wide">
            <dt>Document SHA-256</dt>
            <dd className="mono">{r.docHash}</dd>
          </div>
        </dl>
      )}
      <Barcode hash={r.docHash} />
      {found.key && (
        <span className="idc-key mono">
          Arkiv entity {short(found.key, 6)}{" "}
          <a href={`${ARKIV_EXPLORER}/entity/${found.key}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            view ↗
          </a>
        </span>
      )}
    </article>
  );
}

/* --------------------------------------------------------------- terminal */

type Line = { kind: "cmd" | "out" | "ok" | "err"; text: string };

/** Runs a real Arkiv query and records each step it actually took, then the results. */
function useQuery() {
  const [lines, setLines] = useState<Line[]>([]);
  const [rows, setRows] = useState<FoundIdentity[]>();
  const [busy, setBusy] = useState(false);
  const run = async (input: string) => {
    const v = input.trim();
    const query = !v
      ? ({ recent: true } as const)
      : /^0x[0-9a-fA-F]{64}$/.test(v)
        ? { docHash: v as Hex }
        : isAddress(v)
          ? { holder: v as Address }
          : { name: v };
    const where =
      "recent" in query
        ? "ORDER BY published DESC LIMIT 20"
        : "docHash" in query
          ? `docHash = "${short(v, 6)}"`
          : "holder" in query
            ? `holder = ${short(v)}`
            : `nameKey = "${v.toLowerCase().replace(/\s+/g, " ")}"`;
    setBusy(true);
    setRows(undefined);
    const out: Line[] = [{ kind: "cmd", text: `arkiv.query  satya_identity_v1  ${where}` }];
    setLines([...out]);
    const t0 = performance.now();
    try {
      const found = await findIdentities(query, ARKIV_KEY);
      out.push({ kind: "out", text: `${found.length} record${found.length === 1 ? "" : "s"} · ${Math.round(performance.now() - t0)} ms · Rabdi testnet` });
      for (const f of found) {
        const r = f.signed.record;
        out.push({ kind: "cmd", text: `verify  ${short(f.key, 6)}  "${r.name}"` });
        if (f.check.ok) {
          out.push({ kind: "ok", text: `owner == holder ${short(r.holder)}  ✓` });
          out.push({ kind: "ok", text: `eip712 signer → ${f.check.issuer.name}  ✓` });
          out.push({ kind: "ok", text: `expires ${day(r.expiresAt)}  ✓` });
        } else {
          out.push({ kind: "err", text: `rejected: ${f.check.reason}` });
        }
      }
      if (!found.length) out.push({ kind: "out", text: "no verified record matches" });
      setRows(found);
    } catch (e) {
      out.push({ kind: "err", text: e instanceof Error ? e.message.split("\n")[0]! : String(e) });
      setRows([]);
    }
    setLines([...out]);
    setBusy(false);
  };
  return { lines, rows, busy, run };
}

function Terminal({ lines, busy }: { lines: Line[]; busy: boolean }) {
  return (
    <details className="how" open>
      <summary>How this was checked · live on Arkiv</summary>
      <pre className="term" aria-live="polite">
        {lines.map((l, i) => (
          <div key={i} className={`tl ${l.kind}`} style={{ animationDelay: `${i * 60}ms` }}>
            <span className="tl-p">{l.kind === "cmd" ? "›" : l.kind === "err" ? "!" : " "}</span> {l.text}
          </div>
        ))}
        {busy && <div className="tl out">querying…</div>}
      </pre>
    </details>
  );
}

function QueryBox({ initial = "", autoRun = false }: { initial?: string; autoRun?: boolean; big?: boolean }) {
  const { lines, rows, busy, run } = useQuery();
  useEffect(() => {
    if (autoRun) void run(initial);
  }, []);
  return (
    <div className="query">
      <SearchPill
        big
        initial={initial}
        onSearch={(q) => {
          void run(q);
          history.replaceState(null, "", `#/lookup?q=${encodeURIComponent(q)}`);
        }}
      />
      {rows && rows.length > 0 && (
        <div className="results">
          {rows.map((f) => (
            <div key={f.key} className="result-link" role="link" tabIndex={0} onClick={() => go(`/u/${f.signed.record.holder}`)} onKeyDown={(e) => e.key === "Enter" && go(`/u/${f.signed.record.holder}`)}>
              <IdentityCard found={{ signed: f.signed, ok: f.check.ok, reason: f.check.ok ? undefined : f.check.reason, key: f.key }} compact />
            </div>
          ))}
        </div>
      )}
      {rows && rows.length === 0 && !busy && <div className="card empty">No verified record matches. Names must match exactly (any case).</div>}
      {lines.length > 0 && <Terminal lines={lines} busy={busy} />}
    </div>
  );
}

/* ------------------------------------------------------------------- home */

function RecentList() {
  const [rows, setRows] = useState<FoundIdentity[]>();
  useEffect(() => {
    findIdentities({ recent: true }, ARKIV_KEY, 5)
      .then(setRows)
      .catch(() => setRows([]));
  }, []);
  if (!rows) return <p className="muted">Reading Arkiv…</p>;
  if (!rows.length) return <p className="muted">No one has published yet.</p>;
  return (
    <ul className="recent">
      {rows.map((f) => (
        <li key={f.key}>
          <a href={`#/u/${f.signed.record.holder}`}>
            <span className="avatar sm">{f.signed.record.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}</span>
            <span className="recent-name">{f.signed.record.name}</span>
            <span className={`badge ${f.check.ok ? "ok" : "bad"}`}>{f.check.ok ? "✓ Verified" : "✕"}</span>
            <span className="mono muted">{short(f.signed.record.holder)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function Home() {
  return (
    <>
      <section className="hero">
        <div className="hero-in">
          <h1>
            Trust the <span className="hl-word">proof</span>,
            <br />
            not the profile.
          </h1>
          <SearchPill big />
          <p className="hero-sub">
            Try{" "}
            <a href="#/lookup?q=Asha%20Verma">Asha Verma</a> · or <a href="#/verify">get verified</a> with a mock DigiLocker in under a minute
          </p>
        </div>
      </section>

      <section className="band">
        <div className="band-in">
          <div className="steps">
            <div className="card step">
              <span className="step-n">1</span>
              <h3>Get verified</h3>
              <p>Sign in with mock DigiLocker and upload a document. The issuer signs your name and the document's fingerprint, bound to your wallet.</p>
              <a className="btn" href="#/verify">
                Get verified
              </a>
            </div>
            <div className="card step">
              <span className="step-n">2</span>
              <h3>Stored on Arkiv</h3>
              <p>One record per person, owned by their own wallet. Searchable by name, wallet or document. No server, no indexer.</p>
              <a className="btn ghost" href="#/lookup">
                Browse records
              </a>
            </div>
            <div className="card step">
              <span className="step-n">3</span>
              <h3>Checked anywhere</h3>
              <p>Every result's signature, owner and expiry is re-checked in the browser. The Satya extension names verified wallets on any page.</p>
              <a className="btn ghost" href="#/document">
                Check a document
              </a>
            </div>
          </div>

          <div className="split2">
            <div className="card">
              <h3>Recently verified</h3>
              <RecentList />
            </div>
            <div className="card">
              <h3>What's public, what's not</h3>
              <div className="pp">
                <div>
                  <div className="hl-head pos">On Arkiv</div>
                  <ul>
                    <li className="pos">Name and wallet</li>
                    <li className="pos">Document type and SHA-256 fingerprint</li>
                    <li className="pos">Facts: 18+, nationality, ID valid</li>
                    <li className="pos">The issuer's signature</li>
                  </ul>
                </div>
                <div>
                  <div className="hl-head neg">Never stored</div>
                  <ul>
                    <li className="neg">The document itself</li>
                    <li className="neg">Date of birth</li>
                    <li className="neg">ID number or address</li>
                    <li className="neg">Photo</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

/* ----------------------------------------------------------------- verify */

function Verify({ session }: { session: Session | null }) {
  const [error, setError] = useState<string>();
  const start = async (wallet: Session["wallet"]) => {
    try {
      setError(undefined);
      const holder = wallet === "metamask" ? await metamask() : demoWallet();
      const state = crypto.randomUUID();
      sessionStorage.setItem("aletheia-state", JSON.stringify({ state, holder, wallet }));
      go(`/mock-digilocker/authorize?${new URLSearchParams({ client_id: "aletheia", scope: "identity", holder, state })}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <section className="panel narrow">
      <p className="kicker">Get verified</p>
      <h2>Sign in with DigiLocker (mock)</h2>
      <p className="dim">
        You'll pick a fictional resident, upload a document, and approve what's shared. The issuer signs your name, the document's
        fingerprint and the facts it confirms, bound to your wallet.
      </p>
      {session?.identity && (
        <p className="note">
          You're already verified in this tab. <a href="#/account">See your record</a>.
        </p>
      )}
      <div className="stack">
        <button className="btn" onClick={() => void start("metamask")}>
          Continue with MetaMask
        </button>
        <button className="btn ghost" onClick={() => void start("demo")}>
          Continue with a demo wallet
        </button>
      </div>
      <p className="dim small">Publishing to Arkiv needs MetaMask with a little test GLM. A demo wallet can sign in and see its record, but not publish.</p>
      {error && <p className="err">{error}</p>}
    </section>
  );
}

/* ---------------------------------------------------------- mock DigiLocker */

function MockDigiLocker({ params }: { params: URLSearchParams }) {
  const [resident, setResident] = useState<(typeof RESIDENTS)[number]>();
  const [file, setFile] = useState<File>();
  const [hash, setHash] = useState<Hex>();
  const [busy, setBusy] = useState(false);
  const holder = params.get("holder") ?? "";
  const state = params.get("state") ?? "";
  const back = (q: Record<string, string>) => go(`/callback?${new URLSearchParams({ ...q, state })}`);

  useEffect(() => {
    setHash(undefined);
    if (file) void file.arrayBuffer().then(fingerprint).then(setHash);
  }, [file]);

  if (params.get("client_id") !== "aletheia" || !isAddress(holder) || !state) {
    return (
      <div className="dl-page">
        <div className="dl-card">
          <h2>Invalid sign-in request</h2>
        </div>
      </div>
    );
  }

  const allow = async () => {
    if (!resident || !hash) return;
    setBusy(true);
    let identity: string | undefined;
    let refused: string | undefined;
    try {
      identity = serializeIdentity(await issueIdentity(holder, resident, resident.docType, hash));
    } catch (e) {
      refused = e instanceof ClaimRefusedError ? e.message : String(e);
    }
    // Stands in for the OAuth code exchange.
    const code = crypto.randomUUID();
    sessionStorage.setItem(`dl-code-${code}`, JSON.stringify({ identity, refused }));
    back({ code });
  };

  const step = !resident ? 1 : !hash ? 2 : 3;
  return (
    <div className="dl-page">
      <div className="dl-strip">MOCK DIGILOCKER · demo issuer for Satya · not the real DigiLocker or any government service · fictional residents only</div>
      <div className="dl-card">
        <div className="dl-head">
          <span className="dl-logo" aria-hidden>
            ⬚
          </span>
          <div>
            <div className="dl-title">Mock DigiLocker</div>
            <div className="dl-sub">Demo issuer 0x48D4…9BaB · step {step} of 3</div>
          </div>
        </div>

        {step === 1 && (
          <>
            <h2>Sign in as a test resident</h2>
            <ul className="dl-residents">
              {RESIDENTS.map((r) => (
                <li key={r.id}>
                  <button onClick={() => setResident(r)}>
                    <b>{r.name}</b>
                    <span>{r.note}</span>
                  </button>
                </li>
              ))}
            </ul>
            <button className="dl-link" onClick={() => back({ error: "access_denied" })}>
              Cancel
            </button>
          </>
        )}

        {resident && step === 2 && (
          <>
            <h2>Upload your {resident.docType}</h2>
            <p className="dl-muted">
              The file is fingerprinted (SHA-256) in this browser. Only the fingerprint is signed; the file isn't uploaded anywhere.
            </p>
            <label className="dl-drop">
              <input type="file" onChange={(e) => setFile(e.target.files?.[0])} />
              {file ? <>Reading {file.name}…</> : <>Choose a file (PDF, image, anything)</>}
            </label>
            <button className="dl-link" onClick={() => setFile(sampleDocument(resident.name, resident.docType))}>
              No file? Use a sample demo document
            </button>
          </>
        )}

        {resident && file && hash && (
          <>
            <h2>
              <b>Aletheia</b> wants to verify you
            </h2>
            <div className="dl-file">
              <b>{file.name}</b>
              <span>
                {(file.size / 1024).toFixed(1)} KB · SHA-256 <span className="mono">{short(hash, 6)}</span>
              </span>
              {file.name.includes("-demo-") && (
                <a
                  href={URL.createObjectURL(file)}
                  download={file.name}
                  className="dl-link"
                  title="Keep it to test 'Check a document' later"
                >
                  Download this sample
                </a>
              )}
            </div>
            <p className="dl-muted">If you allow, the issuer signs and Aletheia may publish publicly:</p>
            <ul className="dl-scope">
              <li>✓ Your name: {resident.name}</li>
              <li>✓ Document type and its fingerprint</li>
              <li>✓ Facts: 18+ (yes/no), nationality, ID valid</li>
            </ul>
            <p className="dl-muted">
              Never shared: date of birth, ID number, address, the document itself. Bound to wallet <span className="mono">{short(holder)}</span>.
            </p>
            <div className="dl-actions">
              <button className="dl-allow" disabled={busy} onClick={() => void allow()}>
                {busy ? "Signing…" : "Allow"}
              </button>
              <button className="dl-deny" disabled={busy} onClick={() => back({ error: "access_denied" })}>
                Deny
              </button>
            </div>
          </>
        )}
        {resident && (
          <button
            className="dl-link"
            onClick={() => {
              setResident(undefined);
              setFile(undefined);
            }}
          >
            Start over
          </button>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- callback */

function Callback({ params, onDone }: { params: URLSearchParams; onDone: () => void }) {
  const [error, setError] = useState<string>();
  useEffect(() => {
    void (async () => {
      const expected = JSON.parse(sessionStorage.getItem("aletheia-state") ?? "null") as { state: string; holder: Address; wallet: Session["wallet"] } | null;
      sessionStorage.removeItem("aletheia-state");
      if (!expected || params.get("state") !== expected.state) return setError("This sign-in didn't start here.");
      if (params.get("error")) return setError("You cancelled at DigiLocker.");
      const code = params.get("code") ?? "";
      const raw = sessionStorage.getItem(`dl-code-${code}`);
      sessionStorage.removeItem(`dl-code-${code}`);
      if (!raw) return setError("That sign-in code was already used.");
      const { identity, refused } = JSON.parse(raw) as { identity?: string; refused?: string };
      let accepted: string | undefined;
      let why = refused;
      if (identity) {
        // Never trust what came back: check signature, issuer, wallet and expiry.
        const v = await verifyIdentity(parseIdentity(identity), expected.holder);
        if (v.ok) accepted = identity;
        else why = `The signed record failed verification: ${v.reason}`;
      }
      saveSession({ holder: expected.holder, wallet: expected.wallet, identity: accepted, refused: why });
      onDone();
      go("/account");
    })();
  }, [params]);
  return <section className="panel narrow">{error ? <p className="err">{error}</p> : <p>Checking the signed record…</p>}</section>;
}

/* ---------------------------------------------------------------- account */

function Account({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const signed = session.identity ? parseIdentity(session.identity) : undefined;
  const [published, setPublished] = useState<{ key: string; tx: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const publish = async () => {
    if (!signed) return;
    setBusy(true);
    setError(undefined);
    try {
      if (!window.ethereum) throw new Error("Publishing needs MetaMask.");
      const writer = await arkivBrowserWriter(window.ethereum, session.holder, ARKIV_KEY);
      const r = await publishIdentity(writer, signed);
      setPublished({ key: r.entityKey, tx: r.txHash });
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0]! : String(e));
    } finally {
      setBusy(false);
    }
  };
  const adult = signed?.record.claims.split(",").includes("age_over_18");
  return (
    <div className="grid2">
      <section className="panel">
        <p className="kicker">Your verified record</p>
        {signed ? <IdentityCard found={{ signed, ok: true }} /> : <p className="err">No record: {session.refused}</p>}
        <p className="dim small">Signed by the mock issuer and checked in your browser before Aletheia accepted it.</p>
      </section>
      <div className="stack">
        <section className="panel">
          <p className="kicker">Make it findable</p>
          <h3>Publish to Arkiv</h3>
          <p className="dim small">One record, owned by your wallet, searchable by name, wallet or document fingerprint. Anyone can verify the issuer's signature.</p>
          <button className="btn" disabled={busy || !signed || session.wallet !== "metamask" || !!published} onClick={() => void publish()}>
            {published ? "Published" : busy ? "Publishing…" : "Publish my record"}
          </button>
          {session.wallet !== "metamask" && <p className="dim small">Needs MetaMask (a little test GLM on Arkiv).</p>}
          {published && (
            <p className="ok small">
              ✓ On Arkiv:{" "}
              <a href={`${ARKIV_EXPLORER}/entity/${published.key}`} target="_blank" rel="noreferrer">
                {short(published.key)} ↗
              </a>{" "}
              · <a href={`#/u/${session.holder}`}>public profile</a>
            </p>
          )}
          {error && <p className="err small">{error}</p>}
        </section>
        <section className={`panel gate ${adult ? "open" : "shut"}`}>
          <p className="kicker">Example: an 18+ area</p>
          <h3>{adult ? "Unlocked" : "Locked"}</h3>
          <p className="dim small">{adult ? "Your record says 18+. Aletheia never saw your date of birth." : "Needs a verified 18+ record."}</p>
        </section>
        <button className="btn ghost" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- lookup */

function Results({ rows }: { rows?: FoundIdentity[] }) {
  if (!rows) return <p className="dim mono">querying arkiv…</p>;
  if (!rows.length) return <p className="dim">No verified record found.</p>;
  return (
    <div className="results">
      {rows.map((f) => (
        <div key={f.key} className="result-link" role="link" tabIndex={0} onClick={() => go(`/u/${f.signed.record.holder}`)} onKeyDown={(e) => e.key === "Enter" && go(`/u/${f.signed.record.holder}`)}>
          <IdentityCard found={{ signed: f.signed, ok: f.check.ok, reason: f.check.ok ? undefined : f.check.reason, key: f.key }} compact />
        </div>
      ))}
    </div>
  );
}

function Lookup({ params }: { params: URLSearchParams }) {
  return (
    <section className="panel">
      <p className="kicker">Look up</p>
      <h2>Who's verified?</h2>
      <p className="dim small">Full name (exact, any case), wallet address, or a document's SHA-256. Straight from Arkiv; every result re-checked here.</p>
      <QueryBox initial={params.get("q") ?? ""} autoRun big />
    </section>
  );
}

/* --------------------------------------------------------------- document */

function DocumentCheck() {
  const [file, setFile] = useState<File>();
  const [hash, setHash] = useState<Hex>();
  const [rows, setRows] = useState<FoundIdentity[]>();
  const [error, setError] = useState<string>();
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!file) return;
    setRows(undefined);
    setError(undefined);
    void file
      .arrayBuffer()
      .then(fingerprint)
      .then((h) => {
        setHash(h);
        return findIdentities({ docHash: h }, ARKIV_KEY);
      })
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [file]);
  return (
    <section className="panel">
      <p className="kicker">Check a document</p>
      <h2>Was this exact file verified?</h2>
      <div
        className={`drop ${drag ? "over" : ""}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          setFile(e.dataTransfer.files[0]);
        }}
      >
        <input ref={input} type="file" hidden onChange={(e) => setFile(e.target.files?.[0])} />
        {file ? (
          <>
            <b>{file.name}</b>
            <span className="mono small">{hash ? `SHA-256 ${hash}` : "Fingerprinting…"}</span>
          </>
        ) : (
          <>
            <b>Drop a file here</b>
            <span className="dim small">or click to choose. It's fingerprinted on your device and never uploaded.</span>
          </>
        )}
      </div>
      {error && <p className="err">{error}</p>}
      {hash && (rows?.length === 0 ? <p className="dim">No verified record uses this exact file. Even a one-byte change gives a different fingerprint.</p> : <Results rows={rows} />)}
    </section>
  );
}

/* ---------------------------------------------------------------- profile */

function Profile({ address }: { address: string }) {
  const [rows, setRows] = useState<FoundIdentity[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!isAddress(address)) return setError("Not a wallet address.");
    findIdentities({ holder: address }, ARKIV_KEY)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [address]);
  return (
    <section className="panel">
      <p className="kicker">Verification report</p>
      {/* The wallet is written out in full so the Satya extension can recognise it on this page. */}
      <h2 className="mono wallet-h">{address}</h2>
      {error ? (
        <p className="err">{error}</p>
      ) : !rows ? (
        <p className="muted">Reading Arkiv…</p>
      ) : !rows.length ? (
        <p className="muted">No verified record for this wallet.</p>
      ) : (
        <div className="report">
          {rows.map((f) => (
            <IdentityCard key={f.key} found={{ signed: f.signed, ok: f.check.ok, reason: f.check.ok ? undefined : f.check.reason, key: f.key }} />
          ))}
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------- app */

export function App() {
  const route = useRoute();
  const [session, setSession] = useState(loadSession);
  const refresh = () => setSession(loadSession());

  if (route.path === "/mock-digilocker/authorize") return <MockDigiLocker params={route.params} />;

  let page: ReactNode;
  if (route.path === "/callback") page = <Callback params={route.params} onDone={refresh} />;
  else if (route.path === "/verify") page = <Verify session={session} />;
  else if (route.path === "/lookup") page = <Lookup params={route.params} />;
  else if (route.path === "/document") page = <DocumentCheck />;
  else if (route.path.startsWith("/u/")) page = <Profile address={route.path.slice(3)} />;
  else if (route.path === "/account" && session)
    page = (
      <Account
        session={session}
        onSignOut={() => {
          saveSession(null);
          setSession(null);
          go("/");
        }}
      />
    );
  else page = <Home />;
  return (
    <Shell session={session} dark={page !== null && route.path === "/"}>
      <div className={route.path === "/" ? "" : "page"}>{page}</div>
    </Shell>
  );
}
