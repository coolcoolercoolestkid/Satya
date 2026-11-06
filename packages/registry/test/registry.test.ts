import { describe, expect, it } from "vitest";
import { bucketOf, buildBuckets, domainCandidates, hashesOf, matchInRecords, sha256Hex, type BucketRecord } from "../src/index.js";

const record = async (type: "domain" | "address", source: string, values: string[], bucket: string): Promise<BucketRecord> => {
  const buckets = await buildBuckets(type, values);
  return {
    key: "0x01", source, type, bucket, date: "2026-11-06", published: 1, sourceSha256: "x", sourceUrl: "x",
    hashes: hashesOf(buckets.get(bucket)!),
  };
};

describe("scam registry buckets", () => {
  it("hashes with plain SHA-256 so anyone can reproduce it", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("puts a site and its subdomains in the same bucket", async () => {
    expect(await bucketOf("domain", "login.evil-example.com")).toBe(await bucketOf("domain", "evil-example.com"));
    expect(domainCandidates("www.login.evil-example.co.in")).toEqual(["login.evil-example.co.in", "evil-example.co.in"]);
  });

  it("makes 256 buckets that together hold every entry once", async () => {
    const values = ["a-scam.com", "b-scam.com", "A-SCAM.com", "c-scam.net"];
    const buckets = await buildBuckets("domain", values);
    expect(buckets.size).toBe(256);
    const total = [...buckets.values()].reduce((n, b) => n + b.length / 32, 0);
    expect(total).toBe(3);
  });

  it("finds listed sites and their subdomains, and nothing else, without the plain list", async () => {
    const b = await bucketOf("domain", "evil-example.com");
    const r = await record("domain", "metamask-phishing", ["evil-example.com", "other-scam.org"], b);
    const host = "login.evil-example.com";
    expect((await matchInRecords("domain", domainCandidates(host), [r])).map((h) => h.value)).toEqual(["evil-example.com"]);
    expect(await matchInRecords("domain", domainCandidates("good-example.com"), [r])).toEqual([]);
  });

  it("matches addresses in any letter case", async () => {
    const a = "0x0330070fd38ec3bb94f58fa55d40368271e9e54a";
    const r = await record("address", "ofac-sdn", [a], await bucketOf("address", a));
    const hits = await matchInRecords("address", [a.toUpperCase().replace("0X", "0x")], [r]);
    expect(hits[0]?.source.label).toBe("US Treasury OFAC SDN list");
  });
});

describe("shared hosting sites", () => {
  it("treats each site on a shared host as its own site", async () => {
    const { siteOf } = await import("../src/index.js");
    expect(siteOf("login.scam-one.pages.dev")).toBe("scam-one.pages.dev");
    expect(siteOf("scam-two.netlify.app")).toBe("scam-two.netlify.app");
    expect(siteOf("www.example.co.in")).toBe("example.co.in");
    expect(domainCandidates("a.scam-one.pages.dev")).toEqual(["a.scam-one.pages.dev", "scam-one.pages.dev"]);
  });
});

describe("more shared hosts", () => {
  it("handles region labels, IPFS gateways and country blogspot domains", async () => {
    const { siteOf } = await import("../src/index.js");
    expect(siteOf("login.my-proj.uc.r.appspot.com")).toBe("my-proj.uc.r.appspot.com");
    expect(siteOf("bafyabc.ipfs.dweb.link")).toBe("bafyabc.ipfs.dweb.link");
    expect(siteOf("scam.duckdns.org")).toBe("scam.duckdns.org");
    expect(siteOf("fake-bank.blogspot.co.uk")).toBe("fake-bank.blogspot.co.uk");
  });
});
