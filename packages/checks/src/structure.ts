import type { Brand } from "./brands.js";
import { isSameOrSubdomain, normalizeHost, registrableDomain } from "./domain.js";
import { officialBrandFor } from "./phishing.js";
import type { Finding, PageSnapshot } from "./types.js";

/**
 * Checks on what the page *does*, not what it says: where its forms send data, what it asks
 * you to type, what it asks you to install, and where it is hosted.
 */

/** Platforms where anyone can publish a site in minutes, under the platform's domain. */
export const FREE_HOSTS = [
  "vercel.app", "netlify.app", "github.io", "pages.dev", "web.app", "firebaseapp.com",
  "weebly.com", "wixsite.com", "blogspot.com", "000webhostapp.com", "glitch.me", "replit.app",
  "repl.co", "herokuapp.com", "onrender.com", "framer.website", "webflow.io", "carrd.co",
  "godaddysites.com", "square.site", "sites.google.com", "ipfs.io", "dweb.link", "fleek.co",
  "on-fleek.app", "surge.sh", "workers.dev", "ngrok-free.app", "ngrok.io",
];

const SENSITIVE_LABELS: Record<string, string> = {
  otp: "a one-time password (OTP)",
  cvv: "your card's CVV",
  card: "your card number",
  "upi-pin": "your UPI PIN",
  aadhaar: "your Aadhaar number",
  pan: "your PAN",
  "seed-phrase": "your wallet's secret phrase",
  "private-key": "your wallet's private key",
};

const INSTALLER_RE = /\.(apk|exe|msi|scr|bat|cmd|jar|dmg|pkg|vbs|ps1)(\?|#|$)/i;

export function freeHostOf(host: string): string | undefined {
  const h = normalizeHost(host);
  return FREE_HOSTS.find((d) => isSameOrSubdomain(h, d) && h !== d);
}

const isIpHost = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[");

/** Script hosts of well-known in-browser crypto miners (Coinhive and its successors). */
export const MINER_HOSTS = [
  "coinhive.com", "coin-hive.com", "authedmine.com", "cryptoloot.pro", "crypto-loot.com", "webminepool.com",
  "coinimp.com", "minero.cc", "jsecoin.com", "monerominer.rocks", "webmine.cz", "ppoi.org", "coinblind.com",
];

export function checkStructure(page: PageSnapshot, brands: Brand[]): Finding[] {
  const findings: Finding[] = [];
  const host = normalizeHost(page.url);
  const s = page.signals;
  const official = officialBrandFor(host, brands);
  const isGov = /\.(gov|nic)\.in$/.test(host);
  const trustedOrigin = !!official || isGov || host.endsWith(".bank.in");

  // Where the site lives.
  if (isIpHost(host)) {
    findings.push({
      check: "phishing",
      severity: "warning",
      title: "Site has no domain name, only an IP address",
      detail: "Real businesses use a domain name. Bare IP addresses are common in phishing links.",
      source: "Satya page check",
      weight: 20,
    });
  }
  const freeHost = freeHostOf(host);
  if (freeHost) {
    findings.push({
      check: "phishing",
      severity: page.hasPasswordField ? "warning" : "info",
      title: `Hosted on ${freeHost}, where anyone can make a site`,
      detail: "Free hosting is fine for personal projects, but banks, exchanges and governments never use it.",
      source: "Satya page check",
      weight: page.hasPasswordField ? 15 : 0,
    });
  }

  if (!s) return findings;

  const asksForSecrets = s.sensitiveFields.length > 0 || page.hasPasswordField;

  // Encryption.
  if (s.protocol === "http:" && asksForSecrets) {
    findings.push({
      check: "page",
      severity: "danger",
      title: "Asks for passwords or details without encryption",
      detail: "This page isn't HTTPS, so anything you type can be read on the way.",
      source: "Satya page check",
      weight: 40,
    });
  }

  // Forms that send your details to a different site.
  const myDomain = registrableDomain(host);
  const elsewhere = s.forms.find(
    (f) => f.actionHost && registrableDomain(f.actionHost) !== myDomain && (f.hasPassword || s.sensitiveFields.length > 0),
  );
  if (elsewhere?.actionHost) {
    findings.push({
      check: "page",
      severity: "danger",
      title: `Form sends what you type to ${registrableDomain(elsewhere.actionHost)}`,
      detail: `You're on ${myDomain}, but the login form submits to a different site.`,
      source: "Satya page check",
      evidence: elsewhere.actionHost,
      weight: 40,
    });
  }

  // Secrets no legitimate unknown site should ask for.
  const fields = new Set(s.sensitiveFields);
  if (s.maxInputsInOneForm === 12 || s.maxInputsInOneForm === 24 || s.maxInputsInOneForm === 18) {
    fields.add("seed-phrase");
  }
  const critical = ["seed-phrase", "private-key", "upi-pin", "cvv", "otp"].filter((k) => fields.has(k));
  const personal = ["aadhaar", "pan", "card"].filter((k) => fields.has(k));
  if (critical.length && !trustedOrigin) {
    findings.push({
      check: "page",
      severity: "danger",
      title: `Asks you to type ${critical.map((k) => SENSITIVE_LABELS[k]).join(", ")}`,
      detail:
        fields.has("seed-phrase") || fields.has("private-key")
          ? "Anyone with your secret phrase or private key can empty your wallet. No real service asks for it."
          : "Banks and UPI apps never ask for these on an unknown website.",
      source: "Satya page check",
      weight: fields.has("seed-phrase") || fields.has("private-key") ? 50 : 35,
    });
  }
  if (personal.length && !trustedOrigin) {
    findings.push({
      check: "page",
      severity: "warning",
      title: `Collects ${personal.map((k) => SENSITIVE_LABELS[k]).join(", ")}`,
      detail: "Only share these with official sites you opened yourself.",
      source: "Satya page check",
      weight: 15,
    });
  }

  // Installers outside app stores.
  // Malware and security signals.
  const miners = s.scriptHosts.filter((h) => MINER_HOSTS.some((m) => h === m || h.endsWith(`.${m}`)));
  if (miners.length) {
    findings.push({
      check: "page",
      severity: "danger",
      title: "Runs a cryptocurrency miner in your browser",
      detail: `Scripts from ${miners.join(", ")} use your computer to mine crypto for someone else.`,
      source: "Satya page check (known browser-miner script hosts)",
      weight: 45,
    });
  }
  const hidden = [...new Set((s.hiddenFrameHosts ?? []).filter((h) => h && h !== host && !h.endsWith(`.${registrableDomain(host)}`)))];
  if (hidden.length && !trustedOrigin) {
    findings.push({
      check: "page",
      severity: "warning",
      title: "Loads invisible frames from other sites",
      detail: `Hidden frames from ${hidden.slice(0, 3).join(", ")} can run code or ads you never see, a common way to spread malware.`,
      source: "Satya page check",
      weight: 15,
    });
  }
  if ((s.obfuscatedScripts ?? 0) > 0 && !trustedOrigin) {
    findings.push({
      check: "page",
      severity: "warning",
      title: "Contains scrambled code that decodes and runs itself",
      detail: "Code hidden this way (eval of encoded text, packed scripts) is how malicious pages avoid detection.",
      source: "Satya page check",
      weight: 15,
    });
  }
  if (s.metaRefresh) {
    let target: URL | undefined;
    try {
      target = new URL(s.metaRefresh, page.url);
    } catch {
      target = undefined;
    }
    if (target && (INSTALLER_RE.test(target.pathname) || registrableDomain(target.hostname) !== registrableDomain(host))) {
      const installer = INSTALLER_RE.test(target.pathname);
      findings.push({
        check: "page",
        severity: installer ? "danger" : "warning",
        title: installer ? "Starts a file download automatically" : `Automatically sends you to another site (${target.hostname})`,
        detail: installer
          ? "The page redirects straight to an installer. Drive-by downloads are a classic malware trick."
          : "Pages that bounce you elsewhere hide where you really end up.",
        source: "Satya page check",
        evidence: undefined,
        weight: installer ? 45 : 10,
      });
    }
  }
  if (s.protocol === "https:" && (s.mixedContent ?? 0) > 0) {
    findings.push({
      check: "page",
      severity: "info",
      title: `${s.mixedContent} item${s.mixedContent === 1 ? "" : "s"} loaded without encryption`,
      detail: "Parts of this secure page come over plain http, which others on your network could alter.",
      source: "Satya page check",
      weight: 0,
    });
  }

  const installers = [...new Set(s.downloadLinks.filter((l) => INSTALLER_RE.test(l)))];
  const apk = installers.find((l) => /\.apk(\?|#|$)/i.test(l));
  if (apk && !trustedOrigin) {
    findings.push({
      check: "page",
      severity: "danger",
      title: "Offers an Android app (.apk) outside the Play Store",
      detail: "Fake bank, KYC and rewards apps spread this way and can read your SMS OTPs.",
      source: "Satya page check",
      evidence: apk.split("/").pop(),
      weight: 35,
    });
  } else if (installers.length && !trustedOrigin) {
    findings.push({
      check: "page",
      severity: "warning",
      title: "Offers a program to download and install",
      detail: "Only install software from sources you trust.",
      source: "Satya page check",
      evidence: installers[0]!.split("/").pop(),
      weight: 15,
    });
  }

  return findings;
}

/**
 * Pages that claim to be the Indian government or a bank must live on domains only those
 * institutions can register: .gov.in / .nic.in (government) and .bank.in (RBI-regulated banks,
 * mandatory since RBI's April 2025 circular).
 */
export function checkAuthority(page: PageSnapshot, brands: Brand[]): Finding[] {
  const host = normalizeHost(page.url);
  const text = `${page.title}\n${page.text.slice(0, 5000)}`;
  const findings: Finding[] = [];

  if (/\.(gov|nic)\.in$/.test(host)) {
    return [{
      check: "phishing",
      severity: "good",
      title: "Official Indian government domain",
      detail: ".gov.in and .nic.in can only be registered by government bodies.",
      source: "NIC domain rules",
      weight: 45,
    }];
  }
  if (host.endsWith(".bank.in")) {
    return [{
      check: "phishing",
      severity: "good",
      title: "Registered Indian bank domain (.bank.in)",
      detail: "Only RBI-regulated banks can register .bank.in domains.",
      source: "RBI .bank.in mandate",
      weight: 45,
    }];
  }

  const claimsGov =
    /\b(government of india|govt\.? of india|ministry of [a-z]+|national portal of india|department of [a-z]+, government)\b|भारत सरकार/i.exec(text);
  if (claimsGov && !officialBrandFor(host, brands)) {
    findings.push({
      check: "phishing",
      severity: page.hasPasswordField || page.signals?.sensitiveFields.length ? "danger" : "warning",
      title: "Claims to be the Government of India, but isn't on a .gov.in domain",
      detail: "Real Indian government sites use .gov.in or .nic.in.",
      source: "NIC domain rules",
      evidence: claimsGov[0],
      weight: page.hasPasswordField ? 40 : 25,
    });
  }

  const official = officialBrandFor(host, brands);
  const claimsBank = /\b([a-z]+ )?bank (ltd|limited|of india|net ?banking|internet banking|login)\b|\bnet ?banking\b/i.exec(text);
  if (claimsBank && !official && (page.hasPasswordField || page.signals?.sensitiveFields.length)) {
    findings.push({
      check: "phishing",
      severity: "danger",
      title: "Bank login page that isn't on a .bank.in domain",
      detail: "RBI requires Indian banks to use .bank.in domains, which only real banks can register.",
      source: "RBI .bank.in mandate",
      evidence: claimsBank[0],
      weight: 40,
    });
  }
  return findings;
}
