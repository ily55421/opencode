# Permissions and approval modes

How a tool call becomes a prompt, and what the composer's three approval modes actually change. Read this before
touching `packages/core/src/permission.ts`, `packages/app/src/session/composer/permission-mode.ts`, or anything that
answers a permission request on the user's behalf.

## Evaluation

`Permission.Service` is Location-scoped. A tool calls `assert({action, resources, save, sessionID, agent, source})`;
`evaluate(action, resource, ...rulesets)` returns the **last** rule whose action and resource wildcards match, and
falls back to `ask` when nothing matches. The effective ruleset is ordered:

```
agent.permissions (or deny-* if the agent has none)  →  session.permissions  →  saved always-allow rules
```

so a session rule overrides the agent's, and a saved "always allow" overrides both. Any resource in a request that
evaluates to `deny` blocks the call outright; `ask` on any resource prompts, and one reply answers the whole request.
`permission.evaluate` is a plugin hook, so a plugin can rewrite `effect` after all of this.

Action names are the contract: `edit` is shared by edit, write and patch; `shell` is asserted per parsed command;
`external_directory` covers anything outside the project; `read`, `grep`, `glob`, `webfetch`, `websearch`, `subagent`,
`question`, `skill`, `todowrite`, `provider.use` and `opencode_*` MCP tools are their own actions. Nothing in the
schema ties a tool to its action — the tool passes the string — so renaming one silently changes who prompts.

## The three composer modes

`packages/app/src/session/composer/permission-mode.ts` maps a mode to a session ruleset, and the selector writes it
with `session.update`. The mode is therefore **server-enforced state on the session**, visible to every client and
surviving a restart, rather than a client that answers prompts for the user.

| Mode | Ruleset | Meaning |
| --- | --- | --- |
| Ask every time | `[{*,*,ask}]` | The agent's own policy. The rule changes no behaviour; it records the choice. |
| Auto approve | `[{*,*,allow}]` then `ask` for `edit`, `shell`, `external_directory`, `webfetch`, `websearch`, and `read *.env*` | Ordinary work runs unattended; anything that writes, executes, escapes the project, or reaches the network still asks. |
| Full access | `[{*,*,allow}]` | Never asks, including for the actions above and over a plan-mode agent's denials. |

Because evaluation is last-match-wins, the order inside `ruleset("auto")` is the behaviour: the blanket allow must come
first and the risky exceptions after it. A ruleset that matches none of the three shapes reads as `custom`, which the
selector shows without pretending to be one of its choices.

`ask` writes an explicit rule rather than an empty array on purpose: `[]` means nobody has chosen, which is what keeps
the older client-side auto-approve setting working for existing sessions.

## Where the memory lives

The selector remembers the last choice per project (`permissions.modeProjects` in the app's persisted settings) and
applies it to **newly created** sessions in the new-session composer adapter, chained onto the create request so the
first prompt cannot race it. It never rewrites a session that already exists: opening someone else's session must not
apply this client's preference.

## Decisions

**Modes are rulesets, not a new protocol field.** Rejected: adding `permissionMode` to the session contract. Failure
mode: two sources of truth that can disagree — a session could carry `mode: "ask"` with an allow-all ruleset from
config — and every client would need new handling for something `Permission.Ruleset` already expresses. Cost paid:
the mode is inferred from rule shape, hence the `custom` state.

**The risky set is an action list, not a classifier.** Rejected: computing risk per request (parsing the command,
deciding whether a path escapes, whether a URL is external). Failure mode of the coarse list is a false sense of
precision either way, and the fine version belongs in the `permission.evaluate` hook where a plugin can own it. The
list errs toward asking: `edit` and `shell` stay questions in "Auto approve" even though most of their calls are
harmless.

**A remembered mode applies at creation, not on view.** Rejected: applying the project default the first time a
session renders. Failure mode: opening a session created elsewhere — by the TUI, the CLI, or a colleague's shared
session — would silently widen its permissions to whatever this browser last chose.

**Explicit "ask" outranks the client-side auto-approve setting.** `declinesAutoApproval` is what
`packages/app/src/session/requests/auto-approve.ts` consults before replying `once`. Failure mode without it: the user
picks "Ask every time", the setting is still on, and prompts keep disappearing — the selector becomes decorative.

## Tests

`packages/app/src/session/composer/permission-mode.test.ts` pins the mode↔ruleset round trip, the risky set, the
`custom` reading, and that only an explicit ask opts out of auto-approval. Run from `packages/app` with
`bun run test:unit`. `packages/core/test/permission.test.ts` covers the evaluator itself.
