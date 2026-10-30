# Why permission rules are not folded by most-restrictive-wins

Evaluated against the codex reference design (`Decision` lattice, `Evaluation::from_matches` taking `.max()` over every
matched rule). The conclusion is that opencode must **not** adopt the fold, and the reason is in its own rule sets.

## What was tried

Replace `Permission.evaluate`'s `findLast` with a max over all matching rules under
`allow < ask < deny`, so a broad allow can never override a narrower safety rule no matter where it appears.

## What breaks

opencode writes rule sets as *broad default first, narrower grants after*. Under a max-fold the later grants stop
working:

- the `explore` subagent's rules begin with `{action:"*", resource:"*", effect:"deny"}` and then grant `shell`, `grep`,
  `glob`, `webfetch`, `websearch`, `read` — a max-fold denies all of them and the agent can do nothing;
- Plan mode pushes `{edit, *, deny}` then `{edit, <plan directory>/*, allow}` — a max-fold makes Plan unable to write
  its own plan file;
- the `General` subagent denies `question` and `subagent` after an allow-all default — those two happen to survive,
  which shows the hazard is silent rather than uniform;
- any user config that does the same thing (deny `*` then allow a few actions) silently loses its grants.

The order *is* the semantics in this rule language. Wildcards are used by 24 in-tree rules, so the property that makes
codex's fold safe — rules keyed on an exact first token, no wildcards, therefore no broad rule to conflict with — cannot
be reproduced without breaking every existing config.

## What was kept instead

The escalation keeps the property the fold was meant to provide, at the one place it matters: a risky command is
compared against the rules and wins unless the session itself allowed everything outright. Saved "always allow" rules
are deliberately excluded from clearing it, and an escalated request is published with an empty `save` list so a client
cannot persist a rule for it at all. That is the `PromptUser` behaviour, expressed inside the existing
`allow | deny | ask` vocabulary rather than as a fourth public effect.

## What would change the answer

Moving rule keys to exact program names with an explicit narrow-grant syntax — i.e. adopting codex's rule language, not
just its fold. That is a config-format break for every existing `opencode.json`, so it needs its own migration plan
before the fold becomes safe to adopt.
