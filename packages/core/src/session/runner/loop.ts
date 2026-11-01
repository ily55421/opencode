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
}

const DECLINED = (type: string, message: string) =>
  type === "permission.rejected" || message === "The user declined this tool call" || message.startsWith("Permission denied:")
const MALFORMED = new Set(["tool.input-json", "tool.input-incomplete"])

/** Every settled tool call of this turn, in the order the model made them. */
function facts(messages: ReadonlyArray<SessionMessage.Info>): Fact[] {
  return currentTurn(messages).flatMap((message) =>
    message.type !== "assistant"
      ? []
      : message.content.flatMap((part) => {
          if (part.type !== "tool") return []
          const state = part.state
          if (state.status === "completed")
            return [
              {
                key: callKey(part.name, state.input),
                digest: hash(output(state.content)),
                declined: false,
                malformed: false,
                rejected: false,
              },
            ]
          if (state.status !== "error") return []
          return [
            {
              key: callKey(part.name, state.input),
              digest: hash(`${state.error.type}\0${state.error.message}`),
              declined: DECLINED(state.error.type, state.error.message),
              // Arguments cut off by the output token limit share the incomplete-input error type with
              // arguments the model never finished writing. The first belongs to the output-limit breaker,
              // so only a step that ended for another reason counts as a formatting failure here.
              malformed: MALFORMED.has(state.error.type) && message.finish !== "length",
              rejected: state.error.message.startsWith("Loop guard:"),
            },
          ]
        }),
  )
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

export type Decision = {
  /** Call keys to reject, mapped to how many times the model has already made them. */
  readonly blocked: ReadonlyMap<string, number>
  /** The instruction appended as the closing step's assistant message, with tools turned off. */
  readonly stop?: string
}

/**
 * Decides whether this turn is going in circles, folded from the durable message history so a
 * restart or a location reload cannot quietly reset the counters. Each counter has its own cause and
 * its own wording, and they share one closing move: refuse the next call and run one text-only step.
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
  const repeated = repetition(calls)
  if (repeated === undefined) return { blocked: NONE }
  return { blocked: new Map(repeated.map((key) => [key, REPEAT_LIMIT])) }
}

/** Reads `experimental.loop_guard` from the Config in scope; without one, the guard is on. */
export const enabled = Effect.gen(function* () {
  const config = yield* Effect.serviceOption(Config.Service)
  if (Option.isNone(config)) return true
  return Config.latest(yield* config.value.entries(), "experimental")?.loop_guard !== false
})
