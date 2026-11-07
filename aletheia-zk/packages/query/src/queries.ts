/**
 * The GraphQL documents, in one place.
 *
 * Two rules hold across all of them.
 *
 * First, **every document selects `_meta`.** Not most of them — every one. A caller who
 * can read records without reading how far behind the indexer is will eventually report
 * "not verified" for a transaction that was mined thirty seconds ago. Putting `_meta`
 * in the document rather than leaving it to the caller is what makes that impossible
 * rather than merely discouraged (`.cursor/rules/ethereum.mdc`).
 *
 * Second, **values are passed as GraphQL variables, never interpolated.** These
 * documents are constants; nothing here is assembled from a string a caller supplied.
 *
 * The selection sets mirror `packages/subgraph/schema.graphql`. Field names are checked
 * against the live endpoint by `scripts/check.ts`, because a rename in the schema is
 * otherwise only discovered by whoever next reads a record.
 */

/** `_meta`, selected by every document below. */
const META = `
  _meta {
    block {
      number
    }
    hasIndexingErrors
  }`;

/** Every field of a `Verification`, with its subject and issuer resolved inline. */
const VERIFICATION_FIELDS = `
    id
    subject {
      id
      registeredAt
    }
    issuer {
      id
      label
      active
    }
    claimType
    claimParameter
    credentialValidOn
    contextId
    nullifier
    identityNullifier
    verifiedAt
    blockNumber
    transactionHash`;

/** The indexer's state on its own, for a caller that only wants to know how current it is. */
export const META_QUERY = `query AletheiaMeta {${META}
}`;

/** One verification by its `verificationId`. Null when no such record is indexed. */
export const VERIFICATION_QUERY = `query AletheiaVerification($id: ID!) {${META}
  verification(id: $id) {${VERIFICATION_FIELDS}
  }
}`;

/**
 * Recent verifications across every subject, newest first.
 *
 * Ordered by `verifiedAt` — the timestamp the contract emitted — rather than by block,
 * so the ordering is the chain's own account of when each claim was proven.
 */
export const RECENT_VERIFICATIONS_QUERY = `query AletheiaRecentVerifications($first: Int!, $skip: Int!) {${META}
  verifications(first: $first, skip: $skip, orderBy: verifiedAt, orderDirection: desc) {${VERIFICATION_FIELDS}
  }
}`;

/**
 * One address, with its verifications.
 *
 * The list is `Profile.verifications`, the `@derivedFrom` side of the relation. A null
 * profile means the address has never registered *and* has never been a verification
 * subject — the ordinary case for most addresses, not an error.
 */
export const PROFILE_QUERY = `query AletheiaProfile($id: ID!, $first: Int!, $skip: Int!) {${META}
  profile(id: $id) {
    id
    registeredAt
    verifications(first: $first, skip: $skip, orderBy: verifiedAt, orderDirection: desc) {${VERIFICATION_FIELDS}
    }
  }
}`;

/** One issuer by its registry `issuerId`, including the on-chain label and revocation state. */
export const ISSUER_QUERY = `query AletheiaIssuer($id: ID!) {${META}
  issuer(id: $id) {
    id
    ax
    ay
    label
    active
    registeredAt
  }
}`;
