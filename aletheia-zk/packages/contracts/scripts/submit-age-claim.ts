/**
 * Stage 11 / Day 9: submit a genuine age proof on-chain, then prove replay is refused.
 *
 * This is the first time the whole pipeline runs against a real chain rather than a
 * local simulation: a credential the mock issuer actually signed, a real Groth16 proof
 * over `age.circom`, a real `submitAgeClaim` transaction on Sepolia, and a real
 * `ClaimVerified` event. Nothing here is stubbed — if any link fails, the script fails.
 *
 * It does two things, in order:
 *
 *   1. Builds a credential bound to the connected wallet, signs it with the registered
 *      `mock-dev` issuer, proves the claim, submits it, and reads the emitted event
 *      back from the mined receipt.
 *   2. Resubmits the identical proof and requires it to revert with
 *      `VerificationAlreadyRecorded`. The revert is mined as a real failed transaction
 *      (gas supplied explicitly so the node broadcasts it instead of the RPC rejecting
 *      it during estimation), so the replay defence is demonstrated on-chain and not
 *      merely in a local `expect(...).to.be.reverted`.
 *
 * Run against the network holding the deployment:
 *   npx hardhat run scripts/submit-age-claim.ts --network sepolia
 *
 * The verifier address is read from the Ignition deployment for the connected chain, so
 * the contracts must already be deployed there and the mock issuer registered active.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SCHEMA_VERSION,
  hashToField,
  randomFieldElement,
  todayUtcYyyymmdd,
  type NormalizedCredential,
} from "@aletheia/credential";
import {
  proveAgeClaim,
  releaseProver,
  toSolidityCalldata,
} from "@aletheia/circuits";
import {
  MOCK_ISSUER_LABEL,
  defaultKeystorePath,
  deriveIdentitySecret,
  parseKeystore,
  randomIdentitySalt,
  signCredential,
  type KeystoreFile,
} from "@aletheia/issuer-mock";
import { network } from "hardhat";
import {
  BaseError,
  ContractFunctionRevertedError,
  keccak256,
  parseEventLogs,
  stringToBytes,
  type Abi,
} from "viem";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The AletheiaVerifier address Ignition recorded for this chain, or a clear failure. */
function deployedVerifierAddress(chainId: number): `0x${string}` {
  const file = join(
    HERE,
    "..",
    "ignition",
    "deployments",
    `chain-${chainId}`,
    "deployed_addresses.json",
  );
  let addresses: Record<string, string>;
  try {
    addresses = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
  } catch {
    throw new Error(
      `no Ignition deployment for chain ${chainId} (${file} is missing). ` +
        "Deploy the contracts to this network first.",
    );
  }
  const address = addresses["Aletheia#AletheiaVerifier"];
  if (address === undefined) {
    throw new Error(
      `chain ${chainId} has an Ignition deployment but no AletheiaVerifier in it.`,
    );
  }
  return address as `0x${string}`;
}

/** Load the mock keystore, refusing anything that is not the mock issuer. */
async function loadMockIssuer() {
  const path = defaultKeystorePath();
  let file: KeystoreFile;
  try {
    file = JSON.parse(readFileSync(path, "utf8")) as KeystoreFile;
  } catch {
    throw new Error(
      `no issuer keystore at ${path}. Generate one with ` +
        "`pnpm --filter @aletheia/issuer-mock run keygen` first.",
    );
  }
  if (file.label !== MOCK_ISSUER_LABEL) {
    throw new Error(
      `refusing to sign with a keystore labelled "${file.label}", not "${MOCK_ISSUER_LABEL}". ` +
        "This script only ever exercises the local mock issuer.",
    );
  }
  return parseKeystore(file);
}

async function main(): Promise<void> {
  console.error(
    "!! mock issuer: the credential signed below verifies no identity. This proves the " +
      "on-chain pipeline works, not that anyone is who they say they are. !!",
  );

  const { viem, networkName } = await network.getOrCreate();
  const publicClient = await viem.getPublicClient();
  const [walletClient] = await viem.getWalletClients();
  if (walletClient === undefined) {
    throw new Error("no signer available for this network");
  }
  const account = walletClient.account;

  const chainId = await publicClient.getChainId();
  const verifierAddress = deployedVerifierAddress(chainId);
  const verifier = await viem.getContractAt("AletheiaVerifier", verifierAddress);
  const abi = verifier.abi as Abi;

  console.log(`network:    ${networkName} (chain id ${chainId})`);
  console.log(`verifier:   ${verifierAddress}`);
  console.log(`subject:    ${account.address}`);

  // Fail early and readably if the age verifier was never pointed at its Groth16
  // contract, rather than reverting deep inside submitAgeClaim.
  const claimVerifier = await verifier.read.claimVerifier([1]);
  if (BigInt(claimVerifier) === 0n) {
    throw new Error(
      "claimVerifier[1] is unset: run setClaimVerifier(1, Groth16VerifierAge) before submitting.",
    );
  }
  console.log(`age verifier set to: ${claimVerifier}`);

  // A credential the mock issuer signs, bound to the connected wallet. subject MUST equal
  // msg.sender or submitAgeClaim reverts with SubjectIsNotSender: the proof binds the
  // holder's address, which is what makes a stolen proof useless.
  //
  // credentialId and identitySecret are freshly random each run, so the nullifier is new
  // every time and the success path never collides with a record left by a previous run.
  const currentDate = todayUtcYyyymmdd();
  const credential: NormalizedCredential = {
    schemaVersion: SCHEMA_VERSION,
    credentialId: randomFieldElement(),
    subject: account.address.toLowerCase(),
    dateOfBirth: 20040314, // ~22 on any 2026 date, so "at least 18" is satisfiable
    nationality: 356,
    expiryDate: 20340314,
    issuedAt: currentDate, // the signing date, by definition today
    identitySecret: await deriveIdentitySecret({
      issuerSalt: randomIdentitySalt(),
      documentKey: randomFieldElement(),
    }),
  };

  const { privateKey } = await loadMockIssuer();
  const signed = await signCredential(privateKey, credential);

  // A real verifier-chosen scope tag. Reduced into the field the one sanctioned way.
  const contextId = hashToField(keccak256(stringToBytes("aletheia:day9:sepolia")));
  const request = { minimumAge: 18, currentDate, contextId } as const;

  console.log(`\nproving age >= ${request.minimumAge} on ${currentDate} (context ${contextId})...`);
  const { proof, publicSignals, decoded } = await proveAgeClaim(signed, request);
  console.log("proof produced and locally verified.");

  const calldata = await toSolidityCalldata(proof, publicSignals);
  // The generated verifier is uint256[9]; snarkjs returns nine signals in the frozen
  // order. Fix the tuple length so the ABI encoder and the typechecker both agree.
  const signals = calldata.publicSignals as readonly [
    bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  ];
  const args = [calldata.a, calldata.b, calldata.c, signals] as const;

  // ---- 1. The genuine submission ----------------------------------------------------

  // Simulate first, both to catch a problem before spending gas and to read back the
  // verificationId the contract will assign.
  const { result: expectedId, request: writeRequest } = await publicClient.simulateContract({
    address: verifierAddress,
    abi,
    functionName: "submitAgeClaim",
    args,
    account,
  });
  console.log(`\nverificationId (from simulation): ${expectedId}`);

  const submitHash = await walletClient.writeContract(writeRequest);
  console.log(`submit tx:  ${submitHash}`);
  console.log(`            https://sepolia.etherscan.io/tx/${submitHash}`);

  const submitReceipt = await publicClient.waitForTransactionReceipt({ hash: submitHash });
  if (submitReceipt.status !== "success") {
    throw new Error(`submission transaction reverted on-chain (status ${submitReceipt.status})`);
  }
  console.log(`mined in block ${submitReceipt.blockNumber}, gas used ${submitReceipt.gasUsed}`);

  const events = parseEventLogs({ abi, logs: submitReceipt.logs, eventName: "ClaimVerified" });
  const event = events[0];
  if (event === undefined) {
    throw new Error("submission mined but emitted no ClaimVerified event");
  }
  const emitted = event.args as {
    verificationId: `0x${string}`;
    subject: `0x${string}`;
    claimType: number;
    issuerId: `0x${string}`;
    claimParameter: bigint;
    credentialValidOn: number;
    contextId: `0x${string}`;
    nullifier: `0x${string}`;
    identityNullifier: `0x${string}`;
    verifiedAt: bigint;
  };
  console.log("\nClaimVerified:");
  console.log(`  verificationId:    ${emitted.verificationId}`);
  console.log(`  subject:           ${emitted.subject}`);
  console.log(`  claimType:         ${emitted.claimType}`);
  console.log(`  issuerId:          ${emitted.issuerId}`);
  console.log(`  claimParameter:    ${emitted.claimParameter} (minimumAge)`);
  console.log(`  credentialValidOn: ${emitted.credentialValidOn}`);
  console.log(`  nullifier:         ${emitted.nullifier}`);
  console.log(`  identityNullifier: ${emitted.identityNullifier}`);
  console.log(`  verifiedAt:        ${emitted.verifiedAt}`);

  // The event must agree with what we proved, or "success" means nothing.
  if (emitted.verificationId !== expectedId) {
    throw new Error("emitted verificationId does not match the simulated one");
  }
  if (BigInt(emitted.subject) !== BigInt(account.address)) {
    throw new Error("emitted subject is not the submitting wallet");
  }
  if (emitted.claimParameter !== BigInt(decoded.minimumAge)) {
    throw new Error("emitted claimParameter does not match the proven minimumAge");
  }

  // ---- 2. The replay, refused on-chain ----------------------------------------------

  console.log("\nresubmitting the identical proof; it must be refused...");

  // First establish *which* error the chain gives, decoded by name. simulateContract
  // runs an eth_call against live state and surfaces the custom error.
  let sawExpectedError = false;
  try {
    await publicClient.simulateContract({
      address: verifierAddress,
      abi,
      functionName: "submitAgeClaim",
      args,
      account,
    });
  } catch (err) {
    if (err instanceof BaseError) {
      const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
      if (revert instanceof ContractFunctionRevertedError) {
        const name = revert.data?.errorName;
        console.log(`revert reason (decoded): ${name ?? revert.reason ?? "unknown"}`);
        if (name === "VerificationAlreadyRecorded") {
          sawExpectedError = true;
        }
      }
    }
    if (!sawExpectedError) throw err;
  }
  if (!sawExpectedError) {
    throw new Error("resubmission did NOT revert: the replay defence is not working");
  }

  // Now mine it as a real failed transaction. Supplying gas explicitly skips the RPC's
  // pre-flight estimation (which would reject the call and never broadcast it), so the
  // revert is recorded on-chain with a real hash, per the Day 9 exit criteria.
  const revertHash = await walletClient.writeContract({
    address: verifierAddress,
    abi,
    functionName: "submitAgeClaim",
    args,
    account,
    gas: submitReceipt.gasUsed + 100_000n,
  });
  console.log(`replay tx:  ${revertHash}`);
  console.log(`            https://sepolia.etherscan.io/tx/${revertHash}`);

  const revertReceipt = await publicClient.waitForTransactionReceipt({ hash: revertHash });
  if (revertReceipt.status !== "reverted") {
    throw new Error(
      `expected the replay to revert on-chain, but it had status "${revertReceipt.status}"`,
    );
  }
  console.log(`replay reverted on-chain in block ${revertReceipt.blockNumber} (status reverted).`);

  console.log("\n--- Day 9 artifacts ---");
  console.log(`success tx: ${submitHash}`);
  console.log(`replay tx:  ${revertHash}`);
  console.log(`verificationId: ${expectedId}`);
}

try {
  await main();
} finally {
  // snarkjs starts worker threads for curve arithmetic; without terminating them the
  // process hangs after the work is done instead of exiting.
  await releaseProver();
}
