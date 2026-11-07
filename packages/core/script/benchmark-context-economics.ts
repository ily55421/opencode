/**
 * A/B benchmark for the context-economics commits, runnable on the old and the new tree alike
 * (only `packages/util/src/token.ts` and `packages/core/src/tool-output.ts` are swapped):
 *
 *   bun run script/benchmark-context-economics.ts
 *
 * Section 1: token estimation of Han/mixed text — `estimate` (script-blind) vs `estimateWide`
 *            (per glyph), the rule compaction budgets read against since e87b700002.
 * Section 2: ToolOutput.truncate — the oversized grep result that used to skip the bound via its
 *            own `truncated` metadata (57c55f1b43), and the build log whose verdict used to be
 *            cut off by the head-only slice (1457f4fd17).
 *
 * Imports stay minimal so the old tree's missing `estimateWide` export cannot break the graph.
 */
import os from "os"
import path from "path"
import fs from "fs/promises"
import { Effect } from "effect"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { FSUtil } from "@opencode/util/fs-util"
import * as TokenModule from "../../util/src/token"
import { ToolOutput } from "../src/tool-output"

// Billing-correctness invariants (not timing): the per-glyph estimator must keep the script-blind
// estimate inside these ratios, or compaction budgets silently undercount again. The printed
// ratio is estimate/estimateWide — below 1.0 means the script-blind rule undercounts Han text.
const checks: Array<{ name: string; ok: boolean; detail: string }> = []
const record = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail })

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`
const tok = (bytes: number) => `≈${Math.round(bytes / 3.5)} tok`

console.log("== 1. token estimation: estimate (script-blind) vs estimateWide (per glyph) ==")
const wide = (TokenModule as { estimateWide?: (input: string) => number }).estimateWide
const estimate = TokenModule.estimate
const han = Array.from({ length: 1000 }, (_, i) => `第${i}条约定:保持指令确定性,标注每一次裁剪。`).join("\n")
const mixed = Array.from(
  { length: 500 },
  (_, i) => `// 第${i}行注释:检查会话循环边界\nfunction probe_${i}(input: string) { return input.trim().length }`,
).join("\n")
const ascii = Array.from({ length: 400 }, (_, i) => `probe convention line ${i}: keep instructions deterministic and name every trim.`).join("\n")
for (const [label, text] of [
  ["pure Han, 1000 lines", han],
  ["mixed code + Han comments", mixed],
  ["pure ASCII code", ascii],
] as const) {
  const old = estimate(text)
  const chars = text.length
  const hanGlyphs = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const New = wide ? wide(text) : old
  const ratio = old / New
  if (label.startsWith("pure Han")) record("han.undercount", ratio <= 0.4, `ratio ${ratio.toFixed(2)}x (≤ 0.40 keeps the per-glyph correction honest)`)
  if (label.startsWith("mixed")) record("mixed.undercount", ratio >= 0.5 && ratio <= 1.0, `ratio ${ratio.toFixed(2)}x (0.5–1.0)`)
  if (label.startsWith("pure ASCII")) record("ascii.parity", Math.abs(ratio - 1) <= 0.02, `ratio ${ratio.toFixed(2)}x (±2% of 1.0)`)
  console.log(
    `${label.padEnd(28)} chars ${String(chars).padStart(6)}  Han ${String(hanGlyphs).padStart(5)}  estimate ${String(old).padStart(6)}  estimateWide ${String(New).padStart(6)}  ratio ${ratio.toFixed(2)}x`,
  )
}
console.log(
  `(ceiling consequence: a Han session the old rule sizes at 25k "tokens" really costs ~4x that at the provider — compaction never fired before the provider rejected the request.)`,
)

console.log("\n== 2. ToolOutput.truncate (defaults: MAX_LINES/MAX_BYTES from the module under test) ==")
console.log(`MAX_LINES=${ToolOutput.MAX_LINES} MAX_BYTES=${ToolOutput.MAX_BYTES}`)

const program = Effect.acquireUseRelease(
  Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "oc-bench-ctx-"))),
  (tmp) =>
    Effect.gen(function* () {
      const layer = AppNodeBuilder.build(LayerNode.group([ToolOutput.node, FSUtil.node]), [
        Global.node.replace(Global.layerWith({ data: tmp })),
      ])
      const output = yield* ToolOutput.Service.pipe(Effect.provide(layer))

      // (a) oversized grep result that carries its own `truncated` metadata — the key the old
      // clipper treated as "already bounded" and let straight through (claim: 428 KB reaching
      // the model with no marker).
      const grepLines = Array.from({ length: 2000 }, (_, i) => `src/session/runner/llm.ts:${i + 10}: match ${i} of SessionRunnerLoop.decide in the probe corpus ${"padding-for-realistic-line-length".repeat(2)}`)
      const grepText = grepLines.join("\n")
      const grep = yield* output.truncate({
        output: { matches: 2000 },
        metadata: { truncated: true },
        content: [{ type: "text", text: grepText }],
      })
      const grepOut = grep.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n")
      console.log(
        `grep 2000 matches (${kb(Buffer.byteLength(grepText))}) → model sees ${kb(Buffer.byteLength(grepOut))} ${tok(Buffer.byteLength(grepOut))}, marker:${grepOut.includes("full output saved to") ? "yes" : "NO"}`,
      )

      // (b) build log whose verdict sits in the tail — the head-only slice dropped it.
      const logLines = Array.from({ length: 3000 }, (_, i) => `ok ${i} - probe test case ${i} passes after setup steps`)
      logLines[2998] = "FAILED (tests 128, failures 3): session loop turned in circles"
      logLines[2999] = "error: probe suite exited with code 1 — verdict line"
      const logText = logLines.join("\n")
      const log = yield* output.truncate({
        output: { ok: false },
        content: [{ type: "text", text: logText }],
      })
      const logOut = log.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n")
      console.log(
        `build log 3000 lines (${kb(Buffer.byteLength(logText))}) → model sees ${kb(Buffer.byteLength(logOut))} ${tok(Buffer.byteLength(logOut))}, verdict tail:${logOut.includes("verdict line") ? "kept" : "LOST"}`,
      )
  record(
    "truncate.grep.bound",
    Buffer.byteLength(grepOut) <= ToolOutput.MAX_BYTES + 200 && grepOut.includes("[showing"),
    `model sees ${kb(Buffer.byteLength(grepOut))} with the overflow marker`,
  )
  record(
    "truncate.log.verdict",
    Buffer.byteLength(logOut) <= ToolOutput.MAX_BYTES + 200 && logOut.includes("verdict line"),
    `model sees ${kb(Buffer.byteLength(logOut))} with the verdict tail kept`,
  )
    }),
  () => Effect.void,
)

await Effect.runPromise(Effect.scoped(program))

console.log("\n== invariants ==")
for (const check of checks)
  console.log(`   ${check.ok ? "PASS" : "FAIL"}  ${check.name.padEnd(22)} ${check.detail}`)
const pass = checks.every((check) => check.ok)
console.log(`\nverdict: ${pass ? "PASS" : "FAIL"}`)
process.exit(pass ? 0 : 1)
