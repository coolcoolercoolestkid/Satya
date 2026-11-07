// Matchstick event builders.
//
// Each builder mirrors one event's ABI parameter order exactly (see the manifest and the
// generated event classes). No contract calls are mocked because no handler makes one —
// the subgraph reads events only.
import { newMockEvent } from "matchstick-as";
import {
  Address,
  BigInt,
  Bytes,
  ethereum,
} from "@graphprotocol/graph-ts";
import { ClaimVerified } from "../generated/AletheiaVerifier/AletheiaVerifier";
import {
  IssuerRegistered,
  IssuerActiveSet,
} from "../generated/AletheiaIssuerRegistry/AletheiaIssuerRegistry";
import { ProfileRegistered } from "../generated/AletheiaProfile/AletheiaProfile";

export function b32(hex: string): Bytes {
  // Left-pad a short hex to a full 32-byte word so bytes32 ids are well-formed.
  let clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  let padded = clean.padStart(64, "0");
  return Bytes.fromHexString("0x" + padded);
}

export function createClaimVerifiedEvent(
  verificationId: Bytes,
  subject: Address,
  claimType: i32,
  issuerId: Bytes,
  claimParameter: BigInt,
  credentialValidOn: BigInt,
  contextId: Bytes,
  nullifier: Bytes,
  identityNullifier: Bytes,
  verifiedAt: BigInt,
  blockNumber: BigInt,
  transactionHash: Bytes,
): ClaimVerified {
  let event = changetype<ClaimVerified>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam("verificationId", ethereum.Value.fromFixedBytes(verificationId)),
  );
  event.parameters.push(
    new ethereum.EventParam("subject", ethereum.Value.fromAddress(subject)),
  );
  event.parameters.push(
    new ethereum.EventParam("claimType", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(claimType))),
  );
  event.parameters.push(
    new ethereum.EventParam("issuerId", ethereum.Value.fromFixedBytes(issuerId)),
  );
  event.parameters.push(
    new ethereum.EventParam("claimParameter", ethereum.Value.fromUnsignedBigInt(claimParameter)),
  );
  event.parameters.push(
    new ethereum.EventParam("credentialValidOn", ethereum.Value.fromUnsignedBigInt(credentialValidOn)),
  );
  event.parameters.push(
    new ethereum.EventParam("contextId", ethereum.Value.fromFixedBytes(contextId)),
  );
  event.parameters.push(
    new ethereum.EventParam("nullifier", ethereum.Value.fromFixedBytes(nullifier)),
  );
  event.parameters.push(
    new ethereum.EventParam("identityNullifier", ethereum.Value.fromFixedBytes(identityNullifier)),
  );
  event.parameters.push(
    new ethereum.EventParam("verifiedAt", ethereum.Value.fromUnsignedBigInt(verifiedAt)),
  );
  event.block.number = blockNumber;
  event.transaction.hash = transactionHash;
  return event;
}

export function createIssuerRegisteredEvent(
  issuerId: Bytes,
  ax: BigInt,
  ay: BigInt,
  label: string,
  registeredAt: BigInt,
): IssuerRegistered {
  let event = changetype<IssuerRegistered>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam("issuerId", ethereum.Value.fromFixedBytes(issuerId)),
  );
  event.parameters.push(
    new ethereum.EventParam("ax", ethereum.Value.fromUnsignedBigInt(ax)),
  );
  event.parameters.push(
    new ethereum.EventParam("ay", ethereum.Value.fromUnsignedBigInt(ay)),
  );
  event.parameters.push(
    new ethereum.EventParam("label", ethereum.Value.fromString(label)),
  );
  event.parameters.push(
    new ethereum.EventParam("registeredAt", ethereum.Value.fromUnsignedBigInt(registeredAt)),
  );
  return event;
}

export function createIssuerActiveSetEvent(
  issuerId: Bytes,
  active: boolean,
): IssuerActiveSet {
  let event = changetype<IssuerActiveSet>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam("issuerId", ethereum.Value.fromFixedBytes(issuerId)),
  );
  event.parameters.push(
    new ethereum.EventParam("active", ethereum.Value.fromBoolean(active)),
  );
  return event;
}

export function createProfileRegisteredEvent(
  account: Address,
  registeredAt: BigInt,
): ProfileRegistered {
  let event = changetype<ProfileRegistered>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam("account", ethereum.Value.fromAddress(account)),
  );
  event.parameters.push(
    new ethereum.EventParam("registeredAt", ethereum.Value.fromUnsignedBigInt(registeredAt)),
  );
  return event;
}
