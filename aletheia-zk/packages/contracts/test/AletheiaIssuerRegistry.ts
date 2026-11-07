import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generateKeypair } from "@aletheia/issuer-mock";
import { network } from "hardhat";

async function fixture() {
  const { viem } = await network.create();
  const [owner, stranger] = await viem.getWalletClients();
  const registry = await viem.deployContract("AletheiaIssuerRegistry", [
    owner!.account.address,
  ]);
  const key = (await generateKeypair()).publicKey;
  return { viem, owner: owner!, stranger: stranger!, registry, key };
}

describe("AletheiaIssuerRegistry", () => {
  it("registers an issuer as active and labelled", async () => {
    const { viem, registry, key } = await fixture();
    await viem.assertions.emitWithArgs(
      registry.write.register([key.ax, key.ay, "mock-dev"]),
      registry,
      "IssuerRegistered",
      [
        await registry.read.issuerId([key.ax, key.ay]),
        key.ax,
        key.ay,
        "mock-dev",
        (value: bigint) => value > 0n,
      ],
    );

    const issuer = await registry.read.issuer([await registry.read.issuerId([key.ax, key.ay])]);
    assert.equal(issuer.active, true);
    // The label is what keeps a mock-issued record distinguishable from a real one.
    assert.equal(issuer.label, "mock-dev");
    assert.equal(issuer.ax, key.ax);
    assert.equal(issuer.ay, key.ay);
  });

  it("derives the same id for the same key and different ids for different keys", async () => {
    const { registry, key } = await fixture();
    const other = (await generateKeypair()).publicKey;
    assert.equal(
      await registry.read.issuerId([key.ax, key.ay]),
      await registry.read.issuerId([key.ax, key.ay]),
    );
    assert.notEqual(
      await registry.read.issuerId([key.ax, key.ay]),
      await registry.read.issuerId([other.ax, other.ay]),
    );
  });

  it("refuses a duplicate registration", async () => {
    const { viem, registry, key } = await fixture();
    await registry.write.register([key.ax, key.ay, "mock-dev"]);
    await viem.assertions.revertWithCustomError(
      registry.write.register([key.ax, key.ay, "mock-dev-again"]),
      registry,
      "IssuerAlreadyRegistered",
    );
  });

  it("refuses the zero key", async () => {
    // A zero key would match an unset public signal and cannot be signed with.
    const { viem, registry } = await fixture();
    await viem.assertions.revertWithCustomError(
      registry.write.register([0n, 0n, "zero"]),
      registry,
      "InvalidIssuerKey",
    );
  });

  it("only lets the owner register or revoke", async () => {
    const { viem, registry, key, stranger } = await fixture();
    await viem.assertions.revertWithCustomError(
      registry.write.register([key.ax, key.ay, "mock-dev"], { account: stranger.account }),
      registry,
      "OwnableUnauthorizedAccount",
    );

    await registry.write.register([key.ax, key.ay, "mock-dev"]);
    const id = await registry.read.issuerId([key.ax, key.ay]);
    await viem.assertions.revertWithCustomError(
      registry.write.setActive([id, false], { account: stranger.account }),
      registry,
      "OwnableUnauthorizedAccount",
    );
  });

  it("revokes and restores an issuer, emitting each change", async () => {
    const { viem, registry, key } = await fixture();
    await registry.write.register([key.ax, key.ay, "mock-dev"]);
    const id = await registry.read.issuerId([key.ax, key.ay]);

    await viem.assertions.emitWithArgs(
      registry.write.setActive([id, false]),
      registry,
      "IssuerActiveSet",
      [id, false],
    );
    await viem.assertions.revertWithCustomError(
      registry.read.requireActive([key.ax, key.ay]),
      registry,
      "IssuerNotActive",
    );

    await registry.write.setActive([id, true]);
    assert.equal(await registry.read.requireActive([key.ax, key.ay]), id);
  });

  it("distinguishes an unregistered issuer from a revoked one", async () => {
    const { viem, registry, key } = await fixture();
    await viem.assertions.revertWithCustomError(
      registry.read.requireActive([key.ax, key.ay]),
      registry,
      "IssuerNotRegistered",
    );

    await registry.write.register([key.ax, key.ay, "mock-dev"]);
    await registry.write.setActive([await registry.read.issuerId([key.ax, key.ay]), false]);
    await viem.assertions.revertWithCustomError(
      registry.read.requireActive([key.ax, key.ay]),
      registry,
      "IssuerNotActive",
    );
  });

  it("hands ownership over in two steps", async () => {
    // Ownable2Step, so a typo in an address cannot leave the registry unowned.
    const { registry, stranger } = await fixture();
    await registry.write.transferOwnership([stranger.account.address]);
    assert.equal(
      (await registry.read.pendingOwner()).toLowerCase(),
      stranger.account.address.toLowerCase(),
    );

    await registry.write.acceptOwnership({ account: stranger.account });
    assert.equal(
      (await registry.read.owner()).toLowerCase(),
      stranger.account.address.toLowerCase(),
    );
  });
});
