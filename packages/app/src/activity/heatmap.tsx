import { Icon } from "@opencode/ui/icon"
import { createMemo, For, Match, Show, Switch } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import type { ActivityDay, ActivityResource } from "./activity"
import { activityLevel, buildHeatmap, monthStarts, recentDays, type HeatmapCell } from "./heatmap-model"

const CELL = 8

const GAP = 3

const PITCH = CELL + GAP

const LEVEL_OPACITY = [0, 0.25, 0.45, 0.7, 0.95]

export function ActivityHeatmap(props: { days: readonly ActivityDay[]; weeks?: number; class?: string }) {
  const language = useLanguage()
  const weeks = () => props.weeks ?? 53
  const heatmap = createMemo(() => buildHeatmap(props.days, weeks()))
  const max = createMemo(() => Math.max(1, ...props.days.map((day) => day.steps)))
  const months = createMemo(() => monthStarts(heatmap().columns))
  const monthFormat = createMemo(() => new Intl.DateTimeFormat(language.locale(), { month: "short" }))
  const weekdayFormat = createMemo(() => new Intl.DateTimeFormat(language.locale(), { weekday: "narrow" }))
  const dateFormat = createMemo(() => new Intl.DateTimeFormat(language.locale(), { dateStyle: "medium" }))
  const weekdays = createMemo(() =>
    [0, 1, 2, 3, 4, 5, 6].map((day) => weekdayFormat().format(new Date(2024, 0, 7 + day))),
  )

  const label = (cell: HeatmapCell) =>
    language.t("activity.day.tooltip", {
      date: dateFormat().format(cell.date),
      steps: language.t("workspace.sidebar.steps", { count: cell.steps }),
    })

  return (
    <div data-component="activity-heatmap" class={`flex flex-col gap-1.5 ${props.class ?? ""}`}>
      <div class="flex" style={{ gap: `${GAP}px` }}>
        <div class="shrink-0" style={{ width: "14px" }} />
        <div class="relative h-3" style={{ width: `${weeks() * PITCH - GAP}px` }}>
          <For each={months()}>
            {(month) => (
              <span
                class="absolute top-0 whitespace-nowrap text-[10px] leading-3 text-v2-text-text-faint"
                style={{ left: `${month.index * PITCH}px` }}
              >
                {monthFormat().format(month.date)}
              </span>
            )}
          </For>
        </div>
      </div>
      <div class="flex" style={{ gap: `${GAP}px` }}>
        <div class="flex shrink-0 flex-col" style={{ gap: `${GAP}px`, width: "14px" }}>
          <For each={weekdays()}>
            {(weekday, index) => (
              <span class="whitespace-nowrap text-[10px] leading-[8px] text-v2-text-text-faint">
                {index() === 1 || index() === 3 || index() === 5 ? weekday : ""}
              </span>
            )}
          </For>
        </div>
        <div class="flex" style={{ gap: `${GAP}px` }}>
          <For each={heatmap().columns}>
            {(column) => (
              <div class="flex flex-col" style={{ gap: `${GAP}px` }}>
                <For each={column}>
                  {(cell) => (
                    <Show
                      when={cell}
                      fallback={<span style={{ width: `${CELL}px`, height: `${CELL}px` }} aria-hidden="true" />}
                    >
                      {(day) => {
                        const level = () => activityLevel(day().steps, max())

                        return (
                          <span
                            title={label(day())}
                            class="rounded-[2px]"
                            classList={{
                              "bg-v2-background-bg-layer-03": level() === 0,
                              "bg-v2-icon-icon-muted": level() > 0,
                            }}
                            style={{
                              width: `${CELL}px`,
                              height: `${CELL}px`,
                              opacity: level() === 0 ? 1 : LEVEL_OPACITY[level()],
                            }}
                          />
                        )
                      }}
                    </Show>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}

export function ActivityCard(props: { activity: ActivityResource; class?: string }) {
  const language = useLanguage()
  const info = createMemo(() => {
    const result = props.activity()

    return result?.ok === true ? result.info : undefined
  })
  const failed = createMemo(() => props.activity()?.ok === false)

  const summary = () => {
    const current = info()

    return current
      ? language.t("newSession.activity.summary", { sessions: current.sessions, steps: current.steps })
      : undefined
  }

  return (
    <section
      data-component="activity-card"
      class={`rounded-xl border border-v2-border-border-base bg-v2-background-bg-base px-4 py-3 ${props.class ?? ""}`}
    >
      <header class="flex min-w-0 items-center justify-between gap-3">
        <div class="flex min-w-0 items-baseline gap-2">
          <span class="text-[13px] font-[530] text-v2-text-text-base">{language.t("newSession.activity.title")}</span>
          <span class="text-[11px] text-v2-text-text-faint">{language.t("newSession.activity.subtitle")}</span>
        </div>
        <Show when={summary()}>
          {(value) => <span class="shrink-0 text-[11px] tabular-nums text-v2-text-text-faint">{value()}</span>}
        </Show>
      </header>
      <Switch fallback={<div class="mt-3 h-[76px] animate-pulse rounded-md bg-v2-background-bg-layer-02" />}>
        <Match when={failed()}>
          <p class="mt-3 text-[11px] text-v2-text-text-faint">{language.t("activity.unavailable")}</p>
        </Match>
        <Match when={info()}>
          {(activity) => <ActivityHeatmap days={activity().days} class="mt-3 overflow-x-auto no-scrollbar" />}
        </Match>
      </Switch>
    </section>
  )
}

/** A week of activity for the sidebar, with today at the end. */
export function ActivityStrip(props: { activity: ActivityResource; class?: string }) {
  const language = useLanguage()
  const info = createMemo(() => {
    const result = props.activity()

    return result?.ok === true ? result.info : undefined
  })
  const days = createMemo(() => recentDays(info()?.days ?? [], 7))
  const max = createMemo(() => Math.max(1, ...days().map((day) => day.steps)))
  const total = createMemo(() => days().reduce((sum, day) => sum + day.steps, 0))
  const dateFormat = createMemo(() => new Intl.DateTimeFormat(language.locale(), { dateStyle: "medium" }))
  const failed = createMemo(() => props.activity()?.ok === false)

  return (
    <section
      data-component="activity-strip"
      class={`rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-02 px-3 py-2.5 ${props.class ?? ""}`}
    >
      <header class="flex items-center justify-between gap-2">
        <span class="flex items-center gap-1.5 text-[11px] text-v2-text-text-faint">
          <Icon name="status-active" size="small" class="text-v2-icon-icon-muted" />
          {language.t("workspace.sidebar.activity")}
        </span>
        <Show when={!failed()}>
          <span class="text-[11px] tabular-nums text-v2-text-text-faint">
            {language.t("workspace.sidebar.steps", { count: total() })}
          </span>
        </Show>
      </header>
      <Show
        when={!failed()}
        fallback={<p class="mt-2 text-[11px] text-v2-text-text-faint">{language.t("activity.unavailable")}</p>}
      >
        <div class="mt-2 flex h-7 items-end gap-1">
          <For each={days()}>
            {(day) => {
              const level = () => activityLevel(day.steps, max())

              return (
                <span
                  title={`${dateFormat().format(day.date)} · ${language.t("workspace.sidebar.steps", { count: day.steps })}`}
                  class="min-h-1 flex-1 rounded-[2px]"
                  classList={{
                    "bg-v2-background-bg-layer-03": level() === 0,
                    "bg-v2-icon-icon-muted": level() > 0,
                  }}
                  style={{
                    height: `${level() === 0 ? 6 : 8 + level() * 4}px`,
                    opacity: level() === 0 ? 1 : LEVEL_OPACITY[level()],
                  }}
                />
              )
            }}
          </For>
        </div>
      </Show>
    </section>
  )
}
