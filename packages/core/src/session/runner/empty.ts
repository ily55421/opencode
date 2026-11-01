export * as SessionRunnerEmpty from "./empty.js"

import { SessionMessage } from "../message.js"
import { currentTurn } from "./unfinished.js"

/** Empty answers are the model stalling, not the network: three of them in one turn ends the turn. */
const MAX_EMPTY_RESPONSE_RETRIES = 3

/**
 * Model-visible nudge for a step that produced nothing. It says what to do rather than repeating the
 * request, because the request was already answered — with silence.
 */
export const EMPTY_RESPONSE_RETRY =
  "Your previous response had no visible output. Continue the task: call a tool, or write the answer the user needs. Do not reply with only an acknowledgement."

/**
 * The turn ends with nothing produced. A notice, not a session error: the session is fine, the model
 * stopped answering.
 */
export const EMPTY_RESPONSE_STOPPED =
  "The model returned three responses with no visible output in a row, so automatic continuation stopped. Ask the user how to proceed."

/** `metadata.notice` values, so a client can label these messages without matching their text. */
export const NOTICE_EMPTY_RETRY = "empty-response-retry"
export const NOTICE_EMPTY_STOPPED = "empty-response-stopped"

export type Decision = {
  readonly text: string
  readonly description: string
  readonly notice: typeof NOTICE_EMPTY_RETRY | typeof NOTICE_EMPTY_STOPPED
  readonly continue: boolean
}

const visible = (part: SessionMessage.AssistantContent) =>
  part.type === "tool" || (part.type === "text" && part.text.trim().length > 0)

const succeededTool = (part: SessionMessage.AssistantContent) =>
  part.type === "tool" && part.state.status === "completed"

/**
 * Decide whether the step that just ended with no visible output should run again, folded from the
 * durable history so a restart cannot hand the model a fresh allowance for the same silence.
 *
 * Only a settled, non-failed step counts as "an answer". A stream that ends without any event writes
 * no assistant at all, and a failed step settles with the `error` finish — nudging either would spend
 * the retry allowance on a provider or transport anomaly instead of on the model's silence.
 *
 * A blank reply that follows a step where a tool actually ran is a finished turn, not an empty
 * response: the work happened, and retrying would spend a request to re-say "done".
 */
export const decide = (messages: ReadonlyArray<SessionMessage.Info>): Decision | undefined => {
  const turn = currentTurn(messages)
  const assistants = turn.filter((message): message is SessionMessage.Assistant => message.type === "assistant")
  const last = assistants.at(-1)
  if (last === undefined || last.content.some(visible)) return undefined
  if (last.finish === undefined || last.finish === "error") return undefined
  const previous = assistants.at(-2)
  if (previous !== undefined && previous.content.some(succeededTool)) return undefined
  const retries = turn.filter(
    (message) => message.type === "synthetic" && message.metadata?.notice === NOTICE_EMPTY_RETRY,
  ).length
  if (retries >= MAX_EMPTY_RESPONSE_RETRIES)
    return {
      text: EMPTY_RESPONSE_STOPPED,
      description: `Stopped after ${retries} empty responses`,
      notice: NOTICE_EMPTY_STOPPED,
      continue: false,
    }
  return {
    text: EMPTY_RESPONSE_RETRY,
    description: `Retrying after an empty response (${retries + 1} of ${MAX_EMPTY_RESPONSE_RETRIES})`,
    notice: NOTICE_EMPTY_RETRY,
    continue: true,
  }
}
