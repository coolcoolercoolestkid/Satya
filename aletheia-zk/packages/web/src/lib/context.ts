/**
 * The verifier's scope tag (`contextId`).
 *
 * A verifier picks a label; the circuit takes a field element. The 32-byte keccak digest
 * of the label is reduced into the field by keeping its leading 31 bytes — the one
 * sanctioned reduction (`hashToField`, matching `docs/credential-schema.md`). Every claim
 * proved under the same label carries the same `contextId`, which is what scopes the
 * per-context `identityNullifier`.
 */

import { hashToField } from "@aletheia/credential";
import { keccak256, stringToBytes } from "viem";

/** The demo verifier label; a real verifier chooses its own. */
export const DEFAULT_CONTEXT_LABEL = "aletheia:web:holder-demo";

export function contextIdFromLabel(label: string): bigint {
  return hashToField(keccak256(stringToBytes(label)));
}
