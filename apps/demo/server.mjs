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
  "photo-proof": "images.html",
};

const BANNER = `<div role="alert" style="position:sticky;top:0;z-index:2147483647;background:#b00020;color:#fff;font:800 28px/1.2 system-ui,sans-serif;padding:18px 16px;text-align:center;letter-spacing:.5px;border-bottom:6px solid #ffd400">
SATYA DEMO — NOT A REAL WEBSITE
<div style="font:600 15px/1.4 system-ui,sans-serif;margin-top:6px;letter-spacing:0">A fake scam page made only for testing Satya, served from this computer. Forms here send nothing.</div></div>`;

// Belt and braces: every form on every demo page is blocked from submitting.
const NO_SUBMIT = `<script>document.addEventListener("submit", (e) => { e.preventDefault(); alert("SATYA DEMO: this form sends nothing."); }, true);</script>`;

createServer(async (req, res) => {
  if (req.method !== "GET") {
    res.writeHead(405, { "content-type": "text/plain" }).end("Demo pages accept nothing.");
    return;
  }
  const host = (req.headers.host ?? "").split(":")[0];
  // Sample images for the Content Credentials demo (official C2PA test files).
  const img = /^\/img\/([\w.-]+\.jpg)$/.exec(req.url ?? "");
  if (img) {
    try {
      const bytes = await readFile(new URL(`./pages/img/${img[1]}`, import.meta.url));
      res.writeHead(200, { "content-type": "image/jpeg" }).end(bytes);
    } catch {
      res.writeHead(404).end();
    }
    return;
  }
  const name = host.replace(/\.localhost$/, "");
  const file = SITES[name] ?? (host === "localhost" || host === "127.0.0.1" ? "index.html" : null);
  if (!file || req.url?.startsWith("/favicon")) {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    return;
  }
  const html = (await readFile(new URL(`./pages/${file}`, import.meta.url), "utf8")).replace("<body>", `<body>${BANNER}`)
    .replace("</body>", `${NO_SUBMIT}</body>`);
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
}).listen(PORT, () => {
  console.log(`Satya demo pages on http://localhost:${PORT}`);
  for (const s of Object.keys(SITES)) console.log(`  http://${s}.localhost:${PORT}`);
});
