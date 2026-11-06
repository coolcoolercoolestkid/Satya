import { describe, expect, it } from "vitest";
import { archiveFinding, checkScamText, checkStructure, isObfuscatedScript, SEED_BRANDS, snapshotFromHtml, type PageSnapshot } from "../src/index.js";

const ids = (text: string) =>
  checkScamText({ url: "https://x.example", title: "", text } as PageSnapshot).map((f) => f.source.replace("Satya scam rule: ", ""));

describe("extortion and scareware wording", () => {
  it("catches sextortion, ransom notes, crypto deadlines and fake fines", () => {
    expect(ids("I recorded you while watching adult videos. I will send it to your contacts.")).toContain("sextortion");
    expect(ids("All your files have been encrypted. To decrypt your files pay the ransom.")).toContain("ransom-note");
    expect(ids("You have 48 hours to send 0.05 bitcoin to this wallet address")).toContain("pay-or-else");
    expect(ids("Pay the fine of Rs. 25,000 immediately or a warrant for your arrest will be issued by the cyber cell")).toContain("fake-fine");
  });
  it("leaves ordinary pages alone", () => {
    expect(ids("We recorded a podcast episode with the team.")).toEqual([]);
    expect(ids("Bitcoin price today: track BTC in the next 24 hours.")).toEqual([]);
    expect(ids("How to pay a traffic fine online on the official Parivahan portal.")).toEqual([]);
  });
});

describe("malware and security signals", () => {
  const html = (inner: string, url = "https://shady-downloads.example/") => snapshotFromHtml(`<html><head><title>t</title></head><body>${inner}</body></html>`, url);

  it("finds miners, hidden frames, scrambled code and drive-by downloads", () => {
    const page = html(
      `<script src="https://coinhive.com/lib/coinhive.min.js"></script>
       <iframe src="https://evil-ads.example/x" width="0" height="0"></iframe>
       <script>eval(atob("YWxlcnQoMSk="))</script>
       <meta http-equiv="refresh" content="0; url=/files/setup.exe">`,
    );
    const titles = checkStructure(page, SEED_BRANDS).map((f) => f.title);
    expect(titles).toEqual(
      expect.arrayContaining([
        "Runs a cryptocurrency miner in your browser",
        "Loads invisible frames from other sites",
        "Contains scrambled code that decodes and runs itself",
        "Starts a file download automatically",
      ]),
    );
  });

  it("doesn't flag normal scripts", () => {
    expect(isObfuscatedScript("window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments);}")).toBe(false);
    const page = html(`<script>console.log("hello")</script><iframe src="https://www.youtube.com/embed/x" width="560" height="315"></iframe>`);
    expect(checkStructure(page, SEED_BRANDS)).toEqual([]);
  });
});

describe("site history from the Internet Archive", () => {
  const now = new Date("2026-11-06T00:00:00Z");
  it("rewards long history and warns about brand-new sites", () => {
    expect(archiveFinding("sbi.co.in", new Date("1998-06-26"), now)).toMatchObject({ severity: "good", weight: 10 });
    expect(archiveFinding("new-shop.example", new Date("2026-10-20"), now)).toMatchObject({ severity: "warning" });
    expect(archiveFinding("tiny.example", undefined, now)).toMatchObject({ severity: "info", weight: 0 });
  });
});

describe("official sites and shared hosts", () => {
  it("doesn't count help text on an official site as scam wording, nor a host's age as a site's", async () => {
    const { adjustForOrigin } = await import("../src/index.js");
    const seed = { check: "scam" as const, severity: "danger" as const, title: "Asks for your seed phrase", source: "rule", weight: 50 };
    const age = { check: "records" as const, severity: "good" as const, title: "Domain is 10+ years old", source: "RDAP", weight: 25 };
    expect(adjustForOrigin([seed], { url: "https://metamask.io/faq", title: "", text: "" }, SEED_BRANDS)[0]).toMatchObject({ severity: "info", weight: 0 });
    expect(adjustForOrigin([age], { url: "https://scam.pages.dev/", title: "", text: "" }, SEED_BRANDS)[0]).toMatchObject({ severity: "info", weight: 0 });
    expect(adjustForOrigin([seed], { url: "https://metamask-sync.example/", title: "", text: "" }, SEED_BRANDS)[0]).toMatchObject({ severity: "danger" });
  });
});
