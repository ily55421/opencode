# Context economics

How the size of a prompt is estimated, what budgets that estimate is used to enforce, and where a change to either can
burn money or hit a provider rejection. Read this before touching `packages/core/src/session/compaction.ts`,
`packages/core/src/tool-output.ts`, `packages/core/src/session/model-request.ts`, or `packages/util/src/token.ts`.

## Two estimators, deliberately

`packages/util/src/token.ts` exports both rules and they are not interchangeable:

- `estimate` — four characters per token, blind to script. Every server-side compaction threshold is tuned against this
  number, so it reads Chinese, Japanese and Korean text as roughly a quarter of its real length.
- `estimateWide` — one token per East Asian wide code point plus four characters per narrow token, which tracks real
  tokenizers at about 0.7–1 token per CJK character. It iterates code points so a surrogate pair is charged once.

`packages/core/src/util/token.ts` re-exports **only** `estimate`, on purpose: the desktop client cannot depend on core,
so the shared module has to hold both rules rather than the server picking one. Anything in core that wants the wide
rule has to add the export and then re-check the budgets below, because the estimate feeds thresholds written for the
blind rule and they move together.

`ESTIMATE_ERROR` in `packages/core/src/session/model-request.ts` adds a 15 percent margin on the *estimated* half of a
prompt when it sizes the output limit. That margin exists because character counting runs low on dense text such as
code — it is not a CJK correction, and it will not absorb a script-blind estimate.

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

## One tool result at a time

`packages/core/src/tool-output.ts` clips a tool result *before* it is published, so the model never receives the full
text: `MAX_LINES` and `MAX_BYTES` (configurable through the `ToolOutput` editor) keep a head-only slice, write the whole
output to a file under `data/tool-output` with a 7-day retention, and append a marker naming the path. `metadata.truncated`
and `metadata.outputPath` record what happened, and the guard at the top of `truncate` makes it idempotent.

Because truncation is head-only, everything past the byte or line bound is invisible to the model *and* to the estimate.
`packages/core/src/session/recent-text.ts` applies a second, much smaller bound (`TOOL_OUTPUT_MAX_CHARS`) when tool
outputs are rendered into the summary transcript, and `clip` in `compaction.ts` drops output levels progressively
(`OUTPUTS_CLIPPED` → `OMITTED`) when a summary request is itself rejected as too long.

## Decisions

**Thresholds stay calibrated to one estimator.** Rejected: swapping `estimate` for `estimateWide` inside core without
touching the budgets. Failure mode: every trigger moves at once — `RESERVE_MIN`, `keep`, `PRECOMPUTED_TAIL_MIN` and the
shrink steps are absolute token counts chosen against the blind rule, so the same session starts compacting earlier for
reasons no test would name. If the wide rule is adopted, the budgets are part of the same change.

**Only the current provider's token counts are trusted.** Rejected: anchoring on any recorded usage. Failure mode: a
count from another provider describes a window and a tokenizer this model cannot replay, and history holds the original
messages that window stood for, which the count leaves out — the estimate then reads low and the request is rejected.

**Provider counts are not allowed to lower an estimate.** The anchor's measured value plus an estimated tail is the
working rule; a correction that only ever moves the number down defeats every budget derived from it.

**A large tool result is clipped before it is durable, not summarized inside the loop.** Rejected: letting full outputs
enter history and compacting them later. Failure mode: the raw bytes get re-sent in every later step until some round
of compaction notices, which is the cost the head-only slice exists to avoid. The remainder lives in a file the model
can read again.

**An unknown context window does not refuse the session.** `calculateCeiling` returns infinity when the model reports
no window, and `UNKNOWN_WINDOW` assumes a common size for the compaction request. Rejected: guessing a small window and
refusing to run. Failure mode: a catalog gap turns into an unusable client. What is still missing is the opposite case —
a *known* window too small to hold the fixed request overhead has no explicit diagnosis, so the session fails as a
provider rejection rather than as a stated configuration problem.

## Tests

`packages/core/test/session-compaction.test.ts` drives the real `SessionCompaction.node` against SQLite and a mock
`LLMClient`, and asserts on `estimateContext` numbers directly — so a change to an estimator shows up there first.
`tool-output.test.ts` covers the clip, `session-usage.test.ts` and `usage-limits.test.ts` cover the provider-side
numbers, and compaction scenarios also run inside `session-runner.test.ts`. Run from `packages/core` with `bun run test`.
