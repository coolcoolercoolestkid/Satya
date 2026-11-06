import {
  arkivBrowserWriter,
  proveAnonAadhaarTest,
  publishAnonAadhaar,
  verifyAnonAadhaar,
  type AnonAadhaarCheck,
} from "@satya/identity";
import { useState } from "react";
import type { Address } from "viem";
import { ARKIV_EXPLORER, ARKIV_FAUCET, ARKIV_KEY, provider, short } from "./wallet";

type Card = "adult" | "minor";

async function loadJson<T>(path: string): Promise<T | undefined> {
  try {
    const res = await fetch(path);
    return res.ok ? ((await res.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

export function AadhaarTab({ address, connect }: { address?: Address; connect: () => void }) {
  const [card, setCard] = useState<Card>("adult");
  const [status, setStatus] = useState<string>();
  const [proof, setProof] = useState<string>();
  const [check, setCheck] = useState<AnonAadhaarCheck>();
  const [published, setPublished] = useState<string>();
  const [busy, setBusy] = useState(false);

  const finish = async (serialized: string) => {
    if (!address) return;
    setStatus("Verifying the proof…");
    setProof(serialized);
    setCheck(await verifyAnonAadhaar(serialized, address));
    setStatus(undefined);
  };

  const usePremade = async () => {
    if (!address) return;
    setCheck(undefined);
    setPublished(undefined);
    const premade = await fetch(`/test-aadhaar/proof-${address.toLowerCase()}.json`).then((r) => (r.ok ? r.text() : undefined)).catch(() => undefined);
    if (!premade || !premade.trim().startsWith("{")) {
      setStatus(
        "No pre-made proof for this wallet. Generate one in the browser, or run the Node script in the README with HOLDER set to your address.",
      );
      return;
    }
    await finish(premade);
  };

  const proveInBrowser = async () => {
    if (!address) return;
    setBusy(true);
    setCheck(undefined);
    setPublished(undefined);
    try {
      const data = await loadJson<{ qrData: string }>(`/test-aadhaar/${card}.json`);
      if (!data) throw new Error("Test QR data missing. Run scripts/import/make-test-aadhaar.mjs.");
      setStatus("Proving in your browser. The first run downloads a ~600 MB proving key, so this can take several minutes…");
      await finish(await proveAnonAadhaarTest(data.qrData, address));
    } catch (e) {
      setStatus(`Proving failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (!address || !proof) return;
    setBusy(true);
    try {
      const writer = await arkivBrowserWriter(provider(), address, ARKIV_KEY);
      const r = await publishAnonAadhaar(writer, address, proof);
      setPublished(r.entityKey);
    } catch (e) {
      setStatus(`Publishing failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2>Prove you're 18+ with Aadhaar, revealing nothing else</h2>
      <p className="muted">
        <strong>Anon Aadhaar</strong> (by the Ethereum Foundation's privacy team) turns the UIDAI-signed QR on an Aadhaar card
        into a zero-knowledge proof: "18+, lives in Maharashtra", with no Aadhaar number, name or birthday. The proof is
        tied to your wallet, so nobody can reuse it.
      </p>
      <p className="muted small">
        This demo uses Anon Aadhaar's <strong>test cards</strong>: UIDAI's official sample data (a fictional person) re-signed
        with Anon Aadhaar's public test key. Proofs from them are always labelled TEST. No real Aadhaar data is used.
      </p>
      {!address ? (
        <button className="primary" onClick={connect}>Connect wallet</button>
      ) : (
        <>
          <div className="row wrap">
            <button className={card === "adult" ? "chip active" : "chip"} onClick={() => setCard("adult")}>Test card · adult</button>
            <button className={card === "minor" ? "chip active" : "chip"} onClick={() => setCard("minor")}>Test card · minor</button>
          </div>
          <div className="row wrap">
            <button className="primary" onClick={proveInBrowser} disabled={busy}>Generate proof in browser</button>
            <button className="primary" onClick={usePremade} disabled={busy}>Use pre-made proof</button>
          </div>
        </>
      )}
      {status && <p className="muted">{status}</p>}
      {check?.ok === true && check.ageAbove18 && (
        <>
          <p className="success">
            ✓ Proof verified: 18+ Aadhaar holder{check.state ? ` · ${check.state}` : ""}
            {check.test ? " (TEST data)" : ""}. Nothing else was revealed.
          </p>
          <p className="muted small">
            Publishing needs test GLM from the <a href={ARKIV_FAUCET} target="_blank" rel="noreferrer">Arkiv faucet</a>.
          </p>
          <button className="primary" onClick={publish} disabled={busy}>{busy ? "Publishing…" : "Publish proof to Arkiv"}</button>
          {published && (
            <p className="small">
              ✓ Published: <a href={`${ARKIV_EXPLORER}/entity/${published}`} target="_blank" rel="noreferrer">{short(published)}</a>
            </p>
          )}
        </>
      )}
      {check?.ok === true && !check.ageAbove18 && (
        <p className="error">✕ The proof is valid, but it says this card holder is under 18. The proof can't lie.</p>
      )}
      {check?.ok === false && <p className="error">✕ {check.reason}</p>}
    </section>
  );
}
