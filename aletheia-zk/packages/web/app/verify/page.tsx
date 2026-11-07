"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  deriveVerificationState,
  type IndexingMeta,
  type Verification,
  type VerificationState,
} from "@aletheia/query/browser";

import { SiteHeader } from "../SiteHeader";
import {
  FRESHNESS_PRESETS,
  ensAvailable,
  etherscanTx,
  getQueryClient,
  resolveDisplayName,
  resolveTarget,
  shortHex,
  yyyymmddToIso,
  type ResolvedTarget,
} from "@/lib/verify";

/** The raw material of a lookup: the records and the indexer state from one read. */
interface LookupResult {
  target: ResolvedTarget;
  verifications: Verification[];
  meta: IndexingMeta;
}

const POLL_MS = 4000;

function StatePill({ status }: { status: VerificationState["status"] }) {
  return (
    <span className="state" data-status={status}>
      {status === "not-found" ? "not found" : status}
    </span>
  );
}

/** The mock-dev label, load-bearing: a record derived from it is never a verified identity. */
function IssuerBadge({ label }: { label: string }) {
  if (label === "mock-dev") return <span className="badge-mock">mock-dev</span>;
  return <span className="mono">{label}</span>;
}

/** How a claim reads to a verifier. The generic parameter slot decodes per claim type. */
function claimLabel(v: Verification): string {
  if (v.claimType === 1) return `age ≥ ${v.claimParameter}`;
  if (v.claimType === 2) return `nationality ${v.claimParameter}`;
  // Expiry has no parameter (the slot is pinned to zero); the substance is the date the
  // credential was proven still valid on, which the record carries as credentialValidOn.
  if (v.claimType === 3) return `not expired (valid on ${yyyymmddToIso(v.credentialValidOn)})`;
  return `claim type ${v.claimType}, parameter ${v.claimParameter}`;
}

function RecordCard({ v, state }: { v: Verification; state: VerificationState }) {
  return (
    <div className="record">
      <div className="record-head">
        <StatePill status={state.status} />
        <strong>{claimLabel(v)}</strong>
        <IssuerBadge label={v.issuer.label} />
      </div>
      <p className="reason">{state.reason}</p>
      <div className="kv">
        <span className="k">verificationId</span>
        <span className="mono">{v.id}</span>
        <span className="k">credential valid on</span>
        <span>{yyyymmddToIso(v.credentialValidOn)}</span>
        <span className="k">context</span>
        <span className="mono">{shortHex(v.contextId)}</span>
        <span className="k">nullifier</span>
        <span className="mono">{shortHex(v.nullifier)}</span>
        <span className="k">transaction</span>
        <span className="mono">
          <a href={etherscanTx(v.transactionHash)} target="_blank" rel="noreferrer">
            {v.transactionHash}
          </a>
        </span>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  const [input, setInput] = useState("");
  const [policyIdx, setPolicyIdx] = useState(0);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Watch panel: poll one just-submitted verification from pending to verified.
  const [watchId, setWatchId] = useState("");
  const [watchBlock, setWatchBlock] = useState("");
  const [watching, setWatching] = useState(false);
  const [watchState, setWatchState] = useState<VerificationState | null>(null);
  const [watchError, setWatchError] = useState<string | null>(null);

  const policy = FRESHNESS_PRESETS[policyIdx]!.policy;

  // Re-classify the same records whenever the freshness policy changes — no re-query. This
  // is what makes one real record show `verified` under a generous window and `stale` under
  // a tight one, exactly as scripts/states.ts does against the live endpoint.
  const records = useMemo(() => {
    if (result === null) return [];
    const nowSeconds = Math.floor(Date.now() / 1000);
    return result.verifications.map((v) => ({
      v,
      state: deriveVerificationState({ verification: v, meta: result.meta, policy, nowSeconds }),
    }));
  }, [result, policy]);

  // Re-read the subgraph for an already-resolved target. Used by the initial lookup and by
  // the auto-refresh poll, so a poll never re-resolves ENS or loses the resolved name.
  const queryProfile = useCallback(async (target: ResolvedTarget): Promise<void> => {
    const { meta, data } = await getQueryClient().profile(target.address, { first: 100 });
    setResult({ target, verifications: data?.verifications ?? [], meta });
  }, []);

  const runLookup = useCallback(
    async (raw: string): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        // Resolve without the blocking ENS reverse-lookup, so the subgraph records appear as
        // soon as the indexer responds rather than waiting on a mainnet round-trip.
        const target = await resolveTarget(raw);
        await queryProfile(target);
        // Fill the display name in the background (address path only; a typed name already
        // has one). A slow or empty reverse record never delays the records.
        if (target.via === "address" && ensAvailable) {
          void resolveDisplayName(target.address).then((name) => {
            if (name) setResult((prev) => (prev ? { ...prev, target: { ...prev.target, name } } : prev));
          });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setResult(null);
      } finally {
        setBusy(false);
      }
    },
    [queryProfile],
  );

  // Auto-refresh: re-read the same resolved target on an interval, quietly, so a newly
  // indexed record appears without the verifier reloading the page.
  useEffect(() => {
    if (!autoRefresh || result === null) return;
    const target = result.target;
    const id = setInterval(() => void queryProfile(target).catch(() => {}), POLL_MS);
    return () => clearInterval(id);
  }, [autoRefresh, result, queryProfile]);

  // Watch one verification by id and the block its transaction was mined in. While the
  // indexer is behind that block and no record is present, the state is `pending`; once the
  // record is indexed it becomes `verified`. The poll flips it live, without a reload — the
  // Day 21 exit criterion.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopWatch = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setWatching(false);
  }, []);

  const startWatch = useCallback(
    (idArg?: string, blockArg?: string) => {
      const id = (idArg ?? watchId).trim();
      const blockStr = (blockArg ?? watchBlock).trim();
      setWatchError(null);
      setWatchState(null);
      if (!/^0x[0-9a-fA-F]{64}$/.test(id)) {
        setWatchError("verificationId must be a 32-byte hex value (0x + 64 hex digits)");
        return;
      }
      let expectedBlock: bigint | undefined;
      if (blockStr !== "") {
        try {
          expectedBlock = BigInt(blockStr);
        } catch {
          setWatchError("mined block must be an integer");
          return;
        }
      }
      setWatching(true);
      const tick = async (): Promise<void> => {
        try {
          const state = await getQueryClient().verificationState(id, {
            policy,
            ...(expectedBlock !== undefined ? { expectedBlock } : {}),
          });
          setWatchState(state);
          // Stop once the answer is stable: anything but a pending indexer means the record
          // has either arrived or is genuinely absent.
          if (state.status !== "pending") stopWatch();
        } catch (e) {
          setWatchError(e instanceof Error ? e.message : String(e));
          stopWatch();
        }
      };
      void tick();
      pollRef.current = setInterval(() => void tick(), POLL_MS);
    },
    [watchId, watchBlock, policy, stopWatch],
  );

  // Clean up the poll on unmount.
  useEffect(() => () => stopWatch(), [stopWatch]);

  // Warm the subgraph endpoint on mount, so the verifier's first real lookup doesn't pay the
  // cold-start latency of a Studio endpoint that has been idle. Fire-and-forget; a failure
  // here changes nothing about the real lookup.
  useEffect(() => {
    void getQueryClient().meta().catch(() => {});
  }, []);

  // Handoff from the holder flow:
  //  - /verify?address=<wallet> prefills the lookup and runs it (the holder shares their address).
  //  - /verify?watch=<verificationId>&block=<minedBlock> prefills and starts the watch, so a
  //    verification just submitted on the other page is seen here going pending -> verified.
  const handoffDone = useRef(false);
  useEffect(() => {
    if (handoffDone.current) return;
    handoffDone.current = true;
    const params = new URLSearchParams(window.location.search);
    const address = params.get("address");
    if (address) {
      setInput(address);
      void runLookup(address);
    }
    const id = params.get("watch");
    const block = params.get("block");
    if (id) {
      setWatchId(id);
      if (block) setWatchBlock(block);
      startWatch(id, block ?? undefined);
    }
    // startWatch/runLookup are intentionally not dependencies: this runs once, on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main>
      <SiteHeader active="verify" />

      <h1>Verifier flow</h1>
      <p className="sub">
        Look up an ENS name or a wallet address, read what it has proven, and see each record as one
        of five honest states. Everything is read live from the subgraph and mainnet ENS on this
        device. A verifier learns only the answer to the claim — never the holder’s document or the
        data behind it.
      </p>

      <div className="privacy-note">
        <strong>🔒 A record holds a proof result, not a document.</strong> Each record carries the
        issuer, claim type, the one value a nationality claim discloses, a validity date, a
        per-context nullifier and the wallet — never a date of birth, document number, or the passport
        itself. Nothing is stored off-chain; there is no server.
      </div>

      <div className="mock-banner">
        <span className="badge-mock">mock-dev</span> <strong>Phase 1, Sepolia test network.</strong>{" "}
        Every record here was signed by a labelled mock issuer that verifies no identity — so{" "}
        <span className="ok">verified</span> means a real proof was accepted on-chain, never that a
        real-world identity was checked. In production a trusted issuer (e.g. <em>DigiLocker</em> or a
        passport’s ICAO chip signature) would make the same record carry real-world weight.
      </div>

      {/* Look up an address or name */}
      <section className="step">
        <h2>
          <span className="n">1</span> Look up a subject
        </h2>
        <label>Wallet address (or ENS name)</label>
        <input
          value={input}
          spellCheck={false}
          placeholder={ensAvailable ? "0x1234…abcd  (or vitalik.eth)" : "0x1234…abcd"}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && input.trim() && !busy) void runLookup(input);
          }}
        />
        <p className="hint">
          The holder’s <strong>wallet address</strong> is the identifier — it’s what their proof is
          bound to. The holder gets it to copy on their success screen. An ENS name works too, but
          only if the holder already owns one pointing at that wallet.
        </p>
        {!ensAvailable && (
          <p className="hint">
            ENS name resolution is off (no mainnet RPC configured). Address lookup still works.
          </p>
        )}

        <label>Freshness window — how recent must the proof be for you to accept it?</label>
        <select value={policyIdx} onChange={(e) => setPolicyIdx(Number(e.target.value))}>
          {FRESHNESS_PRESETS.map((p, i) => (
            <option key={p.label} value={i}>
              {p.label}
            </option>
          ))}
        </select>
        <p className="hint">
          This is <strong>your</strong> policy as the verifier, not a property of the record. A proof
          submitted an hour ago reads <span className="ok">verified</span> under “30 days” but{" "}
          <b>stale</b> under “5 minutes” — a bar checking age might accept a week-old proof, while a
          bank login might demand one seconds old. Both readings of the same record are correct.
        </p>

        <div>
          <button disabled={busy || input.trim().length === 0} onClick={() => void runLookup(input)}>
            {busy ? "Looking up…" : "Look up"}
          </button>
          {result !== null && (
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 14 }}>
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              auto-refresh (poll every {POLL_MS / 1000}s)
            </label>
          )}
        </div>

        {error && <p className="error">{error}</p>}
      </section>

      {/* Results */}
      {result !== null && (
        <section className="step">
          <h2>
            <span className="n">2</span> Result
          </h2>
          <div className="kv">
            <span className="k">address</span>
            <span className="mono">{result.target.address}</span>
            <span className="k">ENS name</span>
            <span>
              {result.target.name ? (
                <span className="mono">{result.target.name}</span>
              ) : (
                <span className="hint">none (resolved live; addresses need no name)</span>
              )}
            </span>
            <span className="k">reached via</span>
            <span>{result.target.via === "ens" ? "ENS forward resolution" : "typed address"}</span>
            <span className="k">indexer block</span>
            <span>
              {String(result.meta.blockNumber)}
              {result.meta.hasIndexingErrors && (
                <span className="error"> — subgraph reports indexing errors</span>
              )}
            </span>
          </div>

          {records.length === 0 ? (
            <div className="record">
              <div className="record-head">
                <StatePill status="not-found" />
                <strong>no verifications</strong>
              </div>
              <p className="reason">
                No verification is indexed for this address. That is the ordinary answer for an
                address that has never proven a claim — a normal state, not an error.
              </p>
            </div>
          ) : (
            <>
              <p className="hint" style={{ marginTop: 12 }}>
                {records.length} record{records.length === 1 ? "" : "s"}, newest first.
              </p>
              {records.map(({ v, state }) => (
                <RecordCard key={v.id} v={v} state={state} />
              ))}
            </>
          )}
        </section>
      )}

      {/* Watch a just-submitted verification go pending -> verified */}
      <section className="step">
        <h2>
          <span className="n">3</span> Watch a verification appear
        </h2>
        <p className="hint">
          Paste a verificationId and the block its transaction was mined in (the holder flow links
          here with both filled in). While the subgraph is still behind that block, the state is{" "}
          <b>pending</b>; the poll flips it to <span className="ok">verified</span> the moment the
          record is indexed — no reload. A submitted transaction is never shown as verified before
          its record exists.
        </p>
        <div className="row">
          <div>
            <label>verificationId</label>
            <input
              value={watchId}
              spellCheck={false}
              placeholder="0x…"
              onChange={(e) => setWatchId(e.target.value)}
              disabled={watching}
            />
          </div>
          <div>
            <label>mined in block (optional)</label>
            <input
              value={watchBlock}
              spellCheck={false}
              placeholder="e.g. 11680359"
              onChange={(e) => setWatchBlock(e.target.value)}
              disabled={watching}
            />
          </div>
        </div>
        <div>
          {!watching ? (
            <button disabled={watchId.trim().length === 0} onClick={() => startWatch()}>
              Watch
            </button>
          ) : (
            <button className="secondary" onClick={stopWatch}>
              Stop watching
            </button>
          )}
        </div>

        {watchError && <p className="error">{watchError}</p>}

        {watchState && (
          <div className="record">
            <div className="record-head">
              <span className={watchState.status === "pending" ? "pulse" : undefined}>
                <StatePill status={watchState.status} />
              </span>
              {watching && watchState.status === "pending" && (
                <span className="hint">polling every {POLL_MS / 1000}s…</span>
              )}
            </div>
            <p className="reason">{watchState.reason}</p>
            {"verification" in watchState && (
              <div className="kv">
                <span className="k">claim</span>
                <span>{claimLabel(watchState.verification)}</span>
                <span className="k">issuer</span>
                <span>
                  <IssuerBadge label={watchState.verification.issuer.label} />
                </span>
                <span className="k">transaction</span>
                <span className="mono">
                  <a href={etherscanTx(watchState.verification.transactionHash)} target="_blank" rel="noreferrer">
                    {watchState.verification.transactionHash}
                  </a>
                </span>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
