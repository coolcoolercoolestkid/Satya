// Starts the built server over stdio, like Claude Desktop would, and calls each tool once.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "satya-smoke", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ["dist/server.js"] }));
console.log("tools:", (await client.listTools()).tools.map((t) => t.name).join(", "));

const calls = [
  ["check_message", { text: "Dear customer your SBI KYC is pending. Update now or your account will be blocked today: http://sbi-kyc-update.xyz/login", sender: "VK-SBIKYC" }],
  ["check_domain", { domain: "rnetamask.io" }],
  ["check_url", { url: "https://example.com" }],
  ["check_url", { url: "http://127.0.0.1:8080/admin" }],
  ["check_wallet", { address: "0x0330070fd38ec3bb94f58fa55d40368271e9e54a" }],
];
for (const [name, args] of calls) {
  const r = await client.callTool({ name, arguments: args });
  console.log(`\n=== ${name} ${JSON.stringify(args).slice(0, 80)}\n${r.content[0].text}`);
}
await client.close();
