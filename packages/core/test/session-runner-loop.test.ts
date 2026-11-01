import { describe, expect, test } from "bun:test"
import { SessionMessage } from "@opencode/core/session/message"
import {
  callKey,
  decide,
  LOOP_DECLINE_STOP,
  LOOP_FAILURE_STOP,
  LOOP_GUARD_STOP,
  LOOP_MALFORMED_STOP,
  NOTICE_FAILURE_ADVISORY,
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

const failed = (name: string, input: unknown, message: string, type = "tool.execution") =>
  refused(name, input, message, type)

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

describe("SessionRunnerLoop cross-parameter failure streaks", () => {
  const varying = (count: number) =>
    Array.from({ length: count }, (_, index) => assistant([failed("echo", { text: `v${index}` }, "Echo unavailable")]))

  test("advises one failure before the limit when only the arguments change", () => {
    const decision = decide(varying(5), true)
    expect(decision.stop).toBeUndefined()
    expect(decision.advisory?.notice).toBe(NOTICE_FAILURE_ADVISORY)
    expect(decision.advisory?.text).toContain("echo")
  })

  test("closes the turn at the limit instead of advising again", () => {
    const decision = decide(varying(6), true)
    expect(decision.advisory).toBeUndefined()
    expect(decision.stop).toBe(LOOP_FAILURE_STOP("echo", 6))
  })

  test("keeps different error categories from feeding one counter", () => {
    const settled = [
      ...Array.from({ length: 3 }, (_, i) => assistant([failed("echo", { text: `a${i}` }, `file a${i} not found`)])),
      ...Array.from({ length: 2 }, (_, i) => assistant([failed("echo", { text: `b${i}` }, `invalid input b${i}`)])),
    ]
    expect(decide(settled, true).advisory).toBeUndefined()
  })

  test("keeps different tools from feeding one failure counter", () => {
    const settled = Array.from({ length: 8 }, (_, index) =>
      assistant([failed(index % 2 === 0 ? "echo" : "read", { text: `v${index}` }, "boom")]),
    )
    expect(decide(settled, true).advisory).toBeUndefined()
  })

  test("counts a path streak across separator spellings and error kinds", () => {
    const kinds = ["x not found", "y invalid", "z timed out", "w exploded", "v welp"]
    const spellings = ["src\\a.ts", "src//a.ts", "src/a.ts", "src/a.ts/", "src/a.ts"]
    const settled = kinds.map((kind, index) => assistant([failed("read", { path: spellings[index] }, kind)]))
    expect(decide(settled, true).advisory?.text).toContain("read")
  })

  test("clears a path streak when that path succeeds", () => {
    const kinds = ["a not found", "b invalid", "c timed out", "d welp"]
    const settled = [
      ...kinds.map((kind) => assistant([failed("read", { path: "src/a.ts" }, kind)])),
      assistant([done("read", { path: "src/a.ts" }, "contents")]),
      assistant([failed("read", { path: "src/a.ts" }, "e welp")]),
    ]
    expect(decide(settled, true).advisory).toBeUndefined()
  })

  test("clears a category streak when the tool succeeds", () => {
    const settled = [
      ...Array.from({ length: 4 }, (_, i) => assistant([failed("echo", { text: `v${i}` }, `attempt ${i}`)])),
      assistant([done("echo", { text: "fine" }, "ok")]),
      assistant([failed("echo", { text: "v5" }, "attempt 5")]),
    ]
    expect(decide(settled, true).advisory).toBeUndefined()
  })

  test("counts one parallel batch once per key", () => {
    const settled = [
      assistant([failed("echo", { text: "a" }, "boom"), failed("echo", { text: "b" }, "boom"), failed("echo", { text: "c" }, "boom")]),
      assistant([failed("echo", { text: "d" }, "boom"), failed("echo", { text: "e" }, "boom"), failed("echo", { text: "f" }, "boom")]),
    ]
    expect(decide(settled, true).advisory).toBeUndefined()
  })

  test("counts timeouts as failures", () => {
    const settled = Array.from({ length: 5 }, (_, i) => assistant([failed("fetch", { url: `h${i}` }, `request ${i} timed out`)]))
    expect(decide(settled, true).advisory?.text).toContain("fetch")
  })

  test("does not count permission refusals, aborted calls, or machinery failures", () => {
    const settled = Array.from({ length: 8 }, (_, i) =>
      assistant([
        refused("echo", { text: `d${i}` }, "The user declined this tool call"),
        failed("echo", { text: `a${i}` }, "Tool execution interrupted", "aborted"),
        failed("echo", { text: `m${i}` }, "Provider did not return a tool result", "tool.result-missing"),
      ]),
    )
    const decision = decide(settled, true)
    expect(decision.advisory).toBeUndefined()
    expect(decision.stop).toBeUndefined()
  })

  test("does not count unformattable calls, which the format breaker owns", () => {
    const settled = Array.from({ length: 8 }, (_, i) =>
      assistant([failed("echo", { text: `v${i}` }, "unterminated JSON", "tool.input-json")], "length"),
    )
    expect(decide(settled, true).advisory).toBeUndefined()
  })

  test("does not repeat the advisory once this turn has consumed it", () => {
    const settled = [
      ...varying(4),
      message({ type: "synthetic", text: "advisory", metadata: { notice: NOTICE_FAILURE_ADVISORY } }),
      assistant([failed("echo", { text: "v4" }, "Echo unavailable")]),
    ]
    const decision = decide(settled, true)
    expect(decision.advisory).toBeUndefined()
    expect(decision.stop).toBeUndefined()
  })

  test("starts the failure streak over at the turn boundary", () => {
    const settled = [...varying(8), idle(), assistant([failed("echo", { text: "v9" }, "Echo unavailable")])]
    const decision = decide(settled, true)
    expect(decision.advisory).toBeUndefined()
    expect(decision.stop).toBeUndefined()
  })

  test("does nothing while the guard is off", () => {
    const decision = decide(varying(30), false)
    expect(decision.advisory).toBeUndefined()
    expect(decision.stop).toBeUndefined()
  })
})
