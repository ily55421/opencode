export * as ToolSchemaCanonical from "./schema-canonical.js"

import type { JsonSchema } from "effect"

/**
 * Members that list names, where the order carries no meaning for validation and can be
 * normalised freely. `enum` is deliberately absent: its order is shown to the model and may
 * be authored deliberately.
 */
const NAME_SETS = new Set(["required", "type"])
const DEPENDENCIES = "dependentRequired"

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const order = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0)

const names = (value: Record<string, unknown>) => Object.keys(value).sort(order)

const stringSet = (value: unknown) =>
  Array.isArray(value) && value.every((item) => typeof item === "string") ? [...value].sort(order) : walk(value)

const dependencyMap = (value: unknown) =>
  isObject(value) ? Object.fromEntries(names(value).map((name) => [name, stringSet(value[name])])) : walk(value)

function walk(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(walk)
  if (!isObject(value)) return value
  return Object.fromEntries(
    names(value).map((name) => {
      if (NAME_SETS.has(name)) return [name, stringSet(value[name])]
      if (name === DEPENDENCIES) return [name, dependencyMap(value[name])]
      return [name, walk(value[name])]
    }),
  )
}

/**
 * Rewrites a schema into the byte-identical form of itself: object keys sorted, and name sets
 * sorted. An MCP server that returns the same schema with different key order after a reconnect
 * or an upgrade therefore keeps producing the same serialized tool definition, which is what keeps
 * the provider's cached prompt prefix alive.
 *
 * It normalises bytes only. Compositions such as `oneOf` are neither reordered nor folded, so two
 * genuinely different schemas still serialize differently.
 */
export const canonicalize = (schema: JsonSchema.JsonSchema): JsonSchema.JsonSchema =>
  walk(schema) as JsonSchema.JsonSchema
