import { Icon } from "@opencode/ui/icon"
import type { VcsFileStatus } from "@opencode/client/promise"
import { createEffect, createMemo, createSignal, For, Show, untrack, type JSX } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import type { SessionModel } from "@/session/model"
import { SESSION_RAIL_WIDTH } from "@/session/session-panel-width"
import { sessionRail, type RailEntry, type RailFile } from "./model"

/**
 * The always-visible right column: what this session changed, where it stands, and the two writes a person can
 * trigger from here. Every number comes from `./model`, which folds the session's own durable records, so the
 * rail reads the same way the transcript does rather than keeping a second account of the work.
 */
export function SessionRail(props: { session: SessionModel }) {
  const language = useLanguage()
  const sdk = useServerSDK()
  const data = useData()
  const [status, setStatus] = createSignal<readonly VcsFileStatus[]>([])
  const [diff, setDiff] = createSignal<readonly RailFile[]>([])
  const [message, setMessage] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [confirming, setConfirming] = createSignal(false)
  const [notice, setNotice] = createSignal<string>()
  const [error, setError] = createSignal<string>()

  const directory = createMemo(() => props.session.data.info()?.location.directory)
  const sessionID = createMemo(() => props.session.identity.params.id)
  /** The diff route takes a turn range, so the session's whole span is its first user message to its last. */
  const turns = createMemo(() => {
    const users = props.session.history.messages().filter((message) => message.type === "user")
    const first = users.at(0)
    const last = users.at(-1)
    return first && last ? { from: first.id, to: last.id } : undefined
  })
  const rail = createMemo(() => {
    const current = directory()
    return sessionRail({
      messages: props.session.history.messages(),
      diff: diff(),
      status: status(),
      info: current ? data.location.vcs.info({ directory: current }) : undefined,
      // A tool part only carries the composed `server_tool` name, so the server list is what splits it back.
      servers: (current ? data.location.mcp.server.list({ directory: current }) : undefined)?.map((server) => server.name) ?? [],
      boundary: props.session.data.revertMessageID(),
    })
  })

  const refresh = () => {
    const current = directory()
    if (!current) return
    // The location cache only answers once something has asked the server, and the rail is often the first reader.
    void data.location.vcs.sync({ directory: current }).catch(() => {})
    void data.location.mcp.server.sync({ directory: current }).catch(() => {})
    void sdk.api.vcs
      .status({ location: { directory: current } })
      .then((result) => setStatus(result.data))
      .catch(() => setStatus([]))
    const range = turns()
    const id = sessionID()
    if (!range || !id) return setDiff([])
    void sdk.api.session
      .diff({ sessionID: id, from: range.from, to: range.to })
      .then((result) =>
        setDiff(
          result.map((item) => ({
            file: item.file,
            additions: item.additions,
            deletions: item.deletions,
            status: item.status,
          })),
        ),
      )
      .catch(() => setDiff([]))
  }

  // New messages are the only thing that changes what the rail says about a running session, and a commit or a
  // push lands as one more message, so this is the single place that decides when to ask Git again. The reads
  // inside `refresh` are untracked so writing a cache cannot re-arm the effect that fills it.
  createEffect(() => {
    void props.session.history.messages().length
    untrack(refresh)
  })

  const write = (run: () => Promise<string>, after?: () => void) => {
    setBusy(true)
    setError(undefined)
    setNotice(undefined)
    void run()
      .then((text) => {
        setNotice(text)
        after?.()
        refresh()
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => {
        setBusy(false)
        setConfirming(false)
      })
  }

  const commit = () => {
    const current = directory()
    const files = rail().files.map((file) => file.file)
    if (!current || files.length === 0) return
    write(async () => {
      const result = await sdk.api.vcs.commit({ location: { directory: current }, message: message(), files })
      return language.t("session.rail.committed", { files: result.data.files, hash: result.data.commit.slice(0, 7) })
    }, () => setMessage(""))
  }

  // Pushing is the one action here a person cannot undo locally, so the button asks once and the second click goes.
  const push = () => {
    const current = directory()
    if (!current) return
    if (!confirming()) return setConfirming(true)
    write(async () => {
      const result = await sdk.api.vcs.push({ location: { directory: current } })
      return language.t("session.rail.pushed", {
        commits: result.data.commits,
        target: `${result.data.remote}/${result.data.branch}`,
      })
    })
  }

  return (
    <aside
      data-component="session-rail"
      style={{ width: `${SESSION_RAIL_WIDTH}px` }}
      class="shrink-0 min-w-0 h-full flex flex-col min-h-0 rounded-[14px] border-[0.5px] border-v2-border-border-base bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]"
    >
      <div class="px-3 pt-2.5 pb-2 flex items-center gap-1.5">
        <Icon name="window-analytics" class="size-3.5 shrink-0 text-v2-text-text-muted" />
        <span class="min-w-0 flex-1 truncate text-[13px] font-[530] text-v2-text-text-base">
          {language.t("session.rail.title")}
        </span>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto px-3 pb-3 flex flex-col gap-3.5">
        <Section title={language.t("session.rail.summary")} icon="code-slash">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-v2-text-text-base">
            <span>{language.t("session.rail.counts", { files: rail().files.length, commands: rail().commands })}</span>
            <Show when={rail().additions > 0 || rail().deletions > 0}>
              <span class="flex items-center gap-1 tabular-nums">
                <span class="text-v2-state-fg-success">+{rail().additions}</span>
                <span class="text-v2-state-fg-danger">-{rail().deletions}</span>
              </span>
            </Show>
          </div>
        </Section>

        <Section title={language.t("session.rail.environment")} icon="branch">
          <div class="flex items-center gap-1.5 text-[12px] text-v2-text-text-base min-w-0">
            <Icon name={rail().branch ? "branch" : "folder"} class="size-3 shrink-0 text-v2-text-text-muted" />
            <span class="min-w-0 truncate">{rail().branch ?? language.t("session.rail.noBranch")}</span>
            <Show when={rail().dirty > 0}>
              <span class="shrink-0 text-v2-text-text-muted">{language.t("session.rail.dirty", { count: rail().dirty })}</span>
            </Show>
          </div>

          <Show when={rail().files.length > 0}>
            <input
              data-slot="session-rail-message"
              type="text"
              value={message()}
              onInput={(event) => setMessage(event.currentTarget.value)}
              placeholder={language.t("session.rail.messagePlaceholder")}
              class="w-full min-w-0 rounded-[10px] border-[0.5px] border-v2-border-border-base bg-v2-background-bg-deep px-2 py-1.5 text-[12px] text-v2-text-text-base outline-none"
            />
            <div class="flex items-center gap-1.5">
              <button
                type="button"
                data-slot="session-rail-commit"
                disabled={busy() || message().trim() === ""}
                onClick={commit}
                class="flex-1 min-w-0 flex items-center justify-center gap-1 rounded-[10px] border-[0.5px] border-v2-border-border-base px-2 py-1.5 text-[12px] font-[530] text-v2-text-text-base outline-none disabled:opacity-50"
              >
                <Icon name="check" class="size-3 shrink-0" />
                <span class="truncate">{language.t("session.rail.commit")}</span>
              </button>
              <button
                type="button"
                data-slot="session-rail-push"
                disabled={busy() || !rail().branch}
                onClick={push}
                class="flex-1 min-w-0 flex items-center justify-center gap-1 rounded-[10px] border-[0.5px] border-v2-border-border-base px-2 py-1.5 text-[12px] font-[530] text-v2-text-text-base outline-none disabled:opacity-50"
                classList={{ "text-v2-state-fg-danger": confirming() }}
              >
                <Icon name="arrow-up-right" class="size-3 shrink-0" />
                <span class="truncate">
                  {confirming()
                    ? language.t("session.rail.pushConfirm", { target: rail().branch ?? "" })
                    : language.t("session.rail.push")}
                </span>
              </button>
            </div>
          </Show>

          <Show when={notice() || error()}>
            <div
              data-slot="session-rail-result"
              class="text-[12px] leading-text-compact text-v2-text-text-muted break-words"
              classList={{ "text-v2-state-fg-danger": !!error() }}
            >
              {error() ?? notice()}
            </div>
          </Show>
        </Section>

        <Show when={rail().skills.length > 0 || rail().mcp.length > 0}>
          <Section title={language.t("session.rail.skills")} icon="outline-brain">
            <Entries entries={[...rail().skills, ...rail().mcp]} />
          </Section>
        </Show>

        <Show when={rail().files.length > 0}>
          <Section title={language.t("session.rail.outputs")} icon="file-document">
            <ul class="flex flex-col gap-1">
              <For each={rail().files}>{(file) => <FileRow file={file} />}</For>
            </ul>
          </Section>
        </Show>

        <Show when={rail().links.length > 0}>
          <Section title={language.t("session.rail.links")} icon="outline-globe">
            <Entries entries={rail().links} />
          </Section>
        </Show>
      </div>
    </aside>
  )
}

function Section(props: { title: string; icon: string; children: JSX.Element }) {
  return (
    <section class="flex flex-col gap-1.5">
      <div class="flex items-center gap-1.5">
        <Icon name={props.icon} class="size-3 shrink-0 text-v2-text-text-muted" />
        <h3 class="min-w-0 truncate text-[11px] font-[530] tracking-[0.04em] text-v2-text-text-muted">{props.title}</h3>
      </div>
      <div class="flex flex-col gap-1.5">{props.children}</div>
    </section>
  )
}

function Entries(props: { entries: RailEntry[] }) {
  return (
    <ul class="flex flex-col gap-1">
      <For each={props.entries}>
        {(entry) => (
          <li class="flex items-center gap-1.5 text-[12px] text-v2-text-text-base min-w-0" title={entry.detail}>
            <span class="min-w-0 flex-1 truncate">{entry.label}</span>
            <Show when={entry.count > 1}>
              <span class="shrink-0 tabular-nums text-v2-text-text-muted">{entry.count}</span>
            </Show>
          </li>
        )}
      </For>
    </ul>
  )
}

function FileRow(props: { file: RailFile }) {
  const path = props.file.file.replace(/\\/g, "/")
  const name = path.split("/").pop() ?? path
  const folder = path.slice(0, path.length - name.length).replace(/\/$/, "")

  return (
    <li class="flex items-center gap-1.5 text-[12px] min-w-0" title={props.file.file}>
      <span class="min-w-0 flex-1 truncate text-v2-text-text-base">{name}</span>
      <Show when={folder}>
        <span class="shrink-0 max-w-[72px] truncate text-v2-text-text-muted">{folder}</span>
      </Show>
      <span class="shrink-0 flex items-center gap-1 tabular-nums">
        <span class="text-v2-state-fg-success">+{props.file.additions}</span>
        <span class="text-v2-state-fg-danger">-{props.file.deletions}</span>
      </span>
    </li>
  )
}
