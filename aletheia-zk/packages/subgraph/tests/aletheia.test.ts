// Matchstick coverage for the Aletheia mappings.
//
// Exit criteria (TODO.md Day 11): a first verification, a second in a different context,
// and an issuer revocation. Plus the load-bearing property that the `mock-dev` label
// reaches the Issuer entity, since every UI record depends on it to mark itself mocked.
//
// Note on the toolchain: matchstick 0.6.0 (the newest release) compiles with
// assemblyscript 0.19.23, whose compiler crashes on a `== null` comparison used in an
// *expression* position (e.g. `x == null ? a : b`). `if (x == null)` statements are fine.
// The one null check below therefore reads the raw stored Value with `.get()` rather than
// comparing a nullable field to null in a ternary.
import {
  assert,
  describe,
  test,
  beforeEach,
  clearStore,
} from "matchstick-as/assembly/index";
import { Address, BigInt } from "@graphprotocol/graph-ts";
import { Profile } from "../generated/schema";
import { handleClaimVerified } from "../src/verifier";
import {
  handleIssuerRegistered,
  handleIssuerActiveSet,
} from "../src/registry";
import { handleProfileRegistered } from "../src/profile";
import {
  b32,
  createClaimVerifiedEvent,
  createIssuerRegisteredEvent,
  createIssuerActiveSetEvent,
  createProfileRegisteredEvent,
} from "./utils";

// Shared fixture handles.
const SUBJECT = Address.fromString(
  "0x1111111111111111111111111111111111111111",
);
const ISSUER_ID = b32(
  "0xfee4bdf6ec605973cbc4ae331ef4c92cfc89ce43fb42da6d4d6517a164be2588",
);
const AX = BigInt.fromString(
  "1234567890123456789012345678901234567890123456789012345678901234",
);
const AY = BigInt.fromString(
  "9876543210987654321098765432109876543210987654321098765432109876",
);

function registerMockIssuer(): void {
  handleIssuerRegistered(
    createIssuerRegisteredEvent(
      ISSUER_ID,
      AX,
      AY,
      "mock-dev",
      BigInt.fromI32(1757000000),
    ),
  );
}

// verificationId, contextId, nullifier and identityNullifier differ per record.
function submitAgeClaim(
  verificationId: string,
  contextId: string,
  nullifier: string,
  identityNullifier: string,
): void {
  handleClaimVerified(
    createClaimVerifiedEvent(
      b32(verificationId),
      SUBJECT,
      1, // claimType age
      ISSUER_ID,
      BigInt.fromI32(18), // claimParameter (minimum age)
      BigInt.fromI32(20260910), // credentialValidOn
      b32(contextId),
      b32(nullifier),
      b32(identityNullifier),
      BigInt.fromI32(1757500000), // verifiedAt
      BigInt.fromI32(11674993), // blockNumber
      b32("0xdeadbeef"), // transactionHash
    ),
  );
}

describe("Issuer registry", () => {
  beforeEach(() => {
    clearStore();
  });

  test("IssuerRegistered creates a mock-dev issuer, active", () => {
    registerMockIssuer();

    let id = ISSUER_ID.toHexString();
    assert.entityCount("Issuer", 1);
    assert.fieldEquals("Issuer", id, "label", "mock-dev");
    assert.fieldEquals("Issuer", id, "active", "true");
    assert.fieldEquals("Issuer", id, "ax", AX.toString());
    assert.fieldEquals("Issuer", id, "ay", AY.toString());
    assert.fieldEquals("Issuer", id, "registeredAt", "1757000000");
  });

  test("IssuerActiveSet(false) revokes without touching prior records", () => {
    registerMockIssuer();
    submitAgeClaim("0xa1", "0xc1", "0xf1", "0xe1");

    let id = ISSUER_ID.toHexString();
    assert.fieldEquals("Issuer", id, "active", "true");

    handleIssuerActiveSet(createIssuerActiveSetEvent(ISSUER_ID, false));

    // The issuer flips inactive, but the verification proven while it was active is an
    // immutable record and stays exactly as it was.
    assert.fieldEquals("Issuer", id, "active", "false");
    assert.entityCount("Verification", 1);
    assert.fieldEquals(
      "Verification",
      b32("0xa1").toHexString(),
      "issuer",
      id,
    );
  });

  test("IssuerActiveSet for an unknown issuer creates nothing", () => {
    handleIssuerActiveSet(createIssuerActiveSetEvent(ISSUER_ID, false));
    assert.entityCount("Issuer", 0);
  });
});

describe("ClaimVerified", () => {
  beforeEach(() => {
    clearStore();
    registerMockIssuer();
  });

  test("a first verification creates the record and a subject Profile", () => {
    submitAgeClaim("0xa1", "0xc1", "0xf1", "0xe1");

    let id = b32("0xa1").toHexString();
    assert.entityCount("Verification", 1);
    assert.entityCount("Profile", 1);

    assert.fieldEquals("Verification", id, "subject", SUBJECT.toHexString());
    assert.fieldEquals("Verification", id, "issuer", ISSUER_ID.toHexString());
    assert.fieldEquals("Verification", id, "claimType", "1");
    assert.fieldEquals("Verification", id, "claimParameter", "18");
    assert.fieldEquals("Verification", id, "credentialValidOn", "20260910");
    assert.fieldEquals("Verification", id, "contextId", b32("0xc1").toHexString());
    assert.fieldEquals("Verification", id, "nullifier", b32("0xf1").toHexString());
    assert.fieldEquals(
      "Verification",
      id,
      "identityNullifier",
      b32("0xe1").toHexString(),
    );
    assert.fieldEquals("Verification", id, "verifiedAt", "1757500000");
    assert.fieldEquals("Verification", id, "blockNumber", "11674993");
    assert.fieldEquals(
      "Verification",
      id,
      "transactionHash",
      b32("0xdeadbeef").toHexString(),
    );

    // The subject appeared only as a verification subject; it never called register(), so
    // its Profile is a bare shell with no registeredAt. Read the raw stored Value to prove
    // absence without a `== null` expression (which crashes asc 0.19.23).
    let profile = Profile.load(SUBJECT);
    assert.assertNotNull(profile);
    assert.assertNull((profile as Profile).get("registeredAt"));
  });

  test("a second verification in a different context is a distinct record", () => {
    submitAgeClaim("0xa1", "0xc1", "0xf1", "0xe1");
    submitAgeClaim("0xa2", "0xc2", "0xf2", "0xe2");

    // Two immutable records, one shared subject Profile.
    assert.entityCount("Verification", 2);
    assert.entityCount("Profile", 1);

    assert.fieldEquals(
      "Verification",
      b32("0xa1").toHexString(),
      "contextId",
      b32("0xc1").toHexString(),
    );
    assert.fieldEquals(
      "Verification",
      b32("0xa2").toHexString(),
      "contextId",
      b32("0xc2").toHexString(),
    );
    // Same subject, same issuer across both.
    assert.fieldEquals(
      "Verification",
      b32("0xa2").toHexString(),
      "subject",
      SUBJECT.toHexString(),
    );
    assert.fieldEquals(
      "Verification",
      b32("0xa2").toHexString(),
      "issuer",
      ISSUER_ID.toHexString(),
    );
  });

  test("ProfileRegistered fills registeredAt on an existing subject shell", () => {
    submitAgeClaim("0xa1", "0xc1", "0xf1", "0xe1");
    // The subject shell exists with no registeredAt; now the address registers.
    handleProfileRegistered(
      createProfileRegisteredEvent(SUBJECT, BigInt.fromI32(1757400000)),
    );

    assert.entityCount("Profile", 1);
    assert.fieldEquals(
      "Profile",
      SUBJECT.toHexString(),
      "registeredAt",
      "1757400000",
    );
  });
});
