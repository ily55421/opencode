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

Three mechanisms end or extend a loop without user input:

| Mechanism | Trigger | Where |
| --- | --- | --- |
| Step budget | `step >= agent.info.steps` appends `MAX_STEPS_PROMPT` as an assistant message and sets `toolChoice: "none"` | `core/src/session/runner/max-steps.ts`, used by `runStep` |
| Interrupted stream | `Outcome.Continue` publishes the `CONTINUE_AFTER_INCOMPLETE_STREAM` text | `core/src/session/runner/llm.ts` |
| Output limit | `Outcome.OutputLimit` publishes `CONTINUE_AFTER_OUTPUT_LIMIT`, and fails with the `output-limit` session error after two consecutive `finish: "length"` assistants | `core/src/session/runner/llm.ts` |
| Unfinished work | `Outcome.Completed` without a tool call, while the todo list the model itself last wrote still has `pending` or `in_progress` items | `core/src/session/runner/unfinished.ts`, called by `runStep` |

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

**Turn scoping uses the `idle` marker, not the last user message.** Failure mode of the alternative: a steer mid-turn
moves the boundary, the earlier nudges fall outside the window, and each steer hands the model a fresh nudge allowance
inside one turn.

## Tests

`packages/core/test/session-runner.test.ts` drives full drain loops against a `TestLLM` and asserts on `DrainResult`
and the event sequence; `session-step.test.ts` covers one step, `session-runner-tool-events.test.ts` covers tool
settlement, `session-execution.test.ts` covers the coordinator, and `session-runner-unfinished.test.ts` covers the
nudge decision on projected history directly. Run them from `packages/core` with `bun run test`; never from the
repository root.
