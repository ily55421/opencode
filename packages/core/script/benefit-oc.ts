/** One-off real measurement for the OC-6/OC-8 benefits report. Temporary scratch script. */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Effect, Schema } from "effect"
import { SessionToolSurface } from "../src/session/tool-surface.js"
import { SessionSystemPrompt } from "../src/session/system-prompt.js"
import { definition } from "../src/tool/runtime.js"
import * as ReadTool from "../src/tool/plugin/read.js"
import * as EditTool from "../src/tool/plugin/edit.js"
import * as WriteTool from "../src/tool/plugin/write.js"
import * as PatchTool from "../src/tool/plugin/patch.js"
import * as GlobTool from "../src/tool/plugin/glob.js"
import * as GrepTool from "../src/tool/plugin/grep.js"
import * as ShellTool from "../src/tool/plugin/shell.js"
import * as TodoTool from "../src/tool/plugin/todo.js"
import * as QuestionTool from "../src/tool/plugin/question.js"
import * as SkillTool from "../src/tool/plugin/skill.js"
import * as SubagentTool from "../src/tool/plugin/subagent.js"
import * as WebfetchTool from "../src/tool/plugin/webfetch.js"
import * as WebsearchTool from "../src/tool/plugin/websearch.js"
import * as OpencodeTool from "../src/tool/plugin/opencode.js"
import { Token } from "../src/util/token.js"

const root = "src"
const read = (path: string) => readFileSync(join(import.meta.dir, "..", root, path), "utf8")

/** The shipped description literal inside one `editor.add` block (double or single quoted). */
const literal = (file: string) => {
  const source = read(file)
  const match = source.match(/\n\s*description:\s*\n?\s("((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/)
  if (match === null) throw new Error(`no literal description in ${file}`)
  return JSON.parse(match[1].replaceAll("\n", "\\n"))
}

// shell's description is built from a static string list; the default (no shell detected) drops the
// conditional second entry, which the filter below already skips because it is a template literal.
const shellDescription = (read("tool/plugin/shell.ts").match(/const description = \(shell\?: string\) =>\s*\[([\s\S]*?)\]\.join/)?.[1] ?? "")
  .split(/,\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.startsWith('"'))
  .map((line) => JSON.parse(line))
  .join(" ")

const dummy = () => Effect.succeed({}) as never

const single = (name: string, description: string, input: unknown) =>
  definition({ name, description, input, execute: dummy } as never)

// --- the 13 single-Input plugins: real descriptions + real exported Input schemas -------
const real = [
  single("read", literal("tool/plugin/read.ts"), ReadTool.Input),
  single("edit", literal("tool/plugin/edit.ts"), EditTool.Input),
  single("write", literal("tool/plugin/write.ts"), WriteTool.Input),
  single("patch", read("tool/patch.txt"), PatchTool.Input),
  single("glob", literal("tool/plugin/glob.ts"), GlobTool.Input),
  single("grep", literal("tool/plugin/grep.ts"), GrepTool.Input),
  single("shell", shellDescription, ShellTool.Input),
  single("todowrite", read("tool/todowrite.txt"), TodoTool.Input),
  single("question", QuestionTool.description, QuestionTool.Input),
  single("skill", SkillTool.description, SkillTool.Input),
  single("subagent", SubagentTool.description, SubagentTool.Input),
  single("webfetch", WebfetchTool.description, WebfetchTool.Input),
  single("websearch", WebsearchTool.description, WebsearchTool.Input),
]

// --- opencode.ts's six namespaced tools: real names, descriptions, and Input schemas ----
const opencode = [
  ["session_rename", "Rename the session.", OpencodeTool.RenameInput],
  ["session_move", "Move the session.", OpencodeTool.MoveInput],
  ["worktree_create", "Create a named worktree. Returns its directory.", OpencodeTool.WorktreeCreateInput],
  ["worktree_list", "List a repository's worktrees.", Schema.Struct({})],
  ["worktree_remove", "Remove a worktree.", OpencodeTool.WorktreeRemoveInput],
  ["models", "Search the models available to use.", OpencodeTool.ModelsInput],
] as const
for (const [name, fallback, input] of opencode) {
  const source = read("tool/plugin/opencode.ts")
  const block = source.match(new RegExp(`name: "${name}",\\s*description:\\s*\\n?\\s("((?:[^"\\\\]|\\\\.)*)")`))
  real.push(
    single(`opencode_${name}`, block === null ? fallback : JSON.parse(block[1].replaceAll("\n", "\\n")), input),
  )
}

// --- measure with the real estimator ----------------------------------------------------
const measured = real.map((entry) => ({ name: entry.name, tokens: SessionToolSurface.estimateTool(entry) }))
const builtinTotal = measured.reduce((sum, tool) => sum + tool.tokens, 0)
console.log("=== built-in tool surface (real descriptions + real exported Input schemas, real estimateTool) ===")
for (const tool of [...measured].sort((left, right) => right.tokens - left.tokens))
  console.log(`${tool.name.padEnd(22)} ${String(tool.tokens).padStart(6)}`)
console.log(`TOTAL(${measured.length} tools) = ${builtinTotal} tokens`)

const systemPrompt = SessionSystemPrompt.make(real.map((tool) => tool.name))
const systemTokens = Token.estimateWide(systemPrompt)
console.log(`system prompt (real text, built-in tool list): ${systemTokens} tokens`)
console.log(`fixed per-step overhead (system + tools): ${systemTokens + builtinTotal} tokens`)

// --- synthetic MCP curves (real plan/measure, composed with the real built-in surface) ---
// Two shapes: "lean" (short one-line descriptions, 2-6 flat params) and "verbose" (the long
// descriptions and nested parameter blocks typical of public MCP servers such as github/playwright).
let seed = 42
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
const paramNames = ["id", "query", "path", "owner", "repo", "limit", "offset", "verbose", "format", "branch", "since", "state"]
const filler = " This operation validates its arguments against the connected server, streams large responses to a file when they exceed the inline budget, and returns a structured summary the model can act on without a follow-up call."
const mcpTool = (server: string, index: number, verbose: boolean) => {
  const count = verbose ? 5 + Math.floor(rand() * 5) : 2 + Math.floor(rand() * 5)
  const params = Array.from({ length: count }, (_, slot) => paramNames[slot % paramNames.length])
  const description =
    `${server.replaceAll("_", " ")} operation ${index}: performs the requested action over the connected server and returns the structured result for the model to inspect.` +
    (verbose ? filler.repeat(3) : "")
  const inputSchema = {
    type: "object",
    properties: Object.fromEntries(
      params.map((name) => [
        name,
        {
          type: rand() > 0.5 ? "string" : "number",
          description: verbose
            ? `The ${name} of the operation. When omitted the server derives it from the session context; invalid values are rejected with a per-field error listing every accepted shape.`
            : `The ${name} of the operation.`,
        },
      ]),
    ),
    required: params.slice(0, 2),
  }
  return { type: "tool" as const, name: `${server}_op_${index}`, description, inputSchema }
}
const curve = (count: number, verbose: boolean) => {
  const mcp = Array.from({ length: count }, (_, index) => mcpTool(verbose ? "data" : "fs", index, verbose))
  const defs = [...real, ...mcp]
  const builtinDiscovered = real.map((tool) => tool.name)
  const full = SessionToolSurface.measure(defs)
  const row: Record<string, number | string> = { mcpTools: count, fullTokens: full }
  for (const discovered of [0, 5, 15]) {
    const plan = SessionToolSurface.plan({
      definitions: defs,
      discoveredNames: [...builtinDiscovered, ...mcp.slice(0, discovered).map((tool) => tool.name)],
      contextWindow: 200_000,
      enabled: true,
    })
    const deferred = plan === undefined ? full : SessionToolSurface.measure(plan.advertised)
    row[`advertised(+${discovered})`] = deferred
    row[`save(+${discovered})`] = plan === undefined ? "no-defer" : `${Math.round((1 - deferred / full) * 100)}%`
  }
  return row
}
console.log("\n=== composed curve: 19 real built-ins + N synthetic MCP tools (window 200k => threshold 20k) ===")
console.log("-- lean shape (~115 tokens/tool) --")
for (const count of [30, 60, 120, 200]) console.log(JSON.stringify(curve(count, false)))
console.log("-- verbose shape (long descriptions, nested params) --")
for (const count of [30, 60, 120]) console.log(JSON.stringify(curve(count, true)))

const probeDefs = Array.from({ length: 50 }, (_, index) => mcpTool("probe", index, false))
const verboseDefs = Array.from({ length: 50 }, (_, index) => mcpTool("probe", index, true))
const avg = SessionToolSurface.measure(probeDefs) / 50
const avgVerbose = SessionToolSurface.measure(verboseDefs) / 50
console.log(`\navg tokens per synthetic MCP tool: lean ${Math.round(avg)}, verbose ${Math.round(avgVerbose)}`)
for (const window of [32_000, 100_000, 200_000]) {
  const threshold = Math.max(2_000, 0.1 * window)
  console.log(
    `window ${window}: threshold ${Math.round(threshold)} tokens => ~${Math.ceil((threshold - builtinTotal) / avg)} lean / ~${Math.ceil((threshold - builtinTotal) / avgVerbose)} verbose tools past the 19 built-ins`,
  )
}
