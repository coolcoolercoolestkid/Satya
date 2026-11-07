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

function Nav({ session }: { session: Session | null }) {
  const block = useArkivBlock();
  return (
    <header className="nav">
      <a className="logo" href="#/">
        <span className="logo-glyph" aria-hidden>
          Α
        </span>
        <span>ALETHEIA</span>
        <span className="logo-sub">/ SATYA NETWORK</span>
      </a>
      <nav className="nav-links">
        <a href="#/verify">[01] Verify</a>
        <a href="#/lookup">[02] Query</a>
        <a href="#/document">[03] Document</a>
      </nav>
      <div className="nav-right">
        <span className="live" title="Arkiv Rabdi testnet, read live">
          <span className="pulse" aria-hidden />
          ARKIV {block ? `#${block.toLocaleString()}` : "…"}
        </span>
        {session ? (
          <a className="nav-me" href="#/account">
            {short(session.holder)}
          </a>
        ) : null}
      </div>
    </header>
  );
}

function Shell({ session, children }: { session: Session | null; children: ReactNode }) {
  return (
    <div className="site">
      <div className="grid-bg" aria-hidden />
      <div className="demo-bar">DEMO NETWORK — identities come from a mock DigiLocker with fictional residents — Arkiv testnet</div>
      <Nav session={session} />
      <main className="wrap">{children}</main>
      <footer className="foot">
        <span>ALETHEIA × SATYA</span>
        <span>PEOPLE → ALETHEIA · WEBSITES → SATYA EXTENSION · RECORDS → ARKIV</span>
        <span>NO INDEXER · NO SERVER · VERIFIED IN YOUR BROWSER</span>
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

function IdentityCard({ found, compact }: { found: { signed: SignedIdentity; ok: boolean; reason?: string; key?: string }; compact?: boolean }) {
  const r = found.signed.record;
  return (
    <article className={`pass ${found.ok ? "ok" : "bad"} ${compact ? "compact" : ""}`}>
      <span className="corner tl" />
      <span className="corner tr" />
      <span className="corner bl" />
      <span className="corner br" />
      <div className="pass-head">
        <span className="pass-kind">IDENTITY / {r.docType.toUpperCase()}</span>
        <span className={`status ${found.ok ? "ok" : "bad"}`}>{found.ok ? "● VERIFIED" : "✕ INVALID"}</span>
      </div>
      <div className="pass-name">{r.name}</div>
      <div className="pass-wallet mono">{compact ? short(r.holder, 6) : r.holder}</div>
      <div className="facts">
        {describeFacts(r.claims).map((f) => (
          <span key={f} className="fact">
            {f}
          </span>
        ))}
      </div>
      {!compact && (
        <dl className="pass-meta">
          <div>
            <dt>ISSUER</dt>
            <dd>Mock DigiLocker (demo)</dd>
          </div>
          <div>
            <dt>VALID UNTIL</dt>
            <dd>{day(r.expiresAt)}</dd>
          </div>
          <div className="wide">
            <dt>DOCUMENT SHA-256</dt>
            <dd className="mono">{r.docHash}</dd>
          </div>
        </dl>
      )}
      <Barcode hash={r.docHash} />
      {!found.ok && found.reason && <p className="err">{found.reason}</p>}
      {found.key && (
        <span className="pass-key mono">
          ARKIV ENTITY {short(found.key, 6)}{" "}
          <a href={`${ARKIV_EXPLORER}/entity/${found.key}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            ↗
          </a>
        </span>
      )}
    </article>
  );
}

/* --------------------------------------------------------------- terminal */

type Line = { kind: "cmd" | "out" | "ok" | "err"; text: string };

/** Runs a real Arkiv query and prints each step it actually took, then the results. */
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
    <pre className="term" aria-live="polite">
      {lines.map((l, i) => (
        <div key={i} className={`tl ${l.kind}`} style={{ animationDelay: `${i * 70}ms` }}>
          <span className="tl-p">{l.kind === "cmd" ? ">" : l.kind === "err" ? "!" : "<"}</span> {l.text}
        </div>
      ))}
      {busy && (
        <div className="tl out">
          <span className="tl-p">&lt;</span> <span className="caret">█</span>
        </div>
      )}
    </pre>
  );
}

function QueryBox({ initial = "", autoRun = false, big = false }: { initial?: string; autoRun?: boolean; big?: boolean }) {
  const [q, setQ] = useState(initial);
  const { lines, rows, busy, run } = useQuery();
  useEffect(() => {
    if (autoRun) void run(initial);
  }, []);
  return (
    <div className={`query ${big ? "big" : ""}`}>
      <form
        className="prompt"
        onSubmit={(e) => {
          e.preventDefault();
          void run(q);
          history.replaceState(null, "", `#/lookup?q=${encodeURIComponent(q)}`);
        }}
      >
        <span className="prompt-sym">$</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="name · wallet 0x… · document sha-256" spellCheck={false} />
        <button disabled={busy}>RUN ↵</button>
      </form>
      {lines.length > 0 && <Terminal lines={lines} busy={busy} />}
      {rows && rows.length > 0 && (
        <div className="results">
          {rows.map((f) => (
            <a key={f.key} className="result-link" href={`#/u/${f.signed.record.holder}`}>
              <IdentityCard found={{ signed: f.signed, ok: f.check.ok, reason: f.check.ok ? undefined : f.check.reason, key: f.key }} compact />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- home */

function Home() {
  return (
    <>
      <section className="hero">
        <div className="hero-left">
          <p className="tag">
            <span className="tag-dot" /> TRUST INFRASTRUCTURE · ON ARKIV
          </p>
          <h1>
            Verify the
            <br />
            <span className="hl">person</span>.
            <br />
            Verify the
            <br />
            <span className="hl">site</span>.
          </h1>
          <p className="lede">
            Aletheia binds a name and a document fingerprint to a wallet, signed by an issuer and stored on Arkiv, so anyone can query
            it. The Satya extension scores websites, and names verified wallets wherever they appear.
          </p>
          <div className="cta">
            <a className="btn" href="#/verify">
              GET VERIFIED →
            </a>
            <a className="btn line" href="#/document">
              CHECK A DOCUMENT
            </a>
          </div>
        </div>
        <div className="hero-right">
          <div className="console">
            <div className="console-bar">
              <span>QUERY CONSOLE</span>
              <span className="dim">satya_identity_v1</span>
            </div>
            <QueryBox autoRun />
          </div>
        </div>
      </section>

      <section className="spec">
        <div className="spec-cell">
          <span className="spec-n">01</span>
          <h3>Verify</h3>
          <p>Mock DigiLocker signs name, document type, SHA-256 of the file you showed it, and the facts it confirms. EIP-712, bound to your wallet.</p>
        </div>
        <div className="spec-cell">
          <span className="spec-n">02</span>
          <h3>Store</h3>
          <p>One Arkiv entity per person, owned by their wallet, indexed by name, wallet and fingerprint. Expires with the ID.</p>
        </div>
        <div className="spec-cell">
          <span className="spec-n">03</span>
          <h3>Query</h3>
          <p>Anyone queries Arkiv directly. No indexer, no server. Every result's owner and signature is re-checked in the browser.</p>
        </div>
        <div className="spec-cell">
          <span className="spec-n">04</span>
          <h3>Recognise</h3>
          <p>The Satya extension finds wallets on any page and shows who's verified, next to the site's own 0–100 trust score.</p>
        </div>
      </section>

      <section className="ledger">
        <div>
          <span className="ledger-k">PUBLIC ON ARKIV</span>
          <p>name · wallet · document type · document SHA-256 · facts · issuer signature</p>
        </div>
        <div>
          <span className="ledger-k off">NEVER STORED</span>
          <p>the document · date of birth · ID number · address · photo</p>
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
      <p className="kicker">[01] VERIFY</p>
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
        <a key={f.key} className="result-link" href={`#/u/${f.signed.record.holder}`}>
          <IdentityCard found={{ signed: f.signed, ok: f.check.ok, reason: f.check.ok ? undefined : f.check.reason, key: f.key }} compact />
        </a>
      ))}
    </div>
  );
}

function Lookup({ params }: { params: URLSearchParams }) {
  return (
    <section className="panel">
      <p className="kicker">[02] QUERY</p>
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
      <p className="kicker">[03] DOCUMENT</p>
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
      <p className="kicker">PROFILE</p>
      {/* The wallet is written out in full so the Satya extension can recognise it on this page. */}
      <h2 className="mono wallet-h">{address}</h2>
      {error ? <p className="err">{error}</p> : <Results rows={rows} />}
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
  return <Shell session={session}>{page}</Shell>;
}
