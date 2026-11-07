/**
 * Multi-claim end-to-end runner (TODO.md, day 27; Stage 19).
 *
 * M1 (`m1.ts`) proved one claim — age — all the way through. This proves that the three
 * claim types compose: one holder, one credential, one verification context, three
 * different questions answered about it. The run signs a single credential once, fixes a
 * single `contextId`, and then drives age, nationality and expiry each through the whole
 * pipeline — real proof, deployed-verifier eth_call, real Sepolia transaction, real indexed
 * record — against that one credential.
 *
 * The point is a property, not just three green runs. Two nullifiers come out of every
 * proof:
 *
 *   - `nullifier        = Poseidon([credentialId, claimTypeId, contextId, subject])`
 *     — bound to the claim type, so the three claims produce three *distinct* nullifiers and
 *     one claim can never be replayed as another.
 *   - `identityNullifier = Poseidon([identitySecret, contextId])`
 *     — bound to neither the claim type nor the wallet, so within one context it is *one
 *     value* for this holder across all three claims. That is the whole reason it exists:
 *     a verifier can tell "these three proofs are the same person" without learning who.
 *
 * So the exit criteria (day 27) are exactly: three real transactions, three real records,
 * three distinct `nullifier`s, and the `identityNullifier` identical across all three. This
 * runner asserts all four, on the on-chain events and again on the indexed subgraph records,
 * and fails loudly if any of them does not hold. Nothing here is stubbed: same real
 * infrastructure as M1, three times over.
 *
 * Prerequisites are M1's (built packages, compiled contracts, the registered `mock-dev`
 * keystore, and the root `.env` with SEPOLIA_RPC_URL, SEPOLIA_PRIVATE_KEY and
 * GRAPH_QUERY_URL), plus a little more faucet ETH: three submits instead of one, still well
 * under a cent.
 *
 * Run it:
 *   pnpm --filter @aletheia/scripts run multi-claim
 */

import { readFileSync } from "node:fs";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";

import {
  ageClaimInput,
  calculateWitness,
  checkWitness,
  nationalityClaimInput,
  expiryClaimInput,
  proveAgeClaim,
  proveNationalityClaim,
  proveExpiryClaim,
  releaseProver,
  toSolidityCalldata,
  verifyAgeClaim,
  verifyNationalityClaim,
  verifyExpiryClaim,
  AGE_CLAIM,
  NATIONALITY_CLAIM,
  EXPIRY_CLAIM,
  type CircuitInput,
  type ProofResult,
} from "@aletheia/circuits";
import {
  CLAIM_TYPE,
  SCHEMA_VERSION,
  hashToField,
  randomFieldElement,
  todayUtcYyyymmdd,
  type NormalizedCredential,
  type SignedCredential,
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

import { loadArtifactAbi, loadDeployment, loadEnv, sepoliaClients } from "./env.ts";

/** A generous freshness window, so a freshly indexed record reads `verified`, not `stale`. */
const POLICY: FreshnessPolicy = { maxVerificationAgeSeconds: 30 * 24 * 60 * 60 };
/** How long to poll the subgraph for a record to index before giving up. */
const POLL_BUDGET_MS = 4 * 60 * 1000;
/** Gap between polls: short enough to catch the pending window, not a busy loop. */
const POLL_INTERVAL_MS = 1500;

/** The nine-element public-signal tuple the ABI encoder and typechecker want. */
type Signals9 = readonly [
  bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
];

/** What the ClaimVerified event carries, the same shape every claim type emits. */
interface ClaimVerifiedArgs {
  verificationId: `0x${string}`;
  subject: `0x${string}`;
  claimType: number;
  issuerId: `0x${string}`;
  claimParameter: bigint;
  nullifier: `0x${string}`;
  identityNullifier: `0x${string}`;
  verifiedAt: bigint;
}

/**
 * One claim type's everything-that-differs, so the pipeline below can be written once.
 *
 * Age, nationality and expiry share the whole flow; they differ only in which circuit
 * proves them, which deployed Groth16 verifier decides them, which entrypoint records them,
 * and what the generic parameter slot means. Everything else — the sender binding, the
 * schema pin, the event shape — is identical, which is the thing this run is demonstrating.
 */
interface ClaimSpec {
  name: string;
  claimType: number;
  /** The compiled Groth16 verifier for this claim: artifact dir and contract name. */
  groth16SolDir: string;
  groth16Name: string;
  groth16Address: `0x${string}`;
  /** The AletheiaVerifier entrypoint that records this claim type. */
  submitFn: "submitAgeClaim" | "submitNationalityClaim" | "submitExpiryClaim";
  /** The value the generic parameter slot (index 6) must carry for this claim. */
  expectedParameter: bigint;
  /** The witness input builder, run as its own gate before the proof. */
  input: CircuitInput;
  /** The circuit name, for the witness check against the right r1cs. */
  circuit: string;
  /** Prove this claim; the returned proof is already locally verified by the prover. */
  prove: () => Promise<ProofResult>;
  /** Verify a proof locally against this claim's verification key. */
  verifyLocal: (publicSignals: readonly string[], proof: ProofResult["proof"]) => Promise<boolean>;
}

/** The result of driving one claim all the way to an indexed record. */
interface ClaimOutcome {
  spec: ClaimSpec;
  event: ClaimVerifiedArgs;
  txHash: `0x${string}`;
  submitBlock: bigint;
  /** Filled in once the subgraph indexes it. */
  indexed?: Verification;
  state?: VerificationState;
  sawPending?: boolean;
}

function heading(title: string): void {
  console.log(`\n--- ${title} ---`);
}

function describe(state: VerificationState): string {
  return state.status === "pending"
    ? `${state.status.toUpperCase()} (${state.cause}) — ${state.reason}`
    : `${state.status.toUpperCase()} — ${state.reason}`;
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
        "issuer, before running this.",
    );
  }
  if (file.label !== MOCK_ISSUER_LABEL) {
    throw new Error(
      `refusing to sign with a keystore labelled "${file.label}", not "${MOCK_ISSUER_LABEL}". ` +
        "This runner only ever exercises the local mock issuer.",
    );
  }
  return parseKeystore(file);
}

async function main(): Promise<void> {
  console.error(
    "!! mock issuer: the credential signed below verifies no identity. This run proves the " +
      "on-chain pipeline composes across three claim types, not that anyone is who they say " +
      "they are. !!",
  );

  loadEnv();
  const deployment = loadDeployment();
  const { publicClient, walletClient, account } = sepoliaClients();

  const verifierAddress = deployment.contracts.AletheiaVerifier.address;
  const verifierAbi = loadArtifactAbi("AletheiaVerifier.sol", "AletheiaVerifier");

  console.log(`network:        sepolia (chain id ${deployment.chainId})`);
  console.log(`verifier:       ${verifierAddress}`);
  console.log(`subject/signer: ${account.address}`);

  // --- Cross-check the manifest against the live chain, before spending anything --------
  //
  // The manifest is committed data; the chain is the authority. If they disagree, the
  // deployment moved and the manifest is stale — fail here rather than sending a
  // transaction into the wrong contract. Every one of the three claim verifiers is checked,
  // because this run uses all three.
  heading("pre-flight (manifest vs. live chain)");
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
  console.log(
    `code present, SUPPORTED_SCHEMA_VERSION=${Number(onChainSchema)} (matches build).`,
  );

  // --- 1. One signed credential, one context -------------------------------------------
  //
  // Everything that makes the identityNullifier shared lives here: the credential is signed
  // exactly once, the identitySecret and credentialId are one value each, the subject is the
  // one wallet, and the contextId is fixed. The three claims below all read from this. Were
  // any of these re-randomised per claim, the identityNullifier would differ and the run
  // would fail its own headline assertion — which is the point of deriving them once.
  heading("1. one signed credential, one context (mock-dev)");
  const currentDate = todayUtcYyyymmdd();
  const requiredNationality = 356; // the credential's nationality; the claim asks for this exact value
  const credential: NormalizedCredential = {
    schemaVersion: SCHEMA_VERSION,
    credentialId: randomFieldElement(),
    subject: account.address.toLowerCase(),
    dateOfBirth: 20040314, // ~22 on any 2026 date, so "at least 18" is satisfiable
    nationality: requiredNationality,
    expiryDate: 20340314, // well in the future, so every claim's inherited expiry check holds
    issuedAt: currentDate,
    identitySecret: await deriveIdentitySecret({
      issuerSalt: randomIdentitySalt(),
      documentKey: randomFieldElement(),
    }),
  };
  const { privateKey } = await loadMockIssuer();
  const signed: SignedCredential = await signCredential(privateKey, credential);
  const contextId = hashToField(keccak256(stringToBytes("aletheia:multi-claim:e2e")));
  console.log(`signed a credential for ${credential.subject} (dob ${credential.dateOfBirth}, `);
  console.log(`  nationality ${credential.nationality}, expiry ${credential.expiryDate}).`);
  console.log(`context:        ${contextId}`);

  // --- The three claims, each reading the one credential and the one context -----------
  const ageRequest = { minimumAge: 18, currentDate, contextId } as const;
  const nationalityRequest = { requiredNationality, currentDate, contextId } as const;
  const expiryRequest = { currentDate, contextId } as const;

  const specs: ClaimSpec[] = [
    {
      name: "age",
      claimType: CLAIM_TYPE.AGE,
      groth16SolDir: "verifiers/Groth16VerifierAge.sol",
      groth16Name: "Groth16VerifierAge",
      groth16Address: deployment.contracts.Groth16VerifierAge.address,
      submitFn: "submitAgeClaim",
      expectedParameter: BigInt(ageRequest.minimumAge),
      input: ageClaimInput(signed, ageRequest),
      circuit: AGE_CLAIM.circuit,
      prove: () => proveAgeClaim(signed, ageRequest),
      verifyLocal: verifyAgeClaim,
    },
    {
      name: "nationality",
      claimType: CLAIM_TYPE.NATIONALITY,
      groth16SolDir: "verifiers/Groth16VerifierNationality.sol",
      groth16Name: "Groth16VerifierNationality",
      groth16Address: deployment.contracts.Groth16VerifierNationality.address,
      submitFn: "submitNationalityClaim",
      expectedParameter: BigInt(nationalityRequest.requiredNationality),
      input: nationalityClaimInput(signed, nationalityRequest),
      circuit: NATIONALITY_CLAIM.circuit,
      prove: () => proveNationalityClaim(signed, nationalityRequest),
      verifyLocal: verifyNationalityClaim,
    },
    {
      name: "expiry",
      claimType: CLAIM_TYPE.EXPIRY,
      groth16SolDir: "verifiers/Groth16VerifierExpiry.sol",
      groth16Name: "Groth16VerifierExpiry",
      groth16Address: deployment.contracts.Groth16VerifierExpiry.address,
      submitFn: "submitExpiryClaim",
      expectedParameter: 0n, // the circuit pins the parameter slot to zero
      input: expiryClaimInput(signed, expiryRequest),
      circuit: EXPIRY_CLAIM.circuit,
      prove: () => proveExpiryClaim(signed, expiryRequest),
      verifyLocal: verifyExpiryClaim,
    },
  ];

  // The on-chain verifier wiring for all three claim types must match the manifest, checked
  // together so a half-rewired deployment fails before any proving work.
  for (const spec of specs) {
    const wired = (await publicClient.readContract({
      address: verifierAddress,
      abi: verifierAbi,
      functionName: "claimVerifier",
      args: [spec.claimType],
    })) as `0x${string}`;
    if (wired.toLowerCase() !== spec.groth16Address.toLowerCase()) {
      throw new Error(
        `claimVerifier[${spec.claimType}] (${spec.name}) on-chain is ${wired}, not the ` +
          `manifest's ${spec.groth16Name} ${spec.groth16Address}. Fix the wiring or the manifest.`,
      );
    }
  }
  console.log(
    "claimVerifier[1..3] all match the manifest (age, nationality, expiry wired).",
  );

  // --- 2–7. Each claim: prove → local verify → deployed verify → submit → event --------
  const outcomes: ClaimOutcome[] = [];

  for (const spec of specs) {
    heading(`${spec.name} claim (type ${spec.claimType})`);
    const groth16Abi = loadArtifactAbi(spec.groth16SolDir, spec.groth16Name);

    // Witness on its own: proves the credential satisfies this claim's constraint system,
    // independently of the proof. checkWitness fails if the constraints are not met.
    const witness = await calculateWitness(spec.circuit, spec.input);
    if (!(await checkWitness(spec.circuit, witness.path))) {
      throw new Error(`the witness does not satisfy the ${spec.name} constraint system`);
    }

    // Proof, then a second local verify as its own visible gate.
    const { proof, publicSignals } = await spec.prove();
    if (!(await spec.verifyLocal(publicSignals, proof))) {
      throw new Error(`the ${spec.name} proof does not verify locally`);
    }

    // The deployed Groth16 verifier, by eth_call, before any state change: it must accept
    // the real proof and reject a mutated public signal. The negative half is what makes
    // the positive half mean something.
    const calldata = await toSolidityCalldata(proof, publicSignals);
    const signals = calldata.publicSignals as Signals9;
    const accepted = (await publicClient.readContract({
      address: spec.groth16Address,
      abi: groth16Abi,
      functionName: "verifyProof",
      args: [calldata.a, calldata.b, calldata.c, signals],
    })) as boolean;
    if (!accepted) {
      throw new Error(`the deployed ${spec.groth16Name} rejected a valid ${spec.name} proof`);
    }
    // Mutate currentDate (index 5): a public input every claim commits to, so an honest
    // verifier must return false regardless of what the parameter slot means for this claim.
    const mutated = [...signals] as bigint[];
    mutated[5] = mutated[5]! + 1n;
    const rejected = (await publicClient.readContract({
      address: spec.groth16Address,
      abi: groth16Abi,
      functionName: "verifyProof",
      args: [calldata.a, calldata.b, calldata.c, mutated as unknown as Signals9],
    })) as boolean;
    if (rejected) {
      throw new Error(
        `the deployed ${spec.groth16Name} accepted a ${spec.name} proof with a mutated signal`,
      );
    }
    console.log(`proved, verified locally and on the deployed ${spec.groth16Name} (accepts, rejects mutation).`);

    // Simulate first, both to read back the verificationId and to fail before gas if
    // anything is wrong, then send it for real.
    const args = [calldata.a, calldata.b, calldata.c, signals] as const;
    const { result: expectedId, request: writeRequest } = await publicClient.simulateContract({
      address: verifierAddress,
      abi: verifierAbi as Abi,
      functionName: spec.submitFn,
      args,
      account,
    });
    const txHash = await walletClient.writeContract(writeRequest);
    console.log(`${spec.submitFn}: ${txHash}`);
    console.log(`  https://sepolia.etherscan.io/tx/${txHash}`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new Error(`${spec.submitFn} reverted on-chain (status ${receipt.status})`);
    }
    const submitBlock = receipt.blockNumber;

    const events = parseEventLogs({
      abi: verifierAbi as Abi,
      logs: receipt.logs,
      eventName: "ClaimVerified",
    });
    const event = events[0]?.args as ClaimVerifiedArgs | undefined;
    if (event === undefined) {
      throw new Error(`${spec.name}: the transaction was mined but emitted no ClaimVerified event`);
    }

    // The event must agree with what was proved and simulated, per claim, or a later
    // cross-claim assertion would be comparing garbage.
    if (event.verificationId !== expectedId) {
      throw new Error(`${spec.name}: emitted verificationId does not match the simulated one`);
    }
    if (event.claimType !== spec.claimType) {
      throw new Error(`${spec.name}: emitted claimType ${event.claimType} is not ${spec.claimType}`);
    }
    if (BigInt(event.subject) !== BigInt(account.address)) {
      throw new Error(`${spec.name}: emitted subject is not the submitting wallet`);
    }
    if (event.claimParameter !== spec.expectedParameter) {
      throw new Error(
        `${spec.name}: emitted claimParameter ${event.claimParameter} is not ${spec.expectedParameter}`,
      );
    }
    if (event.issuerId.toLowerCase() !== deployment.mockIssuer.issuerId.toLowerCase()) {
      throw new Error(`${spec.name}: emitted issuerId is not the registered mock-dev issuer`);
    }
    console.log(`  mined in block ${submitBlock}, gas ${receipt.gasUsed}.`);
    console.log(`  nullifier:         ${event.nullifier}`);
    console.log(`  identityNullifier: ${event.identityNullifier}`);

    outcomes.push({ spec, event, txHash, submitBlock });
  }

  // --- 8. The property: three distinct nullifiers, one shared identityNullifier --------
  //
  // This is why the run exists. It holds on the on-chain events first — the authority —
  // and is re-checked on the indexed records below.
  heading("8. cross-claim property (on-chain events)");
  const nullifiers = outcomes.map((o) => o.event.nullifier.toLowerCase());
  const distinct = new Set(nullifiers);
  if (distinct.size !== outcomes.length) {
    throw new Error(
      `expected ${outcomes.length} distinct nullifiers, got ${distinct.size}: ${nullifiers.join(", ")}`,
    );
  }
  const identityNullifiers = outcomes.map((o) => o.event.identityNullifier.toLowerCase());
  const sharedIdentity = identityNullifiers[0]!;
  if (!identityNullifiers.every((n) => n === sharedIdentity)) {
    throw new Error(
      `the identityNullifier is not identical across the three claims: ${identityNullifiers.join(", ")}`,
    );
  }
  console.log(`${outcomes.length} distinct nullifiers (one per claim type):`);
  for (const o of outcomes) console.log(`  ${o.spec.name.padEnd(12)} ${o.event.nullifier}`);
  console.log(`one shared identityNullifier across all three:`);
  console.log(`  ${sharedIdentity}`);

  // --- 9. Three real records, read back from the deployed subgraph ---------------------
  //
  // Each verificationId is polled through the real query client until it classifies
  // `verified`, exactly as M1 does, and then cross-checked against its on-chain event so
  // "indexed" cannot mean some other nearby record.
  heading("9. Graph (three records index: pending → verified)");
  const client = createQueryClient();
  console.log(`endpoint: ${client.endpoint}`);

  for (const outcome of outcomes) {
    const deadline = Date.now() + POLL_BUDGET_MS;
    let sawPending = false;
    let final: VerificationState | undefined;
    let indexed: Verification | undefined;

    while (Date.now() < deadline) {
      const result = await client.verification(outcome.event.verificationId);
      const state = deriveVerificationState({
        verification: result.data,
        meta: result.meta,
        policy: POLICY,
        nowSeconds: Math.floor(Date.now() / 1000),
        expectedBlock: outcome.submitBlock,
      });
      if (state.status === "pending") {
        sawPending = true;
      } else if (
        state.status === "verified" ||
        state.status === "stale" ||
        state.status === "revoked" ||
        state.status === "not-found"
      ) {
        // `verified` is the success terminal; the other three are terminal-but-wrong here,
        // because the record was just made by an active issuer inside the freshness window.
        final = state;
        indexed = result.data ?? undefined;
        break;
      }
      await sleep(POLL_INTERVAL_MS);
    }

    if (final === undefined) {
      throw new Error(
        `${outcome.spec.name}: the subgraph did not index the record within ` +
          `${POLL_BUDGET_MS / 1000}s. The indexer may be lagging; re-run.`,
      );
    }
    if (final.status !== "verified") {
      throw new Error(
        `${outcome.spec.name}: the indexed record classified as ${final.status}, expected verified`,
      );
    }
    if (indexed === undefined) {
      throw new Error(`${outcome.spec.name}: verified state carried no record`);
    }
    // The indexed record must be the same record the chain emitted.
    if (indexed.id.toLowerCase() !== outcome.event.verificationId.toLowerCase()) {
      throw new Error(`${outcome.spec.name}: indexed id does not match the on-chain verificationId`);
    }
    if (indexed.claimType !== outcome.spec.claimType) {
      throw new Error(
        `${outcome.spec.name}: indexed claimType ${indexed.claimType} is not ${outcome.spec.claimType}`,
      );
    }
    if (indexed.nullifier.toLowerCase() !== outcome.event.nullifier.toLowerCase()) {
      throw new Error(`${outcome.spec.name}: indexed nullifier does not match the on-chain event`);
    }
    if (indexed.identityNullifier.toLowerCase() !== outcome.event.identityNullifier.toLowerCase()) {
      throw new Error(`${outcome.spec.name}: indexed identityNullifier does not match the event`);
    }
    if (indexed.transactionHash.toLowerCase() !== outcome.txHash.toLowerCase()) {
      throw new Error(`${outcome.spec.name}: indexed record points at a different transaction`);
    }
    if (indexed.issuer.label !== MOCK_ISSUER_LABEL) {
      throw new Error(
        `${outcome.spec.name}: indexed issuer label is ${JSON.stringify(indexed.issuer.label)}, ` +
          `not ${JSON.stringify(MOCK_ISSUER_LABEL)}`,
      );
    }
    outcome.indexed = indexed;
    outcome.state = final;
    outcome.sawPending = sawPending;
    console.log(
      `  ${outcome.spec.name.padEnd(12)} ${describe(final)}` +
        (sawPending ? " (observed pending first)" : " (indexer already caught up)"),
    );
  }

  // Re-assert the property on the indexed records, not just the events: the read layer the
  // product actually uses must show the same three distinct nullifiers and one identity.
  const indexedNullifiers = outcomes.map((o) => o.indexed!.nullifier.toLowerCase());
  if (new Set(indexedNullifiers).size !== outcomes.length) {
    throw new Error("the indexed records do not carry three distinct nullifiers");
  }
  const indexedIdentity = outcomes.map((o) => o.indexed!.identityNullifier.toLowerCase());
  if (!indexedIdentity.every((n) => n === indexedIdentity[0])) {
    throw new Error("the indexed records do not share one identityNullifier");
  }

  // --- Summary -------------------------------------------------------------------------
  console.log("\n=== multi-claim complete: three real proofs → three transactions → three indexed records ===");
  for (const o of outcomes) {
    console.log(
      `  ${o.spec.name.padEnd(12)} type ${o.spec.claimType}  block ${o.submitBlock}  ${o.txHash}`,
    );
  }
  console.log(`distinct nullifiers:       ${new Set(indexedNullifiers).size} of ${outcomes.length}`);
  console.log(`shared identityNullifier:  ${indexedIdentity[0]}`);
  console.log("the identityNullifier is one value for this holder in this context, across all three claims.");
}

try {
  await main();
} finally {
  // snarkjs starts worker threads for curve arithmetic; without terminating them the
  // process hangs after the work is done instead of exiting.
  await releaseProver();
}
