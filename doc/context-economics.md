# Context economics

How the size of a prompt is estimated, what budgets that estimate is used to enforce, and where a change to either can
burn money or hit a provider rejection. Read this before touching `packages/core/src/session/compaction.ts`,
`packages/core/src/tool-output.ts`, `packages/core/src/session/model-request.ts`, or `packages/util/src/token.ts`.

## Two estimators, one rule in core

`packages/util/src/token.ts` exports both rules and they are not interchangeable:

- `estimate` — four characters per token, blind to script. It reads Chinese, Japanese and Korean text as roughly a
  quarter of its real length.
- `estimateWide` — one token per East Asian wide code point, and the **same** four-characters-per-token arithmetic as
  `estimate` for everything else, which tracks real tokenizers at about 0.7–1 token per CJK character. It iterates
  code points so a surrogate pair is charged once.

The narrow half of `estimateWide` reproduces `estimate` exactly, including its rounding. That parity is what makes the
wide rule safe to budget against: switching a caller changes only text containing wide characters, so every threshold
keeps its meaning for English and code, and `packages/core/test/session-compaction.test.ts`'s exact token assertions
stay green through the swap. `packages/util/src/token.test.ts` pins the parity.

`packages/core/src/session/compaction.ts` uses `Token.estimateWide`, and
`packages/core/src/util/token.ts` re-exports both names — core chose the wide rule for its budgets, but a caller that
genuinely wants the script-blind count can still ask for it. The module lives in `@opencode/util` because the desktop
client cannot depend on core and must estimate with the same code.

`packages/core/src/session/model-request.ts`'s `ESTIMATE_ERROR` adds a 15 percent margin on the *estimated* half of a
prompt when it sizes the output limit. That margin exists because character counting runs low on dense text such as
code — it is not a CJK correction, and it would not have absorbed a script-blind estimate.

## An estimate is measured plus estimated

`estimatePrompt` in `packages/core/src/session/compaction.ts` splits the prompt at an **anchor**: the newest assistant
message whose real token usage came from the same provider. Everything up to and including that message is carried at
its reported `input + cache.read + cache.write + output + reasoning`; everything after it is estimated from characters.

`hasMeasuredPrompt` and `measuredPrompt` guard the anchor: another provider's count may describe a native window this
model cannot replay, and a different model, variant, or agent shapes a different request, so a count from any of those
is not trusted and the whole prompt falls back to estimation.

Consequences worth remembering:

- The anchor covers what the provider saw. Local tool results attached after that response were never in its prompt, so
  they are estimated, not measured.
- Image-heavy sessions can estimate high: `estimatePrompt` re-applies unsupported-part and image-budget passes without
  the compaction history the runner already shaped (a known TODO in that function).
- Estimates are never persisted. Only `TokenUsage.Info` from the provider is stored (`packages/core/src/session/sql.ts`),
  so changing an estimator needs no migration — but it does change behavior immediately for every existing session.

## Budgets

| Constant | Meaning |
| --- | --- |
| `RESERVE_SHARE` | Share of the window kept free before automatic compaction triggers. |
| `RESERVE_MIN` | The floor of that reserve, used when the share would be smaller. A window too small to give this up keeps only the share. |
| `UNKNOWN_WINDOW` | Assumed window when the model reports none, which is also when `calculateCeiling` returns infinity. |
| `SUMMARY_OUTPUT_FLOOR` | Least output a summary request is allowed even when the estimate margin leaves less. |
| `SHRINK_STEPS` | After each "too long" rejection, the next attempt aims at this share of the rejected request. |
| `keep` (config `compaction.keep.tokens`, default 15 000) | How much recent conversation survives verbatim into a compaction. |
| `PRECOMPUTE_RATIO` / `PRECOMPUTE_MIN_TOKENS` | When a background summary starts, and below what measured prompt size it is not worth its cost. |
| `PRECOMPUTED_TAIL_MIN` / `PRECOMPUTED_TAIL_SHARE` | How much verbatim tail a swapped-in summary keeps; a longer tail would leave the context near the threshold, so compaction summarizes from scratch instead. |
| `PRECOMPUTE_MAX_FAILURES` | Failed background summaries after which no new one starts until the next compaction. |
| `MAX_COMPACTIONS_PER_TURN` | Completed summaries one turn may produce before automatic compaction gives up with `compaction.stalled`. |
| `IMAGE_TOKEN_ESTIMATE` / `PDF_TOKEN_ESTIMATE` | Flat charge for media, since a character count means nothing there. |

Settings live at `packages/core/src/config/plugin/compaction.ts` (`compaction.auto`, `compaction.buffer`,
`compaction.keep.tokens`, `experimental.background_compaction`).

## When compaction runs

- **auto** — `runStep` computes `estimatePrompt` and calls `compact` before building the request; a completed
  compaction restarts the step with a rebuilt prompt and releases the drain's frozen instruction prefix.
- **overflow** — a provider rejection classified as context overflow, before any output started, compacts once per step
  (`recoverOverflow`) and retries via `Outcome.Compacted`.
- **manual** — a `/compact` inbox item is delivered by the drain and compacted with reason `manual`.
- **precompute** — a background summary, started after `due` and again when a step ends without needing continuation, so
  it has the idle time to finish.

`due` compares the total estimate against `calculateCeiling`, and short-circuits when the newest message is already a
completed compaction. Failure publishes `session.compaction.failed` with `compaction.failed` / `compaction.unavailable`
/ `compaction.interrupted` error types; the runner turns a failed auto compaction into a `StepFailedError`.

`summarizedThisTurn` counts completed summaries written since the last prompt and, for `auto` or `overflow` triggers
only, `compact` returns the `compaction.stalled` error once that count reaches `MAX_COMPACTIONS_PER_TURN`. A second
automatic compaction in one turn already means the first did not leave enough room, so the counter is the progress
signal; the guard stops the turn from paying for a fifth summary of a context that summarizing cannot shrink. Manual
`/compact` is exempt — the user asked for it.

## One tool result at a time

`packages/core/src/tool-output.ts` clips a tool result *before* it is published, so the model never receives the full
text: `MAX_LINES` and `MAX_BYTES` (configurable through the `ToolOutput` editor and the `tool_output` config keys) keep a
slice of the output, write the whole text to a file under `data/tool-output` with a 7-day retention, and append a marker
naming the path and the ranges kept. The service records its own decision under `metadata.toolOutput` —
`{ truncated, outputPath }` — and its idempotence guard reads that key, **not** a bare `truncated`.

The key is namespaced because `grep` and `read` already publish `metadata.truncated` to mean "this tool stopped paging"
(`grep` for a match cap, `read` for more pages). Reading that as "the bound was already handled" made every oversized
search or file read skip the clipper: a real 2 000-match grep entered history at 428 KB, and the bound only ever applied
to tools that stayed silent about truncation. `doc/records/2026-10-tool-output-metadata-collision.md` keeps the
diagnosis.

The slice splits head and tail: half the line budget from the start, the rest from the end, with the marker reporting
both ranges (`lines 1-1000 and 4001-5000 of 5000`). When the byte budget only reaches one line, that line is the last
one. Multiple text parts collapse into one preview in the first text slot; file parts keep their position.

`Shell.result` in `packages/core/src/shell.ts` bounds its own output independently and reads the **tail** page of the
PTY buffer, so a shell tool result usually arrives already within the limits and `truncate` marks it untruncated.

Because truncation happens before publication, everything past the bound is invisible to the model *and* to the
estimate; the raw bytes survive only in the file the marker names. `packages/core/src/session/recent-text.ts` applies a
second, much smaller bound (`TOOL_OUTPUT_MAX_CHARS`) when tool outputs are rendered into the summary transcript, and
`clip` in `compaction.ts` drops output levels progressively (`OUTPUTS_CLIPPED` → `OMITTED`) when a summary request is
itself rejected as too long.

## Decisions

**The wide rule is core's estimation rule, and it borrows the blind rule's rounding.** Rejected first: swapping
`estimate` for `estimateWide` as it stood, charging narrow text `ceil(narrow / 4)` while the budgets were tuned against
`round(length / 4)`. Failure mode: every trigger moves at once — `RESERVE_MIN`, `keep`, `PRECOMPUTED_TAIL_MIN` and the
shrink steps are absolute token counts, so an English session would start compacting earlier for reasons no test names.
What was done instead: make the wide rule's narrow half identical to `estimate`, so the swap moves CJK text and nothing
else, and prove it with the exact-token assertions already in `session-compaction.test.ts`. Adopting the wide rule
fixes the real defect — a Chinese session estimated at a quarter of its size reached a provider rejection instead of
compacting.

**Provider counts are not allowed to lower an estimate.** The anchor's measured value plus an estimated tail is the
working rule; a correction that only ever moves the number down defeats every budget derived from it. A learned
scale factor from the anchor gap was considered and not built: the anchor already replaces the estimate for everything
it covers, so a scale would only sharpen the tail — the part that is short by construction — while adding state that
survives a restart. The same reasoning keeps `SHRINK_STEPS` a fixed ladder rather than a learned ratio.

**Only the current provider's token counts are trusted.** Rejected: anchoring on any recorded usage. Failure mode: a
count from another provider describes a window and a tokenizer this model cannot replay, and history holds the original
messages that window stood for, which the count leaves out — the estimate then reads low and the request is rejected.

**Repeated compaction is stopped by counting checkpoints, not by measuring the shrink.** Rejected: recomputing the
post-summary prompt size and comparing it to the pre-summary one. Failure mode: the pre-summary size is not retained
anywhere, and storing it would add a durable field for a number the fold can produce — the loaded window starts at the
newest checkpoint, so a turn with several completed summaries is exactly the case where each summary failed to buy
room. `due` runs on every step anyway, so the next step supplies the same information for free and the guard only has
to refuse the next summary.

**A large tool result is clipped before it is durable, and the clip keeps both ends.** Rejected first: letting full
outputs enter history and compacting them later — the raw bytes then re-send in every later step until some round of
compaction notices. Rejected second: a head-only slice. Failure mode: a build, test, or install log puts its verdict at
the end, so the head slice kept the setup and dropped the reason the model needed, and the shell tool's own bound in
`Shell.result` had already reached the opposite conclusion by reading the tail page of the PTY buffer. Head plus tail
reconciles the two.

**No model call to summarize the middle of one tool result.** The rejected design keeps the first and last lines
verbatim, LLM-summarizes everything between them, and falls back to deterministic truncation when the summary fails.
Turned down for this codebase: the complete output is already on disk and its path is in the marker, so the model can
re-read the exact bytes it wants instead of trusting a paraphrase of the part that was cut — and the paraphrase would
cost a request on the critical path of any step that produced a large result. If a future measurement shows models
re-reading those files constantly, the summary becomes worth its latency.

**Each service owns its own metadata key.** Rejected: sharing a bare `truncated` flag between the clipper and the tools.
Failure mode is the record above — `grep` and `read` set it to mean "I paged", the clipper read it as "already bounded",
and every oversized search or file read escaped the bound while every test stayed green. `metadata` on a tool result is
`Record(String, Json)` with no type relationship between writer and reader, so a key that two owners interpret
differently cannot be caught by the compiler, by a lint rule, or by a unit test that builds its own input. When a service
records state in another component's free-form record, namespace it under a key that names the service.

**An unknown context window does not refuse the session.** `calculateCeiling` returns infinity when the model reports
no window, and `UNKNOWN_WINDOW` assumes a common size for the compaction request. Rejected: guessing a small window and
refusing to run. Failure mode: a catalog gap turns into an unusable client. What is still missing is the opposite case —
a *known* window too small to hold the fixed request overhead has no explicit diagnosis, so the session fails as a
provider rejection rather than as a stated configuration problem.

## Tests

`packages/core/test/session-compaction.test.ts` drives the real `SessionCompaction.node` against SQLite and a mock
`LLMClient`, and asserts on `estimateContext` numbers directly — so a change to an estimator shows up there first. Those
assertions are exact token counts on ASCII fixtures, which is what proves a rule change touched CJK text only; the file
also pins a Han conversation crossing the ceiling and the `compaction.stalled` guard.
`tool-output.test.ts` covers the clip, `session-usage.test.ts` and `usage-limits.test.ts` cover the provider-side
numbers, and compaction scenarios also run inside `session-runner.test.ts`. Run from `packages/core` with `bun run test`.
`packages/util/src/token.test.ts` holds the estimator's own rules, including its parity with `estimate`.
