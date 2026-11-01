/**
 * Scratch benchmark for the loop-reliability branch's changed surfaces:
 *   - baseline assembly: pre-branch `Instructions.render` (join) vs `InstructionBudget.fit` (scope pools)
 *   - per-step folds: SessionRunnerLoop.decide, SessionRunnerEmpty.decide, callKey
 *   - skill state with conflict bookkeeping (rebuild per read)
 *   - ToolSchemaCanonical.canonicalize, recoverToolName
 *
 *   bun run script/benchmark-loop-overhead.ts [--rounds 200]
 *
 * Numbers are µs per call unless stated. Machine-noise dominates below ~10 µs;
 * the report compares these against a step's model-streaming wall time.
 */
import { performance } from "node:perf_hooks"
import { Effect } from "effect"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "../src/bus"
import { AbsolutePath } from "../src/schema"
import { Skill } from "../src/skill"
import { Instructions } from "../src/instructions/index"
import { InstructionBudget } from "../src/instructions/budget"
import { SessionRunnerLoop } from "../src/session/runner/loop"
import { SessionRunnerEmpty } from "../src/session/runner/empty"
import { SessionRunnerUnfinished } from "../src/session/runner/unfinished"
import { ToolSchemaCanonical } from "../src/tool/schema-canonical"
import { recoverToolName } from "../src/tool/runtime"
import { SessionMessage } from "../src/session/message"
import { Token } from "../src/util/token"

const args = process.argv.slice(2)
const rounds = Number(args[args.indexOf("--rounds") + 1] ?? 200)

const time = (fn: () => void, n = rounds) => {
  for (let i = 0; i < Math.min(5, n); i++) fn()
  const start = performance.now()
  for (let i = 0; i < n; i++) fn()
  return ((performance.now() - start) / n) * 1000
}

const pad = (label: string) => label.padEnd(52)
const us = (value: number) => `${value.toFixed(2).padStart(9)} µs/call`

// ---- 1. baseline assembly: join (pre-branch) vs fit (scope pools) ----------------------------

const agentsBlock = (lines: number) =>
  Array.from({ length: lines }, (_, i) => `${i}. Probe convention line ${i}: keep instructions deterministic, name every trim, never repeat this line. ${"alpha bravo charlie delta echo foxtrot ".repeat(2)}`).join("\n")

const skillListing = [
  "Skills provide specialized instructions and workflows for specific tasks.",
  "Use the skill tool to load a skill when a task matches its description.",
  "<available_skills>",
  ...Array.from({ length: 8 }, (_, i) => `  <skill>\n    <id>skill-${i}</id>\n    <name>Skill ${i}</name>\n    <description>Use this skill when the task needs capability number ${i} described at length for the probe.</description>\n  </skill>`),
  "</available_skills>",
].join("\n")

console.log("== baseline assembly: Instructions.render (pre-branch path) vs InstructionBudget.fit (scope pools) ==")
for (const [label, lines] of [["~2k tok", 120], ["~8k tok", 480], ["~32k tok", 1920], ["~128k tok", 7680]] as const) {
  const parts = [
    { key: "core/codemode", text: "## Available tools\n  execute(...) signature and catalog lines here", scope: "global" as const },
    { key: "core/skill-guidance", text: skillListing, scope: "global" as const },
    { key: "core/instructions", text: agentsBlock(lines), scope: "project" as const },
    { key: "core/date", text: "Today's date: Sat Nov 1 2026", scope: "global" as const },
    { key: "core/environment", text: "<env>\n  Working directory: /probe\n</env>", scope: "global" as const },
  ]
  const texts = parts.map((part) => part.text)
  const totalTok = texts.reduce((sum, text) => sum + Token.estimateWide(text), 0)
  const joined = time(() => Instructions.render(texts))
  const pools = { global: 100_000, project: 100_000 }
  const fitFull = time(() => InstructionBudget.fit(parts, pools))
  const fitTiny = time(() => InstructionBudget.fit(parts, { global: 1500, project: 1500 }))
  const output = InstructionBudget.fit(parts, { global: 1500, project: 1500 })
  const outTok = Token.estimateWide(output)
  const stable = output === InstructionBudget.fit(parts, { global: 1500, project: 1500 })
  console.log(
    `${pad(`${label} (total ${totalTok} tok)`)} render ${us(joined)}  fit ${us(fitFull)}  fit+trim ${us(fitTiny)}  → ${outTok} tok  deterministic:${stable ? "yes" : "NO"}`,
  )
}
// Under a full budget, fit must reproduce the pre-branch bytes exactly (cache-safe).
{
  const parts = [{ key: "core/instructions", text: agentsBlock(120), scope: "project" as const }]
  const same = InstructionBudget.fit(parts, { global: 100_000, project: 100_000 }) === Instructions.render([parts[0].text])
  console.log(`${pad("fit(no trim) bytes == render bytes")}${same ? "identical" : "DIFFERENT"}`)
}

// ---- 2. per-step folds ----------------------------------------------------------------------

const toolPart = (id: string, name: string) => ({
  type: "tool" as const,
  id,
  name,
  state: { status: "completed" as const, input: { path: `src/file-${id}.ts`, query: "prefix-match-token" }, content: [{ type: "text" as const, text: `result ${id} ${"output ".repeat(20)}` }] },
})
const turn = (steps: number) => [
  { type: "idle", outcome: "succeeded" },
  { type: "user", text: "run the probe" },
  ...Array.from({ length: steps }, (_, i) => ({
    type: "assistant",
    finish: "stop",
    content: [toolPart(`call-${i % 7}`, i % 3 === 0 ? "grep" : i % 3 === 1 ? "read" : "edit")],
  })),
] as unknown as SessionMessage.Info[]

console.log("\n== per-step folds (new on this branch; HEAD ran none of them) ==")
for (const steps of [10, 30, 100]) {
  const messages = turn(steps)
  const loop = time(() => SessionRunnerLoop.decide(messages, true))
  const empty = time(() => SessionRunnerEmpty.decide(messages))
  const unfinished = time(() => SessionRunnerUnfinished.decide(messages))
  console.log(
    `${pad(`turn history of ${steps} steps`)} loop.decide ${us(loop)}  empty.decide ${us(empty)}  unfinished.decide ${us(unfinished)}`,
  )
}
{
  const key = () => SessionRunnerLoop.callKey("grep", { pattern: "SessionRunner", glob: "*.ts", outputMode: "content" })
  console.log(`${pad("loop.callKey (per tool call)")}${us(time(key, rounds * 5))}`)
}

// ---- 3. skill state with conflict bookkeeping ----------------------------------------------

const info = (id: string, path: string) =>
  Skill.Info.make({
    id: Skill.ID.make(id),
    name: Skill.Name.make(id),
    description: `Probe skill ${id} with a description long enough to look real in the listing.`,
    path: AbsolutePath.make(path),
    content: `# ${id}`,
  })

const skillProgram = Effect.gen(function* () {
  const skills = yield* Skill.Service
  yield* skills.transform((editor) => {
    for (let i = 0; i < 200; i++) editor.add(info(`skill-${i}`, `/skills/skill-${i}/SKILL.md`))
  })
  const plain = time(() => skills.list(), 50) // one full state rebuild per read

  yield* skills.transform((editor) => {
    for (let i = 0; i < 20; i++) editor.add(info(`skill-${i}`, `/overlap/skill-${i}/SKILL.md`), [(`/shadowed/skill-${i}/SKILL.md`) as AbsolutePath])
  })
  const withConflicts = time(() => {
    skills.list()
    skills.conflicts()
  }, 50)
  const conflicts = yield* skills.conflicts()
  console.log(`${pad("Skill state rebuild, 200 skills, no collisions")}${us(plain)}`)
  console.log(`${pad("Skill state rebuild, 200 skills + 20 shadow chains")}${us(withConflicts)}  conflicts:${conflicts.length}`)
}).pipe(Effect.provide(AppNodeBuilder.build(LayerNode.group([Skill.node, Bus.node]))))

await Effect.runPromise(Effect.scoped(skillProgram))

// ---- 4. MCP schema canonicalisation + tool-name recovery ------------------------------------

const mcpSchema = {
  type: "object",
  properties: Object.fromEntries(
    Array.from({ length: 30 }, (_, i) => [
      `field_${i}`,
      i % 3 === 0
        ? { type: "string", enum: ["alpha", "bravo", "charlie"], description: `Field ${i} of the probe schema.` }
        : i % 3 === 1
          ? {
              type: "object",
              properties: { inner: { type: "string" }, deep: { type: "array", items: { type: "number" } } },
              required: ["deep", "inner"],
            }
          : { type: "number", description: `Numeric field ${i}`, minimum: 0 },
    ]),
  ),
  required: Array.from({ length: 12 }, (_, i) => `field_${i * 2}`),
}
const scrambled = {
  ...mcpSchema,
  properties: Object.fromEntries(Object.entries(mcpSchema.properties).reverse()),
  required: [...mcpSchema.required].reverse(),
}
{
  const once = ToolSchemaCanonical.canonicalize(mcpSchema)
  const canonical = time(() => ToolSchemaCanonical.canonicalize(mcpSchema), rounds * 5)
  const same = JSON.stringify(ToolSchemaCanonical.canonicalize(scrambled)) === JSON.stringify(once)
  console.log(`\n== registration-time (once per tool, not per request) ==`)
  console.log(`${pad("ToolSchemaCanonical.canonicalize (30-field MCP schema)")}${us(canonical)}  key-order stable:${same}`)

  const advertised = Array.from({ length: 30 }, (_, i) => `mcp_demo_tool_${i}`)
  advertised.push("developer_shell")
  console.log(`${pad("recoverToolName, exact miss over 31 names")}${us(time(() => recoverToolName("no_such_tool_here", advertised), rounds * 5))}`)
  console.log(`${pad("recoverToolName, repairable mcp.demo.tool_7")}${us(time(() => recoverToolName("mcp.demo.tool_7", advertised), rounds * 5))}`)
}
