#!/usr/bin/env bun
// Measures one local Session from the running service: wall time, model streaming, tool settlement,
// token usage, cache reuse, and per-step counts. Use it to compare identical tasks, models and output sizes.
// Usage: bun script/session-efficiency.ts --title "项目分析总结" [--directory deepseek-test] [--dev] [--json]

type Args = {
  session?: string
  title?: string
  directory?: string
  dev: boolean
  json: boolean
}

type Session = {
  id: string
  title?: string
  location?: { directory?: string }
  time?: { created?: number; updated?: number }
}

type ToolPart = {
  type: "tool"
  name: string
  time?: { created?: number; ran?: number; completed?: number }
  state?: { status?: string; input?: unknown }
}

type Message = {
  id: string
  type: string
  text?: string
  time?: { created: number; streamed?: number; completed?: number }
  tokens?: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
  model?: { id: string; providerID: string; variant?: string }
  content?: Array<ToolPart | { type: string; text?: string }>
  metadata?: { notice?: string }
}

const args = parseArgs(process.argv.slice(2))
const serviceFile = args.dev
  ? `${process.env.APPDATA}/ai.opencode.desktop.dev/opencode/service-local.json`
  : `${process.env.USERPROFILE}/.local/state/opencode/service.json`
const service = (await Bun.file(serviceFile).json()) as { url: string; password: string }
const base = service.url.replace("0.0.0.0", "127.0.0.1")
const headers = {
  authorization: `Basic ${Buffer.from(`opencode:${service.password}`).toString("base64")}`,
  "content-type": "application/json",
}

const sessions = (await request<{ data: Session[] }>("/api/session?limit=50&order=desc&parentID=null")).data
const session = selectSession(sessions)
const context = (
  await request<{ data: Message[] }>(
    `/api/session/${session.id}/context?location%5Bdirectory%5D=${encodeURIComponent(session.location?.directory ?? "")}`,
  )
).data

const user = context.find((message) => message.type === "user")
const idle = context.findLast((message) => message.type === "idle")
const assistants = context.filter((message) => message.type === "assistant")
const tools = assistants.flatMap((message) => (message.content ?? []).filter(isTool))
const toolNames = tools.reduce<Record<string, number>>((counts, tool) => {
  counts[tool.name] = (counts[tool.name] ?? 0) + 1
  return counts
}, {})
const notices = context.filter((message) => message.type === "system" && message.metadata?.notice)
const models = [...new Map(assistants.map((message) => [JSON.stringify(message.model), message.model])).values()]

const start = user?.time?.created ?? session.time?.created ?? 0
const end = idle?.time?.created ?? context.findLast((message) => message.time)?.time?.completed ?? Date.now()
const wall = Math.max(0, end - start)
const input = sum(assistants, (message) => message.tokens?.input ?? 0)
const cache = sum(assistants, (message) => message.tokens?.cache?.read ?? 0)
const output = sum(assistants, (message) => message.tokens?.output ?? 0)
const reasoning = sum(assistants, (message) => message.tokens?.reasoning ?? 0)
const stream = sum(assistants, (message) => {
  const time = message.time
  if (!time) return 0
  return Math.max(0, (time.streamed ?? time.completed ?? time.created) - time.created)
})
const settle = sum(assistants, (message) => {
  const time = message.time
  if (!time) return 0
  return Math.max(0, (time.completed ?? 0) - (time.streamed ?? time.completed ?? 0))
})
const gaps = Math.max(0, wall - stream - settle)
const toolMs = tools.flatMap((tool) =>
  tool.time?.ran !== undefined && tool.time.completed !== undefined ? [tool.time.completed - tool.time.ran] : [],
)
const total = output + reasoning
const steps = assistants.map((message, index) => {
  const time = message.time
  const stepStream = time ? Math.max(0, (time.streamed ?? time.completed ?? time.created) - time.created) : 0
  const stepSettle = time ? Math.max(0, (time.completed ?? 0) - (time.streamed ?? time.completed ?? 0)) : 0
  const stepTools = (message.content ?? []).filter(isTool)
  const stepToolMs = stepTools.flatMap((tool) =>
    tool.time?.ran !== undefined && tool.time.completed !== undefined ? [tool.time.completed - tool.time.ran] : [],
  )
  return {
    step: index + 1,
    streamMs: stepStream,
    settleMs: stepSettle,
    tools: stepTools.length,
    toolMs: sum(stepToolMs, (value) => value),
    toolMaxMs: stepToolMs.length ? Math.max(...stepToolMs) : 0,
    input: message.tokens?.input ?? 0,
    cache: message.tokens?.cache?.read ?? 0,
    output: (message.tokens?.output ?? 0) + (message.tokens?.reasoning ?? 0),
  }
})

const summary = {
  session: { id: session.id, title: session.title, directory: session.location?.directory },
  models,
  wallMs: wall,
  steps: assistants.length,
  tools: tools.length,
  toolNames,
  notices: notices.length,
  tokens: {
    input,
    cache,
    output,
    reasoning,
    outputAndReasoning: total,
    cacheHitPct: input + cache > 0 ? (cache / (input + cache)) * 100 : 0,
  },
  timing: {
    streamMs: stream,
    settleMs: settle,
    gapsMs: gaps,
    streamSharePct: wall > 0 ? (stream / wall) * 100 : 0,
    settleSharePct: wall > 0 ? (settle / wall) * 100 : 0,
    streamTokensPerSecond: stream > 0 ? total / (stream / 1_000) : 0,
    overallTokensPerSecond: wall > 0 ? total / (wall / 1_000) : 0,
    msPerOutputToken: total > 0 ? wall / total : 0,
  },
  toolDuration: {
    measured: toolMs.length,
    sumMs: sum(toolMs, (value) => value),
    maxMs: toolMs.length ? Math.max(...toolMs) : 0,
    avgMs: toolMs.length ? sum(toolMs, (value) => value) / toolMs.length : 0,
    parallelGain: settle > 0 ? sum(toolMs, (value) => value) / settle : 0,
  },
  stepsDetail: steps,
}

if (args.json) {
  console.log(JSON.stringify(summary, null, 2))
} else {
  printSummary(summary)
  printSteps(steps)
}

function parseArgs(argv: string[]): Args {
  const result: Args = { dev: false, json: false }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === "--dev") result.dev = true
    else if (arg === "--json") result.json = true
    else if (arg === "--session") result.session = argv[++index]
    else if (arg === "--title") result.title = argv[++index]
    else if (arg === "--directory") result.directory = argv[++index]
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return result
}

function selectSession(all: Session[]) {
  if (args.session) {
    const found = all.find((session) => session.id === args.session)
    if (!found) throw new Error(`Session not found in the recent list: ${args.session}`)
    return found
  }

  const matches = all.filter(
    (session) =>
      (!args.title || session.title?.toLowerCase().includes(args.title.toLowerCase())) &&
      (!args.directory || session.location?.directory?.toLowerCase().includes(args.directory.toLowerCase())),
  )
  if (matches.length === 0) throw new Error("No matching session")
  return matches.sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))[0]!
}

async function request<T>(path: string): Promise<T> {
  const response = await fetch(base + path, { headers })
  const text = await response.text()
  if (!response.ok) throw new Error(`${path} ${response.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text) as T
}

function isTool(part: { type: string }): part is ToolPart {
  return part.type === "tool"
}

function sum<A>(items: A[], value: (item: A) => number) {
  return items.reduce((total, item) => total + value(item), 0)
}

function printSummary(value: typeof summary) {
  console.log(`${value.session.title ?? "(untitled)"} · ${value.session.id}`)
  console.log(`${value.session.directory ?? "(no directory)"} · ${value.models.map(formatModel).join(", ")}`)
  console.log(
    `wall ${seconds(value.wallMs)} · stream ${seconds(value.timing.streamMs)} (${value.timing.streamSharePct.toFixed(1)}%) · tools ${seconds(value.timing.settleMs)} (${value.timing.settleSharePct.toFixed(1)}%) · gaps ${seconds(value.timing.gapsMs)}`,
  )
  console.log(
    `steps ${value.steps} · tools ${value.tools} · ${Object.entries(value.toolNames)
      .map(([name, count]) => `${name} ${count}`)
      .join(", ")}`,
  )
  console.log(
    `tokens in ${number(value.tokens.input)} · cache ${number(value.tokens.cache)} (${value.tokens.cacheHitPct.toFixed(1)}%) · out ${number(value.tokens.output)} · reasoning ${number(value.tokens.reasoning)}`,
  )
  console.log(
    `stream ${value.timing.streamTokensPerSecond.toFixed(1)} tok/s · overall ${value.timing.overallTokensPerSecond.toFixed(1)} tok/s · ${value.timing.msPerOutputToken.toFixed(1)} ms/output token`,
  )
  console.log(
    `tool durations sum ${seconds(value.toolDuration.sumMs)} · max ${seconds(value.toolDuration.maxMs)} · avg ${seconds(value.toolDuration.avgMs)} · parallel gain ${value.toolDuration.parallelGain.toFixed(2)}x`,
  )
  console.log(`mid-run instruction updates: ${value.notices}`)
}

function printSteps(steps: typeof summary.stepsDetail) {
  console.log("step  stream   settle  tools  toolMs  input    cache   out")
  for (const step of steps) {
    console.log(
      `${String(step.step).padStart(4)}  ${seconds(step.streamMs).padEnd(7)} ${seconds(step.settleMs).padEnd(6)} ${String(step.tools).padStart(5)}  ${seconds(step.toolMs).padEnd(6)} ${number(step.input).padEnd(8)} ${number(step.cache).padEnd(7)} ${number(step.output)}`,
    )
  }
}

function formatModel(model: { id: string; providerID: string; variant?: string }) {
  return `${model.providerID}/${model.id}${model.variant ? `:${model.variant}` : ""}`
}

function seconds(ms: number) {
  return `${(ms / 1_000).toFixed(1)}s`
}

function number(value: number) {
  return value.toLocaleString("en-US")
}
