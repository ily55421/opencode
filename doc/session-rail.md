# Session rail

The always-visible column on the right of a session: what this session changed, where the repository stands, and
the two writes a person can trigger from there. Read this before touching `packages/app/src/session/rail/`,
`Vcs.commit` / `Vcs.push` in `packages/core/src/vcs.ts`, or the `vcs.commit` / `vcs.push` routes.

## What it shows

| Section | Content | Source |
| --- | --- | --- |
| Work | files touched, commands run, `+additions -deletions` | `sessionRail` over the session's messages plus its diff |
| Environment | branch, uncommitted count, commit message field, 提交 / 推送 | `vcs.info` and `vcs.status` for the session's directory |
| Skills & MCP | skill names and the MCP servers called | `session.skill` messages, `skill` tool calls, `<server>_<tool>` names |
| Outputs | one row per file this session changed, with its counts | `GET /api/session/:id/diff` over the session's turn range |
| Pages consulted | one row per host, the URL as its tooltip | `input.url` on `webfetch` |

`SessionRail` mounts in `packages/app/src/session/screen.tsx` as the last child of `[data-pane-row]`, after the side
panel's presence element. `railShown()` is the one accessor for whether it is up: desktop, a session, messages
loaded, `settings.appearance.sessionRail()` (default shown), and the side panel closed.

The chat panel's width is not a flex child's — `panel-motion`'s `paint` writes an inline `width` on it, and with the
side panel fully closed it wrote a literal `100%`, which pushed the rail off the window's right edge. `chatIdleWidth`
is now that assignment, and it reserves `SESSION_RAIL_WIDTH` plus the row gap while the rail is shown. A
`createEffect` on the same accessor covers the two cases `paint` never runs for: first mount, and the setting
changing while the side panel is already closed.

## Where the numbers come from

`sessionRail` in `packages/app/src/session/rail/model.ts` is a pure fold over the messages the client already
holds — the same list the timeline and the todo pill read — plus the session's diff and `vcs.status`. It takes the
revert boundary the way `sessionTodos` does, because a message after that boundary is not visible to the model and
so is not part of the session's work. Only tool parts whose state is `completed` count.

The file list is **not** folded from tool metadata. `SessionRail` asks `GET /api/session/:id/diff` for the range
from the session's first user message to its last, which is the same authority the review panel uses, and passes the
rows in as `diff`. That keeps a `write`, an `edit`, a `patch` and a file a shell command created all listed the same
way, with worktree-relative paths the commit call can use unchanged.

`vcs.info` is a cached location resource, and the rail is frequently the first thing in that location to want it, so
`refresh` calls `vcs.sync` and `mcp.server.sync` itself rather than reading a cache nobody filled: an unsynced
location reads as "no branch".

## The two writes

`POST /api/vcs/commit` and `POST /api/vcs/push` are location-scoped like every other vcs route. Both are
`VcsDefinition` methods, so a provider that cannot do them simply does not declare them and the service answers
`OperationError` with the provider's name in it — the same shape `init` uses for a provider without initialization.

Commit runs `git add --intent-to-add -- <paths>` and then `git commit --only -m <message> -- <paths>` from the
worktree root, because `vcs.status` and `metadata.files` both report worktree-relative paths. Hooks run: nothing
here passes `--no-verify`, and `refused` puts the last few lines of Git's stderr into the error so a rejected commit
explains itself in the rail instead of showing "failed".

Push resolves the checked-out branch and the primary remote (`origin`, else the only remote, else `upstream`) and
runs `git push <remote> HEAD:refs/heads/<branch>`. It never forces, and it does not set an upstream. The response
carries the remote, the branch and how many commits it pushed, so the rail can say what happened.

In the UI, push is a two-click action: the first click re-labels the button with the branch it will land on, the
second goes. The rail's own commit is scoped to `rail().files` — the files this session wrote — so the button does
what the column above it shows.

## Decisions

**Outputs come from the session diff, not from tool metadata.** Rejected: folding `metadata.files` off the completed
`edit` / `write` / `patch` parts. Failure mode found by testing the installed build: a completed `write` carries
`toolOutput` and nothing else — the `files` preview rides on its `permission.assert`, not on its result — so the rail
listed `0 个文件` for a session that had just created one. The diff also covers what a shell command produced, which
no tool metadata reports, and returns paths already relative to the worktree. Cost paid: one extra request per
refresh, whose patch text the rail ignores.

**The rail folds; the server does not aggregate.** No `SessionStats`-style read model was added for it. Failure mode
of one: a second account of the session that can disagree with the transcript, which is the bug class `doc/session-loop.md`
already documents around projections. Cost paid: the fold reruns on every message, and the refresh spawns Git when
the message list changes — both cheap next to a model step, and the reason the rail refreshes off messages rather
than on a timer. The refresh reads its inputs under `untrack`, because it writes the same location caches it reads.

**Commit is `--only`, not `git commit -a` and not a plain commit of the index.** Failure mode of the alternatives:
a person who staged something by hand before asking the agent for a change finds their own staged work swept into the
agent's commit. `--only` cannot do that, at the cost of needing `--intent-to-add` first for paths the index has never
seen.

**Push asks twice in the client and never forces on the server.** Rejected: a server-side refusal to push to the
default branch. Failure mode of that rule: it also refuses the person who genuinely works on `dev`, and the guard
would be invisible to the TUI and the SDK, which call the same route. A push is recoverable by whoever owns the
remote; a silent force is not.

**MCP attribution needs the configured server list.** A tool part carries only the composed name
(`packages/core/src/tool/mcp.ts` `name`), so `my.server`'s `fetch` arrives as `my_server_fetch` and no suffix list can
split it back safely. `data.location.mcp.server.list` is the authority, and a name that matches no server is treated
as a built-in tool rather than guessed at.

**The rail yields to the side panel instead of sitting beside it.** Failure mode otherwise: three columns on a
laptop window, and the transcript squeezed under its minimum width. The side panel is what a person opens on
purpose, so it wins; the rail comes back when it closes.

## Tests

`packages/app/src/session/rail/model.test.ts` pins the fold: the diff totals into the summary, outputs are listed by
path, the uncommitted count stays separate from what the session changed, command counting, MCP name splitting,
skills from both the durable activation and the tool call, host dedupe with the URL kept, and the revert boundary.

`packages/core/test/vcs.test.ts` drives real Git: a commit takes only the paths it was given and leaves a
hand-staged change staged; a never-before-seen file commits after the intent-to-add; empty file lists and blank
messages are refused; a push lands on a bare remote and reports the commit count; and with no remote configured the
push says so instead of succeeding quietly.

Run them from `packages/core` and `packages/app` (`bun run test:unit` there), never from the repository root.
