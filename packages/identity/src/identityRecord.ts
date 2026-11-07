import { addr, bytes, defineSchema, str, u64 } from "@arkiv-network/sdk/schema";
import { desc, eq } from "@arkiv-network/sdk/query";
import { hexToString, recoverTypedDataAddress, stringToBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arkivReader, lifetimeFor } from "./arkiv.js";
import {
  ClaimRefusedError,
  MOCK_DIGILOCKER_KEY,
  TRUSTED_ISSUERS,
  type DocumentDetails,
  type TrustedIssuer,
} from "./credential.js";

/**
 * A verified identity: the issuer (mock DigiLocker) signs that a wallet belongs to a named person
 * who showed it a document, identified by the document's SHA-256 fingerprint. The document itself
 * is never stored or sent anywhere; anyone holding the same file can prove it matches.
 *
 * Public by design: the name is published so people can look each other up. Only fictional
 * residents exist on the mock issuer.
 */
export interface IdentityRecord {
  holder: Address;
  name: string;
  /** e.g. "Aadhaar card", "Passport". */
  docType: string;
  /** SHA-256 of the uploaded document file, 0x-prefixed. */
  docHash: Hex;
  /** Comma-separated facts the issuer confirmed, e.g. "age_over_18,nationality:IN,id_valid". */
  claims: string;
  issuedAt: bigint;
  expiresAt: bigint;
}

export interface SignedIdentity {
  record: IdentityRecord;
  signature: Hex;
  issuer: Address;
}

const DOMAIN = { name: "Satya Identity", version: "1" } as const;
const TYPES = {
  Identity: [
    { name: "holder", type: "address" },
    { name: "name", type: "string" },
    { name: "docType", type: "string" },
    { name: "docHash", type: "bytes32" },
    { name: "claims", type: "string" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
  ],
} as const;

/** Lower-case, single-spaced: the key names are searched by. */
export const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/** SHA-256 of a file's bytes, 0x-prefixed. Runs in the browser; the file never leaves it. */
export async function fingerprint(data: ArrayBuffer | Uint8Array): Promise<Hex> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(data as ArrayBuffer) as Uint8Array<ArrayBuffer>);
  return `0x${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function ageOn(dob: Date, on: Date) {
  let age = on.getUTCFullYear() - dob.getUTCFullYear();
  const m = on.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && on.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

/** The mock issuer checks the resident's record and signs name + document fingerprint + facts. */
export async function issueIdentity(
  holder: Address,
  person: { name: string; doc: DocumentDetails },
  docType: string,
  docHash: Hex,
  now = new Date(),
  issuerKey: Hex = MOCK_DIGILOCKER_KEY,
): Promise<SignedIdentity> {
  const expiry = new Date(`${person.doc.documentExpiry}T23:59:59Z`);
  if (!(expiry > now)) throw new ClaimRefusedError("The document has expired, so it can't be verified.");
  if (!/^0x[0-9a-f]{64}$/i.test(docHash)) throw new ClaimRefusedError("No document fingerprint.");
  const facts = [`nationality:${person.doc.nationality}`, "id_valid"];
  if (ageOn(new Date(`${person.doc.dateOfBirth}T00:00:00Z`), now) >= 18) facts.unshift("age_over_18");
  const record: IdentityRecord = {
    holder,
    name: person.name.trim(),
    docType,
    docHash: docHash.toLowerCase() as Hex,
    claims: facts.join(","),
    issuedAt: BigInt(Math.floor(now.getTime() / 1000)),
    expiresAt: BigInt(Math.floor(expiry.getTime() / 1000)),
  };
  const account = privateKeyToAccount(issuerKey);
  const signature = await account.signTypedData({ domain: DOMAIN, types: TYPES, primaryType: "Identity", message: record });
  return { record, signature, issuer: account.address };
}

export type IdentityCheck = { ok: true; issuer: TrustedIssuer } | { ok: false; reason: string };

/** Checks signature, issuer, holder and expiry. */
export async function verifyIdentity(
  s: SignedIdentity,
  expectedHolder?: Address,
  now = new Date(),
  issuers: TrustedIssuer[] = TRUSTED_ISSUERS,
): Promise<IdentityCheck> {
  let signer: Address;
  try {
    signer = await recoverTypedDataAddress({ domain: DOMAIN, types: TYPES, primaryType: "Identity", message: s.record, signature: s.signature });
  } catch {
    return { ok: false, reason: "Signature is malformed." };
  }
  const issuer = issuers.find((i) => i.address.toLowerCase() === signer.toLowerCase());
  if (!issuer) return { ok: false, reason: "Signed by an unknown issuer." };
  if (expectedHolder && s.record.holder.toLowerCase() !== expectedHolder.toLowerCase()) return { ok: false, reason: "Issued to a different wallet." };
  if (Number(s.record.expiresAt) * 1000 <= now.getTime()) return { ok: false, reason: "Expired." };
  return { ok: true, issuer };
}

export function serializeIdentity(s: SignedIdentity): string {
  return JSON.stringify({ ...s, record: { ...s.record, issuedAt: String(s.record.issuedAt), expiresAt: String(s.record.expiresAt) } });
}

export function parseIdentity(json: string): SignedIdentity {
  const o = JSON.parse(json) as SignedIdentity;
  return { ...o, record: { ...o.record, issuedAt: BigInt(o.record.issuedAt), expiresAt: BigInt(o.record.expiresAt) } };
}

/** What each fact in `claims` means, for display. */
export function describeFacts(claims: string): string[] {
  return claims
    .split(",")
    .filter(Boolean)
    .map((c) => (c === "age_over_18" ? "18+" : c === "id_valid" ? "ID valid" : c.startsWith("nationality:") ? `Nationality ${c.slice(12)}` : c));
}

/* ------------------------------------------------------------------ Arkiv */

/**
 * One Arkiv entity per verified identity, owned by the holder's wallet. Indexed so anyone can
 * query by name, wallet or document fingerprint.
 */
export const SatyaIdentity = defineSchema("satya_identity_v1", {
  holder: addr().indexed(),
  name: str(),
  nameKey: str().indexed(),
  docHash: str().indexed(),
  docType: str(),
  issuer: addr().indexed(),
  published: u64().indexed(),
  payload: bytes(),
});


export async function publishIdentity(writer: unknown, s: SignedIdentity, now = new Date()) {
  const w = writer as {
    createEntity: (schema: typeof SatyaIdentity, data: Record<string, unknown>, opts: object) => Promise<{ entityKey: Hex; txHash: Hex }>;
  };
  return w.createEntity(
    SatyaIdentity,
    {
      holder: addr(s.record.holder),
      name: s.record.name.slice(0, 120),
      nameKey: nameKey(s.record.name).slice(0, 120),
      docHash: s.record.docHash,
      docType: s.record.docType.slice(0, 60),
      issuer: addr(s.issuer),
      published: u64(BigInt(Math.floor(now.getTime() / 1000))),
      payload: stringToBytes(serializeIdentity(s)),
    },
    { expiration: lifetimeFor(s.record.expiresAt, now) },
  );
}

export interface FoundIdentity {
  key: Hex;
  owner: Address;
  signed: SignedIdentity;
  check: IdentityCheck;
}

export type IdentityQuery = { name: string } | { holder: Address } | { docHash: Hex } | { recent: true };

/**
 * Finds identity records on Arkiv and verifies each one. A record only counts if the wallet it
 * names owns it and the issuer's signature checks out, so nobody can plant a name on someone
 * else's wallet.
 */
export async function findIdentities(q: IdentityQuery, accessKey = "", limit = 20): Promise<FoundIdentity[]> {
  let query = arkivReader(accessKey).select({ $key: true, $owner: true, payload: true }).from(SatyaIdentity);
  if ("name" in q) query = query.where(eq("nameKey", nameKey(q.name)));
  else if ("holder" in q) query = query.where(eq("holder", addr(q.holder)));
  else if ("docHash" in q) query = query.where(eq("docHash", q.docHash.toLowerCase()));
  const result = await query.orderBy(desc("published")).limit(limit).fetch();
  const out: FoundIdentity[] = [];
  for (const row of result.entities) {
    let signed: SignedIdentity;
    try {
      signed = parseIdentity(hexToString(row.payload.value as Hex));
    } catch {
      continue;
    }
    const owner = row.$owner as Address;
    const check: IdentityCheck =
      owner.toLowerCase() !== signed.record.holder.toLowerCase()
        ? { ok: false, reason: "Published by a different wallet than the one it names." }
        : await verifyIdentity(signed);
    out.push({ key: row.$key as Hex, owner, signed, check });
  }
  return out;
}
