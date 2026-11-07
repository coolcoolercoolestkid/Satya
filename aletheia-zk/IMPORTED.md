# Prior work: imported, not built at ETHGlobal Mumbai

Everything in this folder **as first committed** was built **before** ETHGlobal Mumbai, by the
same author (Ishita Bhardwaj), between **8 and 12 September 2026**:

- Source: https://github.com/Ishitalisa/Aletheia, branch `feature/project-foundation`
- Commit: `06f8f02954b2241fbebf39bf33e43ed6901da5bb` (12 Sep 2026), 47 commits of history there
- Imported unchanged (minus `.git`) in a single commit so the original can be compared byte for
  byte.

What it is: Aletheia, a zero-knowledge credential protocol. A browser app reads a passport's
MRZ on the device, a mock issuer signs a credential, Groth16 circuits prove age / nationality /
"not expired" claims, and Sepolia contracts verify them. The original read path indexed the
contracts' events with **The Graph** (`packages/subgraph`, `packages/query`).

## What was done at ETHGlobal Mumbai (6–7 Nov 2026)

Only the commits after the import commit. In short: **The Graph is replaced by Arkiv.**
An Arkiv mirror copies the contracts' events from Sepolia into Arkiv, and the web app's
"verify someone" flow reads them from Arkiv instead of a subgraph. See `git log -- aletheia-zk`
for the exact changes.
