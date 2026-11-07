pragma circom 2.0.0;

include "comparators.circom";
include "bitify.circom";
include "lib/credential.circom";

/*
 * AgeClaim — "the holder of an issuer-signed, unexpired credential is at least
 * minimumAge years old", proven without revealing the date of birth.
 *
 * The verifier learns that the threshold is met. It does not learn the date of birth,
 * the actual age, or anything else in the credential.
 *
 * Statement, with dates as YYYYMMDD:
 *
 *     dateOfBirth <= currentDate - minimumAge * 10000
 *
 * Subtracting whole years in this encoding touches only the year field, so the check is
 * exact on the birthday itself with no leap-year arithmetic. See docs/date-format.md.
 */
template AgeClaim(expectedSchemaVersion) {
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

    // --- public: declaration order here fixes the public signal order on-chain,
    //     after the outputs. Frozen in docs/public-signals.md.
    //
    //     minimumAge occupies the one generic claim-parameter slot that every Aletheia
    //     claim circuit has, so all claim types share a single 9-signal layout and
    //     AletheiaVerifier can route to them through one entrypoint. Nationality will
    //     put its country code in the same position, and expiry will pin it to zero. ---
    signal input schemaVersion;
    signal input issuerAx;
    signal input issuerAy;
    signal input currentDate;
    signal input minimumAge;
    signal input contextId;
    signal input subject;

    signal output nullifier;
    signal output identityNullifier;

    // Version pin, signature, expiry, range checks and both nullifiers: claim type 1
    // is age.
    component base = CredentialClaimBase(expectedSchemaVersion, 1);
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

    // minimumAge is public, and the caller chooses it, so it is range-checked here as
    // well as on-chain. Without this, a large minimumAge could make minimumAge * 10000
    // wrap the field and produce a satisfiable threshold.
    component minimumAgeBits = Num2Bits(8);
    minimumAgeBits.in <== minimumAge;
    _ <== minimumAgeBits.out;

    component minimumAgeInRange = LessEqThan(8);
    minimumAgeInRange.in[0] <== minimumAge;
    minimumAgeInRange.in[1] <== 120;
    minimumAgeInRange.out === 1;

    // The latest date of birth that still satisfies the claim.
    signal threshold;
    threshold <== currentDate - minimumAge * 10000;

    // Proves the subtraction did not underflow: a negative result would be a huge field
    // element, which cannot be decomposed into 32 bits.
    component thresholdBits = Num2Bits(32);
    thresholdBits.in <== threshold;
    _ <== thresholdBits.out;

    component thresholdAtLeastMin = GreaterEqThan(32);
    thresholdAtLeastMin.in[0] <== threshold;
    thresholdAtLeastMin.in[1] <== 19000101;
    thresholdAtLeastMin.out === 1;

    // The claim itself.
    component oldEnough = LessEqThan(32);
    oldEnough.in[0] <== dateOfBirth;
    oldEnough.in[1] <== threshold;
    oldEnough.out === 1;
}

component main {
    public [schemaVersion, issuerAx, issuerAy, currentDate, minimumAge, contextId, subject]
} = AgeClaim(2);
