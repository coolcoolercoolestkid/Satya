pragma circom 2.0.0;

include "comparators.circom";
include "bitify.circom";
include "lib/credential.circom";

/*
 * NationalityClaim — "the holder of an issuer-signed, unexpired credential holds the
 * nationality requiredNationality", proven without revealing anything else in the
 * credential.
 *
 * Unlike the age claim, this one discloses the value it is asked about: a successful proof
 * tells the verifier the holder's nationality *is* requiredNationality (a public input the
 * verifier chose). It does not reveal the date of birth, the expiry, the document number,
 * or the credential id. The disclosure is inherent to an equality claim and is surfaced to
 * the holder before proving — see docs/trust-model.md and the Day 24 disclosure notice.
 *
 * The statement is a single equality, on nationality as an ISO 3166-1 numeric code:
 *
 *     nationality == requiredNationality
 *
 * Everything that makes the proof mean anything — the schema-version pin, the in-circuit
 * signature check, the expiry check, the range checks, and both nullifiers — comes from
 * CredentialClaimBase, the same base the age claim uses. requiredNationality occupies the
 * one generic claim-parameter slot every Aletheia claim circuit shares (age puts
 * minimumAge there), so all claim types keep one nine-signal public layout and
 * AletheiaVerifier can route to them through a single entrypoint shape.
 */
template NationalityClaim(expectedSchemaVersion) {
    // --- private ---
    signal input credentialId;
    signal input dateOfBirth;
    signal input nationality;
    signal input expiryDate;
    signal input issuedAt;
    signal input identitySecret;
    signal input sigR8x;
    signal input sigR8y;
    signal input sigS;

    // --- public: declaration order here fixes the public signal order on-chain, after the
    //     outputs. Frozen in docs/public-signals.md. requiredNationality sits in the exact
    //     slot age's minimumAge occupies (index 6 of the nine signals). ---
    signal input schemaVersion;
    signal input issuerAx;
    signal input issuerAy;
    signal input currentDate;
    signal input requiredNationality;
    signal input contextId;
    signal input subject;

    signal output nullifier;
    signal output identityNullifier;

    // Version pin, signature, expiry, range checks and both nullifiers: claim type 2
    // is nationality.
    component base = CredentialClaimBase(expectedSchemaVersion, 2);
    base.credentialId <== credentialId;
    base.dateOfBirth <== dateOfBirth;
    base.nationality <== nationality;
    base.expiryDate <== expiryDate;
    base.issuedAt <== issuedAt;
    base.identitySecret <== identitySecret;
    base.sigR8x <== sigR8x;
    base.sigR8y <== sigR8y;
    base.sigS <== sigS;
    base.schemaVersion <== schemaVersion;
    base.issuerAx <== issuerAx;
    base.issuerAy <== issuerAy;
    base.currentDate <== currentDate;
    base.contextId <== contextId;
    base.subject <== subject;

    nullifier <== base.nullifier;
    identityNullifier <== base.identityNullifier;

    // requiredNationality is public and the caller chooses it, so it is range-checked here
    // as the project rules require of every public input. The base already range-checks the
    // private nationality to 16 bits, and the equality below forces the two equal, so this
    // also bounds requiredNationality; the explicit check keeps the guarantee local and
    // survives any later change that makes this a comparison rather than an equality.
    component requiredNationalityBits = Num2Bits(16);
    requiredNationalityBits.in <== requiredNationality;
    _ <== requiredNationalityBits.out;

    // The claim itself: the credential's signed nationality is exactly the one asked about.
    // A mismatch is an unsatisfiable constraint, so a holder of a different nationality
    // cannot produce a proof — and because nationality is inside the signed message, they
    // cannot substitute a value either.
    requiredNationality === nationality;
}

component main {
    public [schemaVersion, issuerAx, issuerAy, currentDate, requiredNationality, contextId, subject]
} = NationalityClaim(2);
