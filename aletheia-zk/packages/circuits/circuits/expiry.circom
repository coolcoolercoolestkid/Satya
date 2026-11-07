pragma circom 2.0.0;

include "comparators.circom";
include "bitify.circom";
include "lib/credential.circom";

/*
 * ExpiryClaim — "the holder of an issuer-signed credential that is not expired as of
 * currentDate", proven without revealing the expiry date itself.
 *
 * This is the thinnest claim of the three: the check it needs is already the one every
 * claim inherits from CredentialClaimBase — `expiryDate >= currentDate` — so ExpiryClaim
 * adds no statement of its own beyond claiming that base for claim type 3. The verifier
 * learns only that the credential was valid on the date asked about; the actual expiry
 * date, the date of birth, the nationality and the credential id all stay in the witness.
 *
 * The generic claim-parameter slot every Aletheia claim shares (age's minimumAge,
 * nationality's requiredNationality) has no meaning here, so it is pinned to zero. Pinning
 * it in-circuit — rather than dropping the signal — keeps the nine-signal public layout
 * identical across all three claim types, so AletheiaVerifier decodes every one the same
 * way and a proof cannot smuggle a non-zero parameter into the record.
 */
template ExpiryClaim(expectedSchemaVersion) {
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
    //     outputs. Frozen in docs/public-signals.md. expiryParameter sits in the exact slot
    //     age's minimumAge and nationality's requiredNationality occupy (index 6), pinned
    //     to zero below. ---
    signal input schemaVersion;
    signal input issuerAx;
    signal input issuerAy;
    signal input currentDate;
    signal input expiryParameter;
    signal input contextId;
    signal input subject;

    signal output nullifier;
    signal output identityNullifier;

    // Version pin, signature, expiry (expiryDate >= currentDate), range checks and both
    // nullifiers: claim type 3 is expiry. The unexpired check inside the base IS this
    // claim, so nothing more is asserted about the dates here.
    component base = CredentialClaimBase(expectedSchemaVersion, 3);
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

    // The generic parameter slot is unused by an expiry claim, so it is pinned to zero.
    // A proof declaring anything else is unsatisfiable, which keeps every ExpiryClaim's
    // parameter identical and the layout aligned with age and nationality.
    expiryParameter === 0;
}

component main {
    public [schemaVersion, issuerAx, issuerAy, currentDate, expiryParameter, contextId, subject]
} = ExpiryClaim(2);
