export * as SessionStats from "./session-stats.js"

import { Schema } from "effect"
import { Model } from "./model.js"
import { Money } from "./money.js"
import { DateTimeUtcFromMillis, NonNegativeInt, optional } from "./schema.js"
import { TokenUsage } from "./token-usage.js"

export const Activity = Schema.Struct({
  date: Schema.String,
  steps: NonNegativeInt,
  /** Tokens produced by the assistant steps on that day. Compaction's recorded usage is in `tokens`, not here. */
  tokens: NonNegativeInt,
}).annotate({ identifier: "SessionStats.Activity" })
export type Activity = typeof Activity.Type

/** The session that stayed active longest inside the range, measured from its first message to going idle. */
export const LongestSession = Schema.Struct({
  sessionID: Schema.String,
  duration: NonNegativeInt,
}).annotate({ identifier: "SessionStats.LongestSession" })
export type LongestSession = typeof LongestSession.Type

export const ModelUsage = Schema.Struct({
  model: Model.Ref,
  steps: NonNegativeInt,
  tokens: TokenUsage.Info,
  cost: Money.USD,
}).annotate({ identifier: "SessionStats.ModelUsage" })
export type ModelUsage = typeof ModelUsage.Type

export const ToolUsage = Schema.Struct({
  name: Schema.String,
  calls: NonNegativeInt,
  succeeded: NonNegativeInt,
  failed: NonNegativeInt,
  unfinished: NonNegativeInt,
  durationP50: Schema.Finite.pipe(optional),
}).annotate({ identifier: "SessionStats.ToolUsage" })
export type ToolUsage = typeof ToolUsage.Type

export const ToolMode = Schema.Literals(["none", "summary", "detail"])
export type ToolMode = typeof ToolMode.Type

export const ToolTotals = Schema.Struct({
  calls: NonNegativeInt,
  succeeded: NonNegativeInt,
  failed: NonNegativeInt,
  unfinished: NonNegativeInt,
}).annotate({ identifier: "SessionStats.ToolTotals" })
export type ToolTotals = typeof ToolTotals.Type

export const Tools = Schema.Union([
  Schema.Struct({ mode: Schema.Literal("none") }),
  Schema.Struct({ mode: Schema.Literal("summary"), totals: ToolTotals }),
  Schema.Struct({ mode: Schema.Literal("detail"), totals: ToolTotals, usage: Schema.Array(ToolUsage) }),
]).annotate({ identifier: "SessionStats.Tools" })
export type Tools = typeof Tools.Type

export const Info = Schema.Struct({
  range: Schema.Struct({
    from: DateTimeUtcFromMillis,
    to: DateTimeUtcFromMillis,
  }),
  sessions: NonNegativeInt,
  subagents: NonNegativeInt,
  prompts: NonNegativeInt,
  steps: NonNegativeInt,
  /** User and assistant messages inside the range, which is what a usage page calls "消息累计". */
  messages: NonNegativeInt,
  tokens: TokenUsage.Info,
  cost: Money.USD,
  tools: Tools,
  activeDays: NonNegativeInt,
  /** The longest run of consecutive active days anywhere in the range. */
  streak: NonNegativeInt,
  /** The run of consecutive active days ending at the range's last active day. */
  currentStreak: NonNegativeInt,
  longestSession: optional(LongestSession),
  activity: Schema.Array(Activity),
  models: Schema.Array(ModelUsage),
}).annotate({ identifier: "SessionStats.Info" })
export type Info = typeof Info.Type
