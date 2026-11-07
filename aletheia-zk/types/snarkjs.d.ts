/**
 * Minimal ambient types for `snarkjs@0.7.6`, which ships none.
 *
 * Only the surface Aletheia uses is declared. Extend it as later stages need more
 * (trusted setup, proving, verification, Solidity verifier export).
 */
declare module "snarkjs" {
  export type CircuitInput = Record<string, string | number | bigint>;

  export interface Logger {
    debug?(message: string): void;
    info?(message: string): void;
    warn?(message: string): void;
    error?(message: string): void;
  }

  export namespace wtns {
    /** Compute a witness from an input object and a compiled circuit wasm. */
    function calculate(
      input: CircuitInput,
      wasmFileName: string,
      wtnsFileName: string,
    ): Promise<void>;

    /** Verify that a witness satisfies every constraint in the r1cs. */
    function check(
      r1csFileName: string,
      wtnsFileName: string,
      logger?: Logger,
    ): Promise<boolean>;

    /** Witness values in circuit order: [1, ...outputs, ...publicInputs, ...rest]. */
    function exportJson(wtnsFileName: string): Promise<bigint[]>;
  }

  export namespace r1cs {
    function info(r1csFileName: string, logger?: Logger): Promise<unknown>;
  }

  export interface Curve {
    name: string;
    terminate(): Promise<void>;
  }

  export namespace curves {
    function getCurveFromName(name: string): Promise<Curve>;
  }

  /** Phase 1. Only used when the published ceremony file cannot be obtained. */
  export namespace powersOfTau {
    function newAccumulator(
      curve: Curve,
      power: number,
      fileName: string,
      logger?: Logger,
    ): Promise<unknown>;

    function contribute(
      oldPtauFilename: string,
      newPTauFilename: string,
      name: string,
      entropy: string,
      logger?: Logger,
    ): Promise<unknown>;

    function beacon(
      oldPtauFilename: string,
      newPTauFilename: string,
      name: string,
      beaconHashStr: string,
      numIterationsExp: number,
      logger?: Logger,
    ): Promise<unknown>;

    function preparePhase2(
      oldPtauFilename: string,
      newPTauFilename: string,
      logger?: Logger,
    ): Promise<unknown>;

    function verify(tauFilename: string, logger?: Logger): Promise<boolean>;
  }

  export namespace zKey {
    /** Phase-2 initialisation from a constraint system and a phase-1 ceremony file. */
    function newZKey(
      r1csName: string,
      ptauName: string,
      zkeyName: string,
      logger?: Logger,
    ): Promise<void>;

    function contribute(
      zkeyNameOld: string,
      zkeyNameNew: string,
      name: string,
      entropy: string,
      logger?: Logger,
    ): Promise<unknown>;

    function beacon(
      zkeyNameOld: string,
      zkeyNameNew: string,
      name: string,
      beaconHashStr: string,
      numIterationsExp: number,
      logger?: Logger,
    ): Promise<unknown>;

    /** True when the proving key really was derived from this r1cs and ptau. */
    function verifyFromR1cs(
      r1csFileName: string,
      pTauFileName: string,
      zkeyFileName: string,
      logger?: Logger,
    ): Promise<boolean>;

    function exportVerificationKey(zkeyName: string, logger?: Logger): Promise<unknown>;

    function exportSolidityVerifier(
      zKeyName: string,
      templates: Record<string, string>,
      logger?: Logger,
    ): Promise<string>;
  }

  export namespace groth16 {
    function prove(
      zkeyFileName: string,
      witnessFileName: string,
      logger?: Logger,
    ): Promise<{ proof: unknown; publicSignals: string[] }>;

    function fullProve(
      input: CircuitInput,
      wasmFile: string,
      zkeyFileName: string,
      logger?: Logger,
    ): Promise<{ proof: unknown; publicSignals: string[] }>;

    function verify(
      vkVerifier: unknown,
      publicSignals: readonly string[],
      proof: unknown,
      logger?: Logger,
    ): Promise<boolean>;

    /** Proof and signals rendered as Solidity call arguments, comma separated. */
    function exportSolidityCallData(
      proof: unknown,
      publicSignals: readonly string[],
    ): Promise<string>;
  }
}
