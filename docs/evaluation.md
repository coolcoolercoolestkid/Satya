# How well does the score separate real sites from phishing?

Measured, not assumed. `packages/registry/scripts/evaluate.ts` runs Satya's full check (deeper
mode: page HTML, domain age from the registry, certificates, Internet Archive history) on:

- **36 real sites**: big Indian and global sites across banking, government, shopping, news,
  crypto and developer tools;
- **35 live phishing domains**: a fixed, evenly spaced sample of Phishing.Database's active list.

**The blocklists are switched off** for this test. Otherwise every phishing domain would be caught
just by being on the list it was sampled from, which proves nothing about the rest of Satya. Only
HTML is downloaded; no page code runs. Raw results with every reason: [evaluation.json](evaluation.json).

## Results (6 Nov 2026, calibrated scoring)

| | Real sites (36) | Phishing sites (35) |
|---|---|---|
| Mean score | **86** | **51** |
| Scored "Looks trustworthy" (75+) | 28 | **0** |
| Scored 45–74 ("no red flags / probably fine") | 8 | 34 |
| Scored below 45 ("be careful / high risk") | **0** | 1 |

What this means:

- **No phishing site was called trustworthy** (0 of 35 at 75+), and **no real site was flagged**
  (0 of 36 below 45).
- Phishing sites mostly land at **50: "no red flags, nothing vouches for it"**. On its own, without
  the lists, Satya rarely *proves* a phishing page is fake: most live phishing pages are blank
  redirects, behind bot protection, or on free hosts. But it never vouches for them, which is the
  failure that hurts users.
- With the blocklists on (the real extension), **all 35 are flagged** (on a list → score at most 5).
- Real sites below 75 are ones where a lookup couldn't vouch for them during the run: the page
  didn't load, or the Internet Archive rate-limited us.

## What the evaluation caught and fixed

The first run (scoring that started at 100) and the second run (before calibration) found real
problems, now fixed:

| Problem found | Fix |
|---|---|
| Every unknown site scored 100 | An unknown site now starts at 50; only evidence moves it |
| Domain age silently missing: rdap.org blocks scripts (HTTP 403) | Ask each domain's own registry directly, found via IANA's RDAP bootstrap file |
| metamask.io scored 0: its help pages mention "seed phrase" | Scam wording on an official domain is shown for information only |
| metamask.io then flagged as a lookalike: it now redirects to **metamask.com** | Added metamask.com as an official MetaMask domain |
| Phishing on `*.r.appspot.com`, `duckdns.org`… scored 85 using the *host's* domain age | 85 hosting / dynamic-DNS / gateway services count as shared hosts: their age, certificate and history can't vouch for a site on them |
| Hacked old domains (dpcpl.com, babymonitorbestbuys.com) scored 85 on age + history alone | "Looks trustworthy" now needs a strong signal (official, `.gov.in` / `.bank.in`, the brand's own ENS name) or two independent ones; age-only now tops out at 74 |

Before → after calibration: phishing sites scored 75+ went from **7 → 0**; real sites below 45
stayed at **0**; real-site mean 85 → 86.

## Honest limits

- **35 + 36 sites is a small sample.** It's enough to catch the mistakes above, not to quote a
  precise accuracy figure.
- **Hacked legitimate domains** look legitimate by every signal except the blocklist. Satya scores
  them 74 ("probably fine"), never "trustworthy", and the lists catch the reported ones.
- **Brand-new phishing that isn't on any list yet**, on its own domain, is caught by the page checks
  (lookalike names, scam wording, risky forms, brand-new domain or certificate) when the page shows
  them. Pages that hide their content from scripts score 50: no evidence either way.

Re-run it yourself:

```bash
pnpm --filter @satya/registry exec tsx scripts/evaluate.ts <phishing-domains.txt> 35
```
