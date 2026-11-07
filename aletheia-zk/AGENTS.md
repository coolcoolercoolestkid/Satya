# Working agreement

How agents work on Aletheia. This file governs *process*. The engineering rules
themselves live in `.cursor/rules/zk-proof.mdc` and `.cursor/rules/ethereum.mdc`, and
this file does not restate them.

## The three files that track work

| File | Contents |
|---|---|
| `STATUS.md` | Current state of the project: what is complete, what is in progress, what is pending |
| `TODO.md` | Task breakdown per day of development, each task with its exit criteria |
| `myTasks.md` | Work that only the human can do, blocking a task |

Keep them accurate as work lands. A status file that lags the code is worse than no
status file, because it gets believed.

## Continuing work

When asked to continue, read `TODO.md`, take the next task and its exit criteria, and
complete **that task only**. Do not read ahead and start the one after it because it
looks related.

A task is finished when its exit criteria pass, demonstrably — not when the code looks
right. Update `STATUS.md` and tick the task in `TODO.md` before stopping.

## One task per session

Each session covers a single bounded piece of functionality that can be built and tested
in isolation. Not two features because they touch the same file, and not a refactor
bundled with a fix.

If the human starts to deviate mid-session — a new feature, an unrelated bug, a
different layer of the stack — say so and suggest starting a new session. This is an
instruction, not a suggestion to be polite about: context that spans four half-finished
tasks is how the schema v2 migration ended up spanning four packages as one uncommitted
change.

## Verify, never assume

When answering a question or when uncertain, **read the actual code**. Not memory, not
what a document says the code does, not what the code did earlier in the session. Open
the file. The documents in `docs/` have been wrong before — `docs/public-signals.md`
froze a seven-signal layout while the circuit emitted nine.

The same applies to your own output. A large code write is not correct because it was
written carefully. Write tests for anything significant, run them often, and run them
before claiming a task is done.

## Fix on discovery

Something broken is fixed when it is found, not noted for later. There is no legacy code
here and no external consumer, so delete freely, refactor freely, and throw away an
approach that is not working rather than nursing it. A deferred fix in a repository this
young is just a fix that will be made under worse conditions.

## Mocks are labelled, always

`packages/issuer-mock` is the only sanctioned mock in this repository, and it is labelled
`mock-dev` on-chain. Every surface that shows a record derived from it — UI, subgraph,
CLI output, documentation — says so explicitly. Never let a mocked component read as
real, and never describe a Phase 1 credential as a verified identity.

Keep the real on-chain mechanics in front. The contract is the only place a claim becomes
true; the proof, the transaction, the event and the indexed record are the substance.
Where something is simulated, the simulation is stated at the point it appears, not in a
caveat at the bottom of a document.

## When a task needs something only the human can do

API keys, funded testnet accounts, hosted service signups, Etherscan verification
credentials, Subgraph Studio access — anything that cannot be done from the editor. Add
it to `myTasks.md` with enough detail to act on, say which task it blocks, and tell the
human directly rather than leaving it in a file to be discovered.

Do not work around a missing credential with a stub. That produces exactly the fake
artifacts `docs/architecture.md` forbids.

## References

- ENS, for any resolution question: https://docs.ens.domains/llms-full.txt
- Architecture and the staged plan: `docs/architecture.md`
- What is trusted, mocked, and not proven: `docs/trust-model.md`
- Normative public-signal order: `docs/public-signals.md`
