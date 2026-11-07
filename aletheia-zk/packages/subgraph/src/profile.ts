// AletheiaProfile mappings.
//
// ProfileRegistered is the only place `registeredAt` is set. A Profile may already exist
// as a bare shell — created the first time it appeared as a verification subject — so this
// handler upserts rather than assuming a fresh entity, and only ever *adds* the
// registration timestamp; it never clears a subject's existing verifications (those are
// derived, never stored here).
import { Address, BigInt } from "@graphprotocol/graph-ts";
import { Profile } from "../generated/schema";
import { ProfileRegistered } from "../generated/AletheiaProfile/AletheiaProfile";

// Load the Profile for an address, creating a bare shell (no registeredAt) if absent.
// Used both here and by the verifier handler, which sees subjects that may never have
// called register().
export function loadOrCreateProfile(account: Address): Profile {
  let profile = Profile.load(account);
  if (profile == null) {
    profile = new Profile(account);
    // registeredAt stays null until a ProfileRegistered event arrives for this address.
    profile.save();
  }
  return profile;
}

export function handleProfileRegistered(event: ProfileRegistered): void {
  let profile = loadOrCreateProfile(event.params.account);
  profile.registeredAt = event.params.registeredAt;
  profile.save();
}
