# Satya site facts on Chainlink CRE

A [Chainlink Runtime Environment](https://docs.chain.link/cre) workflow that gives a second,
independent opinion on whether a website is what it claims to be.

**Input** (HTTP trigger): `{"domain": "example.com"}`

**What every node in the Chainlink DON does, independently:**

| Fact | Source |
|---|---|
| When the domain was registered | RDAP, straight from the domain's own registry (e.g. Verisign for `.com`) |
| When it got its first HTTPS certificate | Certificate Transparency logs, via [Cert Spotter](https://sslmate.com/certspotter/) |
| When the Internet Archive first saw it | [Wayback Machine availability API](https://archive.org/help/wayback_api.php) |
| Whether it resolves in DNS | Cloudflare DNS-over-HTTPS |

The DON then agrees on each fact (median across nodes), and the workflow scores the agreed facts
with the same weights as the Satya extension: start at 50; a brand-new domain or certificate
lowers it; years of history raise it; one weak signal alone can't reach "trustworthy".

**Output:**

```json
{
  "domain": "uniswap.org",
  "facts": { "registered": "…", "firstCertificate": "…", "firstArchived": "2011-…", "resolves": true },
  "score": 80,
  "signals": [{ "points": 20, "reason": "Domain is 5+ years old" }, …],
  "agreedBy": "Chainlink DON consensus (median of every node's independent lookup)"
}
```

## Why CRE

- **Nobody, including Satya, can change the answer.** In the extension, one API answers each
  lookup. Here every node asks for itself and the DON keeps the median, so one lying or broken
  API, node or server can't change the answer.
- **Privacy (CROPS).** The extension's full check sends the domain to these services from the
  user's own IP. Through this workflow, they see a Chainlink node instead.

## Run it

Needs the [CRE CLI](https://docs.chain.link/cre/getting-started/cli-installation), [Bun](https://bun.sh)
1.2.21+, and a Chainlink account (`cre login`).

```bash
cd cre/site-facts && bun install
cd .. && cre workflow simulate site-facts --target staging-settings --non-interactive --trigger-index 0 --http-payload '{"domain":"uniswap.org"}'
```

`site-facts/score.ts` holds the scoring with no SDK imports, so it can be tested in plain Node.

## Status

Type-checks against `@chainlink/cre-sdk` 1.23.0; the scoring is tested in Node. **Not yet run
in the CRE simulator.** Not deployed: deploying needs Chainlink to grant deploy access, and a
deployed HTTP trigger must list the EVM addresses allowed to call it (`authorizedKeys`);
simulation accepts an empty list.
