import {
  ProjectAvatar,
  displayName,
  getProjectAvatarGenerated,
  getProjectAvatarSource,
  getProjectAvatarVariant,
} from "@opencode/ui/project-avatar"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { SessionProgressIndicatorV2 } from "@opencode/session-ui/v2/session-progress-indicator-v2"
import { useQuery } from "@tanstack/solid-query"
import { useLocation, useNavigate } from "@solidjs/router"
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { ActivityStrip } from "@/activity/heatmap"
import { createActivity } from "@/activity/activity"
import { createHomeController } from "@/home/model"
import { HOME_SESSION_LIMIT, mergeHomeSessionIndex, retainHomeSessions } from "@/home/sessions/index"
import { homeSessionsQuery } from "@/home/sessions/queries"
import { buildHomeSessionRecords, type HomeSessionRecord } from "@/home/sessions/records"
import { pathKey } from "@/workspaces/path-key"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { ServerConnection } from "@/runtime/server/registry"
import { sessionLabel } from "@/session/title"
import { useSettingsDialog } from "@/settings/command"
import { useCommand } from "@/shell/commands/command"
import { homeProjectDirectories } from "@/shell/layout/helpers"
import { draftHref, useTabs } from "@/shell/tabs/tabs"
import { useDirectoryPicker } from "@/workspaces/selection/picker"

type WorkspaceGroup = {
  key: string
  name: string
  project: HomeSessionRecord["project"]
  sessions: HomeSessionRecord[]
}

const GROUP_LIMIT = 5

/** The recent-session window is hours wide while the rail stays mounted for days, so the cutoff needs its own clock. */
const RECENCY_TICK_MS = 5 * 60 * 1000

/**
 * The desktop workspaces rail: new task, search, recent sessions grouped by project, this week's activity and
 * settings. It stays mounted across routes, so project groups and the activity card follow the focused server.
 */
export function WorkspaceSidebar() {
  const language = useLanguage()
  const platform = usePlatform()
  const command = useCommand()
  const tabs = useTabs()
  const navigate = useNavigate()
  const location = useLocation()
  const settings = useSettingsDialog()
  const pickDirectory = useDirectoryPicker()
  const home = createHomeController()

  const [state, setState] = createStore<{ collapsed: Record<string, boolean>; showAll: Record<string, boolean> }>({
    collapsed: {},
    showAll: {},
  })

  const sessions = useQuery(() => {
    const ctx = home.server.focusedContext()

    return {
      ...homeSessionsQuery(home.server.focused(), ctx),
      enabled: !!ctx && ctx.sdk.connection.status() === "connected",
    }
  })

  // Reading Date.now() inside the memo would freeze the cutoff at the last data change.
  const [recencyNow, setRecencyNow] = createSignal(Date.now())
  const recencyTimer = setInterval(() => setRecencyNow(Date.now()), RECENCY_TICK_MS)

  onCleanup(() => clearInterval(recencyTimer))

  const records = createMemo(() => {
    const ctx = home.server.focusedContext()

    if (!ctx) return []

    const known = retainHomeSessions(
      ctx.data.session.apply(mergeHomeSessionIndex(sessions.data?.() ?? [], ctx.data.session.list())),
      HOME_SESSION_LIMIT,
      recencyNow(),
    )

    return buildHomeSessionRecords({
      sessions: () => known,
      projectDirectories: () => undefined,
      projects: home.project.list,
      resolveProject: (session) => ctx.projects.forSession(session),
    })
  })

  const activity = createActivity({ api: () => home.server.focusedContext()?.sdk.api })

  const drafts = createMemo(() =>
    tabs.store.flatMap((tab) =>
      tab.type === "draft"
        ? [
            {
              id: tab.draftID,
              title: language.t("workspace.sidebar.newTask"),
              directory: pathKey(tab.directory),
              href: draftHref(tab.draftID),
            },
          ]
        : [],
    ),
  )

  const activeDraft = () => new URLSearchParams(location.search).get("draftId")

  const draftsFor = (group: WorkspaceGroup) => {
    const roots = [group.project.worktree, ...(group.project.sandboxes ?? [])].map(pathKey)

    return drafts().filter((draft) => roots.includes(draft.directory))
  }

  const groups = createMemo(() => {
    const result = new Map<string, WorkspaceGroup>()

    for (const record of records()) {
      const key = record.project.id ?? record.project.worktree

      const group = result.get(key) ?? {
        key,
        name: record.projectName,
        project: record.project,
        sessions: [],
      }

      group.sessions.push(record)
      result.set(key, group)
    }

    // A draft in a project without sessions still needs its workspace and task rows.
    for (const draft of drafts()) {
      const project = home.project
        .list()
        .find((item) =>
          [item.worktree, ...(item.sandboxes ?? [])].some((directory) => pathKey(directory) === draft.directory),
        )

      if (!project) continue
      const key = project.id ?? project.worktree

      if (result.has(key)) continue
      result.set(key, { key, name: displayName(project), project, sessions: [] })
    }

    // Every added project gets a workspace row, even before its first task.
    for (const project of home.project.list()) {
      const key = project.id ?? project.worktree

      if (result.has(key)) continue
      result.set(key, { key, name: displayName(project), project, sessions: [] })
    }

    return [...result.values()].sort((a, b) => {
      const latest = (group: WorkspaceGroup) => group.sessions[0]?.session.time.updated ?? 0

      return (
        latest(b) - latest(a) ||
        (b.project.time?.active ?? 0) - (a.project.time?.active ?? 0) ||
        a.name.localeCompare(b.name)
      )
    })
  })

  const serverName = () => {
    const conn = home.server.focused()

    if (!conn) return

    return ServerConnection.local(conn) ? language.t("composer.status.local") : home.server.label(conn)
  }

  const running = (sessionID: string) => home.server.focusedContext()?.data.session.status(sessionID) === "running"

  // Segment compare: a substring match would also light up for a longer ID that contains this one.
  const selected = (sessionID: string) => {
    const segments = location.pathname.split("/")
    const at = segments.lastIndexOf("session")

    return at >= 0 && segments[at + 1] === sessionID
  }

  const open = (record: HomeSessionRecord) => {
    const conn = home.server.focused()

    if (conn) home.project.openProjectSession(conn, record.project.worktree, record.session)
  }

  const addWorkspace = () => {
    const conn = home.server.focused()

    if (!conn) return
    pickDirectory({
      server: conn,
      title: language.t("command.project.open"),
      multiple: true,
      onSelect: (result) => void home.project.add(conn, homeProjectDirectories(result)),
    })
  }

  const openTask = (group: WorkspaceGroup) => {
    const conn = home.server.focused()

    if (conn) home.project.openProjectNewSession(conn, group.project.worktree)
  }

  return (
    <aside
      data-slot="workspace-sidebar"
      class="hidden w-[276px] shrink-0 flex-col bg-v2-background-bg-deep px-2.5 pb-2 pt-3 md:flex"
    >
      <div class="flex h-8 shrink-0 items-center gap-2 px-1">
        <span class="flex size-6 shrink-0 items-center justify-center rounded-md bg-v2-background-bg-layer-02 text-v2-icon-icon-base">
          <Icon name="code-slash" size="small" />
        </span>
        <span class="text-[13px] font-[530] text-v2-text-text-base">OpenCode</span>
        <Show when={serverName()}>
          {(name) => (
            <span class="ms-auto max-w-[88px] truncate rounded-full border border-v2-border-border-base px-2 py-0.5 text-[10px] text-v2-text-text-faint">
              {name()}
            </span>
          )}
        </Show>
      </div>

      <div class="mt-2 flex shrink-0 flex-col gap-0.5">
        <SidebarAction
          icon="plus"
          label={language.t("workspace.sidebar.newTask")}
          onClick={() => home.project.openNewSession()}
        />
        <SidebarAction
          icon="magnifying-glass"
          label={language.t("workspace.sidebar.search")}
          onClick={() => command.trigger("command.palette")}
        />
      </div>

      <div class="mt-4 flex min-h-0 flex-1 flex-col">
        <div class="flex shrink-0 items-center justify-between gap-2 px-2 pb-1">
          <span class="text-[11px] text-v2-text-text-faint">{language.t("workspace.sidebar.workspaces")}</span>
          <div class="flex items-center gap-1">
            <Show when={groups().length > 0}>
              <span class="text-[10px] tabular-nums text-v2-text-text-faint">{groups().length}</span>
            </Show>
            <Tooltip value={language.t("home.project.add")} placement="top">
              <IconButton
                type="button"
                variant="ghost-muted"
                size="small"
                icon={<Icon name="plus" size="small" />}
                aria-label={language.t("home.project.add")}
                onClick={addWorkspace}
              />
            </Tooltip>
          </div>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto pb-2 no-scrollbar" data-scrollable>
          <Show
            when={groups().length > 0}
            fallback={
              <div class="px-2 py-1 text-[12px] text-v2-text-text-faint">
                {sessions.isPending ? "…" : language.t("workspace.sidebar.empty")}
              </div>
            }
          >
            <For each={groups()}>
              {(group) => {
                const showAll = () => !!state.showAll[group.key]
                const visible = () => (showAll() ? group.sessions : group.sessions.slice(0, GROUP_LIMIT))
                const hidden = () => group.sessions.length - visible().length

                return (
                  <div class="mb-1.5">
                    <div class="group/workspace flex h-7 w-full min-w-0 items-center rounded-md text-[12px] font-[530] text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base">
                      <button
                        type="button"
                        class="flex h-full min-w-0 flex-1 items-center gap-1.5 ps-1.5 pe-1 text-start focus-visible:outline-none"
                        onClick={() => setState("collapsed", group.key, (value) => !value)}
                      >
                        <Icon
                          name={state.collapsed[group.key] ? "chevron-right" : "chevron-down"}
                          size="small"
                          class="shrink-0 text-v2-icon-icon-faint"
                        />
                        <ProjectAvatar
                          class="shrink-0"
                          aria-hidden="true"
                          fallback={displayName(group.project)}
                          src={getProjectAvatarSource(group.project.id, group.project.icon)}
                          variant={getProjectAvatarVariant(group.project.icon?.color)}
                          generated={getProjectAvatarGenerated(group.project)}
                        />
                        <span class="min-w-0 truncate">{group.name}</span>
                      </button>
                      <Tooltip value={language.t("workspace.sidebar.newTask")} placement="top">
                        <IconButton
                          type="button"
                          variant="ghost-muted"
                          size="small"
                          class="shrink-0 opacity-60 focus-visible:opacity-100 group-hover/workspace:opacity-100"
                          icon={<Icon name="plus" size="small" />}
                          aria-label={language.t("workspace.sidebar.newTask")}
                          onClick={(event: MouseEvent) => {
                            event.stopPropagation()
                            openTask(group)
                          }}
                        />
                      </Tooltip>
                    </div>
                    <Show when={!state.collapsed[group.key]}>
                      <div class="mt-0.5 flex flex-col gap-px ps-6">
                        <For each={draftsFor(group)}>
                          {(draft) => (
                            <button
                              type="button"
                              aria-current={activeDraft() === draft.id ? "page" : undefined}
                              class="flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-start text-[12px] transition-colors focus-visible:outline-none"
                              classList={{
                                "bg-v2-overlay-simple-overlay-pressed text-v2-text-text-base":
                                  activeDraft() === draft.id,
                                "text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base":
                                  activeDraft() !== draft.id,
                              }}
                              onClick={() => navigate(draft.href)}
                            >
                              <span class="flex size-3.5 shrink-0 items-center justify-center">
                                <Icon name="plus" size="small" class="text-v2-icon-icon-faint" />
                              </span>
                              <span class="min-w-0 truncate">{draft.title}</span>
                            </button>
                          )}
                        </For>
                        <For each={visible()}>
                          {(record) => (
                            <button
                              type="button"
                              data-session-id={record.session.id}
                              aria-current={selected(record.session.id) ? "page" : undefined}
                              class="group/session flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-start text-[12px] transition-colors focus-visible:outline-none"
                              classList={{
                                "bg-v2-overlay-simple-overlay-pressed text-v2-text-text-base": selected(
                                  record.session.id,
                                ),
                                "text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base":
                                  !selected(record.session.id),
                              }}
                              onClick={() => open(record)}
                            >
                              <span class="flex size-3.5 shrink-0 items-center justify-center">
                                <Show
                                  when={running(record.session.id)}
                                  fallback={<span class="size-1.5 rounded-full bg-v2-icon-icon-faint" />}
                                >
                                  <SessionProgressIndicatorV2 class="scale-75" />
                                </Show>
                              </span>
                              <span class="min-w-0 truncate">{sessionLabel(record.session)}</span>
                            </button>
                          )}
                        </For>
                        <Show when={group.sessions.length > GROUP_LIMIT}>
                          <button
                            type="button"
                            class="flex h-6 w-full items-center rounded-md px-1.5 text-start text-[11px] text-v2-text-text-faint hover:text-v2-text-text-muted focus-visible:outline-none"
                            onClick={() => setState("showAll", group.key, (value) => !value)}
                          >
                            {showAll()
                              ? language.t("workspace.sidebar.less")
                              : language.t("workspace.sidebar.more", { count: hidden() })}
                          </button>
                        </Show>
                      </div>
                    </Show>
                  </div>
                )
              }}
            </For>
          </Show>
          <button
            type="button"
            class="mt-1 flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-start text-[12px] text-v2-text-text-faint transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-muted focus-visible:outline-none"
            onClick={addWorkspace}
          >
            <Icon name="plus" size="small" class="shrink-0" />
            <span class="min-w-0 truncate">{language.t("workspace.sidebar.addWorkspace")}</span>
          </button>
        </div>
      </div>

      <ActivityStrip activity={activity} class="mt-2 shrink-0" />

      <div class="mt-2 flex shrink-0 items-center gap-1 border-t border-v2-border-border-base px-1 pt-2">
        <button
          type="button"
          class="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-[12px] text-v2-text-text-faint transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-muted focus-visible:outline-none"
          onClick={() => settings()}
        >
          <Icon name="settings-gear" size="small" class="shrink-0" />
          <span class="truncate">{language.t("sidebar.settings")}</span>
        </button>
        <Tooltip value={language.t("sidebar.help")} placement="top">
          <IconButton
            type="button"
            variant="ghost-muted"
            size="small"
            icon={<Icon name="help" size="small" />}
            aria-label={language.t("sidebar.help")}
            onClick={() => void platform.openExternal("https://opencode.ai/docs")}
          />
        </Tooltip>
      </div>
    </aside>
  )
}

function SidebarAction(props: { icon: "plus" | "magnifying-glass"; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      class="flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-[13px] text-v2-text-text-base transition-colors hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"
      onClick={props.onClick}
    >
      <Icon name={props.icon} size="small" class="shrink-0 text-v2-icon-icon-muted" />
      <span class="min-w-0 truncate">{props.label}</span>
    </button>
  )
}
