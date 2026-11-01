export * as SessionToolSurface from "./tool-surface.js"

import { ToolDefinition, type ToolEntry } from "@opencode/ai/effect"
import { Effect, Option } from "effect"
import { Config } from "../config.js"
import { Token } from "../util/token.js"
import type { SessionMessage } from "./message.js"

/**
 * The on-demand tool schema surface: when the schemas of one request would cost more than a share of
 * the context window, only tools the model has already used are advertised, plus one discovery tool.
 * The set of already-used tools folds from the durable message history — the same rule every loop
 * counter follows — so a restart or a reload cannot silently un-advertise a tool the session depends
 * on, and nothing about the request is stored outside the history.
 */

/** The discovery tool every deferred request advertises. Executed by the request's own wrapper. */
export const TOOL_SEARCH_NAME = "tool_search"

/** Code Mode collapses its whole catalog into one `execute` tool; deferring it would blind that flow. */
const EXECUTE_TOOL = "execute"

/**
 * The schema surface defers when it costs more than the larger of these two: an absolute floor, or
 * the share of the context window the borrowed design measured ("lazy tools over 10% of the window").
 * A model with no reported window defers only past the floor.
 */
const SURFACE_MIN_TOKENS = 2_000
const SURFACE_WINDOW_SHARE = 0.1

/** Each query loads at most this many tools; the empty-query overview lists names only. */
const SEARCH_LIMIT = 5
const OVERVIEW_LIMIT = 50
const OVERVIEW_DESCRIPTION_CHARS = 120

/** Model-facing refusal for a call to a tool this request did not advertise. */
export const NOT_LOADED_PREFIX = "Load guard:"

export const NOT_LOADED = (tool: string) =>
  `${NOT_LOADED_PREFIX} "${tool}" exists but its schema was not sent in this request, because only already-used tools
are advertised. Call the ${TOOL_SEARCH_NAME} tool with a query matching it to load it, then retry.`

/** Appended to the unknown/unavailable tool errors when deferral is active, for mangled names. */
export const UNAVAILABLE_HINT = `Other tools are available on demand: call the ${TOOL_SEARCH_NAME} tool with a query to load one.`

const DISCOVERY_DESCRIPTION = `Search the tools that are not loaded into this conversation. Most tools exist, but
their schemas are not sent until they are needed. Call this tool with a keyword query to load the matching tools,
read their schemas from the result, then call them. Loaded tools stay advertised for the rest of the session.
Without a query, this lists what is available by name only.`

const DISCOVERY_INPUT_SCHEMA = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Keyword matched against tool names and descriptions. Omit to list the available tool names.",
    },
    limit: { type: "number", description: "Maximum number of tools to load. Defaults to 5." },
  },
}

/** Only function tools defer; namespaces and the Code Mode `execute` tool always stay advertised. */
const deferrable = (entry: ToolEntry): entry is ToolDefinition => entry.type === "tool" && entry.name !== EXECUTE_TOOL

/** Only what providers receive; `metadata` and `native` stay local. */
export const estimateTool = (tool: ToolEntry): number => {
  if (tool.type === "tool") return Token.estimateWide(tool.name + tool.description + JSON.stringify(tool.inputSchema))
  return (
    Token.estimateWide(tool.name + (tool.description ?? "")) +
    tool.tools.reduce((sum, entry) => sum + estimateTool(entry), 0)
  )
}

export const measure = (definitions: ReadonlyArray<ToolEntry>) =>
  definitions.reduce((sum, tool) => sum + estimateTool(tool), 0)

/**
 * The tools this session has already used, in first-use order — every settled tool call's name, plus
 * the names a `tool_search` result says it loaded. A refusal to run an un-loaded tool is the
 * mechanism speaking, not a use, so it does not discover the tool it refused — the same rule that
 * keeps the loop guard's own refusals out of its pattern. The order is stable while history only
 * appends, so within a turn the advertised list is append-only and the previous step's tools stay a
 * byte-prefix of the next one.
 */
export const discovered = (messages: ReadonlyArray<SessionMessage.Info>): ReadonlyArray<string> => {
  const names: string[] = []
  const seen = new Set<string>()
  const add = (name: unknown) => {
    if (typeof name !== "string" || name.length === 0 || seen.has(name)) return
    seen.add(name)
    names.push(name)
  }
  for (const message of messages) {
    if (message.type !== "assistant") continue
    for (const part of message.content) {
      if (part.type !== "tool") continue
      if (part.state.status === "error" && part.state.error.message.startsWith(NOT_LOADED_PREFIX)) continue
      add(part.name)
      // A tool_search result records the tools it loaded, so its own call is what makes them durable.
      if (part.name === TOOL_SEARCH_NAME && part.state.status === "completed" && Array.isArray(part.state.metadata?.loaded))
        part.state.metadata.loaded.forEach(add)
    }
  }
  return names
}

export type Plan = {
  /** Definitions this request advertises: exempt tools and the discovery tool first, then discoveries. */
  readonly advertised: ReadonlyArray<ToolEntry>
  readonly discovery: ToolDefinition
  /** Deferrable definitions this request does not advertise; the discovery tool loads them. */
  readonly deferred: ReadonlyArray<ToolEntry>
}

/**
 * Decides whether this request defers most of its tool schemas. Everything the model has already
 * used (and the tools that can never defer) stays advertised; everything else is reachable only
 * through `tool_search`. Returns `undefined` when the request keeps its full surface.
 */
export const plan = (input: {
  readonly definitions: ReadonlyArray<ToolEntry>
  readonly discoveredNames: ReadonlyArray<string>
  readonly contextWindow: number
  readonly enabled: boolean
}): Plan | undefined => {
  if (!input.enabled) return undefined
  const share = input.contextWindow > 0 ? SURFACE_WINDOW_SHARE * input.contextWindow : 0
  if (measure(input.definitions) <= Math.max(SURFACE_MIN_TOKENS, share)) return undefined
  const byName = new Map(input.definitions.filter(deferrable).map((entry) => [entry.name, entry] as const))
  const exempt = input.definitions.filter((entry) => !deferrable(entry))
  // `discovered` already returns unique names in first-use order; plan trusts that ordering.
  const kept = input.discoveredNames.flatMap((name) => {
    const entry = byName.get(name)
    return entry === undefined ? [] : [entry]
  })
  const keptNames = new Set(kept.map((entry) => entry.name))
  const deferred = input.definitions.filter(deferrable).filter((entry) => !keptNames.has(entry.name))
  const discovery = ToolDefinition.make({
    name: TOOL_SEARCH_NAME,
    description: DISCOVERY_DESCRIPTION,
    inputSchema: DISCOVERY_INPUT_SCHEMA,
  })
  return { advertised: [...exempt, discovery, ...kept], discovery, deferred }
}

/** One search hit: the full definition, so the result text is everything needed to call the tool. */
const hit = (entry: ToolDefinition) => ({ name: entry.name, description: entry.description, inputSchema: entry.inputSchema })

const overview = (entries: ReadonlyArray<ToolEntry>) =>
  entries
    .slice(0, OVERVIEW_LIMIT)
    .map((entry) =>
      entry.type === "tool"
        ? `- ${entry.name}: ${entry.description.slice(0, OVERVIEW_DESCRIPTION_CHARS)}`
        : `- ${entry.name} (a namespace of ${entry.tools.length} tools; search with a keyword to load them)`,
    )
    .join("\n")

/**
 * Matches a query against the deferred tools, name hits outranking description hits, and returns both
 * the result text and the names that count as loaded. An empty query is an overview: it names what
 * exists but loads nothing, so one call cannot re-advertise the whole surface it deferred.
 */
export const search = (
  deferred: ReadonlyArray<ToolEntry>,
  query: string | undefined,
  limit = SEARCH_LIMIT,
): { readonly text: string; readonly loaded: ReadonlyArray<string> } => {
  const keyword = query?.trim().toLowerCase() ?? ""
  if (keyword.length === 0) return { text: `Available tools:\n${overview(deferred)}`, loaded: [] }
  const scored = deferred
    .filter(deferrable)
    .flatMap((entry) => {
      if (entry.name.toLowerCase().includes(keyword)) return [{ entry, score: 2 }]
      if (entry.description.toLowerCase().includes(keyword)) return [{ entry, score: 1 }]
      return []
    })
    .sort((left, right) => right.score - left.score)
  const matches = scored.slice(0, limit).map((scored) => scored.entry)
  if (matches.length === 0) return { text: `No tool matched "${query}".\n${overview(deferred)}`, loaded: [] }
  return {
    text: JSON.stringify({ matches: matches.map(hit) }, null, 2),
    loaded: matches.map((entry) => entry.name),
  }
}

/** Reads `experimental.defer_tool_schemas` from the Config in scope; without one, deferral is off. */
export const enabled = Effect.gen(function* () {
  const config = yield* Effect.serviceOption(Config.Service)
  if (Option.isNone(config)) return false
  return Config.latest(yield* config.value.entries(), "experimental")?.defer_tool_schemas === true
})
