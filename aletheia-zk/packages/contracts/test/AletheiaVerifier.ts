import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { releaseProver } from "@aletheia/circuits";
import { network } from "hardhat";

import {
  buildAgeClaim,
  chainDaysAgo,
  chainToday,
  chainYesterday,
  deployAletheia,
  submitAsHolder,
  type AgeClaimBundle,
  type Deployment,
} from "./support.ts";

describe("AletheiaVerifier", () => {
  after(releaseProver);

  describe("a proven claim", () => {
    let deployment: Deployment;
    let bundle: AgeClaimBundle;

    before(async () => {
      deployment = await deployAletheia();
      bundle = await buildAgeClaim(deployment);
    });

    it("emits ClaimVerified with the claim, the issuer and nothing private", async () => {
      const { verifier, registry, holder, issuer } = deployment;
      const issuerId = await registry.read.issuerId([issuer.publicKey.ax, issuer.publicKey.ay]);
      const verificationId = await verifier.read.verificationIdFor([
        1,
        bundle.signals[7],
        bundle.signals[0],
      ]);

      await deployment.viem.assertions.emitWithArgs(
        submitAsHolder(deployment, bundle),
        verifier,
        "ClaimVerified",
        [
          verificationId,
          holder.account.address,
          1,
          issuerId,
          18n,
          await chainToday(deployment),
          `0x${bundle.signals[7].toString(16).padStart(64, "0")}`,
          `0x${bundle.signals[0].toString(16).padStart(64, "0")}`,
          `0x${bundle.signals[1].toString(16).padStart(64, "0")}`,
          (value: bigint) => value > 0n,
        ],
      );

      // The event carries the claim parameter and the validity date, and no credential
      // field. Asserted here because this event is what the subgraph exposes publicly.
      const privateValues = [
        BigInt(bundle.signed.credential.dateOfBirth),
        BigInt(bundle.signed.credential.nationality),
        BigInt(bundle.signed.credential.expiryDate),
        bundle.signed.credential.credentialId,
        bundle.signed.signature.s,
      ];
      const logs = await deployment.publicClient.getContractEvents({
        address: verifier.address,
        abi: verifier.abi,
        eventName: "ClaimVerified",
        fromBlock: 0n,
      });
      assert.equal(logs.length, 1);
      const emitted = Object.values(logs[0]?.args ?? {}).map((value) => String(value).toLowerCase());
      for (const secret of privateValues) {
        assert.ok(
          !emitted.includes(secret.toString().toLowerCase()),
          `${secret} is private and must not appear in the event`,
        );
      }
    });

    it("records the verification id so a replay is detectable", async () => {
      const verificationId = await deployment.verifier.read.verificationIdFor([
        1,
        bundle.signals[7],
        bundle.signals[0],
      ]);
      assert.equal(await deployment.verifier.read.verificationUsed([verificationId]), true);
    });

    it("rejects the same proof submitted twice", async () => {
      await deployment.viem.assertions.revertWithCustomError(
        submitAsHolder(deployment, bundle),
        deployment.verifier,
        "VerificationAlreadyRecorded",
      );
    });

    it("accepts the same credential for a different verifier context", async () => {
      // Different contextId, so a different nullifier: one credential can answer the
      // same question for two verifiers without either being able to link the records.
      const other = await buildAgeClaim(deployment, { contextId: 987654321n });
      await deployment.viem.assertions.emit(
        submitAsHolder(deployment, other),
        deployment.verifier,
        "ClaimVerified",
      );
      assert.notEqual(other.signals[0], bundle.signals[0]);
    });
  });

  describe("identity binding", () => {
    it("rejects a proof submitted by another wallet", async () => {
      // The proof is valid and the credential is real; it simply is not this sender's.
      const deployment = await deployAletheia();
      const bundle = await buildAgeClaim(deployment);
      await deployment.viem.assertions.revertWithCustomError(
        deployment.verifier.write.submitAgeClaim(
          [bundle.calldata.a, bundle.calldata.b, bundle.calldata.c, bundle.signals],
          { account: deployment.stranger.account },
        ),
        deployment.verifier,
        "SubjectIsNotSender",
      );
    });
  });

  describe("date freshness", () => {
    it("accepts yesterday, for a proof that crossed midnight", async () => {
      const deployment = await deployAletheia();
      const bundle = await buildAgeClaim(deployment, {
        currentDate: await chainYesterday(deployment),
      });
      await deployment.viem.assertions.emit(
        submitAsHolder(deployment, bundle),
        deployment.verifier,
        "ClaimVerified",
      );
    });

    it("rejects a date older than yesterday", async () => {
      const deployment = await deployAletheia();
      const bundle = await buildAgeClaim(deployment, {
        currentDate: await chainDaysAgo(deployment, 2),
      });
      await deployment.viem.assertions.revertWithCustomError(
        submitAsHolder(deployment, bundle),
        deployment.verifier,
        "DateNotCurrent",
      );
    });

    it("rejects a future date", async () => {
      // A holder choosing tomorrow could keep proving with a credential that expires
      // today. block.timestamp is the only clock they cannot choose.
      const deployment = await deployAletheia();
      const bundle = await buildAgeClaim(deployment, {
        currentDate: await chainDaysAgo(deployment, -1),
      });
      await deployment.viem.assertions.revertWithCustomError(
        submitAsHolder(deployment, bundle),
        deployment.verifier,
        "DateNotCurrent",
      );
    });
  });

  describe("issuer authority", () => {
    it("rejects a proof from an unregistered issuer key", async () => {
      // A perfectly valid proof over a credential signed by a key nobody registered.
      // This is the check that stops anyone minting their own credentials.
      const deployment = await deployAletheia();
      const { generateKeypair } = await import("@aletheia/issuer-mock");
      const rogue = await generateKeypair();
      const bundle = await buildAgeClaim(deployment, { issuerPrivateKey: rogue.privateKey });
      await deployment.viem.assertions.revertWithCustomError(
        submitAsHolder(deployment, bundle),
        deployment.registry,
        "IssuerNotRegistered",
      );
    });

    it("rejects a proof from a revoked issuer", async () => {
      const deployment = await deployAletheia();
      const bundle = await buildAgeClaim(deployment);
      const issuerId = await deployment.registry.read.issuerId([
        deployment.issuer.publicKey.ax,
        deployment.issuer.publicKey.ay,
      ]);
      await deployment.registry.write.setActive([issuerId, false]);
      await deployment.viem.assertions.revertWithCustomError(
        submitAsHolder(deployment, bundle),
        deployment.registry,
        "IssuerNotActive",
      );
    });
  });

  describe("proof validity", () => {
    it("rejects a mutated proof", async () => {
      const deployment = await deployAletheia();
      const bundle = await buildAgeClaim(deployment);
      await deployment.viem.assertions.revertWithCustomError(
        deployment.verifier.write.submitAgeClaim(
          [
            [bundle.calldata.a[0] + 1n, bundle.calldata.a[1]],
            bundle.calldata.b,
            bundle.calldata.c,
            bundle.signals,
          ],
          { account: deployment.holder.account },
        ),
        deployment.verifier,
        "InvalidProof",
      );
    });

    it("rejects an altered claim parameter", async () => {
      // Relabelling a proof of "at least 18" as "at least 21" fails the pairing check.
      const deployment = await deployAletheia();
      const bundle = await buildAgeClaim(deployment);
      const inflated = [...bundle.signals];
      inflated[6] = 21n;
      await deployment.viem.assertions.revertWithCustomError(
        deployment.verifier.write.submitAgeClaim(
          [bundle.calldata.a, bundle.calldata.b, bundle.calldata.c, inflated as never],
          { account: deployment.holder.account },
        ),
        deployment.verifier,
        "InvalidProof",
      );
    });

    it("rejects an out-of-range claim parameter before doing any pairing work", async () => {
      // No real proof can carry minimumAge > 120, because the circuit range-checks it.
      // The contract checks anyway, and cheaply, so a future circuit that forgot would
      // not produce a nonsensical record.
      const deployment = await deployAletheia();
      const bundle = await buildAgeClaim(deployment);
      const absurd = [...bundle.signals];
      absurd[6] = 121n;
      await deployment.viem.assertions.revertWithCustomError(
        deployment.verifier.write.submitAgeClaim(
          [bundle.calldata.a, bundle.calldata.b, bundle.calldata.c, absurd as never],
          { account: deployment.holder.account },
        ),
        deployment.verifier,
        "ClaimParameterOutOfRange",
      );
    });
  });

  describe("schema version", () => {
    it("refuses a proof whose schemaVersion is not the one deployed", async () => {
      // The circuit pins schemaVersion to 2, so no real v2 proof carries anything else.
      // A v1 proof padded into nine slots, or a future schema, lands a non-2 value here;
      // the contract must name the failure rather than let it reach the pairing check.
      const deployment = await deployAletheia();
      const bundle = await buildAgeClaim(deployment);
      const wrongSchema = [...bundle.signals];
      wrongSchema[2] = 1n;
      await deployment.viem.assertions.revertWithCustomError(
        deployment.verifier.write.submitAgeClaim(
          [bundle.calldata.a, bundle.calldata.b, bundle.calldata.c, wrongSchema as never],
          { account: deployment.holder.account },
        ),
        deployment.verifier,
        "SchemaVersionNotSupported",
      );
    });
  });

  describe("reserve ordering (the reentrancy defence)", () => {
    it("marks the nullifier used before calling the external verifier", async () => {
      // The verifier is owner-set and therefore untrusted. If it could re-enter
      // submitAgeClaim before the nullifier was reserved, it could record the same
      // verification twice. The defence is ordering: _reserve runs first. This probe
      // stands in for the verifier and reads back, at the moment it is called, whether
      // the id is already reserved — proving the ordering directly rather than by
      // inspecting the source. It never returns true, so no simulated proof success
      // enters the submit path; the transaction always reverts on the observation.
      const deployment = await deployAletheia();
      const probe = await deployment.viem.deployContract("ReserveOrderingProbe", [
        deployment.verifier.address,
      ]);
      await deployment.verifier.write.setClaimVerifier([1, probe.address]);

      const bundle = await buildAgeClaim(deployment);
      await deployment.viem.assertions.revertWithCustomErrorWithArgs(
        submitAsHolder(deployment, bundle),
        probe,
        "ReservedBeforeVerify",
        [true],
      );
    });
  });

  describe("configuration", () => {
    it("rejects a claim type with no verifier", async () => {
      const { viem } = await network.create();
      const [owner] = await viem.getWalletClients();
      const registry = await viem.deployContract("AletheiaIssuerRegistry", [
        owner!.account.address,
      ]);
      const verifier = await viem.deployContract("AletheiaVerifier", [
        owner!.account.address,
        registry.address,
      ]);
      const zeros = [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n] as const;
      await viem.assertions.revertWithCustomError(
        verifier.write.submitAgeClaim([[0n, 0n], [[0n, 0n], [0n, 0n]], [0n, 0n], zeros]),
        verifier,
        "NoVerifierForClaim",
      );
    });

    it("only lets the owner point a claim type at a verifier", async () => {
      const deployment = await deployAletheia();
      await deployment.viem.assertions.revertWithCustomError(
        deployment.verifier.write.setClaimVerifier([1, deployment.groth16.address], {
          account: deployment.stranger.account,
        }),
        deployment.verifier,
        "OwnableUnauthorizedAccount",
      );
    });

    it("refuses the zero address as a verifier", async () => {
      const deployment = await deployAletheia();
      await deployment.viem.assertions.revertWithCustomError(
        deployment.verifier.write.setClaimVerifier([
          2,
          "0x0000000000000000000000000000000000000000",
        ]),
        deployment.verifier,
        "InvalidVerifierAddress",
      );
    });
  });
});
