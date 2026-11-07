import { buildEddsa, type Eddsa } from "circomlibjs";

let instance: Promise<Eddsa> | undefined;

/**
 * The EdDSA instance, built once per process.
 *
 * `buildEddsa` compiles the BabyJubjub field machinery and takes seconds, so every
 * caller shares one instance rather than rebuilding it per signature.
 */
export async function eddsa(): Promise<Eddsa> {
  instance ??= buildEddsa();
  return instance;
}
