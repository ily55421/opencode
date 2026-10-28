import { ScrollView } from "@opencode/ui/scroll-view"
import { Icon } from "@opencode/ui/icon"
import { createMediaQuery } from "@solid-primitives/media"
import { useNavigate } from "@solidjs/router"
import { createEffect, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { homeProjectDirectories } from "@/shell/layout/helpers"
import { draftHref, useTabs } from "@/shell/tabs/tabs"
import { useDirectoryPicker } from "@/workspaces/selection/picker"
import { createHomeController, createHomeSelectionSync, type HomeController } from "./model"
import { createHomeProjectsController } from "./projects/controller"
import { HomeUtilityNav } from "./projects/view"
import { HomeProjects } from "./projects/region"
import { createHomeScrollController } from "./scroll"
import { createHomeSessionSearchController } from "./sessions/search"
import { createHomeSessionsController } from "./sessions/controller"
import { HomeSessions } from "./sessions/region"

export function Home() {
  const mobile = createMediaQuery("(max-width: 767px)")

  return (
    <Show when={mobile()} fallback={<HomeRedirect />}>
      <HomeView />
    </Show>
  )
}

/** The desktop home is the new-task composer; recent sessions live in the workspaces rail. */
function HomeRedirect() {
  const tabs = useTabs()
  const navigate = useNavigate()
  const home = createHomeController()

  createHomeSelectionSync(home)

  let started = false

  createEffect(() => {
    const draft = tabs.store.find((tab) => tab.type === "draft")

    if (draft) {
      navigate(draftHref(draft.draftID), { replace: true })

      return
    }

    if (started || !home.project.newSession()) return
    started = true
    void home.project.openNewSession()
  })

  // An empty project list means "not loaded yet" until the server answers, so the placeholder stays up.
  const ready = () => {
    const ctx = home.server.focusedContext()

    return !!ctx && ctx.sdk.connection.status() === "connected"
  }

  return (
    <Show
      when={!home.project.newSession() && ready()}
      fallback={<div class="flex min-h-0 flex-1 items-center justify-center text-[12px] text-v2-text-text-faint">…</div>}
    >
      <HomeNoWorkspace home={home} />
    </Show>
  )
}

/** The focused server has no project this client has used, so there is nowhere to redirect to. */
function HomeNoWorkspace(props: { home: HomeController }) {
  const language = useLanguage()
  const pickDirectory = useDirectoryPicker()

  const add = () => {
    const conn = props.home.server.focused()

    if (!conn) return
    pickDirectory({
      server: conn,
      title: language.t("command.project.open"),
      multiple: true,
      onSelect: (result) => void props.home.project.add(conn, homeProjectDirectories(result)),
    })
  }

  return (
    <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <span class="text-[13px] font-[530] text-v2-text-text-base">{language.t("home.empty.title")}</span>
      <span class="max-w-[380px] text-[12px] text-v2-text-text-faint">{language.t("home.empty.description")}</span>
      <Show when={props.home.server.focused()}>
        <button
          type="button"
          class="mt-2 flex h-8 items-center gap-2 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 text-[12px] text-v2-text-text-base transition-colors hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"
          onClick={add}
        >
          <Icon name="plus" size="small" class="shrink-0 text-v2-icon-icon-muted" />
          <span>{language.t("workspace.sidebar.addWorkspace")}</span>
        </button>
      </Show>
    </div>
  )
}

function HomeView() {
  const mobile = createMediaQuery("(max-width: 767px)")
  const home = createHomeController()

  createHomeSelectionSync(home)

  const projects = createHomeProjectsController(home)
  const sessions = createHomeSessionsController(home)
  const search = createHomeSessionSearchController(home, sessions)
  const scroll = createHomeScrollController(sessions.data.groups)

  return (
    <div
      data-slot="home-panel"
      class={`
        mx-[var(--shell-inline-inset,8px)] mb-[var(--shell-bottom-inset,8px)] mt-[var(--shell-top-inset,8px)] flex min-h-0 flex-1 flex-col self-stretch overflow-hidden rounded-[10px]
        bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]
      `}
    >
      <Show when={mobile()}>
        <div class="relative z-40 -mb-3 shrink-0 px-3 pt-3">
          <HomeProjects projects={projects} scroll={scroll} dropdown />
        </div>
      </Show>
      <ScrollView
        class="min-h-0 flex-1 [container-type:size]"
        thumbContainer={scroll.viewport.thumbTrack()}
        thumbHoverTarget={scroll.viewport.hoverTarget()}
        viewportRef={scroll.viewport.setViewport}
        onScroll={(event) => scroll.viewport.update(event.currentTarget.scrollTop)}
      >
        <div
          class={`
            mx-auto grid min-h-full w-full max-w-[1080px] grid-rows-[auto_minmax(0,1fr)] gap-4 px-3
            max-md:grid-rows-[minmax(0,1fr)] lg:grid-cols-[280px_minmax(0,720px)] lg:grid-rows-1 lg:gap-8 lg:px-6
          `}
        >
          <Show when={!mobile()}>
            <HomeProjects projects={projects} scroll={scroll} />
          </Show>
          <HomeSessions sessions={sessions} search={search} scroll={scroll} />
        </div>
      </ScrollView>
      <div class="hidden shrink-0 px-3 py-2 md:block lg:hidden">
        <HomeUtilityNav
          class="flex"
          onOpenSettings={projects.utility.settings}
          onOpenHelp={projects.utility.help}
          language={projects.copy.language}
        />
      </div>
    </div>
  )
}
