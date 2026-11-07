/**
 * The Arkiv read path. Replaces The Graph (added at ETHGlobal Mumbai 2026).
 *
 * The Arkiv mirror (`packages/arkiv-mirror`) copies every event the Aletheia contracts emit on
 * Sepolia into Arkiv, one `aletheia_event_v1` entity per log, plus an `aletheia_mirror_meta_v1`
 * entity recording the last Sepolia block it has fully copied. This client rebuilds the same
 * Verification / Issuer / Profile records the subgraph mapping built (packages/subgraph/src),
 * from those events, and returns them through the same `QueryClient` interface, so the verifier
 * flow and `deriveVerificationState` are unchanged.
 *
 * Only entities owned by the mirror's publisher wallet are read, the way a subgraph is trusted
 * for its deployment id. Every record carries its Sepolia transaction hash, so any of them can
 * be checked against the chain directly.
 */
import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { desc, eq } from "@arkiv-network/sdk/query";
import { addr, bytes, defineSchema, str, u64 } from "@arkiv-network/sdk/schema";
import { hexToString, http } from "viem";

import type { PageOptions, QueryClient, VerificationStateOptions } from "./client.ts";
import { deriveVerificationState, type VerificationState } from "./state.ts";
import type { Hex, IndexingMeta, Issuer, ProfileRecord, QueryResult, Verification } from "./types.ts";

/** The wallet that runs the mirror (Satya's Arkiv publisher). */
export const ARKIV_MIRROR_PUBLISHER = "0x0D341d00bB9c2327033f447b45Ebb8712521E736" as const;
export const SEPOLIA_CHAIN_ID = 11155111n;

/** One Sepolia log from an Aletheia contract. `eventKey` is the event's main indexed id. */
const AletheiaEventSchema = defineSchema("aletheia_event_v1", {
  chainId: u64().indexed(),
  contract: addr().indexed(),
  event: str().indexed(),
  eventKey: str().indexed(),
  subject: addr().indexed().optional(),
  blockNumber: u64().indexed(),
  logIndex: u64(),
  txHash: str().indexed(),
  /** The decoded event arguments, JSON, bigints as decimal strings. */
  payload: bytes(),
});

/** How far the mirror has copied: every log up to and including `syncedBlock`. */
const AletheiaMirrorMetaSchema = defineSchema("aletheia_mirror_meta_v1", {
  chainId: u64().indexed(),
  syncedBlock: u64().indexed(),
  payload: bytes(),
});

interface EventRow {
  contract: Hex;
  event: string;
  key: string;
  blockNumber: bigint;
  logIndex: bigint;
  txHash: Hex;
  args: Record<string, string>;
}

/**
 * The two schemas, for the mirror that writes them. Typed loosely on purpose: their inferred
 * SDK types can't be named in this package's emitted declarations.
 */
export const AletheiaEvent: unknown = AletheiaEventSchema;
export const AletheiaMirrorMeta: unknown = AletheiaMirrorMetaSchema;

export interface ArkivQueryClientOptions {
  /** Arkiv RPC access key; empty uses the public endpoint. */
  accessKey?: string;
  publisher?: Hex;
}

export function createArkivQueryClient(options: ArkivQueryClientOptions = {}): QueryClient {
  const client = createPublicClient({ chain: rabdi({ accessKey: options.accessKey ?? "" }), transport: http() });
  const publisher = (options.publisher ?? ARKIV_MIRROR_PUBLISHER) as Hex;

  const num = (v: unknown) => BigInt(String((v as { value?: unknown })?.value ?? v));
  const text = (v: unknown) => String((v as { value?: unknown })?.value ?? v);

  async function events(where: ReturnType<typeof eq>[], limit = 200): Promise<EventRow[]> {
    let q = client
      .select({ contract: true, event: true, eventKey: true, blockNumber: true, logIndex: true, txHash: true, payload: true })
      .from(AletheiaEventSchema)
      .where(eq("chainId", u64(SEPOLIA_CHAIN_ID)));
    for (const w of where) q = q.where(w as never);
    const res = await q.ownedBy(publisher).orderBy(desc("blockNumber")).limit(limit).fetch();
    const rows = res.entities.map((r) => ({
      contract: text(r.contract) as Hex,
      event: text(r.event),
      key: text(r.eventKey),
      blockNumber: num(r.blockNumber),
      logIndex: num(r.logIndex),
      txHash: text(r.txHash) as Hex,
      args: JSON.parse(hexToString(text(r.payload) as Hex)) as Record<string, string>,
    }));
    // The same log may be mirrored twice if a run was retried: keep one per (tx, logIndex).
    const seen = new Set<string>();
    return rows.filter((r) => {
      const id = `${r.txHash}:${r.logIndex}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  async function meta(): Promise<IndexingMeta> {
    const res = await client
      .select({ syncedBlock: true })
      .from(AletheiaMirrorMetaSchema)
      .where(eq("chainId", u64(SEPOLIA_CHAIN_ID)))
      .ownedBy(publisher)
      .orderBy(desc("syncedBlock"))
      .limit(1)
      .fetch();
    const row = res.entities[0];
    // No meta yet means nothing has been mirrored: report block 0 so every read is "pending".
    return { blockNumber: row ? num(row.syncedBlock) : 0n, hasIndexingErrors: false };
  }

  /** Issuer as the subgraph built it: IssuerRegistered, then the latest IssuerActiveSet. */
  async function loadIssuer(issuerId: string): Promise<Issuer | null> {
    const rows = await events([eq("eventKey", issuerId.toLowerCase())], 50);
    const reg = rows.find((r) => r.event === "IssuerRegistered");
    if (!reg) return null;
    const lastSet = rows
      .filter((r) => r.event === "IssuerActiveSet")
      .sort((a, b) => Number(b.blockNumber - a.blockNumber || b.logIndex - a.logIndex))[0];
    return {
      id: issuerId.toLowerCase() as Hex,
      ax: BigInt(reg.args.ax!),
      ay: BigInt(reg.args.ay!),
      label: reg.args.label!,
      active: lastSet ? lastSet.args.active === "true" : true,
      registeredAt: BigInt(reg.args.registeredAt!),
    };
  }

  async function profileRegisteredAt(address: string): Promise<bigint | null> {
    const rows = (await events([eq("eventKey", address.toLowerCase()), eq("event", "ProfileRegistered")], 5));
    return rows[0] ? BigInt(rows[0].args.registeredAt!) : null;
  }

  /** Verification as the subgraph mapping built it, with issuer and profile resolved. */
  async function toVerifications(rows: EventRow[]): Promise<Verification[]> {
    const claims = rows.filter((r) => r.event === "ClaimVerified");
    const issuerIds = [...new Set(claims.map((r) => r.args.issuerId!.toLowerCase()))];
    const subjects = [...new Set(claims.map((r) => r.args.subject!.toLowerCase()))];
    const [issuers, regs] = await Promise.all([
      Promise.all(issuerIds.map(loadIssuer)),
      Promise.all(subjects.map(profileRegisteredAt)),
    ]);
    const issuerBy = new Map(issuerIds.map((id, i) => [id, issuers[i]]));
    const regBy = new Map(subjects.map((s, i) => [s, regs[i] ?? null]));
    return claims.map((r) => {
      const a = r.args;
      const issuer = issuerBy.get(a.issuerId!.toLowerCase());
      const subject = a.subject!.toLowerCase() as Hex;
      return {
        id: a.verificationId!.toLowerCase() as Hex,
        subject: { id: subject, registeredAt: regBy.get(subject) ?? null },
        issuer: { id: a.issuerId!.toLowerCase() as Hex, label: issuer?.label ?? "unknown", active: issuer?.active ?? false },
        claimType: Number(a.claimType),
        claimParameter: BigInt(a.claimParameter!),
        credentialValidOn: Number(a.credentialValidOn),
        contextId: a.contextId as Hex,
        nullifier: a.nullifier as Hex,
        identityNullifier: a.identityNullifier as Hex,
        verifiedAt: BigInt(a.verifiedAt!),
        blockNumber: r.blockNumber,
        transactionHash: r.txHash,
      };
    });
  }

  const page = (o?: PageOptions) => ({ first: Math.min(Math.max(o?.first ?? 100, 1), 1000), skip: Math.max(o?.skip ?? 0, 0) });

  return {
    endpoint: `arkiv:rabdi/${publisher}`,

    meta,

    async verification(verificationId: string): Promise<QueryResult<Verification | null>> {
      const [m, rows] = await Promise.all([meta(), events([eq("eventKey", verificationId.toLowerCase()), eq("event", "ClaimVerified")], 5)]);
      const [v] = await toVerifications(rows);
      return { meta: m, data: v ?? null };
    },

    async verificationState(verificationId: string, opts: VerificationStateOptions): Promise<VerificationState> {
      const result = await this.verification(verificationId);
      return deriveVerificationState({
        verification: result.data,
        meta: result.meta,
        policy: opts.policy,
        nowSeconds: opts.nowSeconds ?? Math.floor(Date.now() / 1000),
        ...(opts.expectedBlock !== undefined ? { expectedBlock: opts.expectedBlock } : {}),
      });
    },

    async recentVerifications(o?: PageOptions): Promise<QueryResult<Verification[]>> {
      const p = page(o);
      const [m, rows] = await Promise.all([meta(), events([eq("event", "ClaimVerified")], p.first + p.skip)]);
      const vs = await toVerifications(rows);
      vs.sort((a, b) => Number(b.verifiedAt - a.verifiedAt));
      return { meta: m, data: vs.slice(p.skip, p.skip + p.first) };
    },

    async profile(address: string, o?: PageOptions): Promise<QueryResult<ProfileRecord | null>> {
      const p = page(o);
      const subject = address.toLowerCase() as Hex;
      const [m, rows, registeredAt] = await Promise.all([
        meta(),
        events([eq("subject", addr(subject)), eq("event", "ClaimVerified")], p.first + p.skip),
        profileRegisteredAt(subject),
      ]);
      const vs = (await toVerifications(rows)).sort((a, b) => Number(b.verifiedAt - a.verifiedAt)).slice(p.skip, p.skip + p.first);
      // Like the subgraph: no profile unless the address registered or proved something.
      if (!vs.length && registeredAt === null) return { meta: m, data: null };
      return { meta: m, data: { id: subject, registeredAt, verifications: vs } };
    },

    async issuer(issuerId: string): Promise<QueryResult<Issuer | null>> {
      const [m, i] = await Promise.all([meta(), loadIssuer(issuerId)]);
      return { meta: m, data: i };
    },
  };
}
