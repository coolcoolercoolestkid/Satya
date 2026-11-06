/**
 * Satya site facts: a Chainlink CRE workflow.
 *
 * Input (HTTP trigger): {"domain": "example.com"}
 *
 * Every node in the Chainlink DON independently looks up four public facts about the domain:
 *   1. when it was registered (RDAP, straight from the domain's own registry),
 *   2. the date of its oldest still-valid HTTPS certificate (Certificate Transparency logs, via Cert Spotter),
 *   3. when the Internet Archive first saw it,
 *   4. whether it resolves in DNS (Cloudflare DNS-over-HTTPS).
 * The DON then agrees on each fact (median across nodes), so no single API, server or node,
 * including Satya's, can change the answer. The workflow scores the agreed facts with the same
 * weights the Satya extension uses and returns them with plain-language reasons.
 *
 * Why it matters for privacy: the extension's full check sends the domain to these services from
 * the user's own IP. Through this workflow they see a Chainlink node instead of the user.
 */
import {
  ConsensusAggregationByFields,
  HTTPCapability,
  HTTPClient,
  Runner,
  decodeJson,
  handler,
  median,
  type HTTPPayload,
  type NodeRuntime,
  type Runtime,
} from "@chainlink/cre-sdk";
import { score, type Facts } from "./score";

type Config = {
  /** RDAP base URL per top-level domain, e.g. {"com": "https://rdap.verisign.com/com/v1/"}. */
  rdapBases: Record<string, string>;
};

const decode = (b: Uint8Array) => new TextDecoder().decode(b);

/** "20110415123000" (Wayback timestamp) to Unix seconds. */
function waybackToUnix(ts: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/.exec(ts);
  if (!m) return 0;
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)) / 1000);
}

/** Runs on every node: four lookups, each failing to 0 ("unknown") rather than breaking consensus. */
function lookUp(domain: string) {
  return (node: NodeRuntime<Config>): Facts => {
    const http = new HTTPClient();
    const get = (url: string, headers: Record<string, string> = {}) => {
      const r = http.sendRequest(node, { url, method: "GET", headers, timeout: "8s" } as never).result();
      if (r.statusCode !== 200) throw new Error(`${url} returned ${r.statusCode}`);
      return JSON.parse(decode(r.body));
    };
    const attempt = (what: string, fn: () => number): number => {
      try {
        return fn();
      } catch (e) {
        node.log(`${what}: ${e instanceof Error ? e.message : String(e)}`);
        return 0;
      }
    };

    const tld = domain.split(".").pop()!;
    const registeredAt = attempt("RDAP", () => {
      const base = node.config.rdapBases[tld];
      if (!base) throw new Error(`no RDAP server configured for .${tld}`);
      const rdap = get(`${base}domain/${domain}`, { accept: "application/rdap+json" }) as {
        events?: { eventAction: string; eventDate: string }[];
      };
      const reg = rdap.events?.find((e) => e.eventAction === "registration");
      return reg ? Math.floor(Date.parse(reg.eventDate) / 1000) : 0;
    });

    const firstCertAt = attempt("Cert Spotter", () => {
      const certs = get(`https://api.certspotter.com/v1/issuances?domain=${domain}&include_subdomains=false&expand=dns_names`) as {
        not_before: string;
      }[];
      const times = certs.map((c) => Date.parse(c.not_before) / 1000).filter((t) => t > 0);
      return times.length ? Math.floor(Math.min(...times)) : 0;
    });

    const firstArchivedAt = attempt("Internet Archive", () => {
      const wb = get(`https://archive.org/wayback/available?url=${domain}&timestamp=19900101`) as {
        archived_snapshots?: { closest?: { timestamp?: string } };
      };
      const ts = wb.archived_snapshots?.closest?.timestamp;
      return ts ? waybackToUnix(ts) : 0;
    });

    const resolves = attempt("DNS", () => {
      const dns = get(`https://cloudflare-dns.com/dns-query?name=${domain}&type=A`, { accept: "application/dns-json" }) as {
        Status: number;
        Answer?: unknown[];
      };
      return dns.Status === 0 && (dns.Answer?.length ?? 0) > 0 ? 1 : 0;
    });

    return { registeredAt, firstCertAt, firstArchivedAt, resolves };
  };
}

const DOMAIN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const onRequest = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
  const { domain: raw } = decodeJson(payload.input) as { domain?: string };
  const domain = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .replace(/^www\./, "");
  if (!DOMAIN.test(domain)) throw new Error(`Not a domain name: ${raw}`);
  runtime.log(`Looking up ${domain} on every node`);

  const facts = runtime
    .runInNodeMode(
      lookUp(domain),
      ConsensusAggregationByFields<Facts>({
        registeredAt: median,
        firstCertAt: median,
        firstArchivedAt: median,
        resolves: median,
      }),
    )()
    .result();

  const now = Math.floor(runtime.now().getTime() / 1000);
  const { score: s, signals } = score(facts, now);
  const iso = (t: number) => (t ? new Date(t * 1000).toISOString().slice(0, 10) : null);
  const out = {
    domain,
    checkedAt: new Date(now * 1000).toISOString(),
    facts: {
      registered: iso(facts.registeredAt),
      oldestValidCertificate: iso(facts.firstCertAt),
      firstArchived: iso(facts.firstArchivedAt),
      resolves: facts.resolves === 1,
    },
    score: s,
    signals,
    agreedBy: "Chainlink DON consensus (median of every node's independent lookup)",
  };
  runtime.log(JSON.stringify(out));
  return JSON.stringify(out);
};

const initWorkflow = (_config: Config) => [
  // Simulation accepts an empty trigger config; a deployed workflow must list authorizedKeys.
  handler(new HTTPCapability().trigger({}), onRequest),
];

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
