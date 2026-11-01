import { describe, expect, test } from "bun:test"
import { ToolDefinition } from "@opencode/ai/effect"
import { SessionMessage } from "@opencode/core/session/message"
import {
  discovered,
  estimateTool,
  NOT_LOADED,
  NOT_LOADED_PREFIX,
  plan,
  search,
  TOOL_SEARCH_NAME,
} from "@opencode/core/session/tool-surface"
import { Token } from "@opencode/core/util/token"

const message = (value: unknown) => value as SessionMessage.Info

const assistant = (parts: ReadonlyArray<unknown>) => message({ type: "assistant", content: parts })

let calls = 0
const tool = (name: string, state: unknown) => ({ type: "tool", id: `call-${(calls += 1)}`, name, state })

const done = (name: string, input: unknown, metadata?: unknown) =>
  tool(name, { status: "completed", input, content: [{ type: "text", text: "ok" }], ...(metadata === undefined ? {} : { metadata }) })

const failed = (name: string, input: unknown, message: string, type = "tool.execution") =>
  tool(name, { status: "error", input, error: { type, message } })

const definition = (name: string, description = `The ${name} tool`) =>
  ToolDefinition.make({ name, description, inputSchema: { type: "object", properties: { path: { type: "string" } } } })

describe("SessionToolSurface.measure", () => {
  test("measures one tool the way the compaction estimator does", () => {
    const entry = definition("alpha", "Does alpha things")
    expect(estimateTool(entry)).toBe(
      Token.estimateWide(`alphaDoes alpha things${JSON.stringify(entry.inputSchema)}`),
    )
  })

  test("charges a namespace by its own text plus its entries", () => {
    const namespace = {
      type: "namespace" as const,
      name: "math",
      description: "Math tools",
      tools: [definition("add"), definition("sub")],
    }
    const expected =
      Token.estimateWide("mathMath tools") + estimateTool(definition("add")) + estimateTool(definition("sub"))
    expect(estimateTool(namespace)).toBe(expected)
  })
})

describe("SessionToolSurface.discovered", () => {
  test("collects used tools in first-use order without duplicates", () => {
    const messages = [
      assistant([done("alpha", {}), done("beta", {})]),
      assistant([done("alpha", {})]),
      assistant([done("gamma", {})]),
    ]
    expect(discovered(messages)).toEqual(["alpha", "beta", "gamma"])
  })

  test("reads the tools a tool_search result loaded", () => {
    const messages = [assistant([done(TOOL_SEARCH_NAME, { query: "math" }, { loaded: ["math_add", "math_sub"] })])]
    expect(discovered(messages)).toEqual([TOOL_SEARCH_NAME, "math_add", "math_sub"])
  })

  test("counts a failed call as a use, but not a refusal to run an un-loaded tool", () => {
    const messages = [
      assistant([failed("alpha", {}, "boom"), failed("beta", {}, NOT_LOADED("beta"))]),
      assistant([failed("gamma", {}, "Tool execution interrupted", "aborted")]),
    ]
    expect(discovered(messages)).toEqual(["alpha", "gamma"])
  })

  test("starts fresh from an empty history", () => {
    expect(discovered([])).toEqual([])
  })
})

describe("SessionToolSurface.plan", () => {
  const fat = (name: string) => definition(name, `Tool ${name}. ${"x".repeat(3_000)}`)

  test("does nothing while the flag is off", () => {
    expect(plan({ definitions: [fat("alpha")], discoveredNames: [], contextWindow: 1_000, enabled: false })).toBeUndefined()
  })

  test("does nothing under the absolute floor", () => {
    expect(plan({ definitions: [definition("alpha")], discoveredNames: [], contextWindow: 1_000, enabled: true })).toBeUndefined()
  })

  test("does nothing while the surface is under its window share", () => {
    expect(plan({ definitions: [fat("alpha")], discoveredNames: [], contextWindow: 1_000_000, enabled: true })).toBeUndefined()
  })

  test("defers everything unused once the surface passes the threshold", () => {
    const decision = plan({
      definitions: [fat("alpha"), fat("beta"), fat("gamma"), fat("delta")],
      discoveredNames: [],
      contextWindow: 1_000,
      enabled: true,
    })
    expect(decision).toBeDefined()
    expect(decision?.advertised.map((entry) => (entry.type === "tool" ? entry.name : ""))).toEqual([TOOL_SEARCH_NAME])
    expect(decision?.deferred.map((entry) => entry.name).sort()).toEqual(["alpha", "beta", "delta", "gamma"])
  })

  test("keeps the used tools, the discovery tool first, discoveries appended after", () => {
    const decision = plan({
      definitions: [fat("alpha"), fat("beta"), fat("gamma"), fat("delta")],
      discoveredNames: ["beta", "alpha"],
      contextWindow: 1_000,
      enabled: true,
    })
    expect(decision?.advertised.map((entry) => (entry.type === "tool" ? entry.name : ""))).toEqual([
      TOOL_SEARCH_NAME,
      "beta",
      "alpha",
    ])
    expect(decision?.deferred.map((entry) => entry.name).sort()).toEqual(["delta", "gamma"])
  })

  test("never defers the Code Mode execute tool", () => {
    const decision = plan({
      definitions: [definition("execute", "Run code"), fat("alpha"), fat("beta"), fat("gamma")],
      discoveredNames: [],
      contextWindow: 1_000,
      enabled: true,
    })
    expect(decision?.advertised.map((entry) => (entry.type === "tool" ? entry.name : ""))).toEqual(["execute", TOOL_SEARCH_NAME])
    expect(decision?.deferred.map((entry) => entry.name).sort()).toEqual(["alpha", "beta", "gamma"])
  })

  test("keeps the advertised list append-only as discoveries arrive", () => {
    const definitions = [fat("alpha"), fat("beta"), fat("gamma")]
    const first = plan({ definitions, discoveredNames: [], contextWindow: 1_000, enabled: true })
    const second = plan({ definitions, discoveredNames: ["gamma"], contextWindow: 1_000, enabled: true })
    const third = plan({ definitions, discoveredNames: ["gamma", "alpha"], contextWindow: 1_000, enabled: true })
    const names = (value: typeof first) => value!.advertised.map((entry) => (entry.type === "tool" ? entry.name : ""))
    expect(names(second)).toEqual([...names(first)!, "gamma"])
    expect(names(third)).toEqual([...names(second)!, "alpha"])
  })
})

describe("SessionToolSurface.search", () => {
  const deferred = [definition("alpha"), definition("beta_reader", "Reads beta files"), definition("gamma")]

  test("matches names outranking descriptions and loads what matched", () => {
    const result = search(deferred, "beta")
    expect(result.loaded).toEqual(["beta_reader"])
    expect(JSON.parse(result.text)).toMatchObject({ matches: [{ name: "beta_reader" }] })
  })

  test("caps the matches at the limit", () => {
    const result = search([definition("a1"), definition("a2"), definition("a3")], "a", 2)
    expect(result.loaded).toEqual(["a1", "a2"])
  })

  test("an empty query is an overview that loads nothing", () => {
    const result = search(deferred, undefined)
    expect(result.loaded).toEqual([])
    expect(result.text).toContain("- alpha")
    expect(result.text).not.toContain("inputSchema")
  })

  test("a missed query still names what exists", () => {
    const result = search(deferred, "zzz")
    expect(result.loaded).toEqual([])
    expect(result.text).toContain("No tool matched")
    expect(result.text).toContain("- gamma")
  })

  test("refusals carry the load-first contract token", () => {
    expect(NOT_LOADED("beta")).toContain(NOT_LOADED_PREFIX)
    expect(NOT_LOADED("beta")).toContain(TOOL_SEARCH_NAME)
  })
})
