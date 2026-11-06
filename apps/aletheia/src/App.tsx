import {
  arkivBrowserWriter,
  CLAIM_LABELS,
  ClaimRefusedError,
  fetchProofRecords,
  issueClaim,
  parseAttestation,
  publishAttestation,
  serializeAttestation,
  verifyAttestation,
  type ClaimId,
  type DocumentDetails,
  type SignedAttestation,
} from "@satya/identity";
import { useEffect, useState } from "react";
import { isAddress, type Address, type EIP1193Provider } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

const ARKIV_KEY = import.meta.env.VITE_ARKIV_ACCESS_KEY ?? "";
const ARKIV_EXPLORER = "https://rabdi.explorer.arkiv.network";
const CLAIM_NAME: Record<ClaimId, string> = { age_over_18: "18+", nationality: "Nationality", id_valid: "ID valid" };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/* ------------------------------------------------------------------ routing */

/** Hash routes: #/, #/mock-digilocker/authorize?…, #/callback?…, #/account, #/u/<address>. */
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

/* ------------------------------------------------------------- sign-in data */

/** The claims Aletheia asks for. It never asks for a name, date of birth or ID number. */
const SCOPE: ClaimId[] = ["age_over_18", "nationality", "id_valid"];

/** Fictional residents of the mock DigiLocker. Invented people; no real data. */
const RESIDENTS: { id: string; name: string; note: string; doc: DocumentDetails }[] = [
  { id: "asha", name: "Asha Verma", note: "Adult · India · ID valid", doc: { dateOfBirth: "1999-04-12", nationality: "IN", documentExpiry: "2031-06-30" } },
  { id: "rohan", name: "Rohan Mehta", note: "Minor · India (born 2010)", doc: { dateOfBirth: "2010-01-20", nationality: "IN", documentExpiry: "2030-01-01" } },
  { id: "kavya", name: "Kavya Iyer", note: "Adult · India · ID expired in 2024", doc: { dateOfBirth: "1988-07-07", nationality: "IN", documentExpiry: "2024-03-31" } },
  { id: "daniel", name: "Daniel Brooks", note: "Adult · USA · ID valid", doc: { dateOfBirth: "1992-09-03", nationality: "US", documentExpiry: "2029-02-14" } },
];

interface Session {
  holder: Address;
  wallet: "metamask" | "demo";
  /** Serialized signed claims (bigints as strings). */
  claims: string[];
  refused: string[];
}
const loadSession = (): Session | null => JSON.parse(sessionStorage.getItem("aletheia-session") ?? "null");
const saveSession = (s: Session | null) =>
  s ? sessionStorage.setItem("aletheia-session", JSON.stringify(s)) : sessionStorage.removeItem("aletheia-session");

/** A throwaway wallet kept in this browser, for people without MetaMask. */
function demoWallet(): Address {
  let key = localStorage.getItem("aletheia-demo-key") as `0x${string}` | null;
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

/* ------------------------------------------------------------------- shell */

function DemoStrip() {
  return (
    <div className="demo-strip">
      DEMO · Aletheia is a Satya demo site. Its sign-in uses a <b>mock DigiLocker</b>: a labelled test issuer with
      fictional residents, not the real DigiLocker.
    </div>
  );
}

function AletheiaHeader({ session }: { session: Session | null }) {
  return (
    <header className="al-top">
      <a className="al-brand" href="#/">
        Aletheia <span>ἀλήθεια</span>
      </a>
      {session ? (
        <a className="al-who" href="#/account">
          {short(session.holder)}
        </a>
      ) : null}
    </header>
  );
}

/* -------------------------------------------------------------------- home */

function Home({ session }: { session: Session | null }) {
  const [error, setError] = useState<string>();
  const signIn = async (wallet: Session["wallet"]) => {
    try {
      setError(undefined);
      const holder = wallet === "metamask" ? await metamask() : demoWallet();
      const state = crypto.randomUUID();
      sessionStorage.setItem("aletheia-state", JSON.stringify({ state, holder, wallet }));
      const q = new URLSearchParams({ client_id: "aletheia", scope: SCOPE.join(" "), holder, state });
      go(`/mock-digilocker/authorize?${q}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <main className="al">
      <AletheiaHeader session={session} />
      <section className="al-hero">
        <h1>Prove a fact about yourself, not your documents.</h1>
        <p>
          Aletheia only needs to know that you're <b>18+</b>, your <b>nationality</b>, and that your <b>ID is valid</b>. Sign in
          with DigiLocker and it gets exactly that: three signed yes/no claims, bound to your wallet. Never your name, date of
          birth or ID number.
        </p>
        {session ? (
          <button className="al-btn" onClick={() => go("/account")}>
            Go to your account
          </button>
        ) : (
          <div className="al-signin">
            <button className="al-btn dl" onClick={() => void signIn("metamask")}>
              Sign in with DigiLocker (mock) · MetaMask wallet
            </button>
            <button className="al-btn ghost" onClick={() => void signIn("demo")}>
              Sign in with DigiLocker (mock) · demo wallet
            </button>
            <p className="al-note">
              The claims are issued to a wallet so you can carry them to other sites. No MetaMask? The demo wallet is a key
              kept in this browser.
            </p>
          </div>
        )}
        {error && <p className="al-error">{error}</p>}
      </section>
      <section className="al-steps">
        <div>
          <b>1. Sign in</b>
          <p>You pick a resident on the mock DigiLocker and approve what Aletheia may see.</p>
        </div>
        <div>
          <b>2. Signed claims</b>
          <p>The issuer signs only the claims that are true (EIP-712), each to your wallet, each with an expiry.</p>
        </div>
        <div>
          <b>3. Check anywhere</b>
          <p>Publish them to Arkiv and any site, or Satya's extension, can verify them without asking you again.</p>
        </div>
      </section>
    </main>
  );
}

/* ---------------------------------------------------------- mock DigiLocker */

function MockDigiLocker({ params }: { params: URLSearchParams }) {
  const [resident, setResident] = useState<(typeof RESIDENTS)[number]>();
  const [busy, setBusy] = useState(false);
  const client = params.get("client_id") ?? "";
  const holder = params.get("holder") ?? "";
  const state = params.get("state") ?? "";
  const scope = (params.get("scope") ?? "").split(/[ +]/).filter((s): s is ClaimId => s in CLAIM_LABELS);
  const back = (q: Record<string, string>) => go(`/callback?${new URLSearchParams({ ...q, state })}`);

  if (client !== "aletheia" || !isAddress(holder) || !state || !scope.length) {
    return (
      <main className="dl-page">
        <div className="dl-card">
          <h2>Invalid sign-in request</h2>
          <p>This request is missing the app, wallet or permissions it needs.</p>
        </div>
      </main>
    );
  }

  const allow = async () => {
    if (!resident) return;
    setBusy(true);
    const signed: string[] = [];
    const refused: string[] = [];
    for (const c of scope) {
      try {
        signed.push(serializeAttestation(await issueClaim(holder, c, resident.doc)));
      } catch (e) {
        refused.push(`${CLAIM_NAME[c]}: ${e instanceof ClaimRefusedError ? e.message : String(e)}`);
      }
    }
    // Stands in for the OAuth code exchange: Aletheia redeems the code for the signed claims.
    const code = crypto.randomUUID();
    sessionStorage.setItem(`dl-code-${code}`, JSON.stringify({ signed, refused }));
    back({ code });
  };

  const LABEL: Record<ClaimId, string> = {
    age_over_18: "Whether you are 18 or older (yes/no)",
    nationality: "Your nationality",
    id_valid: "Whether your ID document is valid (yes/no)",
  };

  return (
    <main className="dl-page">
      <div className="dl-strip">
        MOCK DIGILOCKER · demo issuer for Satya. Not the real DigiLocker or any government service. Fictional residents only;
        nothing here is sent anywhere.
      </div>
      <div className="dl-card">
        <div className="dl-head">
          <span className="dl-logo" aria-hidden>
            ⬚
          </span>
          <div>
            <div className="dl-title">Mock DigiLocker</div>
            <div className="dl-sub">Demo issuer {short("0x48D49a2bF3766cC742CDeA811a6c40F2f40F9BaB")}</div>
          </div>
        </div>

        {!resident ? (
          <>
            <h2>Sign in as a test resident</h2>
            <p className="dl-muted">Choose a fictional person. Each one shows a different outcome.</p>
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
              Cancel and go back to Aletheia
            </button>
          </>
        ) : (
          <>
            <h2>
              <b>Aletheia</b> wants to know
            </h2>
            <p className="dl-muted">Signed in as {resident.name} (fictional).</p>
            <ul className="dl-scope">
              {scope.map((c) => (
                <li key={c}>✓ {LABEL[c]}</li>
              ))}
            </ul>
            <p className="dl-muted">
              Aletheia will <b>not</b> see your name, date of birth, Aadhaar number, address or the document itself. Claims are
              issued to wallet <span className="mono">{short(holder)}</span> and expire with your ID.
            </p>
            <div className="dl-actions">
              <button className="dl-allow" disabled={busy} onClick={() => void allow()}>
                {busy ? "Signing…" : "Allow"}
              </button>
              <button className="dl-deny" disabled={busy} onClick={() => back({ error: "access_denied" })}>
                Deny
              </button>
            </div>
            <button className="dl-link" onClick={() => setResident(undefined)}>
              Not {resident.name.split(" ")[0]}? Choose another resident
            </button>
          </>
        )}
      </div>
    </main>
  );
}

/* --------------------------------------------------------------- callback */

function Callback({ params }: { params: URLSearchParams }) {
  const [error, setError] = useState<string>();
  useEffect(() => {
    void (async () => {
      const expected = JSON.parse(sessionStorage.getItem("aletheia-state") ?? "null") as
        | { state: string; holder: Address; wallet: Session["wallet"] }
        | null;
      sessionStorage.removeItem("aletheia-state");
      if (!expected || params.get("state") !== expected.state) return setError("This sign-in didn't start here (state mismatch).");
      if (params.get("error")) return setError("You cancelled the sign-in at DigiLocker.");
      const code = params.get("code") ?? "";
      const raw = sessionStorage.getItem(`dl-code-${code}`);
      sessionStorage.removeItem(`dl-code-${code}`);
      if (!raw) return setError("That sign-in code was already used or is unknown.");
      const { signed, refused } = JSON.parse(raw) as { signed: string[]; refused: string[] };
      // Never trust what came back: check every signature, issuer, holder and expiry.
      const good: string[] = [];
      for (const s of signed) {
        const v = await verifyAttestation(parseAttestation(s), expected.holder);
        if (v.ok) good.push(s);
        else refused.push(`A claim failed verification: ${v.reason}`);
      }
      saveSession({ holder: expected.holder, wallet: expected.wallet, claims: good, refused });
      go("/account");
    })();
  }, [params]);
  return (
    <main className="al">
      <AletheiaHeader session={null} />
      <section className="al-card">{error ? <p className="al-error">{error}</p> : <p>Checking the signed claims…</p>}</section>
      {error && (
        <button className="al-btn ghost" onClick={() => go("/")}>
          Back to Aletheia
        </button>
      )}
    </main>
  );
}

/* ---------------------------------------------------------------- account */

function ClaimRow({ s }: { s: SignedAttestation }) {
  const a = s.attestation;
  return (
    <li className="al-claim ok">
      <span className="al-tick">✓</span>
      <div>
        <b>{CLAIM_LABELS[a.claim](a.value)}</b>
        <div className="al-small">
          Mock DigiLocker (demo issuer) · valid until {new Date(Number(a.expiresAt) * 1000).toISOString().slice(0, 10)}
        </div>
      </div>
    </li>
  );
}

function Account({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const claims = session.claims.map(parseAttestation);
  const adult = claims.some((c) => c.attestation.claim === "age_over_18");
  const [published, setPublished] = useState<{ claim: ClaimId; key: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const publish = async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (!window.ethereum) throw new Error("Publishing needs MetaMask.");
      const writer = await arkivBrowserWriter(window.ethereum, session.holder, ARKIV_KEY);
      const done: typeof published = [];
      for (const s of claims) {
        const r = await publishAttestation(writer, s);
        done.push({ claim: s.attestation.claim, key: r.entityKey });
        setPublished([...done]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="al">
      <AletheiaHeader session={session} />
      <section className="al-card">
        <div className="al-eyebrow">Signed in with Mock DigiLocker</div>
        <h2 className="mono">{session.holder}</h2>
        <p className="al-small">{session.wallet === "demo" ? "Demo wallet kept in this browser" : "MetaMask wallet"}</p>

        <h3>What Aletheia knows about you</h3>
        {claims.length ? (
          <ul className="al-claims">
            {claims.map((s) => (
              <ClaimRow key={s.attestation.claim} s={s} />
            ))}
          </ul>
        ) : (
          <p>Nothing: DigiLocker issued no claims.</p>
        )}
        {session.refused.length > 0 && (
          <ul className="al-claims">
            {session.refused.map((r) => (
              <li key={r} className="al-claim bad">
                <span className="al-tick">✕</span>
                <div>{r}</div>
              </li>
            ))}
          </ul>
        )}
        <p className="al-small">
          That's all: no name, no date of birth, no ID number. Each claim is signed by the issuer and checked here before it
          was accepted.
        </p>
      </section>

      <section className={`al-card gate ${adult ? "open" : "shut"}`}>
        <h3>{adult ? "18+ community: unlocked" : "18+ community: locked"}</h3>
        <p>{adult ? "Your 18+ claim opens this area. Aletheia never learned your age." : "This area needs a valid 18+ claim from DigiLocker."}</p>
      </section>

      <section className="al-card">
        <h3>Carry it to other sites</h3>
        <p className="al-small">
          Publishing puts each signed claim on Arkiv, owned by your wallet. Anyone (another site, or Satya's extension) can then
          check it against the issuer's signature without asking you again.
        </p>
        <div className="al-row">
          <button className="al-btn" disabled={busy || !claims.length || session.wallet !== "metamask"} onClick={() => void publish()}>
            {busy ? "Publishing…" : "Publish proofs to Arkiv"}
          </button>
          <button className="al-btn ghost" onClick={() => go(`/u/${session.holder}`)}>
            Public profile
          </button>
        </div>
        {session.wallet !== "metamask" && <p className="al-small">Publishing needs MetaMask (it pays a little test GLM on Arkiv).</p>}
        {published.map((p) => (
          <p key={p.key} className="al-small">
            ✓ {CLAIM_NAME[p.claim]} on Arkiv:{" "}
            <a href={`${ARKIV_EXPLORER}/entity/${p.key}`} target="_blank" rel="noreferrer">
              {short(p.key)} ↗
            </a>
          </p>
        ))}
        {error && <p className="al-error">{error}</p>}
      </section>
      <button className="al-btn ghost" onClick={onSignOut}>
        Sign out
      </button>
    </main>
  );
}

/* ---------------------------------------------------------- public profile */

function Profile({ address, session }: { address: string; session: Session | null }) {
  const [rows, setRows] = useState<{ key: string; label: string; ok: boolean; detail: string }[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!isAddress(address)) return setError("Not a wallet address.");
    void (async () => {
      try {
        const records = await fetchProofRecords(address, ARKIV_KEY);
        const out: NonNullable<typeof rows> = [];
        for (const r of records) {
          if (!r.signed) continue;
          const v = await verifyAttestation(r.signed, address);
          const a = r.signed.attestation;
          out.push({ key: r.key, label: CLAIM_LABELS[a.claim](a.value), ok: v.ok, detail: v.ok ? v.issuer.name : v.reason });
        }
        setRows(out);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [address]);
  return (
    <main className="al">
      <AletheiaHeader session={session} />
      <section className="al-card">
        <div className="al-eyebrow">Aletheia member</div>
        <h2 className="mono">{address}</h2>
        <h3>Verified on Arkiv</h3>
        {error && <p className="al-error">{error}</p>}
        {!rows && !error && <p>Loading proofs from Arkiv…</p>}
        {rows && !rows.length && <p>No DigiLocker claims published from this wallet yet.</p>}
        {rows && rows.length > 0 && (
          <ul className="al-claims">
            {rows.map((r) => (
              <li key={r.key} className={`al-claim ${r.ok ? "ok" : "bad"}`}>
                <span className="al-tick">{r.ok ? "✓" : "✕"}</span>
                <div>
                  <b>{r.label}</b>
                  <div className="al-small">
                    {r.detail} ·{" "}
                    <a href={`${ARKIV_EXPLORER}/entity/${r.key}`} target="_blank" rel="noreferrer">
                      Arkiv record ↗
                    </a>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="al-small">Checked in your browser: each record's signature must come from a trusted issuer and name this wallet.</p>
      </section>
    </main>
  );
}

/* -------------------------------------------------------------------- app */

export function App() {
  const route = useRoute();
  const [session, setSession] = useState(loadSession);
  useEffect(() => setSession(loadSession()), [route]);

  let page: JSX.Element;
  if (route.path === "/mock-digilocker/authorize") page = <MockDigiLocker params={route.params} />;
  else if (route.path === "/callback") page = <Callback params={route.params} />;
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
  else if (route.path.startsWith("/u/")) page = <Profile address={route.path.slice(3)} session={session} />;
  else page = <Home session={session} />;

  return (
    <>
      <DemoStrip />
      {page}
      <footer className="al-foot">Aletheia is part of Satya · ETHGlobal Mumbai 2026 · demo data only</footer>
    </>
  );
}
