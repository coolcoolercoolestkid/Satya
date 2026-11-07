/**
 * Loader for the committed credential fixture. Test-support only: it is deliberately not
 * exported from the package entry point.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { NormalizedCredential } from "./credential.ts";

interface FixtureFile {
  credential: {
    schemaVersion: number;
    credentialId: string;
    subject: string;
    dateOfBirth: number;
    nationality: number;
    expiryDate: number;
    issuedAt: number;
    identitySecret: string;
  };
  expected: {
    messageHash: string;
    contextIdSource: string;
    contextId: string;
    nullifierAge: string;
    nullifierNationality: string;
    identityNullifier: string;
  };
}

export interface CredentialFixture {
  credential: NormalizedCredential;
  expected: {
    messageHash: bigint;
    contextIdSource: string;
    contextId: bigint;
    nullifierAge: bigint;
    nullifierNationality: bigint;
    identityNullifier: bigint;
  };
}

export function loadCredentialFixture(): CredentialFixture {
  const path = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "credential-v2.json");
  const file = JSON.parse(readFileSync(path, "utf8")) as FixtureFile;
  return {
    credential: {
      schemaVersion: file.credential.schemaVersion,
      credentialId: BigInt(file.credential.credentialId),
      subject: file.credential.subject,
      dateOfBirth: file.credential.dateOfBirth,
      nationality: file.credential.nationality,
      expiryDate: file.credential.expiryDate,
      issuedAt: file.credential.issuedAt,
      identitySecret: BigInt(file.credential.identitySecret),
    },
    expected: {
      messageHash: BigInt(file.expected.messageHash),
      contextIdSource: file.expected.contextIdSource,
      contextId: BigInt(file.expected.contextId),
      nullifierAge: BigInt(file.expected.nullifierAge),
      nullifierNationality: BigInt(file.expected.nullifierNationality),
      identityNullifier: BigInt(file.expected.identityNullifier),
    },
  };
}
