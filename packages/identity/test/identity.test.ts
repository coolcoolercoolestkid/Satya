import { describe, expect, it } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import {
  checkIdentity,
  ClaimRefusedError,
  issueClaim,
  lifetimeFor,
  parseAttestation,
  profileHandle,
  serializeAttestation,
  verifyAttestation,
  type ProofRecord,
} from "../src/index.js";

const HOLDER = "0x1111111111111111111111111111111111111111" as const;
const NOW = new Date("2026-11-06T00:00:00Z");
const adult = { dateOfBirth: "1999-04-12", nationality: "IN", documentExpiry: "2031-01-01" };

describe("mock DigiLocker issuer", () => {
  it("signs true claims that verify", async () => {
    const s = await issueClaim(HOLDER, "age_over_18", adult, NOW);
    const v = await verifyAttestation(s, HOLDER, NOW);
    expect(v.ok).toBe(true);
    expect(s.attestation.value).toBe("true");
  });
  it("refuses 18+ for a minor and everything for an expired document", async () => {
    await expect(issueClaim(HOLDER, "age_over_18", { ...adult, dateOfBirth: "2010-01-01" }, NOW)).rejects.toThrow(ClaimRefusedError);
    await expect(issueClaim(HOLDER, "nationality", { ...adult, documentExpiry: "2025-01-01" }, NOW)).rejects.toThrow(/expired/);
  });
  it("turns 18 exactly on the birthday", async () => {
    await expect(issueClaim(HOLDER, "age_over_18", { ...adult, dateOfBirth: "2008-11-06" }, NOW)).resolves.toBeTruthy();
    await expect(issueClaim(HOLDER, "age_over_18", { ...adult, dateOfBirth: "2008-11-07" }, NOW)).rejects.toThrow();
  });
  it("rejects tampering, other holders, unknown issuers and expiry", async () => {
    const s = await issueClaim(HOLDER, "nationality", adult, NOW);
    expect((await verifyAttestation({ ...s, attestation: { ...s.attestation, value: "US" } }, HOLDER, NOW)).ok).toBe(false);
    expect((await verifyAttestation(s, "0x2222222222222222222222222222222222222222", NOW)).ok).toBe(false);
    const forged = await issueClaim(HOLDER, "nationality", adult, NOW, generatePrivateKey());
    expect(await verifyAttestation(forged, HOLDER, NOW)).toEqual({ ok: false, reason: "Signed by an unknown issuer." });
    expect((await verifyAttestation(s, HOLDER, new Date("2032-01-01T00:00:00Z"))).ok).toBe(false);
  });
  it("round-trips through JSON", async () => {
    const s = await issueClaim(HOLDER, "id_valid", adult, NOW);
    expect(parseAttestation(serializeAttestation(s))).toEqual(s);
  });
});

describe("Arkiv lifetime", () => {
  it("caps at Arkiv's maximum and uses whole blocks", () => {
    expect(() => lifetimeFor(BigInt(Math.floor(NOW.getTime() / 1000) + 10 * 365 * 86400), NOW)).not.toThrow();
    expect(() => lifetimeFor(BigInt(Math.floor(NOW.getTime() / 1000) + 3601), NOW)).not.toThrow();
  });
});

describe("profile identity check", () => {
  it("reads handles from profile URLs", () => {
    expect(profileHandle("https://x.com/alice_dev")).toMatchObject({ handle: "alice_dev", ensKey: "com.twitter" });
    expect(profileHandle("https://github.com/alice")).toMatchObject({ ensKey: "com.github" });
    expect(profileHandle("https://x.com/home")).toBeUndefined();
  });

  const page = (url: string, text: string) => ({ url, title: "", text });
  const ens = (records: Record<string, string>) => ({
    address: async (n: string) => (n === "alice.eth" ? HOLDER : null),
    text: async (_n: string, key: string) => records[key] ?? null,
  });

  it("confirms a linked handle and shows verified claims", async () => {
    const signed = await issueClaim(HOLDER, "age_over_18", adult, NOW);
    const proofs = async (): Promise<ProofRecord[]> => [{ key: "0x01", owner: HOLDER, kind: "attestation", signed }];
    const f = await checkIdentity(page("https://x.com/alice_dev", "Builder. alice.eth"), {
      ens: ens({ "com.twitter": "alice_dev" }),
      proofs,
      now: NOW,
    });
    const titles = f.map((x) => x.title);
    expect(titles).toContain("X @alice_dev is confirmed by alice.eth");
    expect(titles).toContain("alice.eth: 18+");
  });

  it("flags an impersonator showing someone else's ENS name", async () => {
    const f = await checkIdentity(page("https://x.com/alice_dev_official", "alice.eth giveaway!"), {
      ens: ens({ "com.twitter": "alice_dev" }),
      proofs: async () => [],
      now: NOW,
    });
    expect(f.find((x) => x.severity === "danger")?.title).toMatch(/Possible impersonation/);
    expect(f.map((x) => x.title)).toContain("No verified proofs for alice.eth");
  });
});
