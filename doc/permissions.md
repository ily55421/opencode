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

## Escalation: what a broad allow rule cannot cover

`Permission.evaluate` is last-match-wins, so one `shell: {"*": allow}` rule historically authorised every command,
including `rm -rf /`. A caller that can see more about its request than a wildcard can therefore pass that judgement
independently:

```ts
permission.assert({ action: "shell", resources, save, risk: "dangerous" | "unanalyzable" })
```

`risk` is on `AssertInput`, not on `Request`, so it never reaches the wire or a client's pending list. The ordering in
`evaluateInput` is **deny → escalation → allow**: a deny still wins, and an escalation outranks every allow rule — an
agent default, a project config, or a saved "always allow". The only thing that clears it is a session that allowed
everything outright, which is a standing choice the user made on purpose.

An escalated request is published with `save: []`. `Permission.reply` only persists a non-empty save list, so an
"always allow" click on such a request approves it once and remembers nothing — the next occurrence asks again. That is
the `PromptUser` property (a remembered decision cannot satisfy it), expressed inside the existing
`allow | deny | ask` vocabulary instead of a fourth public effect.

Separately, a command whose raw first token is a shell, an interpreter, or a runner (`sh`, `bash`, `python`, `bun`,
`node`, `xargs`, `sudo`, `env`, …) is never rememberable at all: `bun *` names no program, so saving it would authorise
anything. `ShellDanger.rememberable` drops those entries from the shell tool's `save` list.

Rules themselves are **not** folded by severity. opencode writes `deny *` first and grants after it, so
most-restrictive-wins would break the `explore` agent and Plan mode; see
`doc/records/2026-10-permission-fold-ordering.md`.

`packages/core/src/shell/danger.ts` produces the verdict from the command text:

- **dangerous** — a recognised destructive shape: recursive removal against `/`, `~`, `$HOME` or a top-level system
  directory, `dd`/`mkfs`/`shred`/`wipefs` against a device, `find / -delete`, recursive `chmod`/`chown` on a root, a
  fork bomb, pipe-to-shell installers, `shutdown`/`reboot`/`init 0|6`.
- **unanalyzable** — the rule engine is being asked to approve text whose target it cannot see. Two different things
  hide in a `$`: a substitution (`$(…)` or a backtick) runs code no rule can see, so it escalates wherever it appears;
  a bare expansion (`$X`, `$HOME`) escalates only in a command that can change state (`rm`, `mv`, `chmod`, `kill`,
  `dd`, `tar`, `xargs`, …), because that is the case where the operand *is* the target. `rm -rf "$X"` escalates;
  `rm -rf /tmp/build; echo "exit=$?"` does not — a real false positive this rule was found by.

`ShellParse` no longer fails on an unreadable command. `scanPortable` used to return `Effect.fail` for `opaque` and the
legacy path for a parse error, so the model got a tool error and retried; the result now carries `opaque: reason` and
the shell tool escalates on it. A person decides in one tap what a parser cannot.

The one opt-out is a session whose **own** rules contain `{action:"*", resource:"*", effect:"allow"}` — what the
composer's Full access mode writes. An agent-level allow-all is not an opt-out; see `Decisions`.

**This flips a default.** The built-in `build` agent's rules begin with `{action:"*",resource:"*",effect:"allow"}`, so
before the escalation every shell command the model proposed ran without a prompt — including `rm -rf "$TARGET"`. What
a user gains is a question before an irreversible command; what they lose is the silence. The escape hatch is choosing
**Full access** for the session: answering "always allow" is deliberately not one, because a destructive command should
not become permanently silent from a single click. A non-interactive `opencode run` without `--auto` cannot ask, so an
escalated command there now fails with the standard "cannot ask" rejection instead of executing.

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

**The opt-out reads the session's rules only, never the merged set.** Failure mode otherwise: the default build agent
carries `{action:"*",resource:"*",effect:"allow"}`, so checking the merged ruleset would treat every ordinary session as
having opted out and silence the escalation entirely. The cost is that "Full access" is recognised by rule shape rather
than by a named flag.

**Classification reads the command text, not the parse tree.** Rejected: deriving the verdict per parsed command from
`ShellParse`. Failure mode: the legacy tree-sitter path and the portable scanner path would escalate differently for the
same input, and a command the scanner drops entirely (a declaration-only statement, an opaque read) would produce no
resources and therefore no prompt at all. Text classification is scanner-independent, so both paths agree, and the
`opaque` case still escalates.

**A glob operand is not unanalyzable.** Rejected the reference behaviour of escalating on any `*`/`?`. Failure mode:
`rm -rf dist/*` and `npm run build -- --watch *` are ordinary work, and opencode's rules already match against the
literal command text, so a glob does not hide the target the way `$X` does. A glob at a root position (`rm -rf /*`) is
caught as dangerous instead.

**`dangerous` does not silently pass `--auto`.** The escalation happens server-side before any client sees a request, so
a non-interactive run still gets a prompt — which the CLI's `--auto` path then answers. Deciding that a machine should
preempt the escalation belongs to the caller's explicit rules, not to a heuristic that cannot see the target.

**A remembered mode applies at creation, not on view.** Rejected: applying the project default the first time a
session renders. Failure mode: opening a session created elsewhere — by the TUI, the CLI, or a colleague's shared
session — would silently widen its permissions to whatever this browser last chose.

**Explicit "ask" outranks the client-side auto-approve setting.** `declinesAutoApproval` is what
`packages/app/src/session/requests/auto-approve.ts` consults before replying `once`. Failure mode without it: the user
picks "Ask every time", the setting is still on, and prompts keep disappearing — the selector becomes decorative.

## Tests

`packages/core/test/shell-danger.test.ts` pins the classifier's safe / dangerous / unanalyzable tables, wrapper
stripping and nested payloads. `packages/core/test/permission-escalation.test.ts` is the contract test: a broad allow
rule clears an ordinary command but not a dangerous or unanalyzable one, a deny still wins, an agent-level allow-all is
not an opt-out, and a session-level one is. `packages/core/test/shell-parse-parity.test.ts` and
`shell-parse.test.ts` assert the new `opaque` result in place of the old failure.
`packages/app/src/session/composer/permission-mode.test.ts` covers the composer modes. Run from `packages/core` or
`packages/app` (`bun run test:unit` there); never from the repository root.
