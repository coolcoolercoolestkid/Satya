// Downloads public scam/fraud lists and writes them where the extension loads them.
// Re-runnable: `pnpm --filter @satya/import build`.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../../apps/extension/data");
mkdirSync(out, { recursive: true });

const SOURCES = {
  metamask: "https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json",
  ofacEth:
    "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_ETH.txt",
};

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res;
}

// 1. Phishing domains: MetaMask eth-phishing-detect (DBAD license).
const mm = await (await get(SOURCES.metamask)).json();
const domainLists = [
  {
    source: "MetaMask phishing list",
    kind: "phishing",
    domains: mm.blacklist,
    allow: mm.whitelist,
  },
];

// 2. Sanctioned wallets: US Treasury OFAC SDN list (public domain), ETH addresses
//    extracted by github.com/0xB10C/ofac-sanctioned-digital-currency-addresses (MIT).
const ofacText = await (await get(SOURCES.ofacEth)).text();
const ofac = ofacText
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => /^0x[a-fA-F0-9]{40}$/.test(l));
const addressLists = [
  {
    source: "US Treasury OFAC sanctions list",
    labels: Object.fromEntries(ofac.map((a) => [a.toLowerCase(), "Sanctioned by the US Treasury (OFAC SDN list)"])),
  },
];

// 3. Named entities: RBI Alert List (curated in rbi-alert-list.json).
const rbi = JSON.parse(readFileSync(join(here, "rbi-alert-list.json"), "utf8"));
const namedLists = [{ source: rbi.source, names: rbi.names }];

writeFileSync(join(out, "domain-lists.json"), JSON.stringify(domainLists));
writeFileSync(join(out, "address-lists.json"), JSON.stringify(addressLists));
writeFileSync(join(out, "named-lists.json"), JSON.stringify(namedLists));

console.log(
  `phishing domains: ${mm.blacklist.length}, allowlisted: ${mm.whitelist.length}, OFAC ETH addresses: ${ofac.length}, RBI names: ${rbi.names.length}`,
);
