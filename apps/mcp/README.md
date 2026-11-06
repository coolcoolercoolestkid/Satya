# Satya MCP server

AI agents now open links, read messages and send payments for people. Scammers already
target them with fake pages and hidden instructions. This server lets any MCP client
(Claude Desktop, Claude Code, agent frameworks) ask Satya **before** acting.

| Tool | Use it before… | What it checks |
|---|---|---|
| `check_url` | opening, logging in to, paying on, or recommending a link | Loads the page (public addresses only) and runs every website check: phishing lists, lookalike domains, scam wording, OTP/UPI PIN/card/seed-phrase fields, forms sending data to another site, fake `.gov.in`/`.bank.in` claims, domain age, certificate type, sanctioned wallets, app downloads. Optional Claude page review. |
| `check_domain` | trusting a domain, without loading it | Phishing lists, lookalikes, gov/bank domain rules, domain age, certificate type |
| `check_message` | acting on an SMS, WhatsApp, Telegram or email | Indian and crypto scam patterns, plus every link and wallet inside the message |
| `check_wallet` | sending funds to an address | OFAC sanctions and scam lists |

Every answer has a 0–100 score, a recommended action (**DO NOT PROCEED** whenever any
finding is a danger), and the source for each finding. The same answer is also returned as
structured JSON (`structuredContent`).

## Run

```bash
pnpm install
pnpm data                          # download the public lists
pnpm --filter @satya/mcp build
node apps/mcp/test/smoke.mjs       # optional: calls each tool once (run from apps/mcp)
```

## Add to Claude Desktop

Settings → Developer → Edit config, then add (use your own path):

```json
{
  "mcpServers": {
    "satya": {
      "command": "node",
      "args": ["C:/path/to/Satya/apps/mcp/dist/server.js"],
      "env": { "ANTHROPIC_API_KEY": "optional, turns on the AI page review" }
    }
  }
}
```

Claude Code: `claude mcp add satya -- node /path/to/Satya/apps/mcp/dist/server.js`

## Safety

- Only `http`/`https` links to public addresses are loaded; `localhost` and private network
  addresses are refused, so a tricked agent can't use Satya to read internal pages.
- The server never runs page scripts and reads at most 2 MB of HTML per link.
- Pages drawn entirely by JavaScript show little text this way; the browser extension sees
  the rendered page instead.
- The AI page review can only add warnings that quote the page. It can't vouch for a site.
