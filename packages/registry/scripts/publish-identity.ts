/**
 * Publishes a demo identity record for the publisher wallet: fictional resident Asha Verma,
 * verified by the mock DigiLocker against the same sample document the Aletheia site offers.
 * Uses the same issue/publish code as the site, so the directory and the extension have a real
 * record to find.   pnpm --filter @satya/registry exec tsx scripts/publish-identity.ts
 */
import { createWalletClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { fingerprint, findIdentities, issueIdentity, publishIdentity } from "../../identity/src/identityRecord.js";
import { http, isHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

process.loadEnvFile?.(new URL("../.env", import.meta.url));
const key = process.env.SATYA_PUBLISHER_KEY;
if (!key || !isHex(key)) throw new Error("No SATYA_PUBLISHER_KEY in packages/registry/.env");
const account = privateKeyToAccount(key as Hex);

const name = "Asha Verma";
const docType = "Aadhaar card";
// Byte-for-byte the sample the Aletheia site generates for Asha.
const sample = `SATYA DEMO DOCUMENT - NOT A REAL ID\n${docType} (fictional)\nName: ${name}\nIssued by: Mock DigiLocker (demo issuer)\n`;
const docHash = await fingerprint(new TextEncoder().encode(sample));

const signed = await issueIdentity(account.address, { name, doc: { dateOfBirth: "1999-04-12", nationality: "IN", documentExpiry: "2031-06-30" } }, docType, docHash);
const wallet = createWalletClient({ chain: rabdi({ accessKey: process.env.ARKIV_ACCESS_KEY ?? "" }), transport: http(), account });
const r = await publishIdentity(wallet, signed);
console.log("published", { holder: account.address, docHash, entityKey: r.entityKey, tx: r.txHash });

for (let i = 0; i < 10; i++) {
  const found = await findIdentities({ name });
  const mine = found.find((f) => f.key === r.entityKey);
  if (mine) {
    console.log("found by name:", mine.signed.record.name, mine.check);
    console.log("found by hash:", (await findIdentities({ docHash })).some((f) => f.key === r.entityKey));
    console.log("found by wallet:", (await findIdentities({ holder: account.address })).some((f) => f.key === r.entityKey));
    break;
  }
  await new Promise((res) => setTimeout(res, 3000));
}
