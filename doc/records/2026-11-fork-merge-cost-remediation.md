# Fork merge-cost remediation (2026-11)

Situation: the 2026-11-06 review flagged five fork risks, P0–P3. The headline one — merge cost from 84 inline
core patches against an upstream landing ~50 commits/day — turned out understated: the drift had been measured
against a stale local mirror, which said 72 commits behind. A direct fetch from GitHub showed **722**, on a merge
base of 2026-10-28 (`fa1260d6ca`). "Sync now while the drift is one day" was already too late; the sync became
the immediate next action, because a further week adds ~400 commits of merge surface.

The plan and the sync policy that came out of this review live in `doc/fork-maintenance.md`; this record keeps
what was decided and executed on 2026-11-07.

## Executed

| Priority | Risk | Action | Commit |
| --- | --- | --- | --- |
| P0 | Merge-cost snowball | Weekly cadence, fresh-mirror measurement rule and runbook; plugin-first rule with a frozen patch-set ceiling → `doc/fork-maintenance.md`. The 722-commit merge itself is the next dedicated session | — |
| P1 | `release-stage/` (1.9 GB), JVM crash logs and `.zcode/` untracked | `.gitignore` gained `/release-stage/`, `/.zcode/`, `hs_err_pid*.log` | e170630cd4 |
| P1 | fork.13 work unit uncommitted | `benefit-oc` regex null guards + browser proxy keep-alive tunnel pooling + version bump, as two adjacent commits | 1921cee324, 3fc75550d9 |
| P2 | 25 analysis docs cluttering the root | Moved to `doc/research/` (19 tracked markdown + 5 tracked HTML reports + 6 local-only notes); `doc/context-economics.md` repointed; `doc-refs` excludes the subtree | 775ba5948a |
| P2 | CRLF phantom diffs on Windows | `.gitattributes` pins `* text=auto eol=lf`; `*.bat`/`*.cmd`/`*.ps1` stay CRLF | c21451a853 |
| P3 | CI noise on the fork | Correction to the review: the six `deploy-*` workflows were already repository-guarded upstream. The real unguarded offenders — four `triage-*` schedules/PR hooks and `release-process-daemon` — got the same job-level guard; `bot-docs-locale` was already `if: false`; `check*.yml` stays runnable on purpose | 2255af0a2d |

## Options actually considered

- **Fix the 246 doc-refs failures inside the research notes.** Rejected: the notes cite other repositories' trees
  and the plan documents name files that intentionally do not exist here; rewriting them would falsify
  point-in-time analyses. The checker guards change knowledge, so `script/doc-refs.ts` skips `doc/research/` and
  `doc/conventions.md` records the boundary.
- **Delete the failing workflow files.** Rejected: upstream edits to them would conflict on every sync; a one-line
  job-level `if:` is trivially mergeable and self-documenting.
- **Move the six local-only notes as if tracked.** They were moved on disk with the `.git/info/exclude` rules
  repointed, keeping them out of every upstream PR exactly as before.
- **One commit for the whole fork.13 unit.** Chosen as two adjacent commits instead, matching the existing
  `chore: bump the fork version to …` history pattern; the unit still lands as one push.

## What would prove this wrong

- If `git diff --name-only upstream/dev...HEAD -- packages/core | wc -l` keeps growing across syncs, the
  plugin-first rule is not being applied and the "frozen" patch set is fiction.
- If a sync is skipped because the mirror again reports small drift, the fresh-mirror step was skipped — that
  step exists precisely to prevent the 722-commit surprise.
- If upstream grows an extension surface covering something currently patched inline and the inline patch
  survives anyway, the patch set is stale in the other direction and should shrink.
