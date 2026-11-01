import { describe, expect, test } from "bun:test"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionSchema } from "@opencode/core/session/schema"
import { Tool } from "@opencode/core/tool"
import { availableTools, recoverToolName } from "@opencode/core/tool/runtime"
import { Effect, Schema } from "effect"
import { it } from "./lib/effect"
import { executeTool, toolIdentity } from "./lib/tool"

const registry = AppNodeBuilder.build(Tool.node, [
  Location.node.replace(Location.boundNode({ directory: AbsolutePath.make("/project") })),
])

const sessionID = SessionSchema.ID.make("ses_tool_name")

const call = (name: string) => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id: "call_name", name, input: { text: "hi" } },
})

const echo = (name: string) => ({
  name,
  description: `Echo ${name}`,
  input: Schema.Struct({ text: Schema.String }),
  output: Schema.String,
  options: { codemode: false } as const,
  execute: ({ text }: { text: string }) => Effect.succeed({ output: text }),
})

const ADVERTISED = ["echo", "mcp_demo_search", "webfetch"]

const listing = (message: string | undefined) =>
  (message ?? "").match(/Available tools: ([^.]+)\./)?.[1]?.split(", ") ?? []

describe("recoverToolName", () => {
  for (const [raw, expected] of [
    ["functions.echo", "echo"],
    ["developer.echo", "echo"],
    ["tools.echo", "echo"],
    ["mcp.demo.search", "mcp_demo_search"],
    ["mcp/demo/search", "mcp_demo_search"],
    ["mcp:demo:search", "mcp_demo_search"],
    ["mcp demo search", "mcp_demo_search"],
    ["MCP_Demo_Search", "mcp_demo_search"],
    ["ECHO", "echo"],
    ["echo", "echo"],
  ] as const) {
    test(`folds ${raw} back onto ${expected}`, () => {
      expect(recoverToolName(raw, ADVERTISED)).toBe(expected)
    })
  }

  for (const raw of ["something_else", "mcp.other.thing", "read"]) {
    test(`leaves ${raw} alone when no advertised tool matches`, () => {
      expect(recoverToolName(raw, ADVERTISED)).toBeUndefined()
    })
  }

  test("refuses to guess between two tools that fold to the same name", () => {
    expect(recoverToolName("ECHO", ["Echo", "echo"])).toBeUndefined()
  })

  test("lists the advertised tools in a stable order", () => {
    expect(availableTools(["webfetch", "echo", "mcp_demo_search"])).toBe(
      " Available tools: echo, mcp_demo_search, webfetch.",
    )
  })

  test("caps a listing that would spend the whole reply", () => {
    const names = Array.from({ length: 55 }, (_, index) => `tool_${String(index).padStart(2, "0")}`)
    expect(availableTools(names)).toContain("(and 5 more)")
  })
})

describe("tool name recovery at the registry", () =>
  it.effect("runs the tool a mangled name can only mean", () =>
    Effect.gen(function* () {
      const tools = yield* Tool.Service
      yield* tools.transform((editor) => {
        editor.add(echo("echo"))
        editor.add(echo("lookup"))
      })

      expect((yield* executeTool(tools, call("functions.echo"))).status).toBe("completed")
      expect((yield* executeTool(tools, call("developer.echo"))).status).toBe("completed")
    }).pipe(Effect.scoped, Effect.provide(registry)),
  ))

describe("unknown tool responses", () =>
  it.effect("name the tools the request actually advertised", () =>
    Effect.gen(function* () {
      const tools = yield* Tool.Service
      yield* tools.transform((editor) => {
        editor.add(echo("echo"))
        editor.add(echo("lookup"))
      })

      const missing = yield* executeTool(tools, call("nope"))
      expect(missing.error?.message).toContain('No tool named "nope" is currently available.')
      expect(listing(missing.error?.message)).toEqual(expect.arrayContaining(["echo", "lookup"]))

      // A name the model invented must not reach a tool this request left out.
      const snapshot = yield* tools.snapshot()
      const definitions = new Map(
        snapshot.definitions.filter((tool) => tool.name !== "echo").map((tool) => [tool.name, tool]),
      )
      const dropped = yield* executeTool(tools, { ...call("functions.echo"), definitions })
      expect(dropped.error?.message).toContain('No tool named "functions.echo" is currently available.')
      expect(listing(dropped.error?.message)).not.toContain("echo")
      expect(listing(dropped.error?.message)).toContain("lookup")
    }).pipe(Effect.scoped, Effect.provide(registry)),
  ))
