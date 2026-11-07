import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";

describe("AletheiaProfile", async () => {
  const { viem } = await network.create();
  const [account, other] = await viem.getWalletClients();

  it("registers an address once and records when", async () => {
    const profile = await viem.deployContract("AletheiaProfile");
    await viem.assertions.emitWithArgs(
      profile.write.register(),
      profile,
      "ProfileRegistered",
      [account!.account.address, (value: bigint) => value > 0n],
    );
    assert.equal(await profile.read.isRegistered([account!.account.address]), true);
    assert.equal(await profile.read.isRegistered([other!.account.address]), false);

    await viem.assertions.revertWithCustomError(
      profile.write.register(),
      profile,
      "AlreadyRegistered",
    );
  });

  it("registers only the caller, never someone else", async () => {
    // There is no function that registers a third party, by design: a profile is a
    // statement about yourself.
    const profile = await viem.deployContract("AletheiaProfile");
    await profile.write.register({ account: other!.account });
    assert.equal(await profile.read.isRegistered([other!.account.address]), true);
    assert.equal(await profile.read.isRegistered([account!.account.address]), false);
  });
});
