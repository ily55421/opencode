import { expect, test } from "bun:test"
import type {
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionMessageSkill,
  SessionMessageToolStateCompleted,
  VcsFileStatus,
} from "@opencode/client/promise"
import { sessionRail, type RailFile } from "./model"

let next = 0

const tool = (
  name: string,
  input: SessionMessageToolStateCompleted["input"] = {},
  metadata: SessionMessageToolStateCompleted["metadata"] = undefined,
): SessionMessageAssistantTool => ({
  type: "tool",
  id: `tool_${next++}`,
  name,
  state: { status: "completed", input, content: [{ type: "text", text: "ok" }], metadata },
  time: { created: 0 },
})

const assistant = (...content: SessionMessageAssistant["content"]): SessionMessageAssistant => ({
  id: `msg_${next++}`,
  type: "assistant",
  time: { created: 0 },
  agent: "build",
  model: { id: "model", providerID: "provider" },
  content,
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
})

const skill = (name: string): SessionMessageSkill => ({
  id: `msg_${next++}`,
  type: "skill",
  skill: "skl_test",
  name,
  text: "",
  time: { created: 0 },
})

const file = (name: string, additions: number, deletions = 0): RailFile => ({
  file: name,
  additions,
  deletions,
  status: "modified",
})

const status = (name: string): VcsFileStatus => ({ file: name, additions: 1, deletions: 0, status: "modified" })

const rail = (
  messages: readonly SessionMessageInfo[],
  input: { diff?: RailFile[]; status?: VcsFileStatus[]; servers?: string[]; boundary?: string } = {},
) =>
  sessionRail({
    messages,
    diff: input.diff ?? [],
    status: input.status ?? [],
    info: { branch: { current: "feature", default: "main" } },
    servers: input.servers ?? [],
    boundary: input.boundary,
  })

test("totals the session diff into the summary", () => {
  const result = rail([], { diff: [file("a.ts", 5, 2), file("b.ts", 3)] })

  expect({ additions: result.additions, deletions: result.deletions }).toEqual({ additions: 8, deletions: 2 })
})

test("lists the session's changed files by path", () => {
  const result = rail([], { diff: [file("src/b.ts", 1), file("src/a.ts", 2)] })

  expect(result.files.map((item) => item.file)).toEqual(["src/a.ts", "src/b.ts"])
})

test("keeps the uncommitted count separate from what the session changed", () => {
  const result = rail([], { diff: [file("a.ts", 1)], status: [status("a.ts"), status("stray.md")] })

  expect({ files: result.files.length, dirty: result.dirty }).toEqual({ files: 1, dirty: 2 })
})

test("counts the commands the session ran", () => {
  const result = rail([assistant(tool("shell", { command: "ls" }), tool("shell", { command: "pwd" }), tool("grep", { pattern: "x" }))])

  expect({ commands: result.commands, tools: result.tools }).toEqual({ commands: 2, tools: 2 })
})

test("attributes a composed MCP tool name back to its server", () => {
  const result = rail(
    [assistant(tool("my_server_fetch", {}), tool("gh_issue_create", {}), tool("webfetch", { url: "https://opencode.ai/docs" }))],
    { servers: ["my.server", "gh"] },
  )

  expect(result.mcp).toEqual([
    { label: "gh", detail: "issue_create", count: 1 },
    { label: "my.server", detail: "fetch", count: 1 },
  ])
})

test("records a skill from its durable activation and from the tool call", () => {
  const result = rail([skill("review"), assistant(tool("skill", { name: "review" }, { name: "review" }))])

  expect(result.skills).toEqual([{ label: "review", detail: undefined, count: 2 }])
})

test("folds repeated fetches of one site into one row that still shows a url", () => {
  const result = rail([
    assistant(tool("webfetch", { url: "https://opencode.ai/docs" }), tool("webfetch", { url: "https://opencode.ai/docs/server" })),
  ])

  expect(result.links).toEqual([{ label: "opencode.ai", detail: "https://opencode.ai/docs/server", count: 2 }])
})

test("stops at the revert boundary, because the model cannot see past it", () => {
  const kept = assistant(tool("shell", { command: "ls" }))
  const dropped = assistant(tool("shell", { command: "pwd" }))
  const result = rail([kept, dropped], { boundary: dropped.id })

  expect(result.commands).toBe(1)
})

test("reports the branch the session is standing on", () => {
  const result = rail([])

  expect({ branch: result.branch, default: result.default, dirty: result.dirty }).toEqual({
    branch: "feature",
    default: "main",
    dirty: 0,
  })
})
