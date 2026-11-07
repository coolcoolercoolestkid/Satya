/**
 * The typed shape of everything the subgraph can return.
 *
 * These mirror `packages/subgraph/schema.graphql` field for field. They are written by
 * hand rather than generated because the schema is small, frozen alongside the event
 * signature, and generating it would put a codegen step between a contract change and
 * the compiler noticing — the opposite of what the public-signal layout tests exist to
 * do. If the schema grows past this size, generate them.
 *
 * The GraphQL wire format has no integers wider than 32 bits: `BigInt` scalars arrive as
 * decimal strings and `Int` scalars as JavaScript numbers. That distinction is preserved
 * here rather than flattened to `string`, so a caller comparing `blockNumber` against a
 * chain head is comparing two bigints and not two strings that sort lexicographically.
 */

/** A 0x-prefixed hex string. Ids, hashes and addresses all arrive in this form. */
export type Hex = `0x${string}`;

/**
 * The indexer's own view of itself, returned alongside every read.
 *
 * `blockNumber` is the last block the subgraph has finished indexing, which is what
 * makes "the transaction is mined but not indexed yet" a state a caller can name rather
 * than guess at. `hasIndexingErrors` is the subgraph admitting its own records may be
 * incomplete; a read that ignores it can report "not found" for something that is really
 * "the indexer fell over".
 *
 * Deriving the five verification states from this is stage 14, deliberately not here.
 */
export interface IndexingMeta {
  /** Last block fully indexed by the subgraph. */
  blockNumber: bigint;
  /** True if the subgraph hit an indexing error; its records cannot be trusted as complete. */
  hasIndexingErrors: boolean;
}

/**
 * A recognised issuer key.
 *
 * `label` is the on-chain string the registrant chose. In Phase 1 it is `mock-dev` and it
 * is load-bearing: every surface that renders a record derived from this issuer must say
 * so (AGENTS.md, docs/trust-model.md). It is not a trust signal — it is a label — but it
 * is the one the UI keys off.
 *
 * `active` false means the issuer was revoked *after* some records were already proven.
 * Those records stay true; what changes is how a verifier should read them. Again: that
 * judgement is stage 14.
 */
export interface Issuer {
  /** `keccak256(abi.encode(ax, ay))` — the registry's deterministic issuer id. */
  id: Hex;
  /** EdDSA BabyJubjub public key x. */
  ax: bigint;
  /** EdDSA BabyJubjub public key y. */
  ay: bigint;
  /** Free-text on-chain label. `mock-dev` for the only Phase 1 issuer. */
  label: string;
  /** False once revoked via `setActive(id, false)`. */
  active: boolean;
  /** Unix seconds the issuer was first registered. */
  registeredAt: bigint;
}

/**
 * The issuer fields carried inline on a verification.
 *
 * A verification is read to answer a question about a claim, and answering it needs the
 * issuer's label and revocation state but not its public key. Fetching them in the same
 * round trip is what lets stage 14 decide `revoked` without a second query — and without
 * an `eth_call`, which the subgraph does not do at all.
 */
export interface VerificationIssuer {
  id: Hex;
  label: string;
  active: boolean;
}

/** An address that has opted in to Aletheia and/or has verifications against it. */
export interface Profile {
  /** The wallet address, lower-cased. */
  id: Hex;
  /**
   * Unix seconds of `AletheiaProfile.register()`, or null if this address only ever
   * appeared as a verification subject and never registered. Null is a normal case, not
   * a missing value: registering is optional.
   */
  registeredAt: bigint | null;
}

/**
 * A single proven claim.
 *
 * Immutable in the subgraph and immutable here: it was true when it was made. Nothing in
 * this type is a private credential field — every value traces to a public signal or an
 * event parameter, which is why the subgraph physically cannot leak a date of birth.
 */
export interface Verification {
  /** `keccak256(claimType, contextId, nullifier)`, unique per record. */
  id: Hex;
  /** The wallet that proved it, which is always the transaction sender. */
  subject: Profile;
  /** The issuer whose signature the proof used. */
  issuer: VerificationIssuer;
  /** 1 age. 2 nationality and 3 expiry follow in later stages. */
  claimType: number;
  /** The question's parameter, e.g. the age threshold. Chosen by the verifier. */
  claimParameter: bigint;
  /** The date the credential was proven unexpired on, YYYYMMDD. */
  credentialValidOn: number;
  /** The verifier scope the proof was bound to. */
  contextId: Hex;
  /** Per credential, claim type and context; makes replay detectable on-chain. */
  nullifier: Hex;
  /**
   * `Poseidon(identitySecret, contextId)`: stable across every credential and wallet one
   * identity proves with in this context, and unrelated across contexts. A per-context
   * correlation handle by design — see docs/trust-model.md.
   */
  identityNullifier: Hex;
  /** Unix seconds the claim was verified, as the contract emitted it. */
  verifiedAt: bigint;
  /** Block the `ClaimVerified` event was emitted in. */
  blockNumber: bigint;
  /** The submitting transaction, so every record links back to its on-chain proof. */
  transactionHash: Hex;
}

/**
 * A profile together with the verifications derived from it.
 *
 * The list comes from `Profile.verifications`, the `@derivedFrom` side of the relation,
 * rather than from a filter on `Verification.subject`. Same records either way; the
 * derived field is the one the schema was designed around, and it needs no filter
 * argument whose type could drift.
 */
export interface ProfileRecord extends Profile {
  /** Newest first, by the timestamp the contract emitted. */
  verifications: Verification[];
}

/**
 * Every read returns the records *and* the indexer's state, together, from one round
 * trip.
 *
 * This is the whole point of the package. A caller cannot accidentally read records
 * without knowing how far behind the indexer is, because there is no method that returns
 * records on their own. `.cursor/rules/ethereum.mdc`: "Queries read `_meta.block.number`
 * and `hasIndexingErrors` so indexing lag becomes an explicit `pending` state instead of
 * a silent wrong answer."
 */
export interface QueryResult<T> {
  /** The indexer's own state at the moment this data was read. */
  meta: IndexingMeta;
  /** The records requested. */
  data: T;
}
