#!/usr/bin/env bun
// Measures the MCP schema byte-determinism guarantee (P0 L30) and the cost of enforcing it.
//
// The standard this benchmark enforces:
//   1. Convergence  — every key-order permutation of one logical schema canonicalizes to the SAME
//                     serialized bytes. 100% is the only passing value; this is what keeps the
//                     provider's cached prompt prefix alive across MCP reconnects.
//   2. Idempotency  — canonicalize(canonicalize(x)) serializes identically to canonicalize(x).
//   3. Overhead     — per-call canonicalize cost stays microsecond-scale, so paying it on every
//                     tool load is noise next to one cached-prefix token.
//
// Run: bun script/benchmark-schema-determinism.ts

import { ToolSchemaCanonical } from "../src/tool/schema-canonical.js"

// A seeded shuffle so every run measures the same permutations (LCG, not Math.random).
const rng = (seed: number) => {
  let state = seed
  return () => {
    state = (state * 1_103_515_245 + 12_345) & 0x7fffffff
    return state / 0x7fffffff
  }
}

// A reconnect jitters JSON **key order** only: object insertion order is an implementation detail
// of the server, while array element order (enum values, required lists are separate members) is
// payload the schema itself carries. The permutation therefore shuffles object keys and leaves
// arrays alone — permuting arrays would model a schema change, not a reconnect.
const shuffle = <T>(value: T, random: () => number): T => {
  if (Array.isArray(value)) return value
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
    for (let i = entries.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[entries[i], entries[j]] = [entries[j], entries[i]]
    }
    return Object.fromEntries(entries.map(([key, item]) => [key, shuffle(item, random)])) as T
  }
  return value
}

// A realistic MCP server schema: filesystem+search hybrid, 5 namespaces, nested arrays of objects,
// dependentRequired pairs, enums and long descriptions — roughly what a real server advertises.
const mcpSchema = {
  type: "object",
  properties: {
    query: { type: "string", description: "The search query. Supports quoted phrases and field:value filters." },
    limit: { type: "integer", minimum: 1, maximum: 100, description: "Maximum results to return." },
    cursor: { type: "string", description: "Opaque pagination cursor from a previous page." },
    filters: {
      type: "object",
      properties: {
        kind: { enum: ["file", "directory", "symlink"], description: "Entry kind filter." },
        modified: { type: "string", description: "ISO-8601 date; only entries modified after it." },
        owner: { type: "string" },
        size: { type: "object", properties: { min: { type: "integer" }, max: { type: "integer" } } },
      },
      dependentRequired: { modified: ["kind"], size: ["owner"] },
    },
    scopes: {
      type: "array",
      description: "Directories to search. Empty means the whole workspace.",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          recursive: { type: "boolean" },
          excludes: { type: "array", items: { type: "string" } },
        },
        required: ["path", "recursive"],
      },
    },
    ranking: {
      type: "object",
      properties: {
        weights: {
          type: "object",
          properties: { recency: { type: "number" }, frequency: { type: "number" }, exact: { type: "number" } },
          required: ["exact", "frequency", "recency"],
        },
        mode: { enum: ["balanced", "precise", "broad"] },
      },
    },
    output: {
      type: "object",
      properties: {
        format: { enum: ["text", "json", "csv"] },
        fields: { type: "array", items: { enum: ["path", "score", "snippet", "owner", "modified"] } },
        highlight: { type: "boolean", description: "Wrap matches in markers." },
      },
      required: ["format"],
    },
  },
  required: ["query", "limit", "cursor", "filters", "scopes", "ranking", "output"],
  $defs: {
    page: {
      type: "object",
      properties: { size: { type: "integer" }, index: { type: "integer" }, total: { type: "integer" } },
      required: ["index", "size", "total"],
    },
  },
} as const

const bytes = (schema: object) => JSON.stringify(schema)
const baseline = bytes(mcpSchema)

// --- 1. Convergence across simulated reconnects ---------------------------------------------
const RECONNECTS = 200
const rawForms = new Set<string>()
const canonicalForms = new Set<string>()
const random = rng(20261107)
for (let i = 0; i < RECONNECTS; i++) {
  const permuted = shuffle(mcpSchema, random)
  rawForms.add(bytes(permuted))
  canonicalForms.add(bytes(ToolSchemaCanonical.canonicalize(permuted as never)))
}

// --- 2. Idempotency -------------------------------------------------------------------------
const once = ToolSchemaCanonical.canonicalize(mcpSchema as never)
const twice = ToolSchemaCanonical.canonicalize(once)
const idempotent = bytes(once) === bytes(twice)

// --- 3. Overhead ------------------------------------------------------------------------------
const ITERATIONS = 20_000
const start = performance.now()
for (let i = 0; i < ITERATIONS; i++) ToolSchemaCanonical.canonicalize(mcpSchema as never)
const totalMs = performance.now() - start
const perCallMicros = (totalMs * 1_000) / ITERATIONS

console.log("MCP schema byte-determinism benchmark")
console.log("=====================================")
console.log(`schema bytes (serialized):          ${baseline.length}`)
console.log("")
console.log("1. convergence across reconnects (the standard)")
console.log(
  `   without canonicalize: ${rawForms.size}/${RECONNECTS} reconnects produced distinct bytes` +
    ` (each divergent reconnect re-reads ~${baseline.length} prefix bytes)`,
)
console.log(
  `   with canonicalize:    ${canonicalForms.size}/${RECONNECTS} distinct byte forms` +
    ` — standard ${canonicalForms.size === 1 ? "PASS" : "FAIL"}`,
)
console.log("")
console.log("2. idempotency")
console.log(`   canonicalize twice is byte-identical: ${idempotent ? "PASS" : "FAIL"}`)
console.log("")
console.log("3. overhead")
console.log(
  `   canonicalize: ${perCallMicros.toFixed(1)} µs/call over ${ITERATIONS} runs` +
    ` (${(baseline.length * (ITERATIONS / 1_000_000) / (totalMs / 1_000)).toFixed(1)} MB/s)`,
)
console.log(
  `   100 reconnects pay ${(perCallMicros * 100 / 1_000).toFixed(2)} ms total — standard PASS` +
    ` if under 100 ms total`,
)
const pass = canonicalForms.size === 1 && idempotent && perCallMicros * 100 < 100_000
console.log("")
console.log(`verdict: ${pass ? "PASS" : "FAIL"}`)
process.exit(pass ? 0 : 1)
