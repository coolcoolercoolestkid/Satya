# zkTLS in Satya (design)

Status: **design, not built yet.** The website checks, AI review and MCP server come first.

## What zkTLS is

Every HTTPS page is encrypted between the website and your browser. Normally you can't
prove to anyone else what a website showed you: a screenshot is easy to fake.

zkTLS fixes that. While your browser loads a page, a helper takes part in the encrypted
connection without seeing its contents. At the end you hold a **proof** that says:

> "`example-scam.in` sent these exact words, at this time."

You can reveal only part of the page (for example one sentence) and hide the rest.
Anyone can check the proof later. Nobody, including you, can change the words.

The main open-source implementation is **TLSNotary**, built by Privacy & Scaling
Explorations, a team funded by the Ethereum Foundation (the same team behind Anon Aadhaar).
Others: Reclaim Protocol, zkPass, Opacity.

## Where it helps Satya (website side)

### 1. Scam reports that can't be faked (best fit)

Today scam lists rely on trust: someone says "this site is a scam" and you believe them.
That's open to abuse (false reports against rivals) and hard to defend (scammers deny it).

With zkTLS, the **Report this page** button in the side panel would:

1. Prove, with TLSNotary, that the domain really served the scam sentence (for example
   "pay ₹2,999 to unlock your withdrawal"), revealing only that sentence.
2. Store the proof on **Arkiv**, owned by the reporter, with the domain as an indexed field.
3. Show the report to every other Satya user as **"Proven report: this site said …"**.

Why it matters:

- Reports become **evidence, not accusations**. Satya never has to judge on its own; it
  shows what the site provably said.
- Fake reports are impossible: you can't prove a site said something it didn't.
- Scam sites disappear in days. The proof outlives the site, for police and victims.

### 2. Facts from official sites that have no API

Some of the best data is only on government web pages that block scraping (the RBI Alert
List, company registries). A user visiting the page in their own browser can create a
proof of what it shows ("the RBI Alert List contains *XYZ Forex*"), which Satya can then
reuse without anyone trusting the person who made it.

### 3. Later: the people side

The same idea proves facts about a person from sites they log in to (DigiLocker, a bank,
LinkedIn), without sharing the document. That's for the identity part, after the website side.

## How it would work in the extension

```
Side panel ──"Report this page"──▶ TLSNotary prover (tlsn-js, WebAssembly)
                                       │  encrypted connection to the website,
                                       │  run jointly with a notary server
                                       ▼
                                 proof of the page + chosen sentence
                                       │
                                       ▼
                       Arkiv record { domain, quote, proof }, owned by reporter
                                       │
                                       ▼
            Other users' side panels: "Proven report (TLSNotary): this site said …"
```

## Honest limits

- **Needs a notary.** The proof is only as trustworthy as the notary server's key. PSE
  runs a public test notary; production would use several independent notaries.
- **Heavy in the browser.** The prover is WebAssembly with threads, and browsers can't open
  raw connections, so traffic goes through a small WebSocket proxy. Expect seconds to a
  minute per proof, and some engineering to run it inside a Chrome extension.
- **Proves what was sent, not who sent it.** A proof shows the domain served the words; it
  doesn't say who runs the domain. Satya's other checks (domain age, certificate type,
  lookalikes) cover that.

## Plan

1. Prototype one proof outside the extension with `tlsn-js` against a demo scam page.
2. Add the Arkiv schema `satya_reports_v1 { domain indexed, quote, proof bytes }`.
3. Show proven reports in the side panel ("Past records").
4. Then the extension "Report this page" button.
