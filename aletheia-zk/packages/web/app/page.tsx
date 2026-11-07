"use client";

import Link from "next/link";
import { useState } from "react";

import { todayUtcYyyymmdd } from "@aletheia/credential";
import type { DocumentExtractionResult } from "@aletheia/extraction/browser";

import { SiteHeader } from "./SiteHeader";
import { DEFAULT_CONTEXT_LABEL, contextIdFromLabel } from "@/lib/context";
import { DEPLOYMENT, etherscanTx } from "@/lib/deployment";
import { extractImage, extractPdf, extractText } from "@/lib/extraction";
import { proveAgeInBrowser, proveExpiryInBrowser, proveNationalityInBrowser } from "@/lib/prove";
import { loadMockIssuer, signReviewedCredential } from "@/lib/sign";
import {
  connectDevSigner,
  connectInjected,
  devSignerAvailable,
  submitAgeClaim,
  submitExpiryClaim,
  submitNationalityClaim,
  type Signer,
} from "@/lib/submit";

type InputTab = "text" | "pdf" | "image";
type ClaimType = "age" | "nationality" | "expiry";

interface ReviewForm {
  documentNumber: string;
  nationalityAlpha3: string;
  nationality: string; // ISO numeric, as text for the input
  dateOfBirth: string; // YYYY-MM-DD
  expiryDate: string; // YYYY-MM-DD
  sex: string;
}

interface Outcome {
  hash: string;
  verificationId: string;
  subject: string;
  nullifier: string;
  identityNullifier: string;
  documentKey: string;
  /** What was proven, rendered for the outcome view: "age ≥ 18" or "nationality 356 (IND)". */
  claimSummary: string;
  /** True for a nationality claim, so the outcome can restate what was disclosed. */
  disclosed: boolean;
  /** The block the transaction was mined in, handed to the verifier view to watch indexing. */
  block: string;
}

/**
 * Demo passports. Every one is entirely fabricated — invented names and document numbers,
 * with valid ICAO 7-3-1 check digits so the extraction pipeline accepts them. None of this
 * is a real person or a real document. Clicking one loads its fields straight into the
 * review step so a first-time user can drive the whole flow in one click.
 */
const SYNTHETIC_NOTICE = "DEMO / SYNTHETIC DATA — NOT A REAL PASSPORT";

interface Sample {
  id: string;
  label: string;
  /** What this sample is for, in the demo. */
  note: string;
  /** The two-line TD3 MRZ, for the "paste + Extract" pipeline demo. */
  mrz: string;
  /** The reviewed fields, loaded directly into step 2. */
  fields: ReviewForm;
}

const SAMPLES: Sample[] = [
  {
    id: "valid-adult-india",
    label: "Valid adult · India",
    note: "age ✓, nationality 356, not expired — every claim provable",
    mrz: "P<INDSHARMA<<PRIYA<<<<<<<<<<<<<<<<<<<<<<<<<<\nS1234567<2IND9604124F3208151<<<<<<<<<<<<<<<6",
    fields: { documentNumber: "S1234567", nationalityAlpha3: "IND", nationality: "356", dateOfBirth: "1996-04-12", expiryDate: "2032-08-15", sex: "F" },
  },
  {
    id: "adult-usa",
    label: "Adult · United States",
    note: "different nationality (840) — nationality claim reveals USA",
    mrz: "P<USACARTER<<JAMES<<<<<<<<<<<<<<<<<<<<<<<<<<\nA9988776<0USA9411058M3303207<<<<<<<<<<<<<<<8",
    fields: { documentNumber: "A9988776", nationalityAlpha3: "USA", nationality: "840", dateOfBirth: "1994-11-05", expiryDate: "2033-03-20", sex: "M" },
  },
  {
    id: "minor-india",
    label: "Minor · India",
    note: "under 18 — an age ≥ 18 proof cannot be produced (the point)",
    mrz: "P<INDMEHTA<<AARAV<<<<<<<<<<<<<<<<<<<<<<<<<<<\nU7654321<4IND1206201M3101104<<<<<<<<<<<<<<<2",
    fields: { documentNumber: "U7654321", nationalityAlpha3: "IND", nationality: "356", dateOfBirth: "2012-06-20", expiryDate: "2031-01-10", sex: "M" },
  },
  {
    id: "expired-india",
    label: "Expired · India",
    note: "expiry in the past — no claim is provable (expiry is checked in every proof)",
    mrz: "P<INDKHAN<<SANA<<<<<<<<<<<<<<<<<<<<<<<<<<<<<\nE5556667<0IND9003037F2205016<<<<<<<<<<<<<<<8",
    fields: { documentNumber: "E5556667", nationalityAlpha3: "IND", nationality: "356", dateOfBirth: "1990-03-03", expiryDate: "2022-05-01", sex: "F" },
  },
];

// The default "Use sample MRZ" text: the valid adult, so the paste + Extract path has
// something real to parse.
const SAMPLE_MRZ = SAMPLES[0]!.mrz;

function yyyymmddToInput(value: number): string {
  const s = value.toString().padStart(8, "0");
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function inputToYyyymmdd(value: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) throw new Error(`date must be YYYY-MM-DD, got ${JSON.stringify(value)}`);
  return Number(`${m[1]}${m[2]}${m[3]}`);
}

export default function Page() {
  const [tab, setTab] = useState<InputTab>("text");
  const [rawText, setRawText] = useState("");
  const [extraction, setExtraction] = useState<DocumentExtractionResult | null>(null);
  const [form, setForm] = useState<ReviewForm | null>(null);
  const [activeSample, setActiveSample] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [claimType, setClaimType] = useState<ClaimType>("age");
  const [minimumAge, setMinimumAge] = useState(18);
  // The nationality claim discloses the nationality on-chain, so proving is gated on an
  // explicit acknowledgement shown before the prove button is enabled.
  const [disclosureAck, setDisclosureAck] = useState(false);

  const [signer, setSigner] = useState<Signer | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [copiedAddr, setCopiedAddr] = useState(false);

  async function copyAddress(addr: string) {
    try {
      await navigator.clipboard.writeText(addr);
      setCopiedAddr(true);
      setTimeout(() => setCopiedAddr(false), 1800);
    } catch {
      /* clipboard blocked — the address is still visible to copy by hand */
    }
  }

  function say(line: string) {
    setLog((prev) => [...prev, line]);
  }

  function reset() {
    setExtraction(null);
    setForm(null);
    setActiveSample(null);
    setConfirmed(false);
    setDisclosureAck(false);
    setOutcome(null);
    setError(null);
    setLog([]);
  }

  /**
   * Load a synthetic demo passport straight into the review step. Skips extraction on
   * purpose: a genuine minor's date of birth is century-ambiguous by ICAO rules (so it
   * would need manual confirmation), and one-click loading is the smoothest way for a
   * first-time user to reach the proof. The fields are still fully editable in review.
   */
  function loadSample(s: Sample) {
    setExtraction(null);
    setConfirmed(false);
    setDisclosureAck(false);
    setOutcome(null);
    setError(null);
    setLog([]);
    setRawText(s.mrz);
    setForm({ ...s.fields });
    setActiveSample(s.id);
  }

  function applyExtraction(result: DocumentExtractionResult) {
    setExtraction(result);
    setConfirmed(false);
    setOutcome(null);
    if (result.ok) {
      const f = result.fields;
      setForm({
        documentNumber: f.documentNumber,
        nationalityAlpha3: f.nationalityAlpha3,
        nationality: String(f.nationality),
        dateOfBirth: yyyymmddToInput(f.dateOfBirth),
        expiryDate: yyyymmddToInput(f.expiryDate),
        sex: f.sex,
      });
    } else {
      setForm(null);
    }
  }

  async function onExtract(runner: () => Promise<DocumentExtractionResult> | DocumentExtractionResult) {
    setError(null);
    setBusy(true);
    try {
      applyExtraction(await runner());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function connect(kind: "injected" | "dev") {
    setError(null);
    try {
      const s = kind === "dev" ? connectDevSigner() : await connectInjected();
      setSigner(s);
      say(`wallet connected (${s.kind}): ${s.address}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function proveAndSubmit() {
    if (!signer || !form) return;
    setError(null);
    setOutcome(null);
    setBusy(true);
    setLog([]);
    try {
      const reviewed = {
        documentNumber: form.documentNumber.trim().toUpperCase(),
        nationality: Number(form.nationality),
        dateOfBirth: inputToYyyymmdd(form.dateOfBirth),
        expiryDate: inputToYyyymmdd(form.expiryDate),
      };

      say("loading mock-dev issuer keystore (from this origin)…");
      const issuer = await loadMockIssuer();

      say("deriving documentKey and signing the credential on-device…");
      const { signed, documentKey } = await signReviewedCredential({
        issuer,
        fields: reviewed,
        subject: signer.address,
      });
      say(`documentKey: ${documentKey.toString()}`);

      const currentDate = todayUtcYyyymmdd();
      const contextId = contextIdFromLabel(DEFAULT_CONTEXT_LABEL);

      let result;
      let claimSummary: string;
      let disclosed: boolean;
      if (claimType === "nationality") {
        const alpha3 = form.nationalityAlpha3 ? ` (${form.nationalityAlpha3})` : "";
        claimSummary = `nationality ${reviewed.nationality}${alpha3}`;
        disclosed = true;
        say(
          `proving ${claimSummary} on ${currentDate} — this proof publicly reveals the nationality ` +
            `(this runs in your browser, ~a few seconds)…`,
        );
        const proof = await proveNationalityInBrowser(signed, {
          requiredNationality: reviewed.nationality,
          currentDate,
          contextId,
        });
        say("proof produced and verified locally.");
        say("simulating submitNationalityClaim on Sepolia…");
        result = await submitNationalityClaim(signer, proof.calldata);
      } else if (claimType === "expiry") {
        claimSummary = `not expired (as of ${currentDate})`;
        disclosed = false;
        say(
          `proving the credential is not expired as of ${currentDate} — this reveals only that ` +
            `it is still valid, never the expiry date (this runs in your browser, ~a few seconds)…`,
        );
        const proof = await proveExpiryInBrowser(signed, { currentDate, contextId });
        say("proof produced and verified locally.");
        say("simulating submitExpiryClaim on Sepolia…");
        result = await submitExpiryClaim(signer, proof.calldata);
      } else {
        claimSummary = `age ≥ ${minimumAge}`;
        disclosed = false;
        say(`proving ${claimSummary} on ${currentDate} (this runs in your browser, ~a few seconds)…`);
        const proof = await proveAgeInBrowser(signed, { minimumAge, currentDate, contextId });
        say("proof produced and verified locally.");
        say("simulating submitAgeClaim on Sepolia…");
        result = await submitAgeClaim(signer, proof.calldata);
      }
      say(`submitted: ${result.hash}`);
      say("mined. reading ClaimVerified event…");

      const e = result.event;
      if (e.issuerId.toLowerCase() !== DEPLOYMENT.mockIssuerId.toLowerCase()) {
        throw new Error("the emitted issuerId is not the registered mock-dev issuer");
      }
      setOutcome({
        hash: result.hash,
        verificationId: result.verificationId,
        subject: e.subject,
        nullifier: e.nullifier,
        identityNullifier: e.identityNullifier,
        documentKey: documentKey.toString(),
        claimSummary,
        disclosed,
        block: result.receipt.blockNumber.toString(),
      });
      say("done — real proof, real transaction, real event.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const extractionFailed = extraction && !extraction.ok ? extraction : null;

  // Read-only hints so the demo shows *why* a claim will prove or fail, before proving.
  function isoParts(v: string): [number, number, number] | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  }
  const holderAge = (() => {
    const p = form && isoParts(form.dateOfBirth);
    if (!p) return null;
    const now = new Date();
    let age = now.getUTCFullYear() - p[0];
    if (now.getUTCMonth() + 1 < p[1] || (now.getUTCMonth() + 1 === p[1] && now.getUTCDate() < p[2])) {
      age -= 1;
    }
    return age;
  })();
  const credentialExpired = (() => {
    const p = form && isoParts(form.expiryDate);
    if (!p) return false;
    const today = new Date();
    const todayNum = today.getUTCFullYear() * 10000 + (today.getUTCMonth() + 1) * 100 + today.getUTCDate();
    return p[0] * 10000 + p[1] * 100 + p[2] < todayNum;
  })();

  return (
    <main>
      <SiteHeader active="holder" />

      <h1>Holder flow</h1>
      <p className="sub">
        Extract a passport, review it, then prove your <strong>age</strong>,{" "}
        <strong>nationality</strong>, or that your credential is <strong>not expired</strong> — and
        submit only that proof to Ethereum. Aletheia lets you prove a fact about a document without
        handing over the document.
      </p>

      {/* Privacy — the core promise, stated plainly. */}
      <div className="privacy-note">
        <strong>🔒 Private by design — nothing is stored.</strong> Your passport is read, and the
        proof is generated, entirely in this browser. There is <strong>no server and no database</strong>;
        we never receive or store your document, photo, date of birth, or document number. Only a
        zero-knowledge proof and its public signals are submitted on-chain — never the underlying
        data. The one deliberate exception: a <strong>nationality</strong> proof reveals the
        nationality you choose to prove (you acknowledge this before proving). Age and “not expired”
        proofs reveal only that the fact holds.
      </div>

      {/* What this is + where it's going. */}
      <div className="mock-banner">
        <span className="badge-mock">mock-dev</span> <strong>Phase 1 demo, on the Sepolia test
        network</strong> — the fees you see are free test ETH, not real money. Today a labelled{" "}
        <em>mock issuer</em> signs the credential and verifies no identity, so a record here proves a
        real proof was checked on-chain, never a real passport. <strong>Next:</strong> a trusted
        issuer — <em>DigiLocker</em>, or the passport’s own ICAO e-passport chip signature — attests
        the credential so the proof carries real-world weight. The zero-knowledge layer, contracts,
        and flow stay exactly the same; only the issuer becomes real.
      </div>

      {/* 1. Input */}
      <section className="step" data-done={Boolean(form)}>
        <h2>
          <span className="n">1</span> Load a passport
        </h2>

        {/* Demo passports — one click loads synthetic fields into review. */}
        <div className="samples">
          <div className="samples-head">
            <strong>Try a demo passport</strong>
          </div>
          <p className="hint" style={{ marginTop: 0 }}>
            One click loads fictional passport data (valid ICAO check digits, invented people)
            straight into review. Every sample is fabricated — {SYNTHETIC_NOTICE}.
          </p>
          <div className="sample-grid">
            {SAMPLES.map((s) => (
              <button
                key={s.id}
                className="sample"
                data-active={activeSample === s.id}
                disabled={busy}
                onClick={() => loadSample(s)}
              >
                <span className="sample-label">{s.label}</span>
                <span className="sample-note">{s.note}</span>
              </button>
            ))}
          </div>
          <p className="hint">
            Or use a real one below — paste the two MRZ lines from <em>any</em> passport, or upload a
            scan/PDF. The parser is a full ICAO&nbsp;9303 TD3 reader (check digits and all), so it
            works on any real passport’s machine-readable zone, not just these samples. It is parsed
            on this device and never leaves it.
          </p>
        </div>

        <div className="tabs">
          <button data-active={tab === "text"} onClick={() => setTab("text")}>
            Paste MRZ
          </button>
          <button data-active={tab === "pdf"} onClick={() => setTab("pdf")}>
            PDF
          </button>
          <button data-active={tab === "image"} onClick={() => setTab("image")}>
            Image
          </button>
        </div>

        {tab === "text" && (
          <>
            <label>The two MRZ lines (bottom of the passport data page)</label>
            <textarea
              value={rawText}
              spellCheck={false}
              placeholder={SAMPLE_MRZ}
              onChange={(ev) => setRawText(ev.target.value)}
            />
            <div>
              <button disabled={busy || rawText.trim().length === 0} onClick={() => onExtract(() => extractText(rawText))}>
                Extract
              </button>
              <button
                className="secondary"
                style={{ marginLeft: 8 }}
                disabled={busy}
                onClick={() => setRawText(SAMPLE_MRZ)}
              >
                Use sample MRZ
              </button>
            </div>
            <p className="hint">
              “Use sample MRZ” fills a fabricated MRZ (valid check digits) to demonstrate the
              on-device parser — {SYNTHETIC_NOTICE}.
            </p>
          </>
        )}

        {tab === "pdf" && (
          <>
            <label>A PDF whose text layer carries the MRZ</label>
            <input
              type="file"
              accept="application/pdf"
              disabled={busy}
              onChange={(ev) => {
                const file = ev.target.files?.[0];
                if (file) void onExtract(() => extractPdf(file));
              }}
            />
            <p className="hint">Read locally via pdf.js; document JavaScript is disabled.</p>
          </>
        )}

        {tab === "image" && (
          <>
            <label>A photo or scan of the data page</label>
            <input
              type="file"
              accept="image/*"
              disabled={busy}
              onChange={(ev) => {
                const file = ev.target.files?.[0];
                if (file) void onExtract(() => extractImage(file));
              }}
            />
            <p className="hint">OCR runs on-device (tesseract.js, offline). A clean, cropped MRZ reads best.</p>
          </>
        )}

        {extractionFailed && (
          <div>
            {extractionFailed.issues.map((i, idx) => (
              <p className="issue" key={`d${idx}`}>
                {i.code}: {i.detail}
              </p>
            ))}
            {extractionFailed.mrz.map((i, idx) => (
              <p className="issue" key={`m${idx}`}>
                {i.field} — {i.code}: {i.detail}
              </p>
            ))}
            {extractionFailed.mrzLines.length > 0 && (
              <p className="mono">{extractionFailed.mrzLines.join("\n")}</p>
            )}
          </div>
        )}
      </section>

      {/* 2. Review */}
      {form && (
        <section className="step" data-done={confirmed}>
          <h2>
            <span className="n">2</span> Review &amp; correct
          </h2>
          {activeSample && (
            <div className="synthetic-banner">
              <span className="badge-synthetic">synthetic</span> {SYNTHETIC_NOTICE}. Fictional data,
              fully editable below.
            </div>
          )}
          <p className="hint">
            Extraction is untrusted input. Confirm every field — it is what the issuer will sign.
            {holderAge !== null && (
              <>
                {" "}This holder is <strong>~{holderAge}</strong>
                {credentialExpired ? (
                  <>
                    {" "}and the credential is <strong>expired</strong> — no claim can be proven
                    (every proof checks expiry).
                  </>
                ) : (
                  "."
                )}
              </>
            )}
          </p>
          <div className="row">
            <div>
              <label>Document number</label>
              <input
                value={form.documentNumber}
                onChange={(e) => setForm({ ...form, documentNumber: e.target.value, })}
                disabled={confirmed}
              />
            </div>
            <div>
              <label>Nationality (ISO 3166-1 numeric) — {form.nationalityAlpha3}</label>
              <input
                value={form.nationality}
                onChange={(e) => setForm({ ...form, nationality: e.target.value })}
                disabled={confirmed}
              />
            </div>
            <div>
              <label>Date of birth</label>
              <input
                type="date"
                value={form.dateOfBirth}
                onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
                disabled={confirmed}
              />
            </div>
            <div>
              <label>Expiry date</label>
              <input
                type="date"
                value={form.expiryDate}
                onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
                disabled={confirmed}
              />
            </div>
          </div>
          {!confirmed ? (
            <button onClick={() => setConfirmed(true)}>These fields are correct</button>
          ) : (
            <button className="secondary" onClick={() => setConfirmed(false)}>
              Edit again
            </button>
          )}
        </section>
      )}

      {/* 3. Claim + wallet */}
      {confirmed && form && (
        <section className="step" data-done={Boolean(outcome)}>
          <h2>
            <span className="n">3</span> Prove &amp; submit
          </h2>

          <label>What to prove</label>
          <div className="tabs">
            <button data-active={claimType === "age"} onClick={() => setClaimType("age")}>
              Age
            </button>
            <button data-active={claimType === "nationality"} onClick={() => setClaimType("nationality")}>
              Nationality
            </button>
            <button data-active={claimType === "expiry"} onClick={() => setClaimType("expiry")}>
              Not expired
            </button>
          </div>

          {claimType === "age" ? (
            <>
              <label>Prove age at least</label>
              <input
                type="number"
                min={0}
                max={120}
                value={minimumAge}
                onChange={(e) => setMinimumAge(Number(e.target.value))}
                style={{ width: 120 }}
              />
              <p className="hint">
                An age proof reveals only that the threshold is met — never your date of birth.
              </p>
              {holderAge !== null && !credentialExpired && (
                <p className="hint">
                  {holderAge >= minimumAge ? (
                    <span className="ok">✓ Provable</span>
                  ) : (
                    <span className="warn-text">✗ Not provable</span>
                  )}{" "}
                  — this holder is ~{holderAge}, so a proof of “age ≥ {minimumAge}”{" "}
                  {holderAge >= minimumAge
                    ? "will succeed."
                    : "cannot be produced. The proof can't lie about age — that's the point."}
                </p>
              )}
            </>
          ) : claimType === "expiry" ? (
            <>
              <label>Prove the credential is not expired</label>
              <p className="hint">
                Proves the credential is still valid as of today ({todayUtcYyyymmdd()}) — the same
                unexpired check every claim already runs, on its own. It reveals only that the
                credential has not expired; the expiry date itself
                {form.expiryDate ? ` (${form.expiryDate})` : ""}, and every other field, stay on this
                device. No value is disclosed and there is no threshold to choose.
              </p>
            </>
          ) : (
            <>
              <label>Prove nationality</label>
              <input value={`${form.nationality}${form.nationalityAlpha3 ? ` (${form.nationalityAlpha3})` : ""}`} readOnly style={{ width: 200 }} />
              <div className="disclosure">
                <strong>Disclosure — this reveals your nationality.</strong> Unlike an age proof,
                which hides the underlying value, a successful nationality claim publishes on-chain
                that you hold nationality{" "}
                <strong>
                  {form.nationality}
                  {form.nationalityAlpha3 ? ` (${form.nationalityAlpha3})` : ""}
                </strong>
                . Everything else in the credential — your date of birth, expiry and document
                number — still stays on this device.
                <label className="ack">
                  <input
                    type="checkbox"
                    checked={disclosureAck}
                    onChange={(e) => setDisclosureAck(e.target.checked)}
                  />
                  I understand this proof will reveal my nationality, and I want to continue.
                </label>
              </div>
            </>
          )}

          <div style={{ marginTop: 14 }}>
            {signer ? (
              <p className="hint">
                Wallet ({signer.kind}): <span className="mono">{signer.address}</span>
              </p>
            ) : (
              <>
                <button onClick={() => connect("injected")}>Connect wallet</button>
                {devSignerAvailable && (
                  <button className="secondary" style={{ marginLeft: 8 }} onClick={() => connect("dev")}>
                    Use dev signer
                  </button>
                )}
              </>
            )}
          </div>

          <button
            disabled={!signer || busy || (claimType === "nationality" && !disclosureAck)}
            onClick={() => void proveAndSubmit()}
          >
            {busy
              ? "Working…"
              : claimType === "nationality"
                ? "Prove nationality & submit to Sepolia"
                : claimType === "expiry"
                  ? "Prove not expired & submit to Sepolia"
                  : "Prove age & submit to Sepolia"}
          </button>

          {log.length > 0 && <div className="log">{log.join("\n")}</div>}
        </section>
      )}

      {outcome && (
        <section className="step" data-done>
          <h2>
            <span className="n">✓</span> Verified on Sepolia <span className="badge-mock">mock-dev</span>
          </h2>

          {/* What the holder gives the verifier. The wallet address is the identifier. */}
          <div className="handoff">
            <div className="handoff-label">Give this to the verifier to look you up:</div>
            <div className="handoff-row">
              <span className="mono handoff-addr">{outcome.subject}</span>
              <button className="secondary copy-btn" onClick={() => void copyAddress(outcome.subject)}>
                {copiedAddr ? "Copied ✓" : "Copy address"}
              </button>
            </div>
            <p className="hint" style={{ marginTop: 8 }}>
              Your <strong>wallet address</strong> is your identifier — <strong>no ENS name is
              needed</strong>. The verifier pastes it into the Verifier flow to see this proof. (An
              ENS name is optional: only if you already own one pointing at this wallet — Aletheia
              never creates ENS names.)
            </p>
            <p style={{ marginTop: 8 }}>
              <Link href={`/verify?address=${outcome.subject}`}>Open the verifier for this address →</Link>
            </p>
          </div>

          <div className="kv">
            <span className="k">Claim</span>
            <span className="ok">{outcome.claimSummary}</span>
            <span className="k">Transaction</span>
            <span className="mono">
              <a href={etherscanTx(outcome.hash)} target="_blank" rel="noreferrer">
                {outcome.hash}
              </a>
            </span>
            <span className="k">verificationId</span>
            <span className="mono">{outcome.verificationId}</span>
            <span className="k">subject (wallet)</span>
            <span className="mono">{outcome.subject}</span>
            <span className="k">nullifier</span>
            <span className="mono">{outcome.nullifier}</span>
            <span className="k">identityNullifier</span>
            <span className="mono">{outcome.identityNullifier}</span>
            <span className="k">documentKey</span>
            <span className="mono">{outcome.documentKey}</span>
          </div>
          <p className="hint" style={{ marginTop: 14 }}>
            {outcome.disclosed
              ? "The transaction carried the proof, its public signals, and the nationality you chose to disclose. Your date of birth, expiry and document number never left this device."
              : "The transaction carried only the proof and its public signals. Your date of birth, nationality, expiry and document number never left this device."}
          </p>
          <p style={{ marginTop: 14 }}>
            <Link href={`/verify?watch=${outcome.verificationId}&block=${outcome.block}`}>
              See this in the verifier view →
            </Link>{" "}
            <span className="hint">
              (it starts as pending and turns verified once the subgraph indexes the block, without a
              reload)
            </span>
          </p>
          <button className="secondary" onClick={reset}>
            Start over
          </button>
        </section>
      )}

      {error && <p className="error">{error}</p>}
    </main>
  );
}
