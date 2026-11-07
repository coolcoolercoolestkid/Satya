import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { releaseProver } from "@aletheia/circuits";
import { network } from "hardhat";

import {
  buildAgeClaim,
  buildNationalityClaim,
  chainToday,
  deployAletheia,
  submitNationalityAsHolder,
  type Deployment,
  type NationalityClaimBundle,
} from "./support.ts";

const CLAIM_TYPE_NATIONALITY = 2;
const FIXTURE_NATIONALITY = 356n; // India, the fixture credential's nationality

describe("AletheiaVerifier — nationality claim", () => {
  after(releaseProver);

  describe("a proven nationality claim", () => {
    let deployment: Deployment;
    let bundle: NationalityClaimBundle;

    before(async () => {
      deployment = await deployAletheia();
      bundle = await buildNationalityClaim(deployment);
    });

    it("emits ClaimVerified as claim type 2, with the nationality and nothing private", async () => {
      const { verifier, registry, holder, issuer } = deployment;
      const issuerId = await registry.read.issuerId([issuer.publicKey.ax, issuer.publicKey.ay]);
      const verificationId = await verifier.read.verificationIdFor([
        CLAIM_TYPE_NATIONALITY,
        bundle.signals[7],
        bundle.signals[0],
      ]);

      await deployment.viem.assertions.emitWithArgs(
        submitNationalityAsHolder(deployment, bundle),
        verifier,
        "ClaimVerified",
        [
          verificationId,
          holder.account.address,
          CLAIM_TYPE_NATIONALITY,
          issuerId,
          FIXTURE_NATIONALITY, // claimParameter is the disclosed nationality
          await chainToday(deployment), // credentialValidOn == currentDate the proof carried
          `0x${bundle.signals[7].toString(16).padStart(64, "0")}`,
          `0x${bundle.signals[0].toString(16).padStart(64, "0")}`,
          `0x${bundle.signals[1].toString(16).padStart(64, "0")}`,
          (value: bigint) => value > 0n,
        ],
      );

      // The nationality claim discloses the nationality asked about — that is the point of
      // it — but nothing else in the credential: no date of birth, expiry, credential id or
      // signature scalar may appear in the event the subgraph exposes.
      const privateValues = [
        BigInt(bundle.signed.credential.dateOfBirth),
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
        CLAIM_TYPE_NATIONALITY,
        bundle.signals[7],
        bundle.signals[0],
      ]);
      assert.equal(await deployment.verifier.read.verificationUsed([verificationId]), true);
    });

    it("rejects the same nationality proof submitted twice", async () => {
      await deployment.viem.assertions.revertWithCustomError(
        submitNationalityAsHolder(deployment, bundle),
        deployment.verifier,
        "VerificationAlreadyRecorded",
      );
    });
  });

  describe("the shared identity nullifier", () => {
    it("is identical across an age and a nationality claim for one credential and context", async () => {
      // The property identitySecret exists for: one identity proving two different claims
      // to one verifier carries the same identityNullifier (signals[1]), while the replay
      // nullifier (signals[0]) differs because claimType is bound into it. Proven here with
      // two real proofs over the same credential in one context.
      const deployment = await deployAletheia();
      const contextId = 424242n;
      const age = await buildAgeClaim(deployment, { contextId });
      const nationality = await buildNationalityClaim(deployment, { contextId });

      assert.equal(
        nationality.signals[1],
        age.signals[1],
        "identityNullifier must be the same across claim types in one context",
      );
      assert.notEqual(
        nationality.signals[0],
        age.signals[0],
        "the replay nullifier must differ because claimType is bound into it",
      );
    });
  });

  describe("identity and parameter binding", () => {
    it("rejects a proof submitted by another wallet", async () => {
      const deployment = await deployAletheia();
      const bundle = await buildNationalityClaim(deployment);
      await deployment.viem.assertions.revertWithCustomError(
        deployment.verifier.write.submitNationalityClaim(
          [bundle.calldata.a, bundle.calldata.b, bundle.calldata.c, bundle.signals],
          { account: deployment.stranger.account },
        ),
        deployment.verifier,
        "SubjectIsNotSender",
      );
    });

    it("rejects a relabelled nationality before it is recorded", async () => {
      // Changing requiredNationality after proving fails the pairing check, so a proof of
      // one nationality cannot be passed off as another.
      const deployment = await deployAletheia();
      const bundle = await buildNationalityClaim(deployment);
      const relabelled = [...bundle.signals];
      relabelled[6] = 840n; // claim to be American instead
      await deployment.viem.assertions.revertWithCustomError(
        deployment.verifier.write.submitNationalityClaim(
          [bundle.calldata.a, bundle.calldata.b, bundle.calldata.c, relabelled as never],
          { account: deployment.holder.account },
        ),
        deployment.verifier,
        "InvalidProof",
      );
    });

    it("rejects an out-of-range nationality parameter before any pairing work", async () => {
      // No real proof can carry requiredNationality > 999, because the circuit range-checks
      // it and forces it equal to the signed code. The contract checks anyway, cheaply.
      const deployment = await deployAletheia();
      const bundle = await buildNationalityClaim(deployment);
      const absurd = [...bundle.signals];
      absurd[6] = 1000n;
      await deployment.viem.assertions.revertWithCustomError(
        deployment.verifier.write.submitNationalityClaim(
          [bundle.calldata.a, bundle.calldata.b, bundle.calldata.c, absurd as never],
          { account: deployment.holder.account },
        ),
        deployment.verifier,
        "ClaimParameterOutOfRange",
      );
    });
  });

  describe("issuer authority", () => {
    it("rejects a nationality proof from an unregistered issuer key", async () => {
      const deployment = await deployAletheia();
      const { generateKeypair } = await import("@aletheia/issuer-mock");
      const rogue = await generateKeypair();
      const bundle = await buildNationalityClaim(deployment, { issuerPrivateKey: rogue.privateKey });
      await deployment.viem.assertions.revertWithCustomError(
        submitNationalityAsHolder(deployment, bundle),
        deployment.registry,
        "IssuerNotRegistered",
      );
    });

    it("rejects a nationality proof from a revoked issuer", async () => {
      const deployment = await deployAletheia();
      const bundle = await buildNationalityClaim(deployment);
      const issuerId = await deployment.registry.read.issuerId([
        deployment.issuer.publicKey.ax,
        deployment.issuer.publicKey.ay,
      ]);
      await deployment.registry.write.setActive([issuerId, false]);
      await deployment.viem.assertions.revertWithCustomError(
        submitNationalityAsHolder(deployment, bundle),
        deployment.registry,
        "IssuerNotActive",
      );
    });
  });

  describe("schema version", () => {
    it("refuses a proof whose schemaVersion is not the one deployed", async () => {
      const deployment = await deployAletheia();
      const bundle = await buildNationalityClaim(deployment);
      const wrongSchema = [...bundle.signals];
      wrongSchema[2] = 1n;
      await deployment.viem.assertions.revertWithCustomError(
        deployment.verifier.write.submitNationalityClaim(
          [bundle.calldata.a, bundle.calldata.b, bundle.calldata.c, wrongSchema as never],
          { account: deployment.holder.account },
        ),
        deployment.verifier,
        "SchemaVersionNotSupported",
      );
    });
  });

  describe("configuration", () => {
    it("rejects a nationality claim when no verifier is set for claim type 2", async () => {
      const { viem } = await network.create();
      const [owner] = await viem.getWalletClients();
      const registry = await viem.deployContract("AletheiaIssuerRegistry", [owner!.account.address]);
      const verifier = await viem.deployContract("AletheiaVerifier", [
        owner!.account.address,
        registry.address,
      ]);
      // Only age is wired; nationality is deliberately left unset.
      const groth16 = await viem.deployContract("Groth16VerifierAge");
      await verifier.write.setClaimVerifier([1, groth16.address]);

      const zeros = [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n] as const;
      await viem.assertions.revertWithCustomError(
        verifier.write.submitNationalityClaim([[0n, 0n], [[0n, 0n], [0n, 0n]], [0n, 0n], zeros]),
        verifier,
        "NoVerifierForClaim",
      );
    });
  });
});
