import { createPublicClient, createWalletClient, ExpirationTime } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { eq } from "@arkiv-network/sdk/query";
import { addr, bytes, defineSchema, str } from "@arkiv-network/sdk/schema";
import { custom, hexToString, http, stringToBytes, type Address, type EIP1193Provider, type Hex } from "viem";
import { parseAttestation, serializeAttestation, type SignedAttestation } from "./credential.js";

/**
 * One Arkiv entity per proven claim. No personal data: only the holder's wallet, which claim,
 * who signed it, and the signed statement itself. Each record is owned by the holder's wallet
 * and expires when the credential does (capped at Arkiv's maximum lifetime).
 */
export const SatyaProofs = defineSchema("satya_proofs_v1", {
  holder: addr().indexed(),
  claim: str().indexed(),
  issuer: addr().indexed(),
  kind: str().indexed(),
  payload: bytes(),
});

/**
 * Arkiv RPC access key. Not a secret (it ships with the app), but restrict it to your origins at
 * https://hub.arkiv.network/access-keys. Empty uses the rate-limited public endpoint.
 */
export function arkivChain(accessKey = "") {
  return rabdi({ accessKey });
}

export function arkivReader(accessKey = "") {
  return createPublicClient({ chain: arkivChain(accessKey), transport: http() });
}

/** A writer backed by the user's browser wallet. Switches the wallet to Arkiv's testnet first. */
export async function arkivBrowserWriter(provider: EIP1193Provider, account: Address, accessKey = "") {
  const chain = arkivChain(accessKey);
  const client = createWalletClient({ chain, transport: custom(provider), account });
  const switchTo = () =>
    provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${chain.id.toString(16)}` }] });
  try {
    await switchTo();
  } catch {
    await client.addChain({ chain });
    await switchTo();
  }
  return client;
}

type Writer = Awaited<ReturnType<typeof arkivBrowserWriter>>;

const MAX_SECONDS = 7_884_000 * 2; // Arkiv's maximum lifetime: 7,884,000 blocks of 2 seconds

/** Lifetime for a record: until the credential expires, but never past Arkiv's maximum. */
export function lifetimeFor(expiresAt: bigint, now = new Date()) {
  const secondsLeft = Number(expiresAt) - Math.floor(now.getTime() / 1000);
  const capped = Math.max(2, Math.min(secondsLeft, MAX_SECONDS - 600));
  return ExpirationTime.fromSeconds(capped - (capped % 2));
}

export async function publishAttestation(writer: Writer, signed: SignedAttestation) {
  return writer.createEntity(
    SatyaProofs,
    {
      holder: addr(signed.attestation.holder),
      claim: signed.attestation.claim,
      issuer: addr(signed.issuer),
      kind: "attestation",
      payload: stringToBytes(serializeAttestation(signed)),
    },
    { expiration: lifetimeFor(signed.attestation.expiresAt) },
  );
}

export interface ProofRecord {
  key: Hex;
  owner: Address;
  kind: string;
  signed?: SignedAttestation;
}

/**
 * Proof records for a wallet. Only records the wallet itself owns are returned, so nobody can
 * plant claims on someone else's profile. Callers still verify every signature.
 */
export async function fetchProofRecords(holder: Address, accessKey = ""): Promise<ProofRecord[]> {
  const client = arkivReader(accessKey);
  const result = await client
    .select({ $key: true, $owner: true, kind: true, payload: true })
    .from(SatyaProofs)
    .where(eq("holder", addr(holder)))
    .ownedBy(holder)
    .limit(50)
    .fetch();
  return result.entities.map((row) => {
    const record: ProofRecord = {
      key: row.$key as Hex,
      owner: row.$owner as Address,
      kind: String(row.kind.value),
    };
    if (record.kind === "attestation") {
      try {
        record.signed = parseAttestation(hexToString(row.payload.value as Hex));
      } catch {
        /* unreadable payload: left out, so it can't count as proof */
      }
    }
    return record;
  });
}
