# Usage statistics

What `session.stats` counts, and what the **Token 使用统计** settings page is allowed to claim from it. Read this
before changing `packages/core/src/session/stats.ts`, `packages/schema/src/session-stats.ts`, or
`packages/app/src/settings/usage/`.

## What is folded

`SessionStats.get({from, to, project, timezone, tools})` walks `session_message` joined to `session_v2` in 31-day
windows, and reads the per-message numbers out of the stored JSON with `json_extract`: `$.tokens.input|output|reasoning`,
`$.tokens.cache.read|write`, `$.cost`, and `$.model.*`. Only `user` and `assistant` rows are read, and a row that
belongs to a fork but predates the fork's own creation is skipped, so copying a session does not double-count its
history.

The fold produces, in one pass: `sessions` / `subagents` (top-level versus parented), `prompts`, `steps`, `messages`,
`tokens`, `cost`, `models` (per model, sorted by total tokens), and `activity` — one row per **local** calendar day
with that day's `steps` and `tokens`. `activeDays`, `streak` (the longest run of consecutive active days in the
range) and `currentStreak` (the run ending on the last active day) all read off the same sorted day list.

Two things are deliberately separate numbers, not one:

- `tokens` also folds the durable `session.usage.recorded` events whose `source` is `compaction`. Those events carry
  no model and are not attributed to a day, so **the sum of `activity[].tokens` can be smaller than
  `tokenTotal(tokens)`**. The page shows the total as 累计/窗口 TOKEN and the days as the distribution; making them
  agree would mean inventing a day for an event that has one in `EventTable.created` but no message to hang a model on.
- `steps` counts assistant messages, not model requests, and `messages` counts both roles. A reverted turn stays in
  the history and stays in the numbers.

`longestSession` measures a session's own span — `time_created` to `time_idle`, falling back to `time_updated` for a
session that never went idle — and selects by **overlap** with the range, so a session that started before the window
and ran through it is the longest one inside it. Subagent sessions are excluded: the number is about the session a
person opened.

## What the page shows

`packages/app/src/settings/usage/usage.tsx` is a per-server settings page (`tab=usage`). It makes exactly two
requests: one with no lower bound for the history block (累计 / 单日峰值 / 最长会话 / 当前连续 / 最长连续), and one for
the selected range (the 使用统计 grid, the trend, the model ring and the distribution strip).
`packages/app/src/settings/usage/model.ts` holds every computation that is not rendering:

- `rangeWindow` turns a range key into `{from, to}` in the **renderer's** timezone, because the page is about the
  person's day. `all` sends no `from` on purpose: sending `0` would make the server walk one SQL window per 31 days
  since 1970. `custom` reads the two picked dates as local days and refuses to invent a window when they are missing.
- `distribution(activity, mode, window)` fills every local day the window covers before bucketing, so the trend plots
  time rather than "the days that happened to have usage". `mode` is daily, weekly (weeks start Monday) or cumulative.
- `peakDay` and `shares` / `ticks` derive what the server does not store: the busiest day, and the per-model ring.
  `shares` merges variants of one model, folds everything past the sixth into one entry, and forces the percentages to
  close at 100 so the ring has no gap.
- `areaScale` is the heatmap's scale: coverage grows with the square root, so a day with ten times the tokens covers
  ten times the area instead of ten times the radius.
- `span` splits a duration into days and hours so the units stay translatable, and `tokenTotal` is the single
  definition of "total tokens" on the page.

The charts are hand-written SVG with no charting library. The model ring is 100 ticks — one per percent, longer every
tenth — and the trend is a polyline measured to its container so the dots stay round. Identity comes from the legend
labels, magnitude from opacity and area.

Numbers are formatted with `Intl.NumberFormat(language.intl(), { notation: "compact" })`, which is what makes the
same value read as `1586.32万` in Chinese and `15.9M` in English without a second formatter, with the exact integer
underneath.

The range picker is a row of text buttons rather than `SegmentedControl`: that component is a fixed 232px wide, and
eight ranges cannot share it without truncating every label to an ellipsis.

## Decisions

**No categorical series colours.** The v2 theme exposes one accent hue and no chart palette, and the repo rule is to
extend the theme rather than repurpose an unrelated token. So the model ring and the trend use that single hue, with
the legend carrying identity and opacity/area carrying magnitude. Rejected: borrowing the state tokens (`success`,
`danger`, `warning`) as a series palette — they mean outcome, and a red line that means "third model" is a lie.

**The page keeps no counters of its own.** Rejected: caching totals in app settings. Failure mode: a deleted session
leaves a number behind that nothing can explain. Cost paid: two `session.stats` calls per visit, which is why the
page fetches lazily as a settings tab rather than on the session screen.

**`streak` kept its meaning; `currentStreak` was added beside it.** Renaming `streak` to `longestStreak` would have
been tidier and is a breaking change to a published route for no functional gain. The two names are documented here
because the difference — longest run ever inside the range versus the run still going — is the one thing a reader
cannot infer from the field name.

**Per-day tokens, not per-day cost.** The distribution answers "when did I use it", and cost depends on which model
was used, so a day of cheap long runs would read as quiet. Cost stays a range-level number.

**Compaction usage stays out of the day buckets** rather than being spread across the range. Spreading it would make
the two views agree and would also be a fiction; the mismatch is stated above and visible in the page, where 累计 is
larger than the sum of the dots.

## Tests

`packages/core/test/session-stats.test.ts` pins the fold: per-day steps and tokens, `messages`, both streaks, the
fork-window exclusion, and a dedicated case for `longestSession` overlap semantics (a session that started before the
window, a still-running one measured through `time_updated`, and a subagent that must not win).
`packages/app/src/settings/usage/model.test.ts` pins the range windows, the peak, gap filling, weekly and cumulative
grouping, the model share merge across variants, the ring ticks, the area scale, and the duration split. Run them
from `packages/core` and `packages/app` (`bun run test:unit` there).
