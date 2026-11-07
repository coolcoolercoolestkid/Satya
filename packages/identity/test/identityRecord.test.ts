import { describe, expect, it } from "vitest";
import { describeFacts, fingerprint, issueIdentity, nameKey, parseIdentity, serializeIdentity, verifyIdentity } from "../src/identityRecord.js";

const holder = "0x6b08DcC8631c1643139CBF42227BB7FB1d04F1DD" as const;
const now = new Date("2026-11-07T00:00:00Z");
const asha = { name: "Asha  Verma", doc: { dateOfBirth: "1999-04-12", nationality: "IN", documentExpiry: "2031-06-30" } };

describe("identity record", () => {
  it("signs name + document fingerprint and verifies after a round trip", async () => {
    const hash = await fingerprint(new TextEncoder().encode("a document"));
    const s = await issueIdentity(holder, asha, "Aadhaar card", hash, now);
    expect(s.record.name).toBe("Asha  Verma");
    expect(describeFacts(s.record.claims)).toEqual(["18+", "Nationality IN", "ID valid"]);
    const back = parseIdentity(serializeIdentity(s));
    expect(await verifyIdentity(back, holder, now)).toMatchObject({ ok: true });
    expect(nameKey(" Asha  Verma ")).toBe("asha verma");
  });
  it("rejects tampering, a different wallet and expired documents", async () => {
    const hash = await fingerprint(new TextEncoder().encode("a document"));
    const s = await issueIdentity(holder, asha, "Aadhaar card", hash, now);
    expect(await verifyIdentity({ ...s, record: { ...s.record, name: "Someone Else" } }, holder, now)).toMatchObject({ ok: false });
    expect(await verifyIdentity(s, "0x0000000000000000000000000000000000000001", now)).toMatchObject({ ok: false });
    await expect(issueIdentity(holder, { ...asha, doc: { ...asha.doc, documentExpiry: "2024-01-01" } }, "Aadhaar card", hash, now)).rejects.toThrow(/expired/);
  });
  it("leaves out 18+ for a minor", async () => {
    const hash = await fingerprint(new TextEncoder().encode("x"));
    const s = await issueIdentity(holder, { name: "Rohan Mehta", doc: { dateOfBirth: "2010-01-20", nationality: "IN", documentExpiry: "2030-01-01" } }, "Aadhaar card", hash, now);
    expect(describeFacts(s.record.claims)).toEqual(["Nationality IN", "ID valid"]);
  });
});
