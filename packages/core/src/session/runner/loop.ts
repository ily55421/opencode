export * as SessionRunnerLoop from "./loop.js"

import { createHash } from "crypto"
import { Config } from "../../config.js"
import { Instructions } from "../../instructions/index.js"
import { Option } from "effect"
import { Effect } from "effect"
import { SessionMessage } from "../message.js"
import { currentTurn } from "./unfinished.js"

/** How many settled calls a repetition search looks back over, and the longest period it accepts. */
const WINDOW = 25
const MAX_PERIOD = 5
/** Consecutive identical periods that mean the model is not moving: `R` runs of a `k`-call block. */
const REPEAT_LIMIT = 5
/** Rejections of a blocked call after which the turn is closed out instead of blocked once more. */
const REJECT_LIMIT = 3
/** Consecutive permission rejections of one exact call before the turn is closed out. */
const DECLINE_LIMIT = 8
/** Unparseable tool inputs in one turn before the turn is closed out. */
const MALFORMED_LIMIT = 3
/**
 * Failures of one tool across *different* arguments, counted per error category and per normalized
 * path, before the turn is closed out. One failure earlier the runner advises instead of blocking.
 */
const FAILURE_STREAK_LIMIT = 6

/**
 * Model-visible contract token. Kept in sync with `doc/session-loop.md`; the wording separates it
 * from a permission rejection, which is a user decision and not a statement that the model is stuck.
 */
export const LOOP_GUARD = (times: number) =>
  `Loop guard: this exact tool call (same arguments, same result) has been made ${times} times in
a row. Repeating it will not help. Change the arguments to get new information, use a
different approach, or ask the user.`

export const LOOP_GUARD_STOP = `Loop guard: automatic continuation stopped because the same tool calls kept
repeating. Tools are disabled for this closing step. Say what is stuck and ask the user how to proceed.`

export const LOOP_DECLINE_STOP = `Permission guard: automatic continuation stopped because the same call was
refused repeatedly. Tools are disabled for this closing step. Ask the user what should change.`

export const LOOP_MALFORMED_STOP = (limit: number) =>
  `Format guard: automatic continuation stopped after ${limit} unparseable tool calls in this turn. Tools are
disabled for this closing step. Answer in text, or issue one well-formed call after the user replies.`

export const LOOP_FAILURE_ADVISORY = (tool: string, failures: number) =>
  `Failure guard: ${tool} has failed ${failures} times in this turn, each with different arguments. Repeating
it with new parameters is not making progress. Change the approach, inspect the underlying problem, or ask
the user.`

export const LOOP_FAILURE_STOP = (tool: string, failures: number) =>
  `Failure guard: automatic continuation stopped because ${tool} kept failing across different arguments
(${failures} failures in this turn). Tools are disabled for this closing step. Report what is failing and
ask the user how to proceed.`

/** `metadata.notice` value of the one-failure-before-the-limit advisory, so clients can label it. */
export const NOTICE_FAILURE_ADVISORY = "failure-streak-advisory"

const NONE: ReadonlyMap<string, number> = new Map()

const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 12)

/**
 * A clipped tool result names the file its overflow spilled to, and that file is unique per call.
 * Folding the path away is what lets the same oversized search look identical on the second run
 * instead of forever looking like new information.
 */
const CLIPPED = /\[showing [^\]]*?full output saved to [^\]]*?\]/g
const output = (value: unknown) => Instructions.canonical(value).replace(CLIPPED, "[clipped output]")

/**
 * The identity of one call. The arguments are the model's own text as persisted, before any input
 * repair hook ran, so the guard and the history fold derive the same key from the same call.
 */
export const callKey = (tool: string, input: unknown) => hash(Instructions.canonical({ tool, input }))

type Fact = {
  readonly key: string
  readonly digest: string
  readonly declined: boolean
  readonly malformed: boolean
  readonly rejected: boolean
  readonly failed: boolean
  readonly tool: string
  /** Which message of the turn the call came from; a parallel batch counts each key once. */
  readonly batch: number
  /** Settled failure kind feeding the cross-parameter streaks; undefined when the fact counts none. */
  readonly category?: string
  /** Normalized path-like argument feeding the path streak; undefined when the input has none. */
  readonly path?: string
}

const DECLINED = (type: string, message: string) =>
  type === "permission.rejected" || message === "The user declined this tool call" || message.startsWith("Permission denied:")
const MALFORMED = new Set(["tool.input-json", "tool.input-incomplete"])
/** Settled failures that are the machinery speaking, not the model spinning in place. */
const UNCOUNTED = new Set(["aborted", "tool.result-missing"])

const ABORTED_MESSAGE = /abort|interrupt/i
const NOT_FOUND = /not found|no such file|no such directory|does not exist|doesn't exist|enoent|cannot find/i
const TIMEOUT = /\btimed ?out\b|etimedout|deadline exceeded/i
const INVALID = /invalid|unexpected|failed to parse|parse error|must be/i

/**
 * Buckets a tool failure so `read(a)`, `read(b)` and `read(c)` can share a counter even though their
 * arguments differ. Timeouts count on purpose: a tool that always answers too late is spinning too.
 */
const errorCategory = (type: string, message: string) => {
  if (type === "aborted" || ABORTED_MESSAGE.test(message)) return undefined
  if (NOT_FOUND.test(message)) return "not-found"
  if (TIMEOUT.test(message)) return "timeout"
  if (INVALID.test(message)) return "invalid"
  return "error"
}

const PATH_KEYS = new Set(["path", "file", "filepath", "file_path", "filename", "dir", "directory", "url", "target"])

/**
 * The path-like argument of a call, separator-normalized, so failures of `read(a\\b)` and `read(a/b)`
 * share a counter. Calls without a recognizable path only feed the category counters.
 */
const pathKey = (input: unknown) => {
  if (typeof input !== "object" || input === null) return undefined
  for (const [key, value] of Object.entries(input)) {
    if (!PATH_KEYS.has(key.toLowerCase()) || typeof value !== "string" || value.length === 0) continue
    return value.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/\/+$/, "")
  }
  return undefined
}

/** Every settled tool call of this turn, in the order the model made them. */
function facts(messages: ReadonlyArray<SessionMessage.Info>): Fact[] {
  const settled: Fact[] = []
  currentTurn(messages).forEach((message, batch) => {
    if (message.type !== "assistant") return
    for (const part of message.content) {
      if (part.type !== "tool") continue
      const state = part.state
      if (state.status === "completed") {
        settled.push({
          key: callKey(part.name, state.input),
          digest: hash(output(state.content)),
          declined: false,
          malformed: false,
          rejected: false,
          failed: false,
          tool: part.name,
          batch,
          path: pathKey(state.input),
        })
        continue
      }
      if (state.status !== "error") continue
      const declined = DECLINED(state.error.type, state.error.message)
      const rejected = state.error.message.startsWith("Loop guard:")
      // Arguments cut off by the output token limit share the incomplete-input error type with
      // arguments the model never finished writing. The first belongs to the output-limit breaker,
      // so only a step that ended for another reason counts as a formatting failure here.
      const malformed = MALFORMED.has(state.error.type) && message.finish !== "length"
      // Permission refusals stay owned by the decline counter, unformattable calls by the malformed
      // counter, and machinery failures do not describe the model at all.
      const counted = !declined && !rejected && !malformed && !UNCOUNTED.has(state.error.type)
      settled.push({
        key: callKey(part.name, state.input),
        digest: hash(`${state.error.type}\0${state.error.message}`),
        declined,
        malformed,
        rejected,
        failed: true,
        tool: part.name,
        batch,
        category: counted ? errorCategory(state.error.type, state.error.message) : undefined,
        path: counted ? pathKey(state.input) : undefined,
      })
    }
  })
  return settled
}

/** The trailing run of refusals of one exact call. A refusal of a different call restarts it. */
function declinedRun(settled: ReadonlyArray<Fact>) {
  const last = settled.at(-1)
  if (last === undefined || !last.declined) return 0
  let run = 0
  for (let index = settled.length - 1; index >= 0; index--) {
    const fact = settled[index]
    if (fact === undefined || !fact.declined || fact.key !== last.key) break
    run += 1
  }
  return run
}

/**
 * Finds a call block that repeats verbatim. `k = 1` is the same call five times; `k = 2` is `A B`
 * alternating five times, which a same-call counter cannot see and which is the shape a model
 * actually spins in when it toggles between two files.
 */
function repetition(settled: ReadonlyArray<Fact>) {
  const window = settled.slice(-WINDOW)
  for (let period = 1; period <= MAX_PERIOD; period++) {
    const needed = period * REPEAT_LIMIT
    if (window.length < needed) continue
    const tail = window.slice(-needed)
    const block = tail.slice(0, period)
    if (tail.every((fact, index) => fact.key === block[index % period].key && fact.digest === block[index % period].digest))
      return block.map((fact) => fact.key)
  }
  return undefined
}

/**
 * The largest cross-parameter failure streak, over one counter per (tool, error category) and one per
 * (tool, normalized path) — the axis the exact-call repetition search cannot see, where the arguments
 * keep changing but the model is not moving. A success of the tool clears its category counters and a
 * success on a path clears that path's counter, so a retry that starts producing is not read as
 * spinning. Failures that arrived in one parallel batch count once per key: the model has not yet
 * seen the results it is supposed to adjust against, and the next batch still accumulates.
 */
function failureStreak(settled: ReadonlyArray<Fact>) {
  const errors = new Map<string, number>()
  const paths = new Map<string, number>()
  let batch = -1
  let counted = new Set<string>()
  let best: { readonly tool: string; readonly count: number } | undefined
  const bump = (map: Map<string, number>, key: string, tool: string) => {
    const next = (map.get(key) ?? 0) + 1
    map.set(key, next)
    if (best === undefined || next > best.count) best = { tool, count: next }
  }
  for (const fact of settled) {
    if (fact.batch !== batch) {
      batch = fact.batch
      counted = new Set()
    }
    if (!fact.failed) {
      // The tool just worked, so its failure streaks were environmental, not a spin.
      for (const key of [...errors.keys()]) if (key.startsWith(`${fact.tool}:`)) errors.delete(key)
      if (fact.path !== undefined) paths.delete(`${fact.tool}:${fact.path}`)
      continue
    }
    if (fact.category !== undefined) {
      const key = `${fact.tool}:${fact.category}`
      if (!counted.has(`e:${key}`)) {
        counted.add(`e:${key}`)
        bump(errors, key, fact.tool)
      }
    }
    if (fact.path !== undefined) {
      const key = `${fact.tool}:${fact.path}`
      if (!counted.has(`p:${key}`)) {
        counted.add(`p:${key}`)
        bump(paths, key, fact.tool)
      }
    }
  }
  return best
}

/** Whether this turn already consumed its one cross-parameter advisory. */
function advised(messages: ReadonlyArray<SessionMessage.Info>) {
  return currentTurn(messages).some(
    (message) => message.type === "synthetic" && message.metadata?.notice === NOTICE_FAILURE_ADVISORY,
  )
}

export type Decision = {
  /** Call keys to reject, mapped to how many times the model has already made them. */
  readonly blocked: ReadonlyMap<string, number>
  /** The instruction appended as the closing step's assistant message, with tools turned off. */
  readonly stop?: string
  /** A one-failure-before-the-limit notice the runner publishes as a synthetic message. */
  readonly advisory?: { readonly text: string; readonly notice: typeof NOTICE_FAILURE_ADVISORY }
}

/**
 * Decides whether this turn is going in circles, folded from the durable message history so a
 * restart or a location reload cannot quietly reset the counters. Each counter has its own cause and
 * its own wording, and they share one closing move: refuse the next call and run one text-only step.
 * The cross-parameter failure streak is the one counter that speaks a step before it closes.
 */
export const decide = (messages: ReadonlyArray<SessionMessage.Info>, enabled: boolean): Decision => {
  if (!enabled) return { blocked: NONE }
  const settled = facts(messages)
  const rejections = settled.filter((fact) => fact.rejected).length
  // A refusal is the guard's own output, not a call the model made. Leaving it in the sequence would
  // break the pattern it is supposed to detect, so the guard would release itself after one refusal.
  const calls = settled.filter((fact) => !fact.rejected)
  if (calls.filter((fact) => fact.malformed).length >= MALFORMED_LIMIT)
    return { blocked: NONE, stop: LOOP_MALFORMED_STOP(MALFORMED_LIMIT) }
  if (declinedRun(calls) >= DECLINE_LIMIT) return { blocked: NONE, stop: LOOP_DECLINE_STOP }
  if (rejections >= REJECT_LIMIT) return { blocked: NONE, stop: LOOP_GUARD_STOP }
  const failure = failureStreak(calls)
  if (failure !== undefined && failure.count >= FAILURE_STREAK_LIMIT)
    return { blocked: NONE, stop: LOOP_FAILURE_STOP(failure.tool, failure.count) }
  const repeated = repetition(calls)
  if (repeated !== undefined) return { blocked: new Map(repeated.map((key) => [key, REPEAT_LIMIT])) }
  if (failure !== undefined && failure.count >= FAILURE_STREAK_LIMIT - 1 && !advised(messages))
    return {
      blocked: NONE,
      advisory: { text: LOOP_FAILURE_ADVISORY(failure.tool, failure.count), notice: NOTICE_FAILURE_ADVISORY },
    }
  return { blocked: NONE }
}

/** Reads `experimental.loop_guard` from the Config in scope; without one, the guard is on. */
export const enabled = Effect.gen(function* () {
  const config = yield* Effect.serviceOption(Config.Service)
  if (Option.isNone(config)) return true
  return Config.latest(yield* config.value.entries(), "experimental")?.loop_guard !== false
})
