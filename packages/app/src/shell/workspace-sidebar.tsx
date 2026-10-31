import {
  ProjectAvatar,
  displayName,
  getProjectAvatarGenerated,
  getProjectAvatarSource,
  getProjectAvatarVariant,
} from "@opencode/ui/project-avatar"
import { Icon, type IconProps } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { Tooltip } from "@opencode/ui/tooltip"
import { useDialog } from "@opencode/ui/context/dialog"
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
import { useGlobal, useServerCtx } from "@/runtime/server/runtime"
import { useSessionTabAvatarState } from "@/shell/layout/project-avatar-state"
import { DeleteSessionDialog, renameSessionTitle } from "@/shell/tabs/activity"
import { EditableTitle } from "@/shell/editable-title"
import { sessionLabel } from "@/session/title"
import { useSettingsSurface, type SettingsRootTab } from "@/settings/surface"
import { useCommand } from "@/shell/commands/command"
import { homeProjectDirectories } from "@/shell/layout/helpers"
import { draftHref, findSessionTab, useTabs } from "@/shell/tabs/tabs"
import { useDirectoryPicker } from "@/workspaces/selection/picker"

type WorkspaceGroup = {
  key: string
  name: string
  project: HomeSessionRecord["project"]
  sessions: HomeSessionRecord[]
}

const GROUP_LIMIT = 5

type SidebarLabel = Parameters<ReturnType<typeof useLanguage>["t"]>[0]

/**
 * The bottom navigation's destinations. Each one is a Settings root page the host owns, so the rail never offers an
 * entry that leads nowhere; the rest of those pages stay reachable through `More`.
 */
const NAV_PAGES = [
  { tab: "usage", icon: "window-analytics", label: "settings.usage.title" },
  { tab: "extensions", icon: "extensions", label: "settings.tab.extensions" },
  { tab: "servers", icon: "server", label: "settings.tab.servers" },
] as const satisfies readonly { tab: SettingsRootTab; icon: IconProps["name"]; label: SidebarLabel }[]

const MORE_PAGES = [
  { tab: "shortcuts", label: "settings.tab.shortcuts" },
  { tab: "notifications", label: "settings.tab.notifications" },
  { tab: "experimental", label: "settings.tab.experimental" },
  { tab: "about", label: "settings.tab.about" },
] as const satisfies readonly { tab: SettingsRootTab; label: SidebarLabel }[]

// One row style for every sidebar destination, top nav and bottom nav alike.
const NAV_ROW =
  "flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-start text-[13px] text-v2-text-text-base transition-colors hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-border-border-focus"

const NAV_ROW_ACTIVE = "bg-v2-background-bg-layer-02"

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
  const settings = useSettingsSurface()
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

  const focusedKey = createMemo(() => {
    const conn = home.server.focused()

    return conn && ServerConnection.key(conn)
  })

  // Segment compare: a substring match would also light up for a longer ID that contains this one.
  const selected = (sessionID: string) => {
    const segments = location.pathname.split("/")
    const at = segments.lastIndexOf("session")

    return at >= 0 && segments[at + 1] === sessionID
  }

  // The Settings tab currently on screen, so the bottom nav marks the row that owns it. A project page has no root tab.
  const activePage = createMemo(() => {
    const view = settings.view()

    return settings.active() && view.type === "root" ? view.tab : undefined
  })

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
      class="hidden w-[252px] shrink-0 flex-col border-e border-v2-border-border-base bg-v2-background-bg-deep px-2.5 pb-2 pt-3 md:flex"
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
        <SidebarNavItem
          icon="plus"
          label={language.t("workspace.sidebar.newTask")}
          onClick={() => home.project.openNewSession()}
        />
        <SidebarNavItem
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
                    <div class="group/workspace flex h-7 w-full min-w-0 items-center rounded-lg text-[12.5px] font-[530] text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base">
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
                              class="flex h-7 w-full min-w-0 items-center gap-1.5 rounded-lg px-1.5 text-start text-[12.5px] transition-colors focus-visible:outline-none"
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
                        <Show when={focusedKey()}>
                          {(serverKey) => (
                            <For each={visible()}>
                              {(record) => (
                                <WorkspaceSessionRow
                                  record={record}
                                  serverKey={serverKey()}
                                  selected={selected(record.session.id)}
                                  onOpen={() => open(record)}
                                />
                              )}
                            </For>
                          )}
                        </Show>
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

      <div class="mt-2 flex shrink-0 flex-col gap-0.5">
        <For each={NAV_PAGES}>
          {(page) => (
            <SidebarNavItem
              icon={page.icon}
              label={language.t(page.label)}
              active={activePage() === page.tab}
              onClick={() => settings.open(page.tab)}
            />
          )}
        </For>
        <Menu appearance="standard" gutter={4} modal={false} placement="top-start">
          <Menu.Trigger as="button" type="button" class={NAV_ROW}>
            <Icon name="outline-dots" size="small" class="shrink-0 text-v2-icon-icon-muted" />
            <span class="min-w-0 truncate">{language.t("workspace.sidebar.moreNav")}</span>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content>
              <For each={MORE_PAGES}>
                {(page) => <Menu.Item onSelect={() => settings.open(page.tab)}>{language.t(page.label)}</Menu.Item>}
              </For>
            </Menu.Content>
          </Menu.Portal>
        </Menu>
      </div>

      <div class="mt-1 grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 border-t border-v2-border-border-base pt-1.5">
        <SidebarNavItem
          icon="settings-gear"
          label={language.t("sidebar.settings")}
          active={activePage() === "general"}
          onClick={() => settings.open()}
        />
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

/**
 * One sidebar destination. Top nav and bottom nav share it, so a row never advertises itself as secondary by going
 * small and faint; `active` is the only thing that sets a row apart.
 */
function SidebarNavItem(props: {
  icon: IconProps["name"]
  label: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-current={props.active ? "page" : undefined}
      class={props.active ? `${NAV_ROW} ${NAV_ROW_ACTIVE}` : NAV_ROW}
      onClick={props.onClick}
    >
      <Icon name={props.icon} size="small" class="shrink-0 text-v2-icon-icon-muted" />
      <span class="min-w-0 truncate">{props.label}</span>
    </button>
  )
}

/**
 * One session in the rail. It carries what the top bar's tab strip used to own: the busy and unread marks, the
 * close control for an open tab, and the rename and delete menu, so the rail is the only place a session is switched.
 */
function WorkspaceSessionRow(props: {
  record: HomeSessionRecord
  serverKey: ServerConnection.Key
  selected: boolean
  onOpen: () => void
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const tabs = useTabs()
  const global = useGlobal()
  const [menu, setMenu] = createStore({ open: false, rename: false })
  const [editing, setEditing] = createSignal(false)
  let root!: HTMLDivElement

  const serverCtx = useServerCtx(() =>
    global.servers.list().find((item) => ServerConnection.key(item) === props.serverKey),
  )

  const status = useSessionTabAvatarState(
    () => props.serverKey,
    () => props.record.session.id,
    () => true,
  )

  const tab = createMemo(() => findSessionTab(tabs.store, props.serverKey, props.record.session.id))

  const close = () => {
    const value = tab()

    if (!value) return
    tabs.closeTab(tabs.store.findIndex((item) => item === value))
  }

  const commit = (value: string) => {
    const original = props.record.session.title ?? ""
    setEditing(false)

    if (!value || value === original) return
    void renameSessionTitle(serverCtx(), props.record.session, value, language)
  }

  return (
    <div
      ref={root}
      data-slot="workspace-session-row"
      data-session-id={props.record.session.id}
      class="group/session flex h-7 w-full min-w-0 items-center gap-1.5 rounded-lg pe-1 text-[12.5px] transition-colors"
      classList={{
        "bg-v2-overlay-simple-overlay-pressed text-v2-text-text-base": props.selected,
        "text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base":
          !props.selected,
      }}
    >
      <Menu.Context modal={false} onOpenChange={(open) => setMenu("open", open)}>
        <Menu.Context.Trigger
          as="button"
          type="button"
          data-session-switch
          aria-current={props.selected ? "page" : undefined}
          class="flex h-full min-w-0 flex-1 items-center gap-1.5 ps-1.5 text-start focus-visible:outline-none"
          onClick={props.onOpen}
        >
          <span class="flex size-4 shrink-0 items-center justify-center">
            <Show
              when={status.loading()}
              fallback={
                <Show
                  when={!props.selected && (status.attention() || status.unread())}
                  fallback={<span class="size-1.5 rounded-full bg-v2-icon-icon-faint" />}
                >
                  <span
                    data-slot="workspace-session-unread"
                    aria-hidden="true"
                    class="size-1.5 rounded-full"
                    classList={{
                      "bg-v2-state-fg-warning": status.attention(),
                      "bg-v2-background-bg-accent": !status.attention(),
                    }}
                  />
                </Show>
              }
            >
              <SessionProgressIndicatorV2 data-emphasis="strong" />
            </Show>
          </span>
          <EditableTitle
            text={() => sessionLabel(props.record.session)}
            editing={editing()}
            root={() => root}
            class="truncate"
            attributes={{ "data-slot": "workspace-session-title" }}
            onEditRequest={() => setEditing(true)}
            onCommit={commit}
            onCancel={() => setEditing(false)}
          />
        </Menu.Context.Trigger>
        <Menu.Context.Portal>
          <Menu.Context.Content
            onCloseAutoFocus={(event) => {
              if (!menu.rename) return
              event.preventDefault()
              setMenu("rename", false)
              setEditing(true)
            }}
          >
            <Menu.Item onSelect={() => setMenu("rename", true)}>{language.t("common.rename")}</Menu.Item>
            <Menu.Item disabled={!tab()} onSelect={close}>
              {language.t("common.closeTab")}
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item
              data-variant="critical"
              onSelect={() =>
                dialog.show(() => <DeleteSessionDialog server={props.serverKey} session={() => props.record.session} />)
              }
            >
              {language.t("session.delete.title")}…
            </Menu.Item>
          </Menu.Context.Content>
        </Menu.Context.Portal>
      </Menu.Context>
      <Show when={tab()}>
        <IconButton
          type="button"
          variant="ghost-muted"
          size="small"
          class="shrink-0 transition-opacity group-hover/session:pointer-events-auto group-hover/session:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
          classList={{
            // `hover-reveal` would force this visible on a touch display, where no hover ever happens to reveal it,
            // so every listed tab grew a close button at once. Only the row you are on carries one; the rest wait for
            // hover, and stay inert while hidden so an invisible control cannot be tapped.
            "opacity-100": props.selected,
            "pointer-events-none opacity-0": !props.selected,
          }}
          icon={<Icon name="xmark-small" size="small" />}
          aria-label={language.t("common.closeTab")}
          onClick={(event: MouseEvent) => {
            event.stopPropagation()
            close()
          }}
        />
      </Show>
    </div>
  )
}
