// AletheiaVerifier mappings.
//
// ClaimVerified is the substance of the whole system: the one event that records a claim
// became true on-chain. Every field of the Verification traces to a public signal or an
// event parameter — no `eth_call`, no private field (.cursor/rules/ethereum.mdc). The
// record is immutable: it was true when it was made and is never rewritten.
import { Verification } from "../generated/schema";
import { ClaimVerified } from "../generated/AletheiaVerifier/AletheiaVerifier";
import { loadOrCreateProfile } from "./profile";

export function handleClaimVerified(event: ClaimVerified): void {
  // The subject is msg.sender; it may never have called AletheiaProfile.register(), so a
  // bare Profile shell is created for it if needed. The Issuer is referenced by id only:
  // its entity was created by IssuerRegistered (a registration always precedes any proof
  // against that key), and storing the reference does not require loading it.
  let subject = loadOrCreateProfile(event.params.subject);

  let verification = new Verification(event.params.verificationId);
  verification.subject = subject.id;
  verification.issuer = event.params.issuerId;
  verification.claimType = event.params.claimType;
  verification.claimParameter = event.params.claimParameter;
  verification.credentialValidOn = event.params.credentialValidOn.toI32();
  verification.contextId = event.params.contextId;
  verification.nullifier = event.params.nullifier;
  verification.identityNullifier = event.params.identityNullifier;
  // verifiedAt is the block.timestamp the contract itself emitted, not the indexer's view.
  verification.verifiedAt = event.params.verifiedAt;
  verification.blockNumber = event.block.number;
  verification.transactionHash = event.transaction.hash;
  verification.save();
}
