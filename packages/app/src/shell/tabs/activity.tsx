import { createEffect, createMemo, createResource, For, onCleanup, onMount, type Accessor } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { base64Encode } from "@opencode/util/encode"
import { createTabComposerState } from "@/composer/persistence"
import { useCommand } from "@/shell/commands/command"
import { useSessionTabAvatarState } from "@/shell/layout/project-avatar-state"
import { errorMessage } from "@/shell/layout/helpers"
import { notifySessionTabsRemoved } from "@/shell/titlebar/session-events"
import { sessionTreeIDs } from "@/session/requests/session-request-tree"
import { sessionTitle } from "@/session/title"
import { showToast } from "@/shell/notifications/toast"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal, useServerCtx, type ServerCtx } from "@/runtime/server/runtime"
import { useCurrentRoute } from "@/shell/state/layout"
import type { SessionInfo } from "@opencode/client/promise"
import { tabKey, useTabs, type SessionTab } from "./tabs"
import { registerTabCommands } from "./commands"

type TabState = {
  visible: Accessor<boolean>
  unread: Accessor<boolean>
}

/**
 * Keeps open session tabs warm while the workspaces rail, not a tab strip, is the surface that lists them: resolving
 * each record, syncing the background tabs' metadata and inbox, carrying their unread state, and answering the tab
 * shortcuts. Mount it only when no strip is on screen, because a strip's rows already do all of this for themselves.
 */
export function TabActivityHost() {
  const global = useGlobal()
  const tabs = useTabs()
  const command = useCommand()
  const language = useLanguage()
  const route = useCurrentRoute()

  const [states, setStates] = createStore<Record<string, TabState>>({})

  const visibleTabs = createMemo(() =>
    tabs.store.filter((tab) => tab.type === "draft" || states[tabKey(tab)]?.visible()),
  )

  const currentTab = createMemo(() => {
    const value = route()

    if (value.type === "draft") return tabs.store.find((tab) => tab.type === "draft" && tab.draftID === value.draftID)

    if (value.type !== "session") return

    const direct = tabs.store.find(
      (tab) =>
        tab.type === "session" &&
        tab.server === value.server &&
        (tab.sessionId === value.sessionId || tab.routeSessionId === value.sessionId),
    )

    if (direct) return direct

    // A child session route belongs to the tab that opened it, the way the strip highlights its parent.
    const conn = global.servers.list().find((item) => ServerConnection.key(item) === value.server)
    const root = conn ? global.ensureServerCtx(conn).data.session.root(value.sessionId) : value.sessionId

    return tabs.store.find((tab) => tab.type === "session" && tab.server === value.server && tab.sessionId === root)
  })

  registerTabCommands(command, language, {
    visibleTabs,
    currentTab,
    unread: (key) => states[key]?.unread() ?? false,
    select: (tab) => tabs.select(tab),
  })

  return (
    <For each={tabs.store}>
      {(tab) => {
        if (tab.type !== "session") return null

        return (
          <SessionTabUpkeep
            tab={tab}
            isCurrent={() => {
              const current = currentTab()

              return current !== undefined && current.type === "session" && tabKey(current) === tabKey(tab)
            }}
            register={(key, state) => {
              setStates(key, state)

              return () =>
                setStates(
                  produce((draft) => {
                    delete draft[key]
                  }),
                )
            }}
          />
        )
      }}
    </For>
  )
}

function SessionTabUpkeep(props: {
  tab: SessionTab
  isCurrent: Accessor<boolean>
  register: (key: string, state: TabState) => VoidFunction
}) {
  const global = useGlobal()
  const tabs = useTabs()
  const key = tabKey(props.tab)
  const ctx = useServerCtx(() => global.servers.list().find((item) => ServerConnection.key(item) === props.tab.server))
  const pending = createMemo(() => tabs.pendingSession(props.tab.server, props.tab.sessionId))
  const persisted = createMemo(() => tabs.info[key])

  const status = useSessionTabAvatarState(
    () => props.tab.server,
    () => props.tab.sessionId,
    () => true,
  )

  // The current tab's transcript is loaded by the timeline it is opened into; this one resolves its record.
  const [loadedSession] = createResource(
    () => {
      if (pending() || (!props.isCurrent() && persisted()?.title)) return
      const current = ctx()

      return current ? { id: props.tab.sessionId, ctx: current } : undefined
    },
    ({ id, ctx }) =>
      ctx.data.session
        .sync(id)
        .then(() => ctx.data.session.get(id))
        .catch(() => undefined),
  )

  const session = createMemo(() =>
    pending() ? undefined : (ctx()?.data.session.get(props.tab.sessionId) ?? loadedSession()),
  )

  const missingSession = createMemo(() => !pending() && !!ctx() && !loadedSession.loading && !session())

  createEffect(() => {
    const value = session()

    if (!value) return
    const current = ctx()

    tabs.rememberSessionInfo(
      props.tab,
      value,
      current?.data.session.message.list(value.id).some((message) => message.type === "user") ?? false,
    )

    if (!current) return
    createTabComposerState(tabs, props.tab, current.sdk.scope, {
      dir: base64Encode(value.location.directory),
      id: value.id,
    })
  })

  // An inactive tab needs its metadata and its inbox, whose waiting work keeps it busy. Only a running session can
  // wait on a permission or a form, and reading either boots that session's location on the server.
  createEffect(() => {
    const current = ctx()

    if (
      pending() ||
      !current ||
      props.isCurrent() ||
      (!session() && !persisted()?.title) ||
      current.sdk.connection.status() !== "connected"
    )
      return

    const running = [props.tab.sessionId, ...current.data.session.family(props.tab.sessionId)].some(
      (sessionID) => current.data.session.status(sessionID) === "running",
    )

    const index = tabs.store.findIndex((item) => tabKey(item) === key)

    const timer = window.setTimeout(
      () =>
        void Promise.allSettled([
          current.data.session.sync(props.tab.sessionId, { children: true }),
          ...(running
            ? [
                current.data.session.permission.sync(props.tab.sessionId),
                current.data.session.form.sync(props.tab.sessionId),
              ]
            : []),
          current.data.session.pending.sync(props.tab.sessionId),
        ]),
      300 + Math.max(index, 0) * 50,
    )

    onCleanup(() => window.clearTimeout(timer))
  })

  const state: TabState = {
    visible: createMemo(() => !!pending() || !!session() || missingSession() || !!persisted()?.title),
    unread: createMemo(() => status.unread() && !status.loading()),
  }

  onMount(() => {
    const release = props.register(key, state)
    onCleanup(release)
  })

  return null
}

/** A session listed outside a tab strip, such as a workspaces rail row, deletes through the same confirmation. */
export function DeleteSessionDialog(props: {
  server: SessionTab["server"]
  session: Accessor<SessionInfo | undefined>
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const global = useGlobal()

  const serverCtx = useServerCtx(() =>
    global.servers.list().find((item) => ServerConnection.key(item) === props.server),
  )

  const confirm = async () => {
    const value = props.session()
    const ctx = serverCtx()

    dialog.close()

    if (!value || !ctx) return

    try {
      await ctx.data.session.remove(value.id)
      notifySessionTabsRemoved({
        server: props.server,
        directory: value.location.directory,
        sessionIDs: sessionTreeIDs(ctx.data.session.list(), value.id),
      })
    } catch (cause) {
      showToast({
        title: language.t("session.delete.failed.title"),
        description: errorMessage(cause, language.t("session.delete.failed.title")),
      })
    }
  }

  return (
    <Dialog fit>
      <DialogHeader hideClose>
        <DialogTitleGroup
          title={language.t("session.delete.title")}
          description={language.t("session.delete.confirm", {
            name: sessionTitle(props.session()?.title) ?? language.t("session.tab.session"),
          })}
        />
      </DialogHeader>
      <DialogFooter>
        <Button variant="ghost" autofocus onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="danger" onClick={confirm}>
          {language.t("session.delete.button")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

export async function renameSessionTitle(
  ctx: ServerCtx | undefined,
  session: SessionInfo | undefined,
  title: string,
  language: ReturnType<typeof useLanguage>,
) {
  if (!session || !ctx) return

  ctx.data.session.remember({ ...session, title })

  try {
    await ctx.sdk.api.session.update({ sessionID: session.id, title })
  } catch (err) {
    const current = ctx.data.session.get(session.id)

    // A newer rename may have replaced this title while the save was in flight.
    if (current && current.title === title) ctx.data.session.remember({ ...current, title: session.title })
    showToast({
      title: language.t("common.requestFailed"),
      description: err instanceof Error ? err.message : undefined,
    })
  }
}
