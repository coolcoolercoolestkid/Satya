/**
 * Deployment and proving helpers for the contract tests.
 *
 * Every proof here is generated at test time from a real issuer signature and a real
 * circuit. There are no recorded proofs, no stubbed verifier and no simulated success:
 * if the crypto stops working, these tests stop passing.
 */

import {
  dateToYyyymmdd,
  type NormalizedCredential,
  type SignedCredential,
} from "@aletheia/credential";
import { loadCredentialFixture } from "@aletheia/credential/test-fixture";
import {
  proveAgeClaim,
  proveExpiryClaim,
  proveNationalityClaim,
  toSolidityCalldata,
  type SolidityCalldata,
} from "@aletheia/circuits";
import { generateKeypair, signCredential } from "@aletheia/issuer-mock";
import { network } from "hardhat";

export const MOCK_ISSUER_LABEL = "mock-dev";

export type Deployment = Awaited<ReturnType<typeof deployAletheia>>;

/** Deploy the protocol and wire it up the way a real deployment does. */
export async function deployAletheia() {
  const connection = await network.create();
  const { viem } = connection;
  const publicClient = await viem.getPublicClient();
  const [owner, holder, stranger] = await viem.getWalletClients();
  if (owner === undefined || holder === undefined || stranger === undefined) {
    throw new Error("expected at least three wallet clients");
  }

  const registry = await viem.deployContract("AletheiaIssuerRegistry", [
    owner.account.address,
  ]);
  const groth16 = await viem.deployContract("Groth16VerifierAge");
  const groth16Nationality = await viem.deployContract("Groth16VerifierNationality");
  const groth16Expiry = await viem.deployContract("Groth16VerifierExpiry");
  const verifier = await viem.deployContract("AletheiaVerifier", [
    owner.account.address,
    registry.address,
  ]);
  await verifier.write.setClaimVerifier([1, groth16.address]);
  await verifier.write.setClaimVerifier([2, groth16Nationality.address]);
  await verifier.write.setClaimVerifier([3, groth16Expiry.address]);

  // The issuer key is generated per test run, so nothing here depends on a key that
  // exists in the repository.
  const issuer = await generateKeypair();
  await registry.write.register([
    issuer.publicKey.ax,
    issuer.publicKey.ay,
    MOCK_ISSUER_LABEL,
  ]);

  return {
    connection,
    viem,
    publicClient,
    owner,
    holder,
    stranger,
    registry,
    groth16,
    groth16Nationality,
    groth16Expiry,
    verifier,
    issuer,
  };
}

/** The date the chain currently considers today, read from the contract itself. */
export async function chainToday(deployment: Deployment): Promise<number> {
  return Number(await deployment.verifier.read.today());
}

/** The previous UTC day, derived from the chain's clock rather than the host's. */
export async function chainYesterday(deployment: Deployment): Promise<number> {
  const block = await deployment.publicClient.getBlock();
  return dateToYyyymmdd(new Date((Number(block.timestamp) - 86_400) * 1000));
}

export async function chainDaysAgo(deployment: Deployment, days: number): Promise<number> {
  const block = await deployment.publicClient.getBlock();
  return dateToYyyymmdd(new Date((Number(block.timestamp) - days * 86_400) * 1000));
}

export interface ClaimOptions {
  minimumAge?: number;
  currentDate?: number;
  contextId?: bigint;
  /** Sign with a different issuer key, to model an unregistered issuer. */
  issuerPrivateKey?: Uint8Array;
  /** Override credential fields before signing. */
  credential?: Partial<NormalizedCredential>;
}

export interface AgeClaimBundle {
  signed: SignedCredential;
  calldata: SolidityCalldata;
  /**
   * The fixed-size tuple the generated verifier and AletheiaVerifier expect, in the
   * nine-signal v2 order:
   * `[nullifier, identityNullifier, schemaVersion, issuerAx, issuerAy, currentDate,
   * minimumAge, contextId, subject]`.
   */
  signals: readonly [
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
  ];
  publicSignals: string[];
}

/**
 * Sign a credential for the holder's own address and prove an age claim about it.
 *
 * The subject must be the holder's wallet: it is inside the signed message, inside the
 * nullifier, and compared against `msg.sender` on-chain.
 */
export async function buildAgeClaim(
  deployment: Deployment,
  options: ClaimOptions = {},
): Promise<AgeClaimBundle> {
  const { credential } = loadCredentialFixture();
  const signed = await signCredential(options.issuerPrivateKey ?? deployment.issuer.privateKey, {
    ...credential,
    subject: deployment.holder.account.address.toLowerCase(),
    ...options.credential,
  });

  const proved = await proveAgeClaim(signed, {
    minimumAge: options.minimumAge ?? 18,
    currentDate: options.currentDate ?? (await chainToday(deployment)),
    contextId: options.contextId ?? loadCredentialFixture().expected.contextId,
  });
  const calldata = await toSolidityCalldata(proved.proof, proved.publicSignals);

  return {
    signed,
    calldata,
    signals: calldata.publicSignals as unknown as AgeClaimBundle["signals"],
    publicSignals: proved.publicSignals,
  };
}

/** Submit a claim as the holder. Returns the transaction hash. */
export async function submitAsHolder(
  deployment: Deployment,
  bundle: AgeClaimBundle,
): Promise<`0x${string}`> {
  return deployment.verifier.write.submitAgeClaim(
    [bundle.calldata.a, bundle.calldata.b, bundle.calldata.c, bundle.signals],
    { account: deployment.holder.account },
  );
}

export interface NationalityClaimOptions {
  /** The nationality the verifier asks about; defaults to the fixture's (India, 356). */
  requiredNationality?: number;
  currentDate?: number;
  contextId?: bigint;
  /** Sign with a different issuer key, to model an unregistered issuer. */
  issuerPrivateKey?: Uint8Array;
  /** Override credential fields before signing. */
  credential?: Partial<NormalizedCredential>;
}

/**
 * A nationality claim bundle. The signals tuple is the same nine-signal v2 order as age's,
 * with `requiredNationality` in the generic parameter slot (index 6).
 */
export interface NationalityClaimBundle {
  signed: SignedCredential;
  calldata: SolidityCalldata;
  signals: AgeClaimBundle["signals"];
  publicSignals: string[];
}

/**
 * Sign a credential for the holder's own address and prove a nationality claim about it.
 *
 * The requested nationality defaults to the fixture credential's, so the equality in the
 * circuit holds; passing a different `requiredNationality` models the wrong-nationality
 * negative case (an unsatisfiable witness, so no proof can be built).
 */
export async function buildNationalityClaim(
  deployment: Deployment,
  options: NationalityClaimOptions = {},
): Promise<NationalityClaimBundle> {
  const { credential } = loadCredentialFixture();
  const signed = await signCredential(options.issuerPrivateKey ?? deployment.issuer.privateKey, {
    ...credential,
    subject: deployment.holder.account.address.toLowerCase(),
    ...options.credential,
  });

  const proved = await proveNationalityClaim(signed, {
    requiredNationality: options.requiredNationality ?? signed.credential.nationality,
    currentDate: options.currentDate ?? (await chainToday(deployment)),
    contextId: options.contextId ?? loadCredentialFixture().expected.contextId,
  });
  const calldata = await toSolidityCalldata(proved.proof, proved.publicSignals);

  return {
    signed,
    calldata,
    signals: calldata.publicSignals as unknown as AgeClaimBundle["signals"],
    publicSignals: proved.publicSignals,
  };
}

/** Submit a nationality claim as the holder. Returns the transaction hash. */
export async function submitNationalityAsHolder(
  deployment: Deployment,
  bundle: NationalityClaimBundle,
): Promise<`0x${string}`> {
  return deployment.verifier.write.submitNationalityClaim(
    [bundle.calldata.a, bundle.calldata.b, bundle.calldata.c, bundle.signals],
    { account: deployment.holder.account },
  );
}

export interface ExpiryClaimOptions {
  currentDate?: number;
  contextId?: bigint;
  /** Sign with a different issuer key, to model an unregistered issuer. */
  issuerPrivateKey?: Uint8Array;
  /** Override credential fields before signing — e.g. `expiryDate` for the boundary case. */
  credential?: Partial<NormalizedCredential>;
}

/**
 * An expiry claim bundle. The signals tuple is the same nine-signal v2 order as age's, with
 * the generic parameter slot (index 6, `expiryParameter`) pinned to zero by the circuit.
 */
export interface ExpiryClaimBundle {
  signed: SignedCredential;
  calldata: SolidityCalldata;
  signals: AgeClaimBundle["signals"];
  publicSignals: string[];
}

/**
 * Sign a credential for the holder's own address and prove an expiry claim about it.
 *
 * The claim asserts the credential is unexpired as of `currentDate`, which defaults to the
 * chain's today. The fixture credential expires in 2034, so the default case proves cleanly;
 * pass `credential: { expiryDate }` to drive the boundary (`expiryDate == currentDate`) and
 * the expired negative (an unsatisfiable witness, so no proof can be built).
 */
export async function buildExpiryClaim(
  deployment: Deployment,
  options: ExpiryClaimOptions = {},
): Promise<ExpiryClaimBundle> {
  const { credential } = loadCredentialFixture();
  const signed = await signCredential(options.issuerPrivateKey ?? deployment.issuer.privateKey, {
    ...credential,
    subject: deployment.holder.account.address.toLowerCase(),
    ...options.credential,
  });

  const proved = await proveExpiryClaim(signed, {
    currentDate: options.currentDate ?? (await chainToday(deployment)),
    contextId: options.contextId ?? loadCredentialFixture().expected.contextId,
  });
  const calldata = await toSolidityCalldata(proved.proof, proved.publicSignals);

  return {
    signed,
    calldata,
    signals: calldata.publicSignals as unknown as AgeClaimBundle["signals"],
    publicSignals: proved.publicSignals,
  };
}

/** Submit an expiry claim as the holder. Returns the transaction hash. */
export async function submitExpiryAsHolder(
  deployment: Deployment,
  bundle: ExpiryClaimBundle,
): Promise<`0x${string}`> {
  return deployment.verifier.write.submitExpiryClaim(
    [bundle.calldata.a, bundle.calldata.b, bundle.calldata.c, bundle.signals],
    { account: deployment.holder.account },
  );
}
