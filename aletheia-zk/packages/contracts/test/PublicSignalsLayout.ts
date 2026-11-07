/**
 * The nine-signal AgeClaim layout is decoded by index in four independent places:
 *
 *   - the normative table in `docs/public-signals.md`,
 *   - `AGE_PUBLIC_SIGNALS` in `packages/circuits`,
 *   - the generated verifier `Groth16VerifierAge.sol` (`uint[9]`),
 *   - `AletheiaVerifier.sol` (`uint256[9]`, plus its declared order and hardcoded indices).
 *
 * If any two disagree, a proof decodes as a different claim than it proves — the exact
 * failure the migration to v2 had to get right. Every other test exercises one layer's
 * behaviour; this one asserts the layers describe the *same* layout, so the agreement is
 * checked by a test rather than by a human reading four files. Nothing here is assumed:
 * the doc table, the two Solidity signatures and the contract's own declared order are
 * all read from disk and compared to the TypeScript constant.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  AGE_PUBLIC_SIGNALS,
  EXPIRY_PUBLIC_SIGNALS,
  NATIONALITY_PUBLIC_SIGNALS,
} from "@aletheia/circuits";

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const publicSignalsDoc = read("../../../docs/public-signals.md");
const groth16Source = read("../contracts/verifiers/Groth16VerifierAge.sol");
const groth16NationalitySource = read("../contracts/verifiers/Groth16VerifierNationality.sol");
const groth16ExpirySource = read("../contracts/verifiers/Groth16VerifierExpiry.sol");
const aletheiaSource = read("../contracts/AletheiaVerifier.sol");

/** The expected layout, as an ordinary array, so the assertions read plainly. */
const LAYOUT = [...AGE_PUBLIC_SIGNALS];

/** Signal names from a claim's table in `docs/public-signals.md`, in index order. */
function layoutFromDoc(markdown: string, heading: string): string[] {
  const start = markdown.indexOf(heading);
  assert.notEqual(start, -1, `docs/public-signals.md has no ${heading} section`);
  const section = markdown.slice(start, markdown.indexOf("\n## ", start + 1));

  const rows: Array<{ index: number; name: string }> = [];
  const rowPattern = /^\|\s*(\d+)\s*\|\s*`([^`]+)`\s*\|/gm;
  for (const match of section.matchAll(rowPattern)) {
    rows.push({ index: Number(match[1]), name: match[2] as string });
  }
  // The table must number its rows 0..n-1 with no gaps, or "decode by index" is a lie.
  rows.forEach((row, position) =>
    assert.equal(row.index, position, `${heading} table row ${position} is labelled index ${row.index}`),
  );
  return rows.map((row) => row.name);
}

/** The `[nullifier, ...]` order the contract documents it decodes, read from its natspec. */
function layoutFromContract(source: string): string[] {
  // Collapse the multi-line comment the array is wrapped across into one line.
  const flattened = source.replace(/\r/g, "").replace(/\n\s*\*/g, " ");
  const match = flattened.match(/\[\s*(nullifier[a-zA-Z0-9,\s]*subject)\s*\]/);
  assert.ok(match, "AletheiaVerifier does not document its nine-signal order");
  return (match[1] as string).split(",").map((name) => name.trim());
}

/** The fixed array size a Solidity `verifyProof`/`submitAgeClaim` signature declares. */
function calldataArity(source: string, pattern: RegExp): number {
  const match = source.match(pattern);
  assert.ok(match, `could not find the public-signals parameter matching ${pattern}`);
  return Number(match[1]);
}

describe("AgeClaim public-signal layout agreement", () => {
  it("docs/public-signals.md lists exactly the AGE_PUBLIC_SIGNALS order", () => {
    assert.deepEqual(layoutFromDoc(publicSignalsDoc, "## AgeClaim"), LAYOUT);
  });

  it("the generated verifier takes one uint per signal", () => {
    // Guards the "which is why the generated verifier takes uint[9]" claim in the doc.
    assert.equal(
      calldataArity(groth16Source, /uint\[(\d+)\] calldata _pubSignals/),
      LAYOUT.length,
    );
  });

  it("submitAgeClaim takes one uint256 per signal", () => {
    assert.equal(
      calldataArity(aletheiaSource, /uint256\[(\d+)\] calldata publicSignals/),
      LAYOUT.length,
    );
  });

  it("AletheiaVerifier documents the same order it decodes", () => {
    assert.deepEqual(layoutFromContract(aletheiaSource), LAYOUT);
  });

  it("AletheiaVerifier reads every layout slot and none beyond it", () => {
    // Each of the nine slots is decoded somewhere in submitAgeClaim, and there is no
    // read of a tenth. The meaning of each index — that slot 2 is the schema version,
    // slot 8 the subject, and so on — is pinned behaviourally in AletheiaVerifier.ts,
    // which mutates a single slot and asserts the matching custom error.
    const readIndices = new Set(
      [...aletheiaSource.matchAll(/publicSignals\[(\d+)\]/g)].map((match) => Number(match[1])),
    );
    const expected = new Set(LAYOUT.map((_, index) => index));
    assert.deepEqual(
      [...readIndices].sort((a, b) => a - b),
      [...expected].sort((a, b) => a - b),
      "submitAgeClaim reads a set of signal indices that is not exactly 0..8",
    );
  });
});

describe("NationalityClaim public-signal layout agreement", () => {
  const NATIONALITY_LAYOUT = [...NATIONALITY_PUBLIC_SIGNALS];

  it("is the same nine-signal layout as age, with only the generic slot renamed", () => {
    // The invariant that lets AletheiaVerifier route both claims through one nine-signal
    // decode: every index is identical except slot 6, which age calls `minimumAge` and
    // nationality calls `requiredNationality`.
    assert.equal(NATIONALITY_LAYOUT.length, LAYOUT.length);
    NATIONALITY_LAYOUT.forEach((name, index) => {
      if (index === 6) {
        assert.equal(name, "requiredNationality");
        assert.equal(LAYOUT[index], "minimumAge");
      } else {
        assert.equal(name, LAYOUT[index], `slot ${index} must match the age layout`);
      }
    });
  });

  it("docs/public-signals.md lists exactly the NATIONALITY_PUBLIC_SIGNALS order", () => {
    assert.deepEqual(layoutFromDoc(publicSignalsDoc, "## NationalityClaim"), NATIONALITY_LAYOUT);
  });

  it("the generated verifier takes one uint per signal", () => {
    assert.equal(
      calldataArity(groth16NationalitySource, /uint\[(\d+)\] calldata _pubSignals/),
      NATIONALITY_LAYOUT.length,
    );
  });

  it("submitNationalityClaim takes one uint256 per signal", () => {
    // Isolate the submitNationalityClaim signature so this asserts its arity, not age's.
    const start = aletheiaSource.indexOf("function submitNationalityClaim");
    assert.notEqual(start, -1, "AletheiaVerifier has no submitNationalityClaim");
    const signature = aletheiaSource.slice(start, aletheiaSource.indexOf(")", start) + 1);
    assert.equal(
      calldataArity(signature, /uint256\[(\d+)\] calldata publicSignals/),
      NATIONALITY_LAYOUT.length,
    );
  });
});

describe("ExpiryClaim public-signal layout agreement", () => {
  const EXPIRY_LAYOUT = [...EXPIRY_PUBLIC_SIGNALS];

  it("is the same nine-signal layout as age, with only the generic slot renamed", () => {
    // Every index is identical to age except slot 6, which age calls `minimumAge` and expiry
    // calls `expiryParameter` (pinned to zero in-circuit). This is the invariant that lets
    // AletheiaVerifier route all three claims through one nine-signal decode.
    assert.equal(EXPIRY_LAYOUT.length, LAYOUT.length);
    EXPIRY_LAYOUT.forEach((name, index) => {
      if (index === 6) {
        assert.equal(name, "expiryParameter");
        assert.equal(LAYOUT[index], "minimumAge");
      } else {
        assert.equal(name, LAYOUT[index], `slot ${index} must match the age layout`);
      }
    });
  });

  it("docs/public-signals.md lists exactly the EXPIRY_PUBLIC_SIGNALS order", () => {
    assert.deepEqual(layoutFromDoc(publicSignalsDoc, "## ExpiryClaim"), EXPIRY_LAYOUT);
  });

  it("the generated verifier takes one uint per signal", () => {
    assert.equal(
      calldataArity(groth16ExpirySource, /uint\[(\d+)\] calldata _pubSignals/),
      EXPIRY_LAYOUT.length,
    );
  });

  it("submitExpiryClaim takes one uint256 per signal", () => {
    // Isolate the submitExpiryClaim signature so this asserts its arity, not age's.
    const start = aletheiaSource.indexOf("function submitExpiryClaim");
    assert.notEqual(start, -1, "AletheiaVerifier has no submitExpiryClaim");
    const signature = aletheiaSource.slice(start, aletheiaSource.indexOf(")", start) + 1);
    assert.equal(
      calldataArity(signature, /uint256\[(\d+)\] calldata publicSignals/),
      EXPIRY_LAYOUT.length,
    );
  });
});
