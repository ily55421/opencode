import type { SessionMessageInfo, VcsFileStatus, VcsInfo } from "@opencode/client/promise"

/**
 * The numbers the session rail shows. The file list arrives from `session.diff`, which is the same authority the
 * review panel uses; the rest is folded from durable records the session already wrote, so the rail cannot drift
 * from the transcript.
 */
export interface Rail {
  files: RailFile[]
  additions: number
  deletions: number
  /** Distinct tool names with a completed call, so the rail can say what the session actually used. */
  tools: number
  commands: number
  skills: RailEntry[]
  mcp: RailEntry[]
  links: RailEntry[]
  branch: string | undefined
  default: string | undefined
  /** Working-copy entries, which is what the commit row offers to send. */
  dirty: number
}

export interface RailFile {
  file: string
  additions: number
  deletions: number
  status: string
}

export interface RailEntry {
  label: string
  detail: string | undefined
  count: number
}

export function sessionRail(input: {
  messages: readonly SessionMessageInfo[]
  /** The session's own diff, worktree-relative, from `GET /api/session/:id/diff`. */
  diff: readonly RailFile[]
  status: readonly VcsFileStatus[]
  info: VcsInfo | undefined
  /** Configured MCP server names, because a tool part only carries the composed `server_tool` name. */
  servers: readonly string[]
  /** Revert boundary: messages at or after it are not visible to the model, so they are not the session's work. */
  boundary?: string
}): Rail {
  const end = input.boundary ? input.messages.findIndex((message) => message.id === input.boundary) : -1
  const messages = input.messages.slice(0, end === -1 ? input.messages.length : end)
  const tools = messages
    .flatMap((message) => (message.type === "assistant" ? message.content : []))
    .filter((part) => part.type === "tool" && part.state.status === "completed")

  const names = new Set<string>()
  const skills = new Map<string, Bucket>()
  const mcp = new Map<string, Bucket>()
  const links = new Map<string, Bucket>()
  let commands = 0
  let additions = 0
  let deletions = 0

  for (const message of messages) if (message.type === "skill") bump(skills, message.name)

  for (const part of tools) {
    if (part.type !== "tool" || part.state.status !== "completed") continue
    names.add(part.name)
    if (part.name === "shell") commands++
    if (part.name === "skill")
      bump(skills, text(part.state.metadata?.name) ?? text(part.state.input.name) ?? text(part.state.input.id) ?? "skill")

    const server = input.servers.find((item) => part.name.startsWith(`${item.replaceAll(".", "_")}_`))
    if (server) bump(mcp, server, part.name.slice(server.length + 1))

    const url = text(part.state.input.url)
    if (url) bump(links, host(url), url)
  }

  for (const file of input.diff) {
    additions += file.additions
    deletions += file.deletions
  }

  return {
    files: input.diff.toSorted((a, b) => a.file.localeCompare(b.file)),
    additions,
    deletions,
    tools: names.size,
    commands,
    skills: list(skills),
    mcp: list(mcp),
    links: list(links),
    branch: input.info?.branch.current,
    default: input.info?.branch.default,
    dirty: input.status.length,
  }
}

interface Bucket {
  count: number
  detail: string | undefined
}

function bump(map: Map<string, Bucket>, label: string, detail?: string) {
  const current = map.get(label)
  map.set(label, { count: (current?.count ?? 0) + 1, detail: detail ?? current?.detail })
}

const list = (map: Map<string, Bucket>) =>
  [...map.entries()]
    .map(([label, bucket]) => ({ label, detail: bucket.detail, count: bucket.count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))

const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined)

/** The rail lists a page by its host so ten fetches of one site read as one row; the URL stays as the detail. */
function host(url: string) {
  const authority = /^https?:\/\/([^/?#]+)/.exec(url)?.[1]
  return authority ?? url.replace(/^\/+/, "")
}
