# Fork maintenance

How this fork stays mergeable with upstream (`anomalyco/opencode`, branch `dev`). `origin` is the fork
(`ily55421/opencode`); `upstream` is the local mirror at `D:/code/origin/opencode`, whose own origin points at
anomalyco/opencode.

## Upstream sync cadence

Sync once a week, and measure drift against a freshly refreshed mirror before deciding anything. Upstream lands
roughly 50–80 commits a day, nearly all of it in `packages/core` and `packages/app` — exactly where this fork
carries its inline patches (84 core files, 74 app files as of 2026-11). Every week of delay adds ~400 commits of
merge surface.

Runbook (clean tree, the fork's `dev` checked out):

1. Refresh the mirror first: `git -C D:/code/origin/opencode fetch origin`, then `git fetch upstream`. A stale
   mirror lies: on 2026-11-06 it read 72 commits behind while the true drift was 722, because the mirror itself
   had not been fetched for over a week. When in doubt, measure against GitHub directly:
   `git fetch https://github.com/anomalyco/opencode.git dev`.
2. Count drift: `git rev-list --count HEAD..upstream/dev`, and date the merge base with
   `git merge-base HEAD upstream/dev | xargs git log -1 --format=%cs`.
3. Merge on the fork's `dev`: `git merge upstream/dev`, resolve conflicts, then `bun run check` from the root, and
   `bun run generate` from `packages/client` if the HTTP contract moved.
4. Record the patch-set size after the merge:
   `git diff --name-only upstream/dev...HEAD -- packages/core | wc -l`.

## Plugin-first, not core-inline

New fork behaviour goes through the extension surfaces — `packages/plugin-browser`, `packages/gui-plugins`,
config, or protocol-adjacent packages — instead of editing `packages/core` or `packages/app` inline. Those two
directories are the hottest upstream; every inline edit there is a future conflict. The existing inline patch set
is frozen: treat the file counts above as a ceiling, and during each sync move fork behaviour out of core/app
wherever upstream has grown a hook that can carry it.

## Workflow guards

Workflows that need upstream-only secrets or governance (`deploy-*`, `triage-*`, `release-process-daemon`) carry a
job-level `if: github.repository == 'anomalyco/opencode'` guard, so they skip on the fork instead of failing on
missing secrets. `check*.yml` stays unguarded — it is the fork's own PR value. When a sync brings in a new
workflow that needs secrets, add the same guard in the same merge. Do not delete upstream workflow files: every
upstream edit to them would conflict; a one-line `if:` per job is trivially mergeable.

## Repository hygiene

- `.gitignore` carries the fork-local artifacts: `/release-stage/`, `/.zcode/`, `hs_err_pid*.log`.
- `.gitattributes` pins text to LF (`* text=auto eol=lf`) so Windows checkouts with `core.autocrlf=true` stop
  flipping line endings against upstream's LF blobs. `*.bat`, `*.cmd` and `*.ps1` stay CRLF.
- Session-generated research notes that must never reach an upstream PR live under `doc/research/` and are ignored
  through `.git/info/exclude` — deliberately not the committed `.gitignore`, so both trees see the same committed
  ignore rules. Do not commit those notes, and do not move them into the committed ignore list.

Version numbers, release builds and update policy stay in `AGENTS.md` ("Version Numbers", "Local Release Builds");
this doc does not duplicate them.

## Decisions

- **Weekly sync, measured from a fresh mirror.** The 2026-11-06 review believed the drift was one day because the
  local mirror had gone eight days stale; the true drift was 722 commits on a merge base of 2026-10-28. The
  measure-before-merge step is the control that stops that illusion from repeating.
- **Plugin-first instead of inline patches.** Merge cost compounds in the directories upstream touches most.
  Freezing the fork at an older upstream was rejected: security and model fixes land upstream weekly, and a fork
  that stops merging stops being a fork and becomes a dead end.
- **Guards instead of workflow deletion.** Deleting `.github/workflows` files makes every upstream edit to them a
  conflict; a one-line `if:` per job is trivially mergeable and self-documenting.
- **`doc/research/` sits outside `doc-refs`.** The notes are point-in-time analyses of other codebases and of
  plans whose named files intentionally do not exist here; checking them produced 246 false failures the day they
  moved under `doc/`, so `script/doc-refs.ts` skips the subtree and `doc/conventions.md` records the boundary.
