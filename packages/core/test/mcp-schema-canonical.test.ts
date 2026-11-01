import { describe, expect, test } from "bun:test"
import { Effect, type JsonSchema } from "effect"
import { Tool } from "@opencode/schema/tool"
import { ToolSchemaCanonical } from "@opencode/core/tool/schema-canonical"
import { definition } from "@opencode/core/tool/runtime"

const bytes = (schema: JsonSchema.JsonSchema) => JSON.stringify(ToolSchemaCanonical.canonicalize(schema))

const tool = (input: JsonSchema.JsonSchema): Tool.Info => ({
  name: "search",
  description: "Search the index",
  input,
  options: { namespace: "demo" },
  execute: () => Effect.die("never executed"),
})

const nested = {
  type: "object",
  properties: {
    query: { type: "string", description: "what to look for" },
    limit: { type: ["integer", "null"], minimum: 1 },
  },
  required: ["limit", "query"],
  $defs: {
    page: { type: "object", properties: { size: { type: "integer" }, index: { type: "integer" } }, required: ["index", "size"] },
  },
}

const shuffled = {
  $defs: {
    page: { required: ["size", "index"], properties: { index: { type: "integer" }, size: { type: "integer" } }, type: "object" },
  },
  required: ["query", "limit"],
  properties: {
    limit: { minimum: 1, type: ["null", "integer"] },
    query: { description: "what to look for", type: "string" },
  },
  type: "object",
}

describe("ToolSchemaCanonical.canonicalize", () => {
  test("gives key order and name-set order no bearing on the bytes", () => {
    expect(bytes(nested as JsonSchema.JsonSchema)).toBe(bytes(shuffled as JsonSchema.JsonSchema))
  })

  test("sorts object keys at every depth", () => {
    const [first, second] = [bytes(nested as JsonSchema.JsonSchema), bytes(shuffled as JsonSchema.JsonSchema)]
    expect(first).toContain('"$defs":{"page":{"properties":{"index"')
    expect(first).toBe(second)
  })

  test("sorts required and each dependentRequired list", () => {
    const schema = {
      type: "object",
      required: ["c", "a", "b"],
      dependentRequired: { z: ["b", "a"], a: ["c"] },
      properties: {},
    } as JsonSchema.JsonSchema
    expect(bytes(schema)).toBe(
      JSON.stringify({
        dependentRequired: { a: ["c"], z: ["a", "b"] },
        properties: {},
        required: ["a", "b", "c"],
        type: "object",
      }),
    )
  })

  test("sorts an array type but keeps its members", () => {
    const schema = { type: ["null", "string", "boolean"] } as unknown as JsonSchema.JsonSchema
    expect(bytes(schema)).toBe('{"type":["boolean","null","string"]}')
  })

  test("keeps the order of things that carry meaning", () => {
    const schema = {
      enum: ["z", "a"],
      oneOf: [{ const: 2 }, { const: 1 }],
      anyOf: [{ type: "string" }, { type: "number" }],
    } as unknown as JsonSchema.JsonSchema
    expect(bytes(schema)).toBe('{"anyOf":[{"type":"string"},{"type":"number"}],"enum":["z","a"],"oneOf":[{"const":2},{"const":1}]}')
  })

  test("is idempotent", () => {
    const once = ToolSchemaCanonical.canonicalize(nested as JsonSchema.JsonSchema)
    expect(JSON.stringify(ToolSchemaCanonical.canonicalize(once))).toBe(JSON.stringify(once))
  })

  test("leaves the input untouched", () => {
    const source = JSON.parse(JSON.stringify(nested))
    ToolSchemaCanonical.canonicalize(source)
    expect(source).toEqual(nested)
  })

  test("passes through schemas that are not objects", () => {
    expect(JSON.stringify(ToolSchemaCanonical.canonicalize(true as unknown as JsonSchema.JsonSchema))).toBe("true")
    expect(ToolSchemaCanonical.canonicalize(undefined as unknown as JsonSchema.JsonSchema)).toBeUndefined()
    expect(ToolSchemaCanonical.canonicalize({} as JsonSchema.JsonSchema)).toEqual({})
  })

  test("keeps the serialized tool definition byte-stable", () => {
    const serialized = (schema: JsonSchema.JsonSchema) =>
      JSON.stringify(definition(tool(ToolSchemaCanonical.canonicalize(schema))).inputSchema)
    expect(serialized(nested as JsonSchema.JsonSchema)).toBe(serialized(shuffled as JsonSchema.JsonSchema))
  })

  test("without canonicalization the definition bytes differ", () => {
    const left = JSON.stringify(definition(tool(nested as JsonSchema.JsonSchema)).inputSchema)
    const right = JSON.stringify(definition(tool(shuffled as JsonSchema.JsonSchema)).inputSchema)
    expect(left).not.toBe(right)
  })
})
