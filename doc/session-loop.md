# Session loop

How a session goes from admitted input to idle, and which invariants a change to that path has to keep. Read this
before touching `packages/core/src/session/`, the event set in `packages/schema/src/session-event.ts`, or anything that
decides whether the model runs again.

## The shape of a drain

```
Session.synthetic / Session.prompt / Session.compact        core/src/session/session.ts
  → SessionInbox.admit        durable `session.inbox.enqueued`, one `session_inbox` row
  → SessionExecution.wake     advisory, never persisted
  → SessionRunCoordinator     core/src/session/run-coordinator.ts
  → SessionRunner.drain       core/src/session/runner/llm.ts
  → SessionStep.attempt       core/src/session/runner/step.ts
```

`SessionRunner.drain` returns a `DrainResult` tagged enum: `Complete`, `Moved`, or `Reloaded`. `SessionExecution`
(`core/src/session/execution.ts`) treats `Complete` as "this session is idle" and re-enters `drain` for the other two,
carrying a `Continuation` that names the step number so a location handoff does not restart counting.

Inside one `drain` call:

- `advanceToStep` decides whether there is promotable work. It returns `Ready` with a loaded context, or a `DrainResult`
  when the session should go idle, when a `move` item was delivered, or when the Location closed.
- The outer loop then runs `runStep` and increments the step counter until `advanceToStep` stops returning `Ready`.
- `runStep` owns *logical* step policy — compaction first, then the step budget, then retry/continue/output-limit
  outcomes — while `SessionStep.attempt` owns the stream, the tools, and their durable settlement.

`SessionRunCoordinator` joins explicit resumes of the same session, coalesces wakeups, and lets different sessions run
concurrently. That concurrency is the reason a change here must not assume one writer per directory.

## One step is one model call

`SessionStep.attempt` makes exactly one `llm.stream` call. Tool calls found in that stream fork local execution
fibers; the step joins them before settling. Continuation is *not* an in-memory loop over the same response: the next
step reloads history from the projector and issues a fresh `llm.stream`.

So durable state is the only memory between steps. Anything a later step needs must either be in the event log (and
therefore in the reloaded context) or be re-derivable from it.

`needsContinuation` on the step record answers one narrow question — did this step contain a non-provider-executed tool
call or settlement? — and is what keeps the loop turning while tools are in play. It is not a statement about the task
being finished.

## Stopping, continuing, and nudging

Several mechanisms end or extend a loop without user input:

| Mechanism | Trigger | Where |
| --- | --- | --- |
| Step budget | `step >= agent.info.steps` appends `MAX_STEPS_PROMPT` as an assistant message and sets `toolChoice: "none"` | `core/src/session/runner/max-steps.ts`, used by `runStep` |
| Interrupted stream | `Outcome.Continue` publishes the `CONTINUE_AFTER_INCOMPLETE_STREAM` text | `core/src/session/runner/llm.ts` |
| Output limit | `Outcome.OutputLimit` publishes `CONTINUE_AFTER_OUTPUT_LIMIT`, and fails with the `output-limit` session error after two consecutive `finish: "length"` assistants | `core/src/session/runner/llm.ts` |
| Unfinished work | `Outcome.Completed` without a tool call, while the todo list the model itself last wrote still has `pending` or `in_progress` items | `core/src/session/runner/unfinished.ts`, called by `runStep` |
| Empty response | `Outcome.Completed` whose step settled with a non-error finish but no visible output, when no previous step of the turn completed a tool | `core/src/session/runner/empty.ts`, called by `runStep` |
| Repeated identical call | The same (tool, arguments, result) made five times in a row, or a block of up to five calls repeating five times | `core/src/session/runner/loop.ts`, refused in `SessionStep.attempt`'s `executeTool` |
| Repeated refusal | One exact call denied by the permission rules eight times in a row | `core/src/session/runner/loop.ts` |
| Unformattable calls | Three tool calls in one turn that never parsed, when the step did not end at the output limit | `core/src/session/runner/loop.ts` |
| Cross-parameter failures | One tool failing six times in a turn across *different* arguments, counted per (tool, error category) and per (tool, normalized path) | `core/src/session/runner/loop.ts` |
| Failure-streak advisory | The same streak reaching five failures publishes one model-facing advisory instead of blocking | `core/src/session/runner/loop.ts`, published by `runStep` as a `failure-streak-advisory` synthetic |

All four loop counters fold from the durable message history the same way `SessionRunnerUnfinished.decide`
does, and all four close the turn the same way the step budget does: `runStep` appends the guard's notice as
an assistant message and sends the final request with `toolChoice: "none"`. None of them is a session error —
an error reads as a broken session when the truth is that the model is going in circles. A refusal is
recorded as a failed tool call whose message starts with the token below, and the fold **excludes** its own
refusals when it looks for a repeating block; leaving them in would break the pattern after one refusal and
the guard would release itself.

The cross-parameter counters exist because the exact-call repetition search above is blind to a model that
varies its arguments: `read(a)`, `read(b)` and `read(c)` all failing share no call key, yet nothing about
the situation is moving. Each failure feeds two counters — one per `(tool, error category)` (a small
message-based bucket: `not-found`, `timeout`, `invalid`, `error`) and one per `(tool, normalized path)` for
calls whose input carries a path-like argument. A success of the tool clears its category counters, and a
success on a path clears that path's counter, so a retry that starts producing is never read as spinning.
Failures that arrived in one parallel batch count once per key — the model has not yet seen the results it
is adjusting against — and the next batch still accumulates. Timeouts count on purpose; permission refusals
stay owned by the repeated-refusal counter, unformattable calls by the format counter, and aborted or
result-missing settlements are machinery, not the model, and feed nothing.

One failure before the limit, the guard speaks instead of blocking: `runStep` publishes a
`SessionEvent.Synthetic` whose `metadata.notice` is `failure-streak-advisory`. The published synthetic is
itself the dedup counter — it folds from history like every other counter, so a restart cannot hand the
model a second advisory, and the next step either heeds it or closes at the limit.

The refusal and closing texts are model-visible contract tokens, kept verbatim:

```
Loop guard: this exact tool call (same arguments, same result) has been made N times in
a row. Repeating it will not help. Change the arguments to get new information, use a
different approach, or ask the user.
```

```
Loop guard: automatic continuation stopped because the same tool calls kept
repeating. Tools are disabled for this closing step. Say what is stuck and ask the user how to proceed.
```

```
Failure guard: <tool> has failed <N> times in this turn, each with different arguments. Repeating
it with new parameters is not making progress. Change the approach, inspect the underlying problem, or ask
the user.
```

```
Failure guard: automatic continuation stopped because <tool> kept failing across different arguments
(<N> failures in this turn). Tools are disabled for this closing step. Report what is failing and
ask the user how to proceed.
```

`experimental.loop_guard` turns the whole guard off; with it off the fold returns no decision and the loop
behaves exactly as it did before. When a call is refused because tools are off for the closing step — for
either the step budget or a loop guard — the model sees `Tools are disabled for this closing step.`, which is
true for both, rather than a step-count message on a turn that stopped for repetition.

`SessionRunnerUnfinished.decide` is the only task-level completion check in the loop, and it is fenced by
`experimental.todo`: no todo tool means no list means nothing to detect. Its four constants are the whole contract —
`MAX_NUDGES` (10) and `STALL_LIMIT` (3) are the two independent breakers, whichever hits first wins, and
`ESCALATE_AFTER` (3) switches the wording. `NOTICE` (`todo-residue`) and `NOTICE_STOPPED`
(`todo-residue-stopped`) are the `metadata.notice` values a client should label these messages with; match those, never
the text, since the text is model-visible and may be reworded.

Progress is a **real side effect**, not a claim: a completed `edit`, `write`, `patch`, or `shell` call, or a `todowrite`
that leaves fewer open items than the list before it. Rewriting the same list is the model restating the task, so it
does not reset the stall run. When both breakers are exhausted the turn publishes `TODO_RESIDUE_STOPPED` and goes idle —
deliberately not a session error, because an error reads as a broken session when the truth is that work remains.

An empty answer is answered before the todo nudge runs, and it owns the boundary: one turn gets one automatic notice,
so the two mechanisms never speak over each other. `SessionRunnerEmpty.decide` nudges a step that **settled** — its
assistant carries a finish that is not `error` — with no visible output, unless the previous step of the turn completed
a tool, in which case the work happened and the blank reply is a finished turn. A step that never settled (a stream
that ended without any event writes no assistant at all) or that failed stays with the retry and error machinery:
"your previous response had no visible output" would be a lie, and spending the allowance on a transport anomaly turns
a broken response into three wasted requests. `MAX_EMPTY_RESPONSE_RETRIES` (3) is the cap; the fourth empty answer
publishes `EMPTY_RESPONSE_STOPPED` (`empty-response-stopped`) and goes idle, not a session error. The counters fold
from the durable history — `NOTICE_EMPTY_RETRY` (`empty-response-retry`) synthetic messages are the counter, so a
restart cannot hand the model a fresh allowance for the same silence.

A nudge is published as `SessionEvent.Synthetic` — durable, model-visible, projected as a message that is not a user
message (`to-llm-message.ts` renders it with the user role; `message-updater.ts` records it as synthetic). The
alternative path is `Session.synthetic(...)` in `core/src/session/session.ts`, which admits an inbox item and therefore
takes part in delivery ordering, wake-up, and cancellation.

Pick deliberately: `bus.publish(SessionEvent.Synthetic, ...)` is for a runner that is *already* continuing;
`Session.synthetic(...)` is for putting work into the queue that a later drain must discover.

The output-limit streak is counted by reading recent message rows from the database rather than holding a counter, so a
restart cannot lose the breaker. Follow that pattern for any new auto-continuation limit; a process-local counter
resets on reload and silently turns a bounded loop into an unbounded one.

## Delivery vocabulary

Prompts steer by default. At safe step boundaries a steered compaction takes priority up to the first steered move
control; other steers follow enqueue order. At an idle boundary steers win; otherwise exactly one queued item is
delivered before the runner re-evaluates continuation. Promoting new user input resets the agent's step allowance; a
batch of steers resets it once.

`turn` is reserved for the future assistant-turn unit that spans all steps from prompt promotion until the session
would go idle. Never write "provider turn", and never use bare `turn` for one call — one call is a **step**.

## Recovery claims and stale settlement

A write-ahead execution claim (`SessionStore.claim`) is committed in the same transaction as `Execution.Started`.
Terminal completion, failure, or user interruption releases it; shutdown interruption and process death preserve it so
startup recovery can resume. **It is a recovery marker only** — not clustered ownership, not fencing, not exactly-once.

A drain that starts after a process death settles what the dead process left half-written, before running anything:
`settleStaleCompactions` fails `running` compaction rows with `compaction.interrupted`, and `settleStaleToolCalls`
settles `streaming`/`running` tool states with `Tool.Failed` and type `aborted`. Any new "in progress" durable shape
needs its own stale-settlement path here, or the UI shows a spinner forever.

## Invariants

- Durable events record irreducible new facts. If a state can be folded from the ordered aggregate history, fold it;
  do not add an event that repeats it. Todo progress, side-effect counts, and "did work happen" are all foldable from
  `session.tool.success` / `session.tool.failed`.
- Admission stays separate from execution: `Session.prompt` enqueues, delivery publishes `session.inbox.delivered`, and
  the projection consumes the inbox row and inserts the visible message in one transaction. `session_inbox` holds only
  unconsumed work.
- `SessionExecution` stays process-global and session-ID keyed; no layer takes a session ID. `SessionRunner`, model
  resolution, tools, and permissions stay Location-scoped.
- One drain freezes the instruction prefix (`InstructionBaseline`) for every step it runs, so a mid-drain AGENTS.md or
  skill edit lands on the next drain and the provider's cached prefix survives. Compaction rebuilds the prompt, so it is
  the one thing allowed to clear the baseline.

## Decisions

**A step is one stream, and there is no in-memory tool loop.** Rejected: holding the response in memory and iterating
tools inside one step. Failure mode: the durable record would no longer be the model-visible span, and a reload mid-loop
would lose work that history says happened. Cost paid: continuation reloads history per step.

**Nudges are synthetic messages, not fabricated user messages.** Rejected: appending a fake user turn to history.
Failure mode: the UI and every "last user message" consumer (title generation, delivery ordering, step-allowance reset)
would treat a machine-generated continuation as new intent, and promoting it would reset the step budget the nudge was
meant to respect.

**Auto-continuation breakers read durable history instead of keeping counters.** Rejected: a `Map<SessionID, number>`
in the runner. Failure mode: a location reload or restart clears it and the loop loses its own limit, which turns a
bounded retry into an unbounded spend. See the output-limit streak query for the pattern.

**`needsContinuation` stays "a tool was involved".** Rejected: making it mean "the model has not finished the task".
Failure mode: it is also the signal that keeps tool results attached to their calls; overloading it with task judgment
couples settlement correctness to a heuristic that can be wrong. Task-level completion checks belong in front of the
idle verdict, as their own decision with its own cap — which is how `SessionRunnerUnfinished` is wired.

**The nudge turns over to `SessionStep.Outcome.Completed` rather than to a drain result variant.** Rejected: adding
`DrainResult.Rerun(reason)`. Failure mode: `SessionExecution` re-enters `drain` for non-`Complete` results, so a rerun
would re-run drain entry work (`settleStaleCompactions`, `settleStaleToolCalls`, instruction preparation) for something
that is really just another step of the same drain. Returning `true` from `runStep` reuses the path a tool call already
takes.

**Todo residue is detected only from the list the model wrote.** Rejected: a "did the user ask for work?" heuristic that
inspects the prompt for action verbs and fires when few tools ran. Failure mode: it cannot tell a finished three-call
fix from an abandoned refactor, so it nudges correct answers, and its verb list would be a language-specific policy
inside the loop. `doc/records/2026-10-todo-completion-nudge.md` keeps the full reasoning.

**An empty response is a settled, non-failed answer, not any step without output.** Rejected: nudging every step that
produced nothing visible. Failure mode: a provider stream that ends without a single event writes no assistant, and a
failed step settles with the `error` finish — nudging either spends the retry allowance (and three requests) on a
transport anomaly while telling the model its previous response "had no visible output" when none arrived. The
empty-response nudge is for the model that answered with silence, which is the case the borrowed design measured; dead
streams and provider failures already have machinery, and it does not include a nudge.

**Turn scoping uses the `idle` marker, not the last user message.** Failure mode of the alternative: a steer mid-turn
moves the boundary, the earlier nudges fall outside the window, and each steer hands the model a fresh nudge allowance
inside one turn.

**Loop counters fold from history; none of them is a process map.** Rejected: `Map<SessionID, number>` next to the
runner. Failure mode: a location reload or a process restart clears it, and a bounded retry silently becomes an
unbounded spend. The same reason covers the step budget, the output-limit streak, and the nudge counts.

**The result participates in the loop key.** The borrowed write-ups all say a loop is the same call with the same
"arguments and outcome", and every implementation that was read keys on name plus arguments only. Failure mode
without the outcome: a status poll — same command, new information each time — is refused after the fifth check,
which turns a working session into a stalled one. Cost paid: the digest must come from the persisted tool part, so a
result that embeds a fresh spill path is folded to a placeholder before hashing — the
`[showing … full output saved to …]` marker in `core/src/session/runner/loop.ts`.

**Four causes, one closing move, and the guard's own refusals are not part of the pattern.** The counters answer
different questions — repetition, no side effect, repeated refusal, unparseable calls — so each has its own limit and
its own text; they share the step-budget shape (refuse the next call, then one `toolChoice: "none"` step) instead of
each inventing an exit. Rejected: a warn-then-block ladder, because `execute.before` has only two outcomes and a
ladder sends the same sentence twice. Rejected: a `DrainResult` variant for the close, for the same reason the nudge
turns over to `Completed`. A refusal is the guard speaking, not the model moving, so the repetition search runs over
the calls with refusals removed — keeping them in makes the pattern fail on the next step and the guard releases
itself after one refusal.

**Cross-parameter streaks are counted per tool and category, and a success clears them.** Rejected: counting every
failure of a tool regardless of kind — a tool that returns "not found" five times and "invalid input" twice is
exploring, not spinning, and merging the buckets would close it at six mixed failures. Rejected: counting only
*consecutive* failures — the borrowed design measured that shape, but a parallel batch of five failures is one
decision the model has not yet seen the results of, so a batch counts once per key and the next batch accumulates.
Rejected: letting permission refusals feed the streak — the decline counter already owns refusals with its own limit
and wording, and double-counting them would close a same-call refusal streak at six instead of its contract's eight.
A success clears the counters because a tool that just worked was not spinning; without the clear, one environmental
outage followed by legitimate retries would still compound toward the limit. The advisory at limit−1 is the one
place a counter speaks before it closes — a model varying arguments looks productive to every other signal in this
loop, so the cheapest possible intervention (one synthetic message) comes a step before the expensive one.

## Tests

`packages/core/test/session-runner.test.ts` drives full drain loops against a `TestLLM` and asserts on `DrainResult`
and the event sequence; `session-step.test.ts` covers one step, `session-runner-tool-events.test.ts` covers tool
settlement, `session-execution.test.ts` covers the coordinator, and `session-runner-unfinished.test.ts` covers the
nudge decision on projected history directly. `session-runner-loop.test.ts` covers the loop guard as a pure fold —
repetition, alternating pairs, polls that must not trip it, refusal streaks, malformed counts, the turn boundary, and
the cross-parameter streaks (advisory at limit−1, close at the limit, clear-on-success, parallel batches, the
excluded kinds) — while `session-runner.test.ts` keeps three end-to-end cases: the refusal, the closing step, and
the cross-parameter advisory-then-close. The empty response has
the same two layers: `session-runner-empty.test.ts` folds constructed history, and three drain scenarios there cover
the nudge, the three-strikes stop, and the blank-after-tool pass. Scenarios that mean "the turn ends" push a response
with visible text (`closing()`), because a bare settled stop *is* an empty response and the recovery answers it. Note
when adding turn-boundary cases there: the runner harness never writes the `idle` message a real terminal publishes,
so boundary behaviour is asserted on constructed history, not on a second drain. Run them from `packages/core` with
`bun run test`; never from the repository root.
