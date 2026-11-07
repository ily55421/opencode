import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { SessionSystemPrompt } from "@opencode/core/session/system-prompt"

import * as EditTool from "@opencode/core/tool/plugin/edit"
import * as GlobTool from "@opencode/core/tool/plugin/glob"
import * as GrepTool from "@opencode/core/tool/plugin/grep"
import * as ImageTool from "@opencode/core/tool/plugin/image-generate"
import * as PatchTool from "@opencode/core/tool/plugin/patch"
import * as ReadTool from "@opencode/core/tool/plugin/read"
import * as ShellTool from "@opencode/core/tool/plugin/shell"
import * as SkillTool from "@opencode/core/tool/plugin/skill"
import * as SubagentTool from "@opencode/core/tool/plugin/subagent"
import * as TodoTool from "@opencode/core/tool/plugin/todo"
import * as WebfetchTool from "@opencode/core/tool/plugin/webfetch"
import * as WebsearchTool from "@opencode/core/tool/plugin/websearch"
import * as WriteTool from "@opencode/core/tool/plugin/write"

const root = join(import.meta.dir, "../../..")
const source = (file: string) => readFileSync(join(root, file), "utf8")

/**
 * The model surface is a contract: these sentences, notice tokens and event names are repeated
 * verbatim by consumers — the UI labels synthetic messages by their notice token, clients match
 * event names, and the provider caches whatever bytes the prompts produce. Renaming one of these
 * is a protocol change, so each entry must be updated here in the same change that renames it.
 */
const CONTRACT_TOKENS: ReadonlyArray<{ token: string; file: string; why: string }> = [
  {
    token: "Your previous response had no visible output.",
    file: "packages/core/src/session/runner/empty.ts",
    why: "empty-response retry nudge",
  },
  {
    token: "The model returned three responses with no visible output in a row",
    file: "packages/core/src/session/runner/empty.ts",
    why: "empty-response stop notice",
  },
  { token: "empty-response-retry", file: "packages/core/src/session/runner/empty.ts", why: "notice label" },
  { token: "empty-response-stopped", file: "packages/core/src/session/runner/empty.ts", why: "notice label" },
  {
    token: "The previous response was interrupted. Continue from where you left off",
    file: "packages/core/src/session/runner/llm.ts",
    why: "incomplete-stream continuation",
  },
  { token: "Loop guard: this exact tool call", file: "packages/core/src/session/runner/loop.ts", why: "repeat refusal" },
  {
    token: "Loop guard: automatic continuation stopped",
    file: "packages/core/src/session/runner/loop.ts",
    why: "repeat stop notice",
  },
  {
    token: "Permission guard: automatic continuation stopped",
    file: "packages/core/src/session/runner/loop.ts",
    why: "decline stop notice",
  },
  {
    token: "Format guard: automatic continuation stopped",
    file: "packages/core/src/session/runner/loop.ts",
    why: "malformed stop notice",
  },
  { token: "Failure guard: ", file: "packages/core/src/session/runner/loop.ts", why: "failure streak advisory and stop" },
  {
    token: "Plan mode cannot run shell commands the scanner cannot analyze",
    file: "packages/core/src/tool/plugin/shell.ts",
    why: "plan-mode hard backstop for unanalyzable shell commands",
  },
  { token: '"session.inbox.enqueued"', file: "packages/schema/src/session-event.ts", why: "durable event name" },
  { token: '"session.inbox.delivered"', file: "packages/schema/src/session-event.ts", why: "durable event name" },
  { token: '"session.usage.recorded"', file: "packages/schema/src/session-event.ts", why: "durable event name" },
  { token: '"session.step.ended"', file: "packages/schema/src/session-event.ts", why: "durable event name" },
  { token: '"session.tool.success"', file: "packages/schema/src/session-event.ts", why: "durable event name" },
]

const RETIRED_VOCABULARY: ReadonlyArray<{ phrase: string; where: string; why: string }> = [
  {
    phrase: "provider turn",
    where: "packages/core/src",
    why: "AGENTS.md: a single model call must not be called a turn; the word is reserved for the assistant-turn unit",
  },
  {
    phrase: "LLMRequest.update(",
    where: "packages/core/src",
    why: "the helper was removed with the ai.request refactor; spread the request instead",
  },
  {
    phrase: "TestLLM.tool(",
    where: "packages/core/test",
    why: "renamed to TestLLM.toolCall when requests became plain objects",
  },
]

const TOOL_PLUGINS = [
  EditTool,
  GlobTool,
  GrepTool,
  ImageTool,
  PatchTool,
  ReadTool,
  ShellTool,
  SkillTool,
  SubagentTool,
  TodoTool,
  WebfetchTool,
  WebsearchTool,
  WriteTool,
]

const ALL_TOOLS = TOOL_PLUGINS.map((plugin) => plugin.name)

describe("model surface contract", () => {
  test("every registered contract token appears verbatim in the file that owns it", () => {
    const missing = CONTRACT_TOKENS.filter(({ token, file }) => !source(file).includes(token))
    expect(
      missing.map(({ token, file, why }) => `${file} no longer carries "${token}" (${why})`),
    ).toEqual([])
  })

  test("the contract registry stays anchored: every listed file exists", () => {
    const dead = CONTRACT_TOKENS.filter(({ file }) => {
      try {
        source(file)
        return false
      } catch {
        return true
      }
    })
    expect(dead.map(({ file }) => file)).toEqual([])
  })

  test("retired vocabulary does not come back", () => {
    for (const { phrase, where } of RETIRED_VOCABULARY) {
      const offenders: string[] = []
      const scan = (dir: string) => {
        for (const entry of Array.from(new Bun.Glob("**/*.ts").scanSync({ cwd: join(root, dir) }))) {
          if (entry.includes("node_modules")) continue
          // This file quotes the retired phrases as literals; it is the registry, not an offender.
          if (entry.endsWith("model-surface-contract.test.ts")) continue
          if (source(join(dir, entry)).includes(phrase)) offenders.push(`${dir}/${entry}`)
        }
      }
      scan(where)
      expect(offenders).toEqual([])
    }
  })

  test("tool names stay unique, machine-safe and reconciled with the prompt guidance", () => {
    const names: string[] = TOOL_PLUGINS.map((plugin) => plugin.name)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) expect(/^[a-z][a-z0-9_-]*$/.test(name)).toBe(true)
    // The system prompt's tool guidance keys on these names; a rename without updating the
    // prompt silently drops the guidance from every request.
    expect(["shell", "write", "edit"].every((tool) => names.includes(tool))).toBe(true)
  })

  test("the default system prompt stays inside its per-role byte budget", () => {
    // Measured 1,753 bytes at the time the budget was set (all 14 tools). The ceiling exists to
    // turn an accidental prompt growth into a reviewed decision, not to forbid growth.
    const budget = 2_200
    const prompt = SessionSystemPrompt.make(ALL_TOOLS)
    expect(prompt.length).toBeLessThanOrEqual(budget)
    expect(prompt.length).toBeGreaterThan(1_000)
  })

  test("tool guidance is scoped to the tools a request actually carries", () => {
    const withShell = SessionSystemPrompt.make(["shell", "read"])
    const withoutShell = SessionSystemPrompt.make(["read"])
    expect(withShell).toContain("Prefer dedicated tools over shell commands")
    expect(withoutShell).not.toContain("Prefer dedicated tools over shell commands")
    expect(withoutShell.length).toBeLessThan(withShell.length)
  })
})
