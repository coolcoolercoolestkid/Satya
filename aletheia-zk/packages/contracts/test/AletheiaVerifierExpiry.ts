import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { releaseProver } from "@aletheia/circuits";
import { network } from "hardhat";

import {
  buildAgeClaim,
  buildExpiryClaim,
  chainToday,
  chainYesterday,
  deployAletheia,
  submitExpiryAsHolder,
  type Deployment,
  type ExpiryClaimBundle,
} from "./support.ts";

const CLAIM_TYPE_EXPIRY = 3;

describe("AletheiaVerifier — expiry claim", () => {
  after(releaseProver);

  describe("a proven expiry claim", () => {
    let deployment: Deployment;
    let bundle: ExpiryClaimBundle;

    before(async () => {
      deployment = await deployAletheia();
      bundle = await buildExpiryClaim(deployment);
    });

    it("emits ClaimVerified as claim type 3, parameter zero, with nothing private", async () => {
      const { verifier, registry, holder, issuer } = deployment;
      const issuerId = await registry.read.issuerId([issuer.publicKey.ax, issuer.publicKey.ay]);
      const verificationId = await verifier.read.verificationIdFor([
        CLAIM_TYPE_EXPIRY,
        bundle.signals[7],
        bundle.signals[0],
      ]);

      await deployment.viem.assertions.emitWithArgs(
        submitExpiryAsHolder(deployment, bundle),
        verifier,
        "ClaimVerified",
        [
          verificationId,
          holder.account.address,
          CLAIM_TYPE_EXPIRY,
          issuerId,
          0n, // claimParameter is pinned to zero for expiry
          await chainToday(deployment), // credentialValidOn == currentDate the proof carried
          `0x${bundle.signals[7].toString(16).padStart(64, "0")}`,
          `0x${bundle.signals[0].toString(16).padStart(64, "0")}`,
          `0x${bundle.signals[1].toString(16).padStart(64, "0")}`,
          (value: bigint) => value > 0n,
        ],
      );

      // An expiry claim discloses nothing but the fact of validity on currentDate: no date
      // of birth, expiry date, nationality, credential id or signature scalar may appear in
      // the event the subgraph exposes.
      const privateValues = [
        BigInt(bundle.signed.credential.dateOfBirth),
        BigInt(bundle.signed.credential.expiryDate),
        BigInt(bundle.signed.credential.nationality),
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
        CLAIM_TYPE_EXPIRY,
        bundle.signals[7],
        bundle.signals[0],
      ]);
      assert.equal(await deployment.verifier.read.verificationUsed([verificationId]), true);
    });

    it("rejects the same expiry proof submitted twice", async () => {
      await deployment.viem.assertions.revertWithCustomError(
        submitExpiryAsHolder(deployment, bundle),
        deployment.verifier,
        "VerificationAlreadyRecorded",
      );
    });
  });

  describe("the expiryDate == currentDate boundary, on-chain", () => {
    it("verifies a credential expiring exactly on the date proven", async () => {
      // The exit criterion for stage 18: a credential whose expiryDate equals currentDate is
      // still valid (the base check is expiryDate >= currentDate). Proven on-chain by setting
      // the credential's expiry to the chain's today and proving against that same date, which
      // the contract's date-currency check also accepts.
      const deployment = await deployAletheia();
      const today = await chainToday(deployment);
      const bundle = await buildExpiryClaim(deployment, {
        currentDate: today,
        credential: { expiryDate: today },
      });

      const hash = await submitExpiryAsHolder(deployment, bundle);
      const receipt = await deployment.publicClient.waitForTransactionReceipt({ hash });
      assert.equal(receipt.status, "success");

      const logs = await deployment.publicClient.getContractEvents({
        address: deployment.verifier.address,
        abi: deployment.verifier.abi,
        eventName: "ClaimVerified",
        fromBlock: 0n,
      });
      assert.equal(logs.length, 1);
      assert.equal(logs[0]?.args?.credentialValidOn, today);
    });

    it("cannot produce a proof for a credential that expired the day before", async () => {
      // The other side of the boundary: expiryDate < currentDate is expired, so the base
      // check fails and no witness exists. The claim is unprovable at all — there is nothing
      // to submit on-chain, which is the strongest possible guarantee.
      const deployment = await deployAletheia();
      const today = await chainToday(deployment);
      const yesterday = await chainYesterday(deployment);
      await assert.rejects(
        buildExpiryClaim(deployment, {
          currentDate: today,
          credential: { expiryDate: yesterday },
        }),
        "an expired credential must not yield a provable expiry claim",
      );
    });
  });

  describe("the shared identity nullifier", () => {
    it("is identical across an age and an expiry claim for one credential and context", async () => {
      // identityNullifier (signals[1]) is claim-type independent, so one identity proving age
      // and expiry to one verifier carries the same value, while the replay nullifier
      // (signals[0]) differs because claimType is bound into it.
      const deployment = await deployAletheia();
      const contextId = 424242n;
      const age = await buildAgeClaim(deployment, { contextId });
      const expiry = await buildExpiryClaim(deployment, { contextId });

      assert.equal(
        expiry.signals[1],
        age.signals[1],
        "identityNullifier must be the same across claim types in one context",
      );
      assert.notEqual(
        expiry.signals[0],
        age.signals[0],
        "the replay nullifier must differ because claimType is bound into it",
      );
    });
  });

  describe("identity and parameter binding", () => {
    it("rejects a proof submitted by another wallet", async () => {
      const deployment = await deployAletheia();
      const bundle = await buildExpiryClaim(deployment);
      await deployment.viem.assertions.revertWithCustomError(
        deployment.verifier.write.submitExpiryClaim(
          [bundle.calldata.a, bundle.calldata.b, bundle.calldata.c, bundle.signals],
          { account: deployment.stranger.account },
        ),
        deployment.verifier,
        "SubjectIsNotSender",
      );
    });

    it("rejects a non-zero expiryParameter before any pairing work", async () => {
      // No real proof can carry a non-zero parameter, because the circuit pins the slot to
      // zero. The contract bounds it to zero anyway, cheaply, before the verifier is called.
      const deployment = await deployAletheia();
      const bundle = await buildExpiryClaim(deployment);
      const tampered = [...bundle.signals];
      tampered[6] = 1n;
      await deployment.viem.assertions.revertWithCustomError(
        deployment.verifier.write.submitExpiryClaim(
          [bundle.calldata.a, bundle.calldata.b, bundle.calldata.c, tampered as never],
          { account: deployment.holder.account },
        ),
        deployment.verifier,
        "ClaimParameterOutOfRange",
      );
    });
  });

  describe("issuer authority", () => {
    it("rejects an expiry proof from an unregistered issuer key", async () => {
      const deployment = await deployAletheia();
      const { generateKeypair } = await import("@aletheia/issuer-mock");
      const rogue = await generateKeypair();
      const bundle = await buildExpiryClaim(deployment, { issuerPrivateKey: rogue.privateKey });
      await deployment.viem.assertions.revertWithCustomError(
        submitExpiryAsHolder(deployment, bundle),
        deployment.registry,
        "IssuerNotRegistered",
      );
    });

    it("rejects an expiry proof from a revoked issuer", async () => {
      const deployment = await deployAletheia();
      const bundle = await buildExpiryClaim(deployment);
      const issuerId = await deployment.registry.read.issuerId([
        deployment.issuer.publicKey.ax,
        deployment.issuer.publicKey.ay,
      ]);
      await deployment.registry.write.setActive([issuerId, false]);
      await deployment.viem.assertions.revertWithCustomError(
        submitExpiryAsHolder(deployment, bundle),
        deployment.registry,
        "IssuerNotActive",
      );
    });
  });

  describe("schema version", () => {
    it("refuses a proof whose schemaVersion is not the one deployed", async () => {
      const deployment = await deployAletheia();
      const bundle = await buildExpiryClaim(deployment);
      const wrongSchema = [...bundle.signals];
      wrongSchema[2] = 1n;
      await deployment.viem.assertions.revertWithCustomError(
        deployment.verifier.write.submitExpiryClaim(
          [bundle.calldata.a, bundle.calldata.b, bundle.calldata.c, wrongSchema as never],
          { account: deployment.holder.account },
        ),
        deployment.verifier,
        "SchemaVersionNotSupported",
      );
    });
  });

  describe("configuration", () => {
    it("rejects an expiry claim when no verifier is set for claim type 3", async () => {
      const { viem } = await network.create();
      const [owner] = await viem.getWalletClients();
      const registry = await viem.deployContract("AletheiaIssuerRegistry", [owner!.account.address]);
      const verifier = await viem.deployContract("AletheiaVerifier", [
        owner!.account.address,
        registry.address,
      ]);
      // Only age is wired; expiry is deliberately left unset.
      const groth16 = await viem.deployContract("Groth16VerifierAge");
      await verifier.write.setClaimVerifier([1, groth16.address]);

      const zeros = [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n] as const;
      await viem.assertions.revertWithCustomError(
        verifier.write.submitExpiryClaim([[0n, 0n], [[0n, 0n], [0n, 0n]], [0n, 0n], zeros]),
        verifier,
        "NoVerifierForClaim",
      );
    });
  });
});
