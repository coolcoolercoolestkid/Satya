/**
 * Mock issuer CLI: keygen, sign, verify.
 *
 * DEVELOPMENT ONLY. Every path here prints a warning that this issuer verifies no
 * identity, because output from this tool ends up in demos.
 */

import { readFileSync, writeFileSync } from "node:fs";

import {
  parseSignedCredential,
  serializeSignedCredential,
  type NormalizedCredential,
  type SignedCredentialJson,
} from "@aletheia/credential";

import { MOCK_ISSUER_LABEL, generateKeypair } from "./keys.ts";
import { defaultKeystorePath, readKeystore, writeKeystore } from "./keystore-node.ts";
import { signCredential, verifySignedCredential } from "./sign.ts";

const WARNING =
  "!! mock issuer: verifies no identity. Signed credentials prove issuance only. !!";

interface CredentialInputJson {
  schemaVersion: number;
  credentialId: string;
  subject: string;
  dateOfBirth: number;
  nationality: number;
  expiryDate: number;
  issuedAt: number;
  identitySecret?: string;
}

function readCredential(path: string): NormalizedCredential {
  const json = JSON.parse(readFileSync(path, "utf8")) as CredentialInputJson;
  if (json.identitySecret === undefined) {
    throw new Error(
      `${path}: missing identitySecret. A real issuer derives it once per document with ` +
        "deriveIdentitySecret({ issuerSalt, documentKey }); it is not a value the holder " +
        "supplies. See docs/credential-schema.md.",
    );
  }
  return {
    schemaVersion: json.schemaVersion,
    credentialId: BigInt(json.credentialId),
    subject: json.subject,
    dateOfBirth: json.dateOfBirth,
    nationality: json.nationality,
    expiryDate: json.expiryDate,
    issuedAt: json.issuedAt,
    identitySecret: BigInt(json.identitySecret),
  };
}

function usage(): never {
  console.error(
    [
      "usage:",
      "  cli.ts keygen [keystore.json]",
      "  cli.ts sign <credential.json> <out-signed.json> [keystore.json]",
      "  cli.ts verify <signed.json>",
    ].join("\n"),
  );
  process.exit(2);
}

async function main(): Promise<void> {
  console.error(WARNING);
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "keygen": {
      const path = writeKeystore(await generateKeypair(), args[0] ?? defaultKeystorePath());
      const { publicKey } = await readKeystore(path);
      console.log(`keystore written: ${path}`);
      console.log(`label:            ${MOCK_ISSUER_LABEL}`);
      console.log(`publicKey.ax:     ${publicKey.ax}`);
      console.log(`publicKey.ay:     ${publicKey.ay}`);
      return;
    }

    case "sign": {
      const [credentialPath, outPath, keystorePath] = args;
      if (credentialPath === undefined || outPath === undefined) usage();
      const { privateKey } = await readKeystore(keystorePath ?? defaultKeystorePath());
      const signed = await signCredential(privateKey, readCredential(credentialPath));
      writeFileSync(outPath, `${JSON.stringify(serializeSignedCredential(signed), null, 2)}\n`, "utf8");
      console.log(`signed credential written: ${outPath}`);
      return;
    }

    case "verify": {
      const [signedPath] = args;
      if (signedPath === undefined) usage();
      const json = JSON.parse(readFileSync(signedPath, "utf8")) as SignedCredentialJson;
      const valid = await verifySignedCredential(parseSignedCredential(json));
      console.log(valid ? "signature: VALID" : "signature: INVALID");
      process.exit(valid ? 0 : 1);
    }

    default:
      usage();
  }
}

await main();
