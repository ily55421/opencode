import { useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { adjacentTabKey } from "@/shell/titlebar/tab-order"
import { tabKey, type Tab } from "./tabs"

export const previousSessionCommand = { id: "session.previous", keybind: "alt+arrowup" }

export const nextSessionCommand = { id: "session.next", keybind: "alt+arrowdown" }

export const tabCyclePalette = "tab-cycle"

export const tabNumbersPalette = "tab-numbers"

export type TabCycle = {
  visibleTabs: () => Tab[]
  currentTab: () => Tab | undefined
  unread: (key: string) => boolean
  select: (tab: Tab) => void
}

/**
 * The tab shortcuts, shared by whichever surface owns tab upkeep. Both the title bar's strip and the workspaces rail
 * register these under the same palette keys, and only one of them is mounted at a time.
 */
export function registerTabCommands(
  command: ReturnType<typeof useCommand>,
  language: ReturnType<typeof useLanguage>,
  cycle: TabCycle,
) {
  const selectAdjacentTab = (offset: -1 | 1, include?: (key: string) => boolean) => {
    const listed = cycle.visibleTabs()
    const current = cycle.currentTab()
    const key = adjacentTabKey(listed.map(tabKey), current ? tabKey(current) : undefined, offset, include)
    const next = listed.find((tab) => tabKey(tab) === key)

    if (next) cycle.select(next)
  }

  command.register(tabCyclePalette, () => [
    {
      id: "tab.prev",
      category: "tab",
      title: "",
      keybind: "mod+option+ArrowLeft,ctrl+shift+tab",
      hidden: true,
      onSelect: () => selectAdjacentTab(-1),
    },
    {
      id: "tab.next",
      category: "tab",
      title: "",
      keybind: "mod+option+ArrowRight,ctrl+tab",
      hidden: true,
      onSelect: () => selectAdjacentTab(1),
    },
    {
      ...previousSessionCommand,
      category: language.t("command.category.session"),
      title: language.t("command.session.previous"),
      onSelect: () => selectAdjacentTab(-1),
    },
    {
      ...nextSessionCommand,
      category: language.t("command.category.session"),
      title: language.t("command.session.next"),
      onSelect: () => selectAdjacentTab(1),
    },
    {
      id: "session.previous.unseen",
      category: language.t("command.category.session"),
      title: language.t("command.session.previous.unseen"),
      keybind: "shift+alt+arrowup",
      onSelect: () => selectAdjacentTab(-1, cycle.unread),
    },
    {
      id: "session.next.unseen",
      category: language.t("command.category.session"),
      title: language.t("command.session.next.unseen"),
      keybind: "shift+alt+arrowdown",
      onSelect: () => selectAdjacentTab(1, cycle.unread),
    },
  ])

  // One registration numbers the visible tabs, so a reorder, a close or a tab coming into view never leaves two tabs
  // holding the same number while their owners update.
  command.register(tabNumbersPalette, () =>
    cycle
      .visibleTabs()
      .slice(0, 9)
      .map((tab, index) => ({
        id: `tab.${index + 1}`,
        category: "tab",
        title: "",
        keybind: `mod+${index + 1}`,
        hidden: true,
        onSelect: () => cycle.select(tab),
      })),
  )
}
