/**
 * M1: the end-to-end runner (TODO.md, day 16).
 *
 * One command that drives the whole Aletheia pipeline against real infrastructure, start
 * to finish, and fails if any link is not genuine. Nothing here is stubbed or simulated:
 * the credential is really signed by the `mock-dev` issuer, the proof is a real Groth16
 * proof, the on-chain verifier really checks it, the transaction is really mined on
 * Sepolia, and the record is really read back from the deployed subgraph.
 *
 * The nine stages, in the order docs/architecture.md lists them:
 *
 *   1. signed credential   — mock-dev signs a credential bound to the runner's wallet
 *   2. circuit             — the credential satisfies the age constraint system (witness)
 *   3. proof               — a real Groth16 proof over age.circom
 *   4. local verify        — snarkjs verifies the proof against the verification key
 *   5. Solidity verify     — the deployed Groth16 verifier accepts it (and rejects a
 *                            mutated public signal), by eth_call, before any state change
 *   6. Sepolia transaction — submitAgeClaim is mined on Sepolia
 *   7. event               — the mined receipt carries the expected ClaimVerified event
 *   8. Graph               — the subgraph indexes the record (pending, then verified)
 *   9. verifier query      — the indexed record reads back as `verified`, cross-checked
 *                            against the on-chain event
 *
 * Prerequisites (all documented in README.md and none of them optional, because this is
 * the point of the task): the workspace packages are built, the contracts are compiled,
 * the mock issuer keystore exists and its key is the registered `mock-dev` issuer, and the
 * root `.env` carries SEPOLIA_RPC_URL, SEPOLIA_PRIVATE_KEY and GRAPH_QUERY_URL. The wallet
 * needs a little Sepolia ETH; one submitAgeClaim costs well under a cent of faucet funds.
 *
 * Run it:
 *   pnpm --filter @aletheia/scripts run m1
 */

import { readFileSync } from "node:fs";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";

import {
  AGE_CLAIM,
  ageClaimInput,
  calculateWitness,
  checkWitness,
  proveAgeClaim,
  releaseProver,
  toSolidityCalldata,
  verifyAgeClaim,
} from "@aletheia/circuits";
import {
  SCHEMA_VERSION,
  hashToField,
  randomFieldElement,
  todayUtcYyyymmdd,
  type NormalizedCredential,
} from "@aletheia/credential";
import {
  MOCK_ISSUER_LABEL,
  defaultKeystorePath,
  deriveIdentitySecret,
  parseKeystore,
  randomIdentitySalt,
  signCredential,
  type KeystoreFile,
} from "@aletheia/issuer-mock";
import {
  createQueryClient,
  deriveVerificationState,
  type FreshnessPolicy,
  type Verification,
  type VerificationState,
} from "@aletheia/query";
import { keccak256, parseEventLogs, stringToBytes, type Abi } from "viem";

import {
  loadArtifactAbi,
  loadDeployment,
  loadEnv,
  sepoliaClients,
} from "./env.ts";

/** A generous freshness window, so a freshly indexed record reads `verified`, not `stale`. */
const POLICY: FreshnessPolicy = { maxVerificationAgeSeconds: 30 * 24 * 60 * 60 };
/** How long to poll the subgraph for the record to index before giving up. */
const POLL_BUDGET_MS = 4 * 60 * 1000;
/** Gap between polls: short enough to catch the pending window, not a busy loop. */
const POLL_INTERVAL_MS = 1500;

/** A nine-element public-signal tuple, the length the ABI encoder and typechecker want. */
type Signals9 = readonly [
  bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
];

function heading(step: number, title: string): void {
  console.log(`\n=== ${step}. ${title} ===`);
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
        "`pnpm --filter @aletheia/issuer-mock run keygen`, and register it as the mock-dev " +
        "issuer, before running M1.",
    );
  }
  if (file.label !== MOCK_ISSUER_LABEL) {
    throw new Error(
      `refusing to sign with a keystore labelled "${file.label}", not "${MOCK_ISSUER_LABEL}". ` +
        "The M1 runner only ever exercises the local mock issuer.",
    );
  }
  return parseKeystore(file);
}

function describe(state: VerificationState): string {
  return state.status === "pending"
    ? `${state.status.toUpperCase()} (${state.cause}) — ${state.reason}`
    : `${state.status.toUpperCase()} — ${state.reason}`;
}

async function main(): Promise<void> {
  console.error(
    "!! mock issuer: the credential signed below verifies no identity. M1 proves the " +
      "on-chain pipeline works end to end, not that anyone is who they say they are. !!",
  );

  loadEnv();
  const deployment = loadDeployment();
  const { publicClient, walletClient, account } = sepoliaClients();

  const verifierAddress = deployment.contracts.AletheiaVerifier.address;
  const groth16Address = deployment.contracts.Groth16VerifierAge.address;
  const claimType = deployment.ageClaim.claimType;

  const verifierAbi = loadArtifactAbi("AletheiaVerifier.sol", "AletheiaVerifier");
  const groth16Abi = loadArtifactAbi("verifiers/Groth16VerifierAge.sol", "Groth16VerifierAge");

  console.log(`network:        sepolia (chain id ${deployment.chainId})`);
  console.log(`verifier:       ${verifierAddress}`);
  console.log(`age verifier:   ${groth16Address}`);
  console.log(`subject/signer: ${account.address}`);

  // --- Cross-check the manifest against the live chain, before spending anything --------
  //
  // The manifest is committed data; the chain is the authority. If they disagree, the
  // deployment moved and the manifest is stale — fail here, named, rather than sending a
  // transaction into the wrong contract.
  const chainId = await publicClient.getChainId();
  if (chainId !== deployment.chainId) {
    throw new Error(
      `SEPOLIA_RPC_URL is connected to chain ${chainId}, but the manifest is for ` +
        `${deployment.chainId}. Point it at Sepolia.`,
    );
  }
  const code = await publicClient.getCode({ address: verifierAddress });
  if (code === undefined || code === "0x") {
    throw new Error(
      `no contract code at ${verifierAddress}. The manifest address is wrong for this ` +
        "chain, or the contracts are not deployed here.",
    );
  }
  const onChainSchema = (await publicClient.readContract({
    address: verifierAddress,
    abi: verifierAbi,
    functionName: "SUPPORTED_SCHEMA_VERSION",
  })) as number | bigint;
  if (Number(onChainSchema) !== SCHEMA_VERSION) {
    throw new Error(
      `the deployed verifier supports schema version ${onChainSchema}, but this build ` +
        `proves schema version ${SCHEMA_VERSION}. They must match.`,
    );
  }
  const claimVerifier = (await publicClient.readContract({
    address: verifierAddress,
    abi: verifierAbi,
    functionName: "claimVerifier",
    args: [claimType],
  })) as `0x${string}`;
  if (claimVerifier.toLowerCase() !== groth16Address.toLowerCase()) {
    throw new Error(
      `claimVerifier[${claimType}] on-chain is ${claimVerifier}, not the manifest's ` +
        `Groth16VerifierAge ${groth16Address}. Run setClaimVerifier, or fix the manifest.`,
    );
  }
  console.log(
    `on-chain checks: code present, SUPPORTED_SCHEMA_VERSION=${Number(onChainSchema)}, ` +
      `claimVerifier[${claimType}]→${claimVerifier} (matches manifest).`,
  );

  // --- 1. Signed credential ------------------------------------------------------------
  //
  // Bound to the connected wallet: subject MUST equal msg.sender or submitAgeClaim reverts
  // with SubjectIsNotSender, which is what makes a stolen proof useless. credentialId and
  // identitySecret are freshly random each run, so the nullifier is new every time and the
  // success path never collides with a record a previous run left behind.
  heading(1, "signed credential (mock-dev)");
  const currentDate = todayUtcYyyymmdd();
  const credential: NormalizedCredential = {
    schemaVersion: SCHEMA_VERSION,
    credentialId: randomFieldElement(),
    subject: account.address.toLowerCase(),
    dateOfBirth: 20040314, // ~22 on any 2026 date, so "at least 18" is satisfiable
    nationality: 356,
    expiryDate: 20340314,
    issuedAt: currentDate,
    identitySecret: await deriveIdentitySecret({
      issuerSalt: randomIdentitySalt(),
      documentKey: randomFieldElement(),
    }),
  };
  const { privateKey } = await loadMockIssuer();
  const signed = await signCredential(privateKey, credential);
  console.log(`signed a credential for ${credential.subject} (dob ${credential.dateOfBirth}).`);

  const contextId = hashToField(keccak256(stringToBytes("aletheia:m1:e2e")));
  const request = { minimumAge: 18, currentDate, contextId } as const;

  // --- 2. Circuit ----------------------------------------------------------------------
  //
  // The witness step, run on its own: it proves the credential actually satisfies the age
  // constraint system, independently of the proof that comes next. checkWitness fails if
  // the constraints are not met.
  heading(2, "circuit (witness satisfies the constraints)");
  const input = ageClaimInput(signed, request);
  const witness = await calculateWitness(AGE_CLAIM.circuit, input);
  if (!(await checkWitness(AGE_CLAIM.circuit, witness.path))) {
    throw new Error("the witness does not satisfy the age constraint system");
  }
  console.log(`witness computed and checked against ${AGE_CLAIM.circuit}.r1cs.`);

  // --- 3. Proof ------------------------------------------------------------------------
  heading(3, "proof (Groth16 over age.circom)");
  const { proof, publicSignals, decoded } = await proveAgeClaim(signed, request);
  console.log(`proved age >= ${decoded.minimumAge} on ${decoded.currentDate} (context ${contextId}).`);

  // --- 4. Local verify -----------------------------------------------------------------
  //
  // proveAgeClaim already verifies before returning; doing it again as its own named gate
  // is cheap and makes "local verify" a step you can see pass, not an assumption.
  heading(4, "local verify (snarkjs against the verification key)");
  if (!(await verifyAgeClaim(publicSignals, proof))) {
    throw new Error("the proof does not verify locally against the verification key");
  }
  console.log("proof verifies locally.");

  // --- 5. Solidity verify --------------------------------------------------------------
  //
  // The deployed Groth16 verifier is asked directly, by eth_call, before any state
  // change: it must accept the real proof and reject a mutated public signal. The negative
  // half is what makes the positive half mean something — a verifier that returns true for
  // everything would pass the first check and fail the second.
  heading(5, "Solidity verify (deployed Groth16 verifier, eth_call)");
  const calldata = await toSolidityCalldata(proof, publicSignals);
  const signals = calldata.publicSignals as Signals9;

  const accepted = (await publicClient.readContract({
    address: groth16Address,
    abi: groth16Abi,
    functionName: "verifyProof",
    args: [calldata.a, calldata.b, calldata.c, signals],
  })) as boolean;
  if (!accepted) {
    throw new Error("the deployed Groth16 verifier rejected a valid proof");
  }

  // Mutate the minimumAge public signal (index 6). The proof no longer matches its
  // signals, so an honest verifier must return false.
  const mutated = [...signals] as bigint[];
  mutated[6] = mutated[6]! + 1n;
  const rejected = (await publicClient.readContract({
    address: groth16Address,
    abi: groth16Abi,
    functionName: "verifyProof",
    args: [calldata.a, calldata.b, calldata.c, mutated as unknown as Signals9],
  })) as boolean;
  if (rejected) {
    throw new Error("the deployed Groth16 verifier accepted a proof with a mutated signal");
  }
  console.log("deployed verifier accepts the real proof and rejects a mutated signal.");

  // --- 6. Sepolia transaction ----------------------------------------------------------
  //
  // Simulate first, both to read back the verificationId the contract will assign and to
  // fail before spending gas if anything is wrong, then send it for real.
  heading(6, "Sepolia transaction (submitAgeClaim)");
  const args = [calldata.a, calldata.b, calldata.c, signals] as const;
  const { result: expectedId, request: writeRequest } = await publicClient.simulateContract({
    address: verifierAddress,
    abi: verifierAbi as Abi,
    functionName: "submitAgeClaim",
    args,
    account,
  });
  console.log(`verificationId (from simulation): ${expectedId}`);

  const submitHash = await walletClient.writeContract(writeRequest);
  console.log(`submit tx:  ${submitHash}`);
  console.log(`            https://sepolia.etherscan.io/tx/${submitHash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: submitHash });
  if (receipt.status !== "success") {
    throw new Error(`submitAgeClaim reverted on-chain (status ${receipt.status})`);
  }
  const submitBlock = receipt.blockNumber;
  console.log(`mined in block ${submitBlock}, gas used ${receipt.gasUsed}.`);

  // --- 7. Event ------------------------------------------------------------------------
  heading(7, "event (ClaimVerified from the mined receipt)");
  const events = parseEventLogs({
    abi: verifierAbi as Abi,
    logs: receipt.logs,
    eventName: "ClaimVerified",
  });
  const event = events[0];
  if (event === undefined) {
    throw new Error("the transaction was mined but emitted no ClaimVerified event");
  }
  const emitted = event.args as {
    verificationId: `0x${string}`;
    subject: `0x${string}`;
    claimType: number;
    issuerId: `0x${string}`;
    claimParameter: bigint;
    nullifier: `0x${string}`;
    identityNullifier: `0x${string}`;
    verifiedAt: bigint;
  };
  console.log(`  verificationId:    ${emitted.verificationId}`);
  console.log(`  subject:           ${emitted.subject}`);
  console.log(`  issuerId:          ${emitted.issuerId}`);
  console.log(`  claimParameter:    ${emitted.claimParameter} (minimumAge)`);
  console.log(`  nullifier:         ${emitted.nullifier}`);
  console.log(`  identityNullifier: ${emitted.identityNullifier}`);

  // The event must agree with what was proved and simulated, or "success" is hollow.
  if (emitted.verificationId !== expectedId) {
    throw new Error("the emitted verificationId does not match the simulated one");
  }
  if (BigInt(emitted.subject) !== BigInt(account.address)) {
    throw new Error("the emitted subject is not the submitting wallet");
  }
  if (emitted.claimParameter !== BigInt(decoded.minimumAge)) {
    throw new Error("the emitted claimParameter does not match the proven minimumAge");
  }
  if (emitted.issuerId.toLowerCase() !== deployment.mockIssuer.issuerId.toLowerCase()) {
    throw new Error("the emitted issuerId is not the registered mock-dev issuer");
  }
  console.log("event agrees with the proof, the simulation and the mock-dev issuer.");

  // --- 8. Graph ------------------------------------------------------------------------
  //
  // Poll the deployed subgraph through the real query client. Immediately after the submit
  // block is mined the indexer is a block or so behind, so the first reads classify
  // `pending / awaiting-index`; polling continues until the indexer reaches the submit
  // block and the same lookup flips to `verified`. Every read is a real query.
  heading(8, "Graph (subgraph indexes the record: pending → verified)");
  const client = createQueryClient();
  console.log(`endpoint: ${client.endpoint}`);

  let sawPending = false;
  let final: VerificationState | undefined;
  let indexed: Verification | undefined;
  const deadline = Date.now() + POLL_BUDGET_MS;

  while (Date.now() < deadline) {
    const result = await client.verification(emitted.verificationId);
    const state = deriveVerificationState({
      verification: result.data,
      meta: result.meta,
      policy: POLICY,
      nowSeconds: Math.floor(Date.now() / 1000),
      expectedBlock: submitBlock,
    });
    console.log(`  indexer@${result.meta.blockNumber} (submit@${submitBlock}): ${describe(state)}`);

    if (state.status === "pending") sawPending = true;
    if (state.status === "verified") {
      final = state;
      indexed = result.data ?? undefined;
      break;
    }
    if (state.status === "stale" || state.status === "revoked" || state.status === "not-found") {
      // These are terminal-but-wrong here: the record was just made by an active issuer
      // inside the freshness window, so anything other than pending-then-verified is a
      // real defect, not a state to keep polling through.
      final = state;
      indexed = result.data ?? undefined;
      break;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  if (final === undefined) {
    throw new Error(
      `the subgraph did not index the record within ${POLL_BUDGET_MS / 1000}s. The indexer ` +
        "may be lagging; re-run.",
    );
  }
  console.log(
    sawPending
      ? "observed the record pending, then indexed."
      : "the indexer had already caught up by the first poll (pending window missed).",
  );

  // --- 9. Verifier query ---------------------------------------------------------------
  //
  // The read layer's product: the indexed record, classified into one of the five states.
  // It must be `verified`, and it must be the *same* record the chain just emitted — the
  // id, the nullifier and the transaction all cross-checked, so "indexed" cannot mean some
  // other record that happened to be nearby.
  heading(9, "verifier query (the indexed record reads back as verified)");
  if (final.status !== "verified") {
    throw new Error(`the indexed record classified as ${final.status}, expected verified`);
  }
  if (indexed === undefined) {
    throw new Error("verified state carried no record");
  }
  if (indexed.id.toLowerCase() !== emitted.verificationId.toLowerCase()) {
    throw new Error("the indexed record id does not match the on-chain verificationId");
  }
  if (indexed.nullifier.toLowerCase() !== emitted.nullifier.toLowerCase()) {
    throw new Error("the indexed nullifier does not match the on-chain event");
  }
  if (indexed.transactionHash.toLowerCase() !== submitHash.toLowerCase()) {
    throw new Error("the indexed record points at a different transaction");
  }
  if (indexed.issuer.label !== MOCK_ISSUER_LABEL) {
    throw new Error(
      `the indexed record's issuer label is ${JSON.stringify(indexed.issuer.label)}, ` +
        `not the expected ${JSON.stringify(MOCK_ISSUER_LABEL)}`,
    );
  }
  console.log(`state:          ${final.status} (recorded ${final.ageSeconds}s ago)`);
  console.log(`record id:      ${indexed.id}`);
  console.log(`issuer label:   ${indexed.issuer.label} (mock — verifies no identity)`);
  console.log(`transaction:    ${indexed.transactionHash}`);

  // --- Summary -------------------------------------------------------------------------
  console.log("\n=== M1 complete: real proof → real transaction → real indexed record ===");
  console.log(`submit tx:      ${submitHash}`);
  console.log(`                https://sepolia.etherscan.io/tx/${submitHash}`);
  console.log(`verificationId: ${emitted.verificationId}`);
  console.log(`indexed record: ${indexed.id} — verified, issuer ${indexed.issuer.label}`);
}

try {
  await main();
} finally {
  // snarkjs starts worker threads for curve arithmetic; without terminating them the
  // process hangs after the work is done instead of exiting.
  await releaseProver();
}
