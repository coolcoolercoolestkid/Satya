import {
  arkivBrowserWriter,
  ClaimRefusedError,
  issueClaim,
  publishAttestation,
  type ClaimId,
  type DocumentDetails,
  type SignedAttestation,
} from "@satya/identity";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { AadhaarTab } from "./AadhaarTab";
import { EvidenceTab } from "./EvidenceTab";
import { loadVerifiedProofs, type CheckedProof } from "./proofs";
import { ARKIV_EXPLORER, ARKIV_FAUCET, ARKIV_KEY, connect, ensNameOf, ensText, provider, resolveTarget, short } from "./wallet";

type Tab = "verify" | "aadhaar" | "link" | "check" | "company" | "evidence";

const PERSONAS: { label: string; doc: DocumentDetails }[] = [
  { label: "Adult · India", doc: { dateOfBirth: "1999-04-12", nationality: "IN", documentExpiry: "2031-06-30" } },
  { label: "Adult · USA", doc: { dateOfBirth: "1992-09-03", nationality: "US", documentExpiry: "2029-02-14" } },
  { label: "Minor · India", doc: { dateOfBirth: "2010-01-20", nationality: "IN", documentExpiry: "2030-01-01" } },
  { label: "Expired ID · India", doc: { dateOfBirth: "1988-07-07", nationality: "IN", documentExpiry: "2024-03-31" } },
];

const CLAIMS: { id: ClaimId; label: string }[] = [
  { id: "age_over_18", label: "I am 18+" },
  { id: "nationality", label: "My nationality" },
  { id: "id_valid", label: "My ID is valid" },
];

function useWallet() {
  const [address, setAddress] = useState<Address>();
  const [ens, setEns] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const doConnect = async () => {
    try {
      setError(undefined);
      const a = await connect();
      setAddress(a);
      setEns(await ensNameOf(a));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return { address, ens, error, connect: doConnect };
}

function ProofList({ proofs }: { proofs: CheckedProof[] }) {
  if (!proofs.length) return <p className="muted">No proofs found on Arkiv for this wallet.</p>;
  return (
    <ul className="proofs">
      {proofs.map((p) => (
        <li key={p.key} className={p.ok ? "ok" : "bad"}>
          <span className="badge">{p.ok ? "✓" : "✕"}</span>
          <div>
            <strong>{p.label}</strong>
            <div className="muted small">
              {p.detail}
              {p.ok && p.expiresAt ? ` · valid until ${p.expiresAt.toISOString().slice(0, 10)}` : ""}
            </div>
            <a className="small" href={`${ARKIV_EXPLORER}/entity/${p.key}`} target="_blank" rel="noreferrer">
              Arkiv record
            </a>
          </div>
        </li>
      ))}
    </ul>
  );
}

function GetVerified({ wallet }: { wallet: ReturnType<typeof useWallet> }) {
  const [doc, setDoc] = useState<DocumentDetails>(PERSONAS[0]!.doc);
  const [claims, setClaims] = useState<ClaimId[]>(["age_over_18", "nationality"]);
  const [issued, setIssued] = useState<SignedAttestation[]>([]);
  const [messages, setMessages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState<{ claim: string; key: string; tx: string }[]>([]);

  const issue = async () => {
    if (!wallet.address) return;
    const out: SignedAttestation[] = [];
    const msgs: string[] = [];
    for (const c of claims) {
      try {
        out.push(await issueClaim(wallet.address, c, doc));
      } catch (e) {
        msgs.push(e instanceof ClaimRefusedError ? `✕ ${CLAIMS.find((x) => x.id === c)?.label}: ${e.message}` : String(e));
      }
    }
    setIssued(out);
    setMessages(msgs);
    setPublished([]);
  };

  const publish = async () => {
    if (!wallet.address || !issued.length) return;
    setBusy(true);
    try {
      const writer = await arkivBrowserWriter(provider(), wallet.address, ARKIV_KEY);
      const done: typeof published = [];
      for (const s of issued) {
        const r = await publishAttestation(writer, s);
        done.push({ claim: s.attestation.claim, key: r.entityKey, tx: r.txHash });
        setPublished([...done]);
      }
    } catch (e) {
      setMessages((m) => [...m, `Publishing failed: ${e instanceof Error ? e.message : String(e)}`]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2>1. Your document</h2>
      <p className="muted">
        A <strong>mock DigiLocker</strong> issuer reads these details in your browser and signs only the claims that are
        true. Your date of birth is never stored or published. (Real DigiLocker access needs government approval, so this
        demo issuer is clearly labelled everywhere.)
      </p>
      <div className="row wrap">
        {PERSONAS.map((p) => (
          <button key={p.label} className={doc === p.doc ? "chip active" : "chip"} onClick={() => setDoc(p.doc)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="grid3">
        <label>
          Date of birth
          <input type="date" value={doc.dateOfBirth} onChange={(e) => setDoc({ ...doc, dateOfBirth: e.target.value })} />
        </label>
        <label>
          Nationality (code)
          <input value={doc.nationality} maxLength={2} onChange={(e) => setDoc({ ...doc, nationality: e.target.value.toUpperCase() })} />
        </label>
        <label>
          ID valid until
          <input type="date" value={doc.documentExpiry} onChange={(e) => setDoc({ ...doc, documentExpiry: e.target.value })} />
        </label>
      </div>

      <h2>2. What do you want to prove?</h2>
      <div className="row wrap">
        {CLAIMS.map((c) => (
          <label key={c.id} className="check">
            <input
              type="checkbox"
              checked={claims.includes(c.id)}
              onChange={(e) => setClaims(e.target.checked ? [...claims, c.id] : claims.filter((x) => x !== c.id))}
            />
            {c.label}
          </label>
        ))}
      </div>
      {!wallet.address ? (
        <button className="primary" onClick={wallet.connect}>Connect wallet</button>
      ) : (
        <button className="primary" onClick={issue} disabled={!claims.length}>Get signed claims</button>
      )}
      {messages.map((m, i) => <p key={i} className="error">{m}</p>)}
      {issued.length > 0 && (
        <>
          <p className="success">✓ Signed: {issued.map((s) => s.attestation.claim).join(", ")}. Nothing else about you is in them.</p>
          <h2>3. Publish to Arkiv</h2>
          <p className="muted">
            Each claim becomes a record owned by your wallet on Arkiv's testnet, and it expires when your ID does. Your
            wallet will switch to Arkiv (Rabdi) and needs a little test GLM from the{" "}
            <a href={ARKIV_FAUCET} target="_blank" rel="noreferrer">faucet</a>.
          </p>
          <button className="primary" onClick={publish} disabled={busy}>{busy ? "Publishing…" : "Publish proofs"}</button>
          {published.map((p) => (
            <p key={p.key} className="small">
              ✓ {p.claim}:{" "}
              <a href={`${ARKIV_EXPLORER}/entity/${p.key}`} target="_blank" rel="noreferrer">{short(p.key)}</a>
            </p>
          ))}
        </>
      )}
    </section>
  );
}

function LinkProfile({ wallet }: { wallet: ReturnType<typeof useWallet> }) {
  const [records, setRecords] = useState<Record<string, string | null>>({});
  useEffect(() => {
    if (!wallet.ens) return;
    void Promise.all(["com.twitter", "com.github"].map(async (k) => [k, await ensText(wallet.ens!, k)] as const)).then(
      (entries) => setRecords(Object.fromEntries(entries)),
    );
  }, [wallet.ens]);
  return (
    <section>
      <h2>Prove you own your profiles</h2>
      <p className="muted">
        Two steps make a two-way link that impersonators can't copy: put your ENS name in your X or GitHub bio, and set the
        matching text record on your ENS name. Satya then shows ✓ on your real profile and ⚠ on anyone else showing your
        name.
      </p>
      {!wallet.address && <button className="primary" onClick={wallet.connect}>Connect wallet</button>}
      {wallet.address && !wallet.ens && (
        <p className="error">This wallet has no primary ENS name. Set one at app.ens.domains first.</p>
      )}
      {wallet.ens && (
        <>
          <ol>
            <li>Add <code>{wallet.ens}</code> to your X / GitHub bio.</li>
            <li>
              At <a href={`https://app.ens.domains/${wallet.ens}`} target="_blank" rel="noreferrer">app.ens.domains/{wallet.ens}</a>,
              set the <code>com.twitter</code> or <code>com.github</code> record to your handle.
            </li>
          </ol>
          <table>
            <tbody>
              {Object.entries(records).map(([k, v]) => (
                <tr key={k}>
                  <td><code>{k}</code></td>
                  <td>{v ? <span className="success">✓ {v}</span> : <span className="muted">not set</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function CheckSomeone() {
  const [input, setInput] = useState("");
  const [state, setState] = useState<{ loading?: boolean; error?: string; target?: { address: Address; name?: string }; proofs?: CheckedProof[] }>({});
  const run = async () => {
    setState({ loading: true });
    try {
      const target = await resolveTarget(input);
      if (!target) return setState({ error: "Not a wallet address or a registered ENS name." });
      setState({ target, proofs: await loadVerifiedProofs(target.address) });
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <section>
      <h2>Check anyone</h2>
      <p className="muted">Enter an ENS name or wallet. You'll see only what they've proven, never their documents.</p>
      <div className="row">
        <input placeholder="alice.eth or 0x…" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} />
        <button className="primary" onClick={run}>Check</button>
      </div>
      {state.loading && <p className="muted">Looking up ENS and Arkiv…</p>}
      {state.error && <p className="error">{state.error}</p>}
      {state.target && (
        <>
          <p>
            <strong>{state.target.name ?? short(state.target.address)}</strong>{" "}
            <span className="muted">{state.target.name ? short(state.target.address) : ""}</span>
          </p>
          <ProofList proofs={state.proofs ?? []} />
        </>
      )}
    </section>
  );
}

function CompanyDemo({ wallet }: { wallet: ReturnType<typeof useWallet> }) {
  const [result, setResult] = useState<"checking" | "granted" | "denied">();
  const verify = async () => {
    if (!wallet.address) return wallet.connect();
    setResult("checking");
    const proofs = await loadVerifiedProofs(wallet.address).catch(() => []);
    setResult(proofs.some((p) => p.ok && p.claim === "age_over_18") ? "granted" : "denied");
  };
  return (
    <section>
      <h2>Companies check people: demo store</h2>
      <div className="store">
        <div className="store-name">🍷 Demo Wine Club <span className="muted small">(fictional demo site)</span></div>
        <p>This section is for 18+ members only. We never ask for your ID.</p>
        <button className="primary" onClick={verify}>{wallet.address ? "Verify with Satya" : "Connect wallet to verify"}</button>
        {result === "checking" && <p className="muted">Checking your proofs on Arkiv…</p>}
        {result === "granted" && <p className="success">✓ Access granted. The store learned only "18+", nothing else.</p>}
        {result === "denied" && <p className="error">✕ No valid 18+ proof found for this wallet.</p>}
      </div>
    </section>
  );
}

export function App() {
  const wallet = useWallet();
  // The extension links here as #evidence=<fingerprint>; keep the fingerprint before the hash changes.
  const [evidenceFp] = useState(() => /^#evidence=([0-9a-f]{64})$/.exec(location.hash)?.[1]);
  const [tab, setTab] = useState<Tab>(() => (evidenceFp ? "evidence" : (location.hash.slice(1) as Tab)) || "verify");
  useEffect(() => {
    location.hash = tab;
  }, [tab]);
  const tabs: [Tab, string][] = [
    ["verify", "Get verified"],
    ["aadhaar", "Aadhaar (ZK)"],
    ["link", "Link profiles"],
    ["check", "Check anyone"],
    ["company", "Verify with Satya"],
    ["evidence", "Scam evidence"],
  ];
  return (
    <main>
      <header>
        <div>
          <h1>Satya <span className="muted">सत्य</span></h1>
          <p className="muted">Prove you're real without showing your documents.</p>
        </div>
        <div className="wallet">
          {wallet.address ? (
            <span>{wallet.ens ?? short(wallet.address)}</span>
          ) : (
            <button onClick={wallet.connect}>Connect wallet</button>
          )}
        </div>
      </header>
      {wallet.error && <p className="error">{wallet.error}</p>}
      <nav>
        {tabs.map(([id, label]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>
      {tab === "verify" && <GetVerified wallet={wallet} />}
      {tab === "aadhaar" && <AadhaarTab address={wallet.address} connect={wallet.connect} />}
      {tab === "link" && <LinkProfile wallet={wallet} />}
      {tab === "check" && <CheckSomeone />}
      {tab === "company" && <CompanyDemo wallet={wallet} />}
      {tab === "evidence" && <EvidenceTab address={wallet.address} connect={wallet.connect} initial={evidenceFp} />}
      <footer className="muted small">
        Claims come from a demo issuer standing in for DigiLocker, or from Anon Aadhaar test cards. Records live on Arkiv's testnet. No trackers, no
        Satya server.
      </footer>
    </main>
  );
}
