import { describe, expect, it } from "vitest";
import { bucketOf, buildBuckets, checkRegistry, hashesOf, type BucketRecord } from "../src/index.js";

async function fakeRegistry(sources: { source: string; type: "domain" | "address"; values: string[] }[]) {
  const asked: string[] = [];
  const fetcher = async (bucket: string): Promise<BucketRecord[]> => {
    asked.push(bucket);
    const out: BucketRecord[] = [];
    for (const s of sources) {
      const b = await buildBuckets(s.type, s.values);
      out.push({ key: "0xabcdef0123456789", source: s.source, type: s.type, bucket, date: "2026-11-06", published: 1, sourceSha256: "x", sourceUrl: "x", hashes: hashesOf(b.get(bucket)!) });
    }
    return out;
  };
  return { fetcher, asked };
}

const OFAC = "0x0330070fd38ec3bb94f58fa55d40368271e9e54a";

describe("private registry check", () => {
  it("flags a listed site and a listed wallet, asking Arkiv only for bucket ids", async () => {
    const { fetcher, asked } = await fakeRegistry([
      { source: "metamask-phishing", type: "domain", values: ["evil-wallet-sync.com"] },
      { source: "ofac-sdn", type: "address", values: [OFAC] },
    ]);
    const r = await checkRegistry({ url: "https://app.evil-wallet-sync.com/connect", title: "", text: `Send to ${OFAC}` }, fetcher);
    expect(r.findings.map((f) => f.title)).toEqual(["Known phishing site", "Wallet on US Treasury OFAC SDN list"]);
    expect(r.findings[0]!.source).toMatch(/mirrored on Arkiv/);
    expect(asked).toEqual([await bucketOf("domain", "evil-wallet-sync.com"), await bucketOf("address", OFAC)]);
    expect(asked.every((b) => /^[0-9a-f]{2}$/.test(b))).toBe(true);
    expect(r.covered.domain).toEqual(["metamask-phishing"]);
  });

  it("reports which lists it covered, so missing ones fall back to the bundled copy", async () => {
    const { fetcher } = await fakeRegistry([{ source: "ofac-sdn", type: "address", values: [OFAC] }]);
    const r = await checkRegistry({ url: "https://example.org", title: "", text: "" }, fetcher);
    expect(r.covered.domain).toEqual([]);
    expect(r.covered.address).toEqual(["*"]);
  });

  it("says when Arkiv is unreachable", async () => {
    const r = await checkRegistry({ url: "https://example.org", title: "", text: "" }, async () => { throw new Error("down"); });
    expect(r.reachable).toBe(false);
  });
});
