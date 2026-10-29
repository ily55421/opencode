# Why the unfinished-work nudge only reads the todo list

A model that stops early is the dominant failure of weak local models, and the loop had no answer for it: retries in
`core/src/session/model-retry.ts` and `core/src/session/runner/retry.ts` cover provider errors, and nothing covered
"It announced it was done". The current behaviour is in `doc/session-loop.md`; this record covers what was turned down.

## Situation

`SessionRunnerLLM`'s `runStep` ends a drain as soon as a step completes without a tool call. Whether the task is
finished is never asked, so a session can go idle with work outstanding and the only signal the user gets is text that
sounds conclusive.

The reference design this borrows from detected eight distinct failure shapes and nudged on most of them. Adopting that
set wholesale would have put a per-failure threshold table into the loop.

## Options considered

**A prompt-shape heuristic for "fake completion".** Fire when the turn used a side-effecting tool, made few total
calls, and the prompt contained an action verb. Turned down: the verb list is a language-specific policy inside the
engine (the original was Chinese verbs — 部署, 修复, 重构 — and opencode ships about twenty locales), and "few calls"
cannot separate a completed three-call fix from an abandoned refactor. The false-positive class is a machine-written
interruption on a correct answer, which is worse than the miss: it trains the user to ignore the notice.

**Process-local nudge counters.** Cheaper to write. Turned down because a location reload or process restart clears
them, which silently turns a bounded retry into an unbounded spend — the exact failure the caps exist to prevent. The
existing output-limit streak reads recent rows from the database for the same reason.

**A new durable event, or a new `DrainResult` variant.** Turned down: todo state, side-effect success, and nudge counts
are all foldable from `session.tool.success`, `session.tool.failed` and `session.synthetic` rows already written, and a
rerun through `SessionExecution` would repeat drain entry work (stale settlement, instruction preparation) that a plain
extra step does not.

**A fabricated user message.** Turned down: `SessionInbox` promotion resets the agent's step allowance, so every nudge
would refill the budget it is supposed to police. `SessionEvent.Synthetic` is model-visible without being an admission.

**The runner calling `Session.synthetic`.** Turned down because the runner is Location-scoped and `Session` routes back
through `LocationServiceMap`, which forms a type cycle with the runner node — the same reason
`core/src/session/instructions.ts` publishes to the bus directly.

## Chosen

Fold the turn's projected history, where the turn starts at the `idle` marker. Detect exactly one shape — the model's
own `todo` list still has `pending` or `in_progress` items — and nudge with `session.synthetic` messages whose
`metadata.notice` is `todo-residue`. Two breakers, whichever hits first wins: `MAX_NUDGES` absolute, `STALL_LIMIT` on
consecutive nudges with no real side effect. Exhausting them publishes `todo-residue-stopped` and goes idle instead of
raising a session error.

Because detection requires the todo tool, `experimental.todo` gates the whole mechanism without a new config key. A
strong model that never uses `todowrite` is unaffected; a weak model that does gets held to the plan it wrote itself.

The nudge text names the `todowrite` tool explicitly. That came from a field report where a generic "continue with your
tools" was answered by re-running a shell check: 93 steps, one todo write, and a panel that never moved off 0/4.

## What would prove this wrong

- Sessions that end early without ever calling `todowrite` becoming the common case, which would mean the gate is too
  narrow and some other intent signal is needed.
- `STALL_LIMIT` of 3 cutting off models that are genuinely working in long reasoning passes before they touch a tool.
- Evidence that a stop notice inside the transcript confuses the next turn, which would argue for an ephemeral event or
  a dedicated UI surface instead of a `session.synthetic` row.
