// AletheiaIssuerRegistry mappings.
//
// The Issuer entity carries the on-chain `label` verbatim. In Phase 1 that label is
// `mock-dev`, and it is load-bearing: every downstream record reads it to mark itself as
// mocked rather than a real identity (docs/trust-model.md, AGENTS.md). The label is not
// trusted — it is a string the registrant chose — but it is the signal the UI keys off.
//
// No `eth_call`: every field is carried by the event (.cursor/rules/ethereum.mdc).
import { log } from "@graphprotocol/graph-ts";
import { Issuer } from "../generated/schema";
import {
  IssuerRegistered,
  IssuerActiveSet,
} from "../generated/AletheiaIssuerRegistry/AletheiaIssuerRegistry";

export function handleIssuerRegistered(event: IssuerRegistered): void {
  let issuer = new Issuer(event.params.issuerId);
  issuer.ax = event.params.ax;
  issuer.ay = event.params.ay;
  issuer.label = event.params.label;
  issuer.active = true;
  issuer.registeredAt = event.params.registeredAt;
  issuer.save();
}

export function handleIssuerActiveSet(event: IssuerActiveSet): void {
  let issuer = Issuer.load(event.params.issuerId);
  if (issuer == null) {
    // An active-flip for an issuer we never indexed a registration for. This cannot
    // happen against the deployed registry (setActive reverts for an unknown id), so it
    // is logged rather than papered over with a shell entity that would be missing ax/ay.
    log.warning("IssuerActiveSet for unknown issuer {}", [
      event.params.issuerId.toHexString(),
    ]);
    return;
  }
  // Only `active` changes. Existing Verification records are immutable and untouched by
  // design: a claim that was true when proven stays a true record after the issuer is
  // revoked.
  issuer.active = event.params.active;
  issuer.save();
}
