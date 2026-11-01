import { describe, expect, test } from "bun:test"
import { SessionMessage } from "@opencode/core/session/message"
import {
  callKey,
  decide,
  LOOP_DECLINE_STOP,
  LOOP_GUARD_STOP,
  LOOP_MALFORMED_STOP,
} from "@opencode/core/session/runner/loop"

const message = (value: unknown) => value as SessionMessage.Info

const assistant = (parts: ReadonlyArray<unknown>, finish?: string) =>
  message({ type: "assistant", content: parts, ...(finish === undefined ? {} : { finish }) })

let calls = 0
const tool = (name: string, state: unknown) => ({ type: "tool", id: `call-${(calls += 1)}`, name, state })

const done = (name: string, input: unknown, result: string) =>
  tool(name, { status: "completed", input, content: [{ type: "text", text: result }], metadata: {} })

const refused = (name: string, input: unknown, message: string, type = "permission.rejected") =>
  tool(name, { status: "error", input, error: { type, message } })

const idle = () => message({ type: "idle", outcome: "succeeded" })

const ECHO = { text: "same" }
const key = callKey("echo", ECHO)

describe("SessionRunnerLoop.decide", () => {
  test("does nothing below the repeat limit", () => {
    const settled = Array.from({ length: 4 }, () => assistant([done("echo", ECHO, "hit")]))
    expect(decide(settled, true).blocked.size).toBe(0)
    expect(decide(settled, true).stop).toBeUndefined()
  })

  test("blocks the exact call once it has repeated five times with the same result", () => {
    const settled = Array.from({ length: 5 }, () => assistant([done("echo", ECHO, "hit")]))
    expect(decide(settled, true).blocked.get(key)).toBe(5)
  })

  test("lets a changed argument through", () => {
    const settled = [
      ...Array.from({ length: 4 }, () => assistant([done("echo", ECHO, "hit")])),
      assistant([done("echo", { text: "different" }, "hit")]),
    ]
    expect(decide(settled, true).blocked.size).toBe(0)
  })

  test("lets a poll through: same arguments, different result each time", () => {
    const settled = Array.from({ length: 12 }, (_, index) => assistant([done("echo", ECHO, `status ${index}`)]))
    const decision = decide(settled, true)
    expect(decision.blocked.size).toBe(0)
    expect(decision.stop).toBeUndefined()
  })

  test("breaks an alternating pair, which a same-call counter cannot see", () => {
    const settled = Array.from({ length: 10 }, (_, index) =>
      assistant([done(index % 2 === 0 ? "read" : "grep", { path: `f${index % 2}` }, "same")]),
    )
    const decision = decide(settled, true)
    expect(decision.blocked.size).toBe(2)
    expect(decision.blocked.get(callKey("read", { path: "f0" }))).toBe(5)
    expect(decision.blocked.get(callKey("grep", { path: "f1" }))).toBe(5)
  })

  test("recognises a longer period inside the window", () => {
    const block = [
      done("echo", { n: 1 }, "a"),
      done("echo", { n: 2 }, "b"),
      done("echo", { n: 3 }, "c"),
    ]
    const settled = Array.from({ length: 5 }, () => assistant(block))
    expect(decide(settled, true).blocked.size).toBe(3)
  })

  test("keeps different tools from feeding one counter", () => {
    const settled = Array.from({ length: 4 }, () => assistant([done("echo", ECHO, "hit"), done("read", ECHO, "hit")]))
    expect(decide(settled, true).blocked.size).toBe(0)
  })

  test("keeps blocking through its own refusals", () => {
    const settled = [
      ...Array.from({ length: 5 }, () => assistant([done("echo", ECHO, "hit")])),
      assistant([refused("echo", ECHO, "Loop guard: this exact tool call has been made 5 times in a row.", "tool.execution")]),
    ]
    expect(decide(settled, true).blocked.get(key)).toBe(5)
  })

  test("closes the turn after three refusals of a blocked call", () => {
    const settled = [
      ...Array.from({ length: 5 }, () => assistant([done("echo", ECHO, "hit")])),
      ...Array.from({ length: 3 }, () =>
        assistant([refused("echo", ECHO, "Loop guard: this exact tool call has been made 5 times in a row.", "tool.execution")]),
      ),
    ]
    expect(decide(settled, true).stop).toBe(LOOP_GUARD_STOP)
  })

  test("closes the turn after eight refusals of one call by the permission rules", () => {
    const settled = Array.from({ length: 8 }, () => assistant([refused("shell", { command: "ls" }, "not allowed")]))
    expect(decide(settled, true).stop).toBe(LOOP_DECLINE_STOP)
  })

  test("does not read a refusal of a different call as one streak", () => {
    const settled = Array.from({ length: 8 }, (_, index) =>
      assistant([refused("shell", { command: index % 2 === 0 ? "ls" : "pwd" }, "not allowed")]),
    )
    expect(decide(settled, true).stop).toBeUndefined()
  })

  test("closes the turn when the model cannot format its calls", () => {
    const settled = Array.from({ length: 3 }, () =>
      assistant([refused("echo", { text: "broken" }, "unterminated JSON", "tool.input-json")]),
    )
    expect(decide(settled, true).stop).toBe(LOOP_MALFORMED_STOP(3))
  })

  test("leaves output-limit truncation to the breaker that owns it", () => {
    const settled = Array.from({ length: 3 }, () =>
      assistant([refused("echo", { text: "partial" }, "arguments were cut off", "tool.input-incomplete")], "length"),
    )
    expect(decide(settled, true).stop).toBeUndefined()
  })

  test("starts over at the turn boundary", () => {
    const settled = [
      ...Array.from({ length: 6 }, () => assistant([done("echo", ECHO, "hit")])),
      idle(),
      assistant([done("echo", ECHO, "hit")]),
    ]
    expect(decide(settled, true).blocked.size).toBe(0)
  })

  test("counts from history, not from process memory", () => {
    const settled = Array.from({ length: 5 }, () => assistant([done("echo", ECHO, "hit")]))
    expect(decide(settled, true)).toEqual(decide(settled, true))
  })

  test("does nothing while the guard is off", () => {
    const settled = Array.from({ length: 30 }, () => assistant([done("echo", ECHO, "hit")]))
    const decision = decide(settled, false)
    expect(decision.blocked.size).toBe(0)
    expect(decision.stop).toBeUndefined()
  })
})
