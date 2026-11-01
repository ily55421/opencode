import { describe, expect, test } from "bun:test"
import { SessionMessage } from "@opencode/core/session/message"
import {
  decide,
  EMPTY_RESPONSE_RETRY,
  EMPTY_RESPONSE_STOPPED,
  NOTICE_EMPTY_RETRY,
  NOTICE_EMPTY_STOPPED,
} from "@opencode/core/session/runner/empty"

const message = (value: unknown) => value as SessionMessage.Info

const empty = () => message({ type: "assistant", content: [], finish: "stop" })
const said = (text: string) => message({ type: "assistant", content: [{ type: "text", text }], finish: "stop" })
const tool = (status: "completed" | "error") =>
  message({
    type: "assistant",
    content: [
      {
        type: "tool",
        id: "call-1",
        name: "echo",
        state:
          status === "completed"
            ? { status: "completed", input: { text: "hi" }, content: [{ type: "text", text: "hi" }] }
            : { status: "error", input: { text: "hi" }, error: { type: "tool.execution", message: "denied" } },
      },
    ],
    finish: "stop",
  })
const notices = (count: number) =>
  Array.from({ length: count }, () =>
    message({ type: "synthetic", text: EMPTY_RESPONSE_RETRY, metadata: { notice: NOTICE_EMPTY_RETRY } }),
  )
const idle = () => message({ type: "idle", outcome: "succeeded" })

describe("SessionRunnerEmpty.decide", () => {
  test("says nothing about a step that produced output", () => {
    expect(decide([said("Done")])).toBeUndefined()
  })

  test("treats whitespace as no output", () => {
    expect(decide([said("   \n ")])).toMatchObject({ notice: NOTICE_EMPTY_RETRY })
  })

  test("retries the first blank answer", () => {
    expect(decide([empty()])).toMatchObject({ notice: NOTICE_EMPTY_RETRY, continue: true })
  })

  test("leaves a step that never settled alone — no answer arrived to nudge", () => {
    expect(decide([message({ type: "assistant", content: [] })])).toBeUndefined()
  })

  test("leaves a failed step alone — the retry machinery owns it", () => {
    expect(
      decide([
        message({
          type: "assistant",
          content: [],
          finish: "error",
          error: { type: "provider.invalid-request", message: "Invalid request" },
        }),
      ]),
    ).toBeUndefined()
  })

  test("leaves a blank answer after a successful tool alone", () => {
    expect(decide([tool("completed"), empty()])).toBeUndefined()
  })

  test("retries a blank answer after a failed tool", () => {
    expect(decide([tool("error"), empty()])).toMatchObject({ notice: NOTICE_EMPTY_RETRY })
  })

  test("stops after three retries, and the stop is not a retry", () => {
    const decision = decide([...notices(3), empty()])
    expect(decision).toMatchObject({ text: EMPTY_RESPONSE_STOPPED, notice: NOTICE_EMPTY_STOPPED, continue: false })
  })

  test("counts retries from history, so a restart does not reset them", () => {
    // One retry cycle: an empty answer, then the synthetic notice it produced.
    const cycle = [empty(), ...notices(1)]
    const history = [...cycle, ...cycle]
    expect(decide([...history, empty()])?.notice).toBe(NOTICE_EMPTY_RETRY)
    expect(decide([...history, ...cycle, empty()])?.notice).toBe(NOTICE_EMPTY_STOPPED)
  })

  test("starts over at the turn boundary", () => {
    expect(decide([...notices(3), idle(), empty()])).toMatchObject({ notice: NOTICE_EMPTY_RETRY })
  })

  test("does not read a turn that never answered as empty when there is no assistant yet", () => {
    expect(decide([])).toBeUndefined()
  })
})
