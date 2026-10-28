import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistant } from "@opencode/client/promise"
import { cacheHitRate, contextSize, estimateOutputTokens, stepTokensPerSecond } from "./stats"

const step = (change: Partial<SessionMessageAssistant> = {}): SessionMessageAssistant => ({
  id: "msg_step",
  type: "assistant",
  agent: "build",
  model: { id: "model", providerID: "provider" },
  content: [],
  time: { created: 0 },
  ...change,
})

describe("estimateOutputTokens", () => {
  test("counts CJK glyphs once and other text at four characters per token", () => {
    expect(estimateOutputTokens([{ type: "text", text: "hello world" }])).toBe(3)
    expect(estimateOutputTokens([{ type: "text", text: "你好世界" }])).toBe(4)
    expect(estimateOutputTokens([{ type: "text", text: "你好, world" }])).toBe(4)
  })

  test("counts CJK punctuation as wide rather than as filler characters", () => {
    expect(estimateOutputTokens([{ type: "text", text: "你好，世界。" }])).toBe(6)
    expect(estimateOutputTokens([{ type: "text", text: "「引用」" }])).toBe(4)
  })

  test("charges an emoji or extension B glyph once, not as two narrow characters", () => {
    expect(estimateOutputTokens([{ type: "text", text: "🙂" }])).toBe(1)
    expect(estimateOutputTokens([{ type: "text", text: "𠀀" }])).toBe(1)
  })

  test("counts reasoning and streamed tool input as output", () => {
    const content: SessionMessageAssistant["content"] = [
      { type: "text", text: "done" },
      { type: "reasoning", text: "思考中" },
      {
        type: "tool",
        id: "tool_1",
        name: "read",
        state: { status: "streaming", input: '{"path":"a.ts"}' },
        time: { created: 0 },
      },
    ]

    expect(estimateOutputTokens(content)).toBe(1 + 3 + Math.ceil(14 / 4))
  })

  test("keeps a settled tool call's arguments in the count", () => {
    const content: SessionMessageAssistant["content"] = [
      {
        type: "tool",
        id: "tool_1",
        name: "read",
        state: { status: "running", input: { path: "a.ts" }, metadata: {} },
        time: { created: 0 },
      },
    ]

    expect(estimateOutputTokens(content)).toBe(Math.ceil('{"path":"a.ts"}'.length / 4))
  })

  test("grows as more output arrives", () => {
    expect(estimateOutputTokens([{ type: "text", text: "one two three four five" }])).toBeGreaterThan(
      estimateOutputTokens([{ type: "text", text: "one two" }]),
    )
  })
})

describe("stepTokensPerSecond", () => {
  test("weights output and reasoning against the provider's streaming duration", () => {
    const message = step({
      time: { created: 1_000, streamed: 3_000 },
      tokens: { input: 100, output: 100, reasoning: 20, cache: { read: 0, write: 0 } },
    })

    expect(stepTokensPerSecond(message)).toBe(60)
  })

  test("waits for the stream and ignores steps without output", () => {
    expect(
      stepTokensPerSecond(
        step({ time: { created: 1_000 }, tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } } }),
      ),
    ).toBeUndefined()
    expect(stepTokensPerSecond(step({ time: { created: 1_000, streamed: 2_000 } }))).toBeUndefined()
    expect(
      stepTokensPerSecond(
        step({
          time: { created: 1_000, streamed: 1_000 },
          tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
        }),
      ),
    ).toBeUndefined()
    expect(
      stepTokensPerSecond(
        step({
          time: { created: 1_000, streamed: 2_000 },
          tokens: { input: 1, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        }),
      ),
    ).toBeUndefined()
  })
})

describe("cacheHitRate", () => {
  test("reports cached reads as a share of every prompt token", () => {
    expect(cacheHitRate({ input: 20, output: 0, reasoning: 0, cache: { read: 70, write: 10 } })).toBe(70)
    expect(cacheHitRate({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })).toBeUndefined()
  })
})

describe("contextSize", () => {
  test("counts every token the step filled the window with", () => {
    expect(contextSize({ input: 10, output: 5, reasoning: 2, cache: { read: 80, write: 3 } })).toBe(100)
  })
})
