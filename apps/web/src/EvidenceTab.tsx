import { checkEvidenceFile, type EvidenceFile } from "@satya/checks";
import { anchorEvidence, arkivBrowserWriter, findEvidenceAnchors, type EvidenceAnchor } from "@satya/identity";
import { useState } from "react";
import type { Address } from "viem";
import { ARKIV_EXPLORER, ARKIV_FAUCET, ARKIV_KEY, provider, short } from "./wallet";

/**
 * Scam evidence: anchor a saved file's fingerprint on Arkiv, or check a file someone gave you.
 * Only the fingerprint (a SHA-256 hash) ever goes on Arkiv.
 */
export function EvidenceTab({ address, connect, initial }: { address?: Address; connect: () => void; initial?: string }) {
  const [fingerprint, setFingerprint] = useState(initial ?? "");
  const [status, setStatus] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [anchored, setAnchored] = useState<string>();
  const [checked, setChecked] = useState<{ file: EvidenceFile; anchors: EvidenceAnchor[] } | { error: string }>();

  const anchor = async () => {
    if (!address || !/^[0-9a-f]{64}$/.test(fingerprint)) return;
    setBusy(true);
    setStatus(undefined);
    try {
      const writer = await arkivBrowserWriter(provider(), address, ARKIV_KEY);
      const r = await anchorEvidence(writer, fingerprint);
      setAnchored(r.entityKey);
    } catch (e) {
      setStatus(`Anchoring failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (f: File) => {
    setChecked(undefined);
    let file: EvidenceFile;
    try {
      file = JSON.parse(await f.text()) as EvidenceFile;
    } catch {
      setChecked({ error: "That isn't a Satya evidence file." });
      return;
    }
    const c = await checkEvidenceFile(file);
    if (!c.ok) {
      setChecked({ error: c.reason });
      return;
    }
    setChecked({ file, anchors: await findEvidenceAnchors(c.fingerprint, ARKIV_KEY) });
  };

  return (
    <section>
      <h2>Scam evidence that can't be quietly changed</h2>
      <p className="muted">
        Scam pages vanish within days. In the Satya extension, <strong>Save evidence</strong> freezes a page (its text, a
        screenshot and Satya's findings) into a file on your computer. Anchoring puts only that file's <strong>fingerprint</strong>{" "}
        (a SHA-256 hash) on Arkiv, never the page or its address. Later, anyone you give the file to can check it here: if one
        letter changed, the fingerprint won't match.
      </p>
      <p className="muted small">
        It proves the file existed, unchanged, by the time it was anchored. It doesn't prove the website served it; a zkTLS
        proof would add that.
      </p>

      <h3>1. Anchor a fingerprint</h3>
      <input
        className="mono"
        value={fingerprint}
        onChange={(e) => setFingerprint(e.target.value.trim().toLowerCase())}
        placeholder="64-character fingerprint from the extension"
        size={70}
      />
      {!address ? (
        <button className="primary" onClick={connect}>Connect wallet</button>
      ) : (
        <button className="primary" onClick={anchor} disabled={busy || !/^[0-9a-f]{64}$/.test(fingerprint)}>
          {busy ? "Anchoring…" : "Anchor on Arkiv"}
        </button>
      )}
      <p className="muted small">
        Needs a little test GLM from the <a href={ARKIV_FAUCET} target="_blank" rel="noreferrer">Arkiv faucet</a>. The record is
        owned by your wallet and kept for about 6 months.
      </p>
      {anchored && (
        <p className="success">
          ✓ Anchored: <a href={`${ARKIV_EXPLORER}/entity/${anchored}`} target="_blank" rel="noreferrer">{short(anchored)}</a>
        </p>
      )}
      {status && <p className="error">{status}</p>}

      <h3>2. Check an evidence file</h3>
      <input type="file" accept=".json,application/json" onChange={(e) => e.target.files?.[0] && void verify(e.target.files[0])} />
      {checked && "error" in checked && <p className="error">✕ {checked.error}</p>}
      {checked && "file" in checked && (
        <div>
          <p className="success">✓ The file is intact: its text, screenshot and details match its fingerprint.</p>
          <p className="small">
            <strong>{checked.file.header.title || checked.file.header.url}</strong> · {checked.file.header.url}
            <br />
            Saved {new Date(checked.file.header.capturedAt).toLocaleString()} · Satya said: {checked.file.header.score}/100,{" "}
            {checked.file.header.label}
            {checked.file.header.findings.length ? ` (${checked.file.header.findings.join("; ")})` : ""}
          </p>
          {checked.file.screenshot && <img src={checked.file.screenshot} alt="Screenshot saved as evidence" style={{ maxWidth: "100%", border: "1px solid #ccc" }} />}
          {checked.anchors.length ? (
            <p className="success">
              ✓ Anchored on Arkiv on {checked.anchors[0]!.at.toLocaleString()} (block {checked.anchors[0]!.block.toString()}) by{" "}
              {short(checked.anchors[0]!.owner)}, so this file existed, unchanged, by then.
            </p>
          ) : (
            <p className="muted">Not anchored on Arkiv yet, so there's no proof of when it existed.</p>
          )}
        </div>
      )}
    </section>
  );
}
