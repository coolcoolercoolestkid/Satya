/**
 * The five verification states.
 *
 * A read returns a record (or null) and the indexer's `_meta`. Neither on its own answers
 * the question a verifier actually asks — "should I act on this?" — and the gap between
 * them is exactly where wrong answers live: a record that was true when made but whose
 * issuer has since been revoked, a record that is simply too old for this verifier's
 * policy, a transaction that is mined but not yet indexed, an id that no record matches,
 * or an indexer that has fallen over and cannot be trusted to have either.
 *
 * `deriveVerificationState` collapses that gap into one of five named states, each with
 * its own reason. It is **pure**: record, meta, policy and an injected `now` in, a state
 * out — no network, no clock, no environment. That is what makes it the honest, testable
 * seam of the read path, the same way the decoders are (`.cursor/rules/ethereum.mdc`
 * confines test doubles to unit tests of pure functions). The states it names are only
 * ever produced from real endpoint data — see `scripts/states.ts`, which reproduces all
 * five against the deployed subgraph, and `docs/architecture.md`:
 *
 *   wallet address -> GraphQL query + _meta -> verified | stale | revoked | pending | not found
 *
 * ## Precedence
 *
 * The states are mutually exclusive, so their order is load-bearing and fixed here:
 *
 *   1. **pending / indexer-errored.** `hasIndexingErrors` first, ahead of everything. A
 *      subgraph that has errored cannot be trusted to be complete *or* current: an
 *      absence may be an un-indexed record, and a record's `issuer.active` flag may be a
 *      revocation it has not yet processed. No answer read from it can be trusted, so the
 *      whole read is pending until it recovers.
 *   2. **pending / awaiting-index.** The record is absent *and* a specific block was
 *      expected (the block a just-submitted transaction was mined in) that the indexer
 *      has not reached. "Mined but not indexed yet" is a pending state a caller can name,
 *      never a "not found" — a submitted transaction is never rendered as verified, and
 *      the mirror of that rule is that its record is never rendered as absent either.
 *   3. **not-found.** Absent, with no newer block expected. The ordinary answer for most
 *      ids, never an error.
 *   4. **revoked.** The record is present but its issuer's key has been revoked on-chain
 *      (`Issuer.active == false`). The record was true when it was made and stays
 *      immutable; what a verifier does about a claim signed by a now-revoked key is a
 *      policy decision, and this state is what lets them make it. Revoked ranks above
 *      stale because a revoked *key* is a stronger signal than an old *record*: the thing
 *      the proof relied on is no longer trusted at all.
 *   5. **stale.** The record is present, its issuer active, but the verification is older
 *      than the verifier's freshness window. Freshness is a verifier-side policy, not a
 *      property of the record (`docs/security.md`), so two verifiers can read the same
 *      record as `stale` and `verified` respectively, and both are right.
 *   6. **verified.** Present, issuer active, within the freshness window.
 *
 * ## Why freshness is measured on `verifiedAt`, not `credentialValidOn`
 *
 * The threat model names `credentialValidOn` as the staleness signal, and it is the right
 * one in principle — it is the date the credential was proven unexpired on. But it is a
 * `YYYYMMDD` integer with day granularity, and the contract derives it from
 * `block.timestamp`, so every record made today carries today's date. A freshness policy
 * expressed in days cannot distinguish a verification made an hour ago from one made this
 * morning, and cannot render either `stale` until a calendar day has passed.
 *
 * `verifiedAt` is the same event's `block.timestamp` in whole seconds — when the
 * verification was actually recorded — so a policy expressed against it ("no older than N
 * seconds") is both finer and a more faithful reading of "stale verification record":
 * how long ago was this verification made, not merely on what date. `credentialValidOn`
 * remains on the record for a verifier that wants the coarser, credential-oriented check;
 * the default policy here is the verification-age one because it is the one that can be
 * both applied and demonstrated honestly.
 */

import type { IndexingMeta, Verification, VerificationIssuer } from "./types.ts";

/**
 * A verifier's freshness policy.
 *
 * There is no default anywhere in this module: a freshness window is a verifier's own
 * judgement, and a hidden default is exactly the kind of silent policy that renders an
 * old record `verified` because nobody chose otherwise. The caller states it.
 */
export interface FreshnessPolicy {
  /**
   * A verification whose `verifiedAt` is more than this many seconds before `now` is
   * `stale`. Must be a non-negative finite number. Zero means "must have been recorded at
   * or after now" — every past record is stale — which is a legitimate, if strict, policy.
   */
  maxVerificationAgeSeconds: number;
}

/** The five states' discriminants. */
export type VerificationStatus = "verified" | "stale" | "revoked" | "pending" | "not-found";

/** Why a read is `pending`: the indexer errored, or it has not reached the expected block. */
export type PendingCause = "indexer-errored" | "awaiting-index";

interface StateBase {
  readonly status: VerificationStatus;
  /** A human-readable, single-sentence explanation, distinct per state. */
  readonly reason: string;
}

/** Present, issuer active, within the freshness window. Safe to act on. */
export interface VerifiedState extends StateBase {
  readonly status: "verified";
  readonly verification: Verification;
  /** How many seconds ago the verification was recorded, at the `now` that was passed. */
  readonly ageSeconds: number;
}

/** Present and issuer-active, but older than the verifier's freshness window. */
export interface StaleState extends StateBase {
  readonly status: "stale";
  readonly verification: Verification;
  readonly ageSeconds: number;
  /** The window it exceeded, echoed back so a caller can render "12h old, limit 1h". */
  readonly maxVerificationAgeSeconds: number;
}

/** Present, but the issuer's key was revoked on-chain after the record was made. */
export interface RevokedState extends StateBase {
  readonly status: "revoked";
  readonly verification: Verification;
  /** The issuer as carried on the record, with `active: false`. */
  readonly issuer: VerificationIssuer;
}

/** The indexer cannot answer yet: it errored, or it has not reached the expected block. */
export interface PendingState extends StateBase {
  readonly status: "pending";
  readonly cause: PendingCause;
  readonly meta: IndexingMeta;
  /** The block being waited on, present only for `awaiting-index`. */
  readonly expectedBlock?: bigint;
}

/** No record matches, and none is expected at a block beyond the indexer's head. */
export interface NotFoundState extends StateBase {
  readonly status: "not-found";
}

/** Exactly one of the five. Discriminate on `status`. */
export type VerificationState =
  | VerifiedState
  | StaleState
  | RevokedState
  | PendingState
  | NotFoundState;

/** The inputs to a single classification. */
export interface DeriveStateInput {
  /** The record the endpoint returned for the lookup, or `null` if none is indexed. */
  readonly verification: Verification | null;
  /** The indexer's own state, from the *same* read that produced `verification`. */
  readonly meta: IndexingMeta;
  /** The verifier's freshness policy. */
  readonly policy: FreshnessPolicy;
  /** "Now" in Unix seconds. Injected so this function stays pure and testable. */
  readonly nowSeconds: number;
  /**
   * The block a just-submitted transaction was mined in, when the caller is waiting on a
   * specific record to appear. Turns an absent record into `pending` rather than
   * `not-found` while the indexer catches up. Omit when not waiting on anything.
   */
  readonly expectedBlock?: bigint;
}

function assertPolicy(policy: FreshnessPolicy): void {
  const max = policy.maxVerificationAgeSeconds;
  if (typeof max !== "number" || !Number.isFinite(max) || max < 0) {
    throw new RangeError(
      `maxVerificationAgeSeconds must be a non-negative finite number, received ${String(max)}`,
    );
  }
}

function assertNow(nowSeconds: number): void {
  if (typeof nowSeconds !== "number" || !Number.isFinite(nowSeconds)) {
    throw new RangeError(`nowSeconds must be a finite number, received ${String(nowSeconds)}`);
  }
}

/**
 * Classify one lookup into exactly one of the five states.
 *
 * Pure. The only way it can throw is an invalid policy or `now` — a programming error in
 * the caller, never a property of the data — which is surfaced rather than folded into a
 * misleading state.
 */
export function deriveVerificationState(input: DeriveStateInput): VerificationState {
  const { verification, meta, policy, nowSeconds, expectedBlock } = input;
  assertPolicy(policy);
  assertNow(nowSeconds);

  // 1. An errored indexer can be trusted for nothing: not the absence of a record, not
  //    the `active` flag on one it did return. Everything else below reads its output as
  //    authoritative, so this guard has to come first.
  if (meta.hasIndexingErrors) {
    return {
      status: "pending",
      cause: "indexer-errored",
      meta,
      reason:
        "the subgraph reports indexing errors; its records cannot be trusted as complete " +
        "or current, so no verification state can be read from it yet",
    };
  }

  if (verification === null) {
    // 2. Absent, but a transaction is known to be mined past the indexer's head: the
    //    record is on its way, not missing.
    if (expectedBlock !== undefined && meta.blockNumber < expectedBlock) {
      return {
        status: "pending",
        cause: "awaiting-index",
        meta,
        expectedBlock,
        reason:
          `the transaction was mined in block ${expectedBlock} but the subgraph has only ` +
          `indexed up to block ${meta.blockNumber}; its record is not queryable yet`,
      };
    }
    // 3. Absent, and nothing newer is expected. The ordinary answer.
    return {
      status: "not-found",
      reason: "no verification is indexed for this lookup",
    };
  }

  // 4. Present, but the issuer's key has been revoked on-chain since. The record stays
  //    true and immutable; the trust in the key that signed it does not.
  if (!verification.issuer.active) {
    return {
      status: "revoked",
      verification,
      issuer: verification.issuer,
      reason:
        `issuer ${verification.issuer.id} (label ${JSON.stringify(verification.issuer.label)}) ` +
        "was revoked on-chain after this record was proven; the record was true when made — " +
        "see docs/trust-model.md",
    };
  }

  // 5 / 6. Present and issuer-active: freshness decides. A verifiedAt in the future
  //        relative to `now` (clock skew) is clamped to age 0, never negative, so skew
  //        can only ever read as fresher, never as stale.
  const ageSeconds = Math.max(0, nowSeconds - Number(verification.verifiedAt));
  if (ageSeconds > policy.maxVerificationAgeSeconds) {
    return {
      status: "stale",
      verification,
      ageSeconds,
      maxVerificationAgeSeconds: policy.maxVerificationAgeSeconds,
      reason:
        `the verification was recorded ${ageSeconds}s ago, older than this verifier's ` +
        `freshness window of ${policy.maxVerificationAgeSeconds}s`,
    };
  }

  return {
    status: "verified",
    verification,
    ageSeconds,
    reason:
      `the verification is indexed, its issuer active, and it was recorded ${ageSeconds}s ago, ` +
      `within this verifier's freshness window of ${policy.maxVerificationAgeSeconds}s`,
  };
}
