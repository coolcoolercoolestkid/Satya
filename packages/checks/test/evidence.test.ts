import { describe, expect, it } from "vitest";
import { buildEvidence, canonicalJson, checkEvidenceFile } from "../src/index.js";

const png = "data:image/png;base64," + Buffer.from("fake png bytes").toString("base64");
const make = () => buildEvidence({ url: "https://scam.example/kyc", title: "KYC", text: "Update KYC now", screenshot: png, score: 10, label: "High risk", findings: ["KYC threat"], capturedAt: new Date("2026-11-06T16:00:00Z") });

describe("scam evidence", () => {
  it("fingerprints the same evidence the same way, whatever the key order", async () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
    expect((await make()).fingerprint).toBe((await make()).fingerprint);
    expect((await make()).fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
  it("accepts an untouched file and catches any edit", async () => {
    const e = await make();
    expect(await checkEvidenceFile(e)).toEqual({ ok: true, fingerprint: e.fingerprint });
    expect((await checkEvidenceFile({ ...e, text: "Edited text" })).ok).toBe(false);
    expect((await checkEvidenceFile({ ...e, header: { ...e.header, url: "https://other.example" } })).ok).toBe(false);
    expect((await checkEvidenceFile({ ...e, screenshot: "data:image/png;base64,AAAA" })).ok).toBe(false);
  });
});
