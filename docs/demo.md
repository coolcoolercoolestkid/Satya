# Demo: 2-minute script and test checklist

## Before recording

1. `pnpm demo` (demo scam pages on http://localhost:5180), and `pnpm --filter @satya/web dev`
   (web app on http://localhost:5173).
2. Reload Satya in `chrome://extensions` so it runs the latest build, then open the side panel.
3. Have MetaMask on **Arkiv Rabdi testnet** with a little tGLM, connected to the web app.
4. Have a terminal with the `curl` query from the README ready.
5. The demo wallet is the publisher wallet `0x0D34…E736` (imported into MetaMask). A real TEST
   proof for it is already made (`apps/web/public/test-aadhaar/proof-0x0d34….json`), so in the
   Aadhaar tab use **Use pre-made proof**; it is verified again in the browser. One copy is
   already on Arkiv (record `0x2bc7745c…`). The test card was signed on 6 Nov 2026 11:00 IST, so
   the 3-day rule accepts it until 9 Nov; after that, re-sign the cards with
   `node scripts/import/make-test-aadhaar.mjs` and make a new proof.

## Script (about 2 minutes)

**0:00 Hook (15 s).** "AI can fake any website, face or ID. The padlock doesn't help anymore.
Satya answers one question: can I trust what's in front of me? With reasons and proofs, and
without spying on you."

**0:15 Website check (35 s).** Open http://sbi-kyc-update.localhost:5180 (the red banner says
it's a demo). The side panel shows **0, High risk**: "Looks like State Bank of India, but
isn't", "Bank login not on .bank.in", "Asks for your UPI PIN and OTP", "Form sends what you type
to another site", "Offers an .apk". Click the KYC finding: the page scrolls to the highlighted
sentence. Every line shows its source. Then open https://www.onlinesbi.sbi : **Official State
Bank of India domain**.

**0:50 Private lookup on Arkiv (30 s).** Open http://earn-daily-tasks.localhost:5180 : task-job
scam, deposit-to-withdraw, and **"Wallet on US Treasury OFAC SDN list, mirrored on Arkiv by
Satya"**. Point at the panel line: "Arkiv was only asked for bucket 71, 22". Say: "Satya never
sends the site's address. It asks Arkiv for one of 256 buckets of hashes and matches on my
computer." In the terminal, run the `curl` query and show the live record: source, date, and
the SHA-256 of the official list it was built from. Mention "Run full check" is opt-in (asked once on first open) and
says exactly what it sends.

**1:20 Anon Aadhaar 18+ (25 s).** Web app → **Aadhaar** tab. "This proves I'm over 18 from the
UIDAI-signed QR, revealing nothing else: no number, name or birthday. It's bound to my wallet,
the QR must be under 3 days old, which needs an OTP to the owner's phone, and one card counts
for one wallet." Show the verified proof (TEST data, labelled), click **Publish proof to
Arkiv**, confirm in MetaMask.

**1:45 Read it back (15 s).** **Check anyone** tab → paste the wallet address: "18+ Aadhaar
holder (TEST data)", loaded from Arkiv and verified again in the browser. "Owned by my wallet,
expiring on its own. No Satya server anywhere."

## Test checklist (real Chrome)

Tick each one before recording. Expected results come from running the extension's own code
against these pages.

| Page | Expected |
|---|---|
| http://sbi-kyc-update.localhost:5180 | 0, High risk: SBI lookalike, not .bank.in, no encryption, form to another site, UPI PIN/OTP, .apk, KYC threat |
| http://metamask-wallet-sync.localhost:5180 | 0, High risk: MetaMask lookalike, asks for secret phrase, airdrop |
| http://earn-daily-tasks.localhost:5180 | 0, High risk: OFAC wallet (via Arkiv), guaranteed returns, doubling, fee to withdraw, task job, personal UPI |
| http://pm-kisan-help.localhost:5180 | 0, High risk: claims Government of India off .gov.in, CVV, card and Aadhaar fields, no encryption |
| http://photo-proof.localhost:5180 (after **Run full check**) | C.jpg: "drawn by a computer program, not AI" (test signer, not on the C2PA trust list); E-sig-CA.jpg: "broken Content Credentials label"; "Checked 3 images: 2 had them" |
| https://example.com | 50, "No red flags found", low confidence (quick check); after Run full check: OV certificate, "Looks trustworthy" |
| https://ethereum.org | 100, Official Ethereum domain |
| https://www.onlinesbi.sbi | 100, Official State Bank of India domain |
| https://github.com | 50, "No red flags found" (quick check); after Run full check: "Looks trustworthy" if its age/certificate vouch for it |

Also check:
- [ ] The panel shows "Private by default… one bucket id" and "Checked privately against Satya's
      registry on Arkiv" with the bucket ids.
- [ ] "Run full check" adds the certificate and domain-age lines (e.g. onlinesbi.sbi: EV
      certificate).
- [ ] Scam sentences are outlined on the page; clicking a quote scrolls to it.
- [ ] Chrome DevTools on the side panel (right-click → Inspect → Network): before the full check,
      the only request is to `rpc.rabdi.db-chain.testnet.arkiv.network`.
