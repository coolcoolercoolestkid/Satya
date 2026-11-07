# Toolchain

## Required

| Tool | Version | Why |
|---|---|---|
| Node.js | >= 22.6 | native TypeScript type stripping (`--experimental-strip-types`) is used to run tests without a transpiler |
| pnpm | 11.x | workspace manager |
| circom | **2.2.3** | circuit compiler |
| snarkjs | 0.7.6 | trusted setup, proving, verification, Solidity verifier export |
| Rust / cargo | 1.90+ | only needed to build circom from source |

## circom 2.x is mandatory

The npm package `circom` (last published as `0.5.46`) is the **old JavaScript compiler,
which iden3 has frozen**. It cannot compile `pragma circom 2.x` sources and must not be
used by this project.

If `circom --version` prints anything other than `circom compiler 2.x`, stop and fix the
toolchain before touching `packages/circuits`.

### Install (Windows)

```powershell
Invoke-WebRequest -Uri "https://github.com/iden3/circom/releases/download/v2.2.3/circom-windows-amd64.exe" `
  -OutFile "$env:USERPROFILE\.cargo\bin\circom.exe"
circom --version   # expect: circom compiler 2.2.3
```

`~/.cargo/bin` precedes the npm global directory on PATH, so this shadows any leftover
npm shim. If the deprecated package is still installed, remove it:

```powershell
npm uninstall -g circom
```

### Install (macOS / Linux, from source)

```bash
git clone https://github.com/iden3/circom.git
cd circom && git checkout v2.2.3
cargo build --release
cargo install --path circom
circom --version
```

Prebuilt `circom-linux-amd64` and `circom-macos-amd64` binaries are also attached to the
v2.2.3 release.

## Verification record

Stage 0 gate, verified on this machine:

```
> circom --version
circom compiler 2.2.3

> circom hello.circom --r1cs --wasm --sym --inspect -o .
template instances: 1
non-linear constraints: 1
...
Everything went okay
```

The circuits build script re-checks the compiler version on every run and fails if a
circom 1.x binary is found.
