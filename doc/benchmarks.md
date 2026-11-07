# Benchmarks

The performance suite under `packages/core/script/` measures the fork's changed hot paths against a
**rolling baseline** — the last pinned numbers for this machine, not the pre-branch tree. Run it
after every upstream sync absorption, before a release build, and whenever a hot path changes.

## Running

```bash
cd packages/core
bun run script/<benchmark>.ts            # compare against the pinned baseline
bun run script/<benchmark>.ts --rebaseline   # re-pin after an intentional change
```

Every script exits non-zero on failure, so the four can be chained. Run the suite with `SHELL`
unset and through the test wrapper protocol — see `doc/fork-maintenance.md` ("Testing on this
machine").

## The four scripts

| Script | Measures | P0 items |
| --- | --- | --- |
| `benchmark-loop-overhead.ts` | Per-step folds (`SessionRunnerLoop.decide`, `SessionRunnerEmpty.decide`, `SessionRunnerUnfinished.decide`), `loop.callKey`, baseline assembly (`InstructionBudget.fit` with and without trimming), skill rebuilds with conflict bookkeeping, `ToolSchemaCanonical.canonicalize`, `recoverToolName` | L1, L13, L30 |
| `benchmark-schema-determinism.ts` | Byte convergence across seeded reconnect key permutations, idempotency, per-call overhead on a realistic 1.8 KB MCP schema | L30, L17 |
| `benchmark-context-economics.ts` | Billing-correctness invariants of the per-glyph token estimator (pure Han, mixed, ASCII ratios) and tool-output truncation bounds with verdict tails kept | e87b7000, 1457f4fd17 |
| `benchmark-session-stats.ts` | `SessionStats.get` aggregation over 500 sessions with message + title + compaction usage sources: billing exactness and latency | OH-0 |

## Two kinds of checks

- **Invariants** — exact and machine-independent: byte convergence must be total, billing must
  count every source to the token, truncated output must keep the bound and the verdict tail.
  These never touch the baseline file; a failure is a regression, full stop.
- **Baselined latencies** — compared within a per-entry ratio band against
  `packages/core/script/benchmark-baselines.json`. Machine noise dominates sub-10 µs calls and Windows
  filesystems swing widely, so each entry carries its own tolerance (±200% for µs-scale folds,
  ±300% for filesystem-heavy aggregation). A number outside the band means the tree regressed or
  the machine changed — both are worth a look before re-pinning.

## The rebaseline protocol

```bash
bun run script/<benchmark>.ts --rebaseline   # pins today's measured values, stamped with HEAD
```

Re-pin in exactly three situations: after absorbing an upstream sync (the new tree's numbers
become the reference), after landing an intentional trade (say, a cache-busting correctness fix
that costs microseconds), or after the machine itself changed (new hardware, Developer Mode,
different power profile). The pin records the commit, so `benchmark-baselines.json` also reads as
a history of what the suite expected at each point.

Never re-pin to make a failure disappear: diagnose first, and if the change is intentional, say
so in the commit that lands it.

## Decisions

- **Rolling baseline instead of pre-branch A/B.** The suite began as A/B comparisons against dead
  pre-branch paths (the render join, the script-blind estimator). With the upstream 2.2.5 merge
  absorbed, those re-litigate settled decisions every run; the baseline now moves with the tree
  and only guards the current implementation against silent drift.
- **Invariants stay exact.** Convergence, billing and byte bounds are cheap to assert precisely
  and would be meaningless as ratios — folding them into the tolerance file would let a real
  regression hide inside machine noise.
- **Per-entry tolerances live in the JSON.** The right band differs by an order of magnitude
  between a 2 µs fold and a filesystem-heavy aggregation; a single global band is either always
  red or always blind.
- **Pinned numbers are machine-local.** The JSON reflects this workstation (touch-first Windows,
  npmmirror registry); another machine re-pins once and proceeds. CI does not run the suite.
