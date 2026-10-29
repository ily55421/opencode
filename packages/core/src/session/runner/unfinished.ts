export * as SessionRunnerUnfinished from "./unfinished.js"

import { Option, Schema } from "effect"
import { SessionMessage } from "../message.js"
import { TodoTool } from "../../tool/plugin/todo.js"

/**
 * Model-visible nudge. It names `todowrite` because a generic "keep working with your tools" reads to a weaker model as
 * permission to re-check the work with the shell, which leaves the list exactly as unfinished as it was.
 */
export const TODO_RESIDUE =
  "Your todo list still has unfinished items. Call `todowrite` with the current status of every item, then finish the remaining ones. Do not end the turn while items are pending."

/** A louder wording once the same list has been nudged several times without moving. */
export const TODO_RESIDUE_ESCALATED =
  "Your todo list has still not moved after repeated reminders. Call `todowrite` now: mark finished items completed and cancel items you will not do, then complete what remains. Do not reply with a summary while items are still pending."

/**
 * The turn ends with the list still open. This is a notice and not a session error: an error reads as a broken session,
 * while the honest statement is that work remains.
 */
export const TODO_RESIDUE_STOPPED =
  "The turn ended with unfinished items on the todo list. Automatic continuation stopped; the remaining items stay as they are until you say otherwise."

/** `metadata.notice` values, so a client can label these messages without matching their text. */
export const NOTICE = "todo-residue"
export const NOTICE_STOPPED = "todo-residue-stopped"

/** Tools whose success changes something outside the conversation, so a step that used one made progress. */
const SIDE_EFFECT_TOOLS = new Set(["edit", "write", "patch", "shell"])
/** Nudges per turn at any price, including the productive ones. */
const MAX_NUDGES = 10
/** Nudges in a row with no side effect and nothing checked off, which means the model is not moving. */
const STALL_LIMIT = 3
/** Nudges after which the wording escalates. */
const ESCALATE_AFTER = 3

export type Decision = {
  readonly text: string
  readonly description: string
  readonly notice: typeof NOTICE | typeof NOTICE_STOPPED
  readonly continue: boolean
}

/**
 * Decide whether a step that stopped without tools should run again, folded from the turn's projected history so a
 * restart or a location reload cannot silently lose the counters and turn a bounded nudge into an unbounded loop.
 */
export const decide = (messages: ReadonlyArray<SessionMessage.Info>): Decision | undefined => {
  const turn = scan(currentTurn(messages))
  if (turn.open === 0 || turn.stopped) return undefined

  if (turn.nudges >= MAX_NUDGES || turn.stalled >= STALL_LIMIT)
    return {
      text: TODO_RESIDUE_STOPPED,
      description: `Stopped with ${turn.open} unfinished todo item(s)`,
      notice: NOTICE_STOPPED,
      continue: false,
    }

  return {
    text: turn.nudges >= ESCALATE_AFTER ? TODO_RESIDUE_ESCALATED : TODO_RESIDUE,
    description: `Continuing with ${turn.open} unfinished todo item(s)`,
    notice: NOTICE,
    continue: true,
  }
}

const scan = (turn: ReadonlyArray<SessionMessage.Info>) => {
  const state = { open: 0, nudges: 0, stalled: 0, moved: false, stopped: false }

  for (const message of turn) {
    if (message.type === "synthetic") {
      if (message.text === TODO_RESIDUE_STOPPED) state.stopped = true
      if (message.text !== TODO_RESIDUE && message.text !== TODO_RESIDUE_ESCALATED) continue
      state.nudges++
      state.stalled = state.moved ? 0 : state.stalled + 1
      state.moved = false
      continue
    }

    if (message.type !== "assistant") continue
    for (const part of message.content) {
      if (part.type !== "tool" || part.state.status !== "completed") continue
      if (part.name === TodoTool.name) {
        // Replacing the whole list with the same open count is the model restating the task, not doing it.
        const open = openCount(todos(part.state.metadata?.todos))
        if (state.nudges > 0 && open < state.open) state.moved = true
        state.open = open
      } else if (SIDE_EFFECT_TOOLS.has(part.name)) state.moved = true
    }
  }

  return state
}

/** The steps of this turn: everything after the marker that put the Session idle, or all history on the first turn. */
const currentTurn = (messages: ReadonlyArray<SessionMessage.Info>) =>
  messages.slice(messages.findLastIndex((message) => message.type === "idle") + 1)

const decodeTodos = Schema.decodeUnknownOption(Schema.Array(TodoTool.Info))
const todos = (value: unknown) => (value === undefined ? [] : Option.getOrUndefined(decodeTodos(value)) ?? [])

const openCount = (todos: ReadonlyArray<TodoTool.Info>) =>
  todos.filter((todo) => todo.status === "pending" || todo.status === "in_progress").length
