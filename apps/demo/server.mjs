// Serves Satya's demo scam pages on *.localhost, so each page gets its own domain name.
// Chrome sends every *.localhost name to this computer, so no setup is needed.
// These pages are fake, clearly labelled, and their forms don't send anything anywhere.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const PORT = Number(process.env.PORT ?? 5180);
const SITES = {
  "sbi-kyc-update": "kyc.html",
  "metamask-wallet-sync": "seed.html",
  "earn-daily-tasks": "tasks.html",
  "pm-kisan-help": "gov.html",
};

const BANNER = `<div style="position:sticky;top:0;z-index:9;background:#111;color:#ffd400;font:600 14px system-ui;padding:8px 12px;text-align:center">
SATYA DEMO: a fake scam page made for testing. Not a real site. Forms here send nothing.</div>`;

createServer(async (req, res) => {
  const host = (req.headers.host ?? "").split(":")[0];
  const name = host.replace(/\.localhost$/, "");
  const file = SITES[name] ?? (host === "localhost" || host === "127.0.0.1" ? "index.html" : null);
  if (!file || req.url?.startsWith("/favicon")) {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    return;
  }
  const html = (await readFile(new URL(`./pages/${file}`, import.meta.url), "utf8")).replace("<body>", `<body>${BANNER}`);
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
}).listen(PORT, () => {
  console.log(`Satya demo pages on http://localhost:${PORT}`);
  for (const s of Object.keys(SITES)) console.log(`  http://${s}.localhost:${PORT}`);
});
