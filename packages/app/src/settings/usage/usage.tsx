import { Icon, type IconProps } from "@opencode/ui/icon"
import { SegmentedControl, SegmentedControlItem } from "@opencode/ui/segmented-control"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import type { Component, JSX } from "solid-js"
import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import "@/settings/settings.css"
import {
  areaScale,
  distribution,
  peakDay,
  rangeWindow,
  shares,
  span,
  ticks,
  tokenTotal,
  RANGES,
  type RangeKey,

} from "./model"

const LEVELS = [0.35, 0.5, 0.65, 0.82, 1]

/**
 * Token usage over the local history. Everything here reads `session.stats`, which folds the durable message
 * records; the page keeps no counters of its own, so a deleted session cannot leave a stale total behind.
 *
 * The charts are hand-written SVG in one hue. The theme exposes a single accent and no categorical palette, and
 * inventing series colours would put the page outside the theme; identity comes from labels, magnitude from
 * opacity and area, which is also the scale that reads correctly (coverage grows with the square root).
 */
export const SettingsUsage: Component<{ active?: boolean; headerAction?: JSX.Element }> = (props) => {
  const language = useLanguage()
  const sdk = useServerSDK()
  const timezone = new Intl.DateTimeFormat().resolvedOptions().timeZone
  const [range, setRange] = createSignal<RangeKey>("30d")
  const [custom, setCustom] = createSignal({ from: "", to: "" })
  const [mode, setMode] = createSignal<"daily" | "weekly" | "cumulative">("daily")

  const [whole, { refetch: refetchWhole }] = createResource(() => sdk.api.session.stats({ timezone, tools: "none" }))
  const window = createMemo(() => rangeWindow(range(), Date.now(), custom()))
  const [scoped, { refetch: refetchScoped }] = createResource(window, (value) =>
    sdk.api.session.stats({ ...value, timezone, tools: "none" }),
  )

  const compact = createMemo(
    () => new Intl.NumberFormat(language.intl(), { notation: "compact", maximumFractionDigits: 2 }),
  )
  const plain = createMemo(() => new Intl.NumberFormat(language.intl()))
  const number = (value: number) => compact().format(value)
  const exact = (value: number) => plain().format(value)
  const day = (key: string | undefined) =>
    key === undefined
      ? language.t("settings.usage.none")
      : new Intl.DateTimeFormat(language.intl(), { month: "numeric", day: "numeric" }).format(new Date(`${key}T00:00:00`))

  const history = () => whole()
  const current = () => scoped()
  const busiest = createMemo(() => peakDay(history()?.activity ?? []))
  // The trend plots time, so the window fills the days between dots; the strip below caps how many it draws.
  const series = createMemo(() => {
    const bounds = window()
    return distribution(
      current()?.activity ?? [],
      mode(),
      bounds.from === undefined ? undefined : { from: bounds.from, to: bounds.to },
    )
  })
  const buckets = createMemo(() => series().slice(-120))
  const largest = createMemo(() => buckets().reduce((max, bucket) => Math.max(max, bucket.tokens), 0))
  const ranked = createMemo(() => shares(current()?.models ?? []))
  const ring = createMemo(() => {
    const list = ranked()
    const all = list.other ? [...list.top, { ...list.other, label: language.t("settings.usage.other") }] : list.top
    return { cells: ticks(all), segments: all }
  })

  const duration = (value: number | undefined) => {
    if (!value) return language.t("settings.usage.none")
    const parts = span(value)

    return parts.days > 0
      ? `${parts.days}${language.t("settings.usage.unit.days")}${parts.hours}${language.t("settings.usage.unit.hours")}`
      : `${parts.hours}${language.t("settings.usage.unit.hours")}`
  }

  const refresh = () => {
    void refetchWhole()
    void refetchScoped()
  }

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.usage.title")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.usage.description")}</span>
          </div>
          <div class="flex items-center gap-2">
            <Show when={props.headerAction}>{props.headerAction}</Show>
            <button
              type="button"
              data-action="settings-usage-refresh"
              onClick={refresh}
              title={language.t("settings.usage.refresh")}
              class="flex items-center gap-1 rounded-md border border-v2-border-border-base px-2 py-1 text-11-regular text-v2-text-text-base outline-none"
            >
              <Icon name="refresh" class="size-3" />
              <span>{language.t("settings.usage.refresh")}</span>
            </button>
          </div>
        </div>
      </div>

      <div class="settings-tab-body settings-tab-body--sectioned">
        <div class="settings-section">
          <div class="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-5">
            <Stat
              icon="outline-dots"
              label={language.t("settings.usage.cumulative")}
              value={number(tokenTotal(history()?.tokens ?? empty))}
              hint={exact(tokenTotal(history()?.tokens ?? empty))}
            />
            <Stat
              icon="status"
              label={language.t("settings.usage.peak")}
              value={number(busiest()?.tokens ?? 0)}
              hint={day(busiest()?.date)}
            />
            <Stat
              icon="comment"
              label={language.t("settings.usage.longestSession")}
              value={duration(history()?.longestSession?.duration)}
              hint={language.t("settings.usage.longestSessionHint")}
            />
            <Stat
              icon="status-active"
              label={language.t("settings.usage.currentStreak")}
              value={`${history()?.currentStreak ?? 0}${language.t("settings.usage.unit.days")}`}
              hint={language.t("settings.usage.currentStreakHint")}
            />
            <Stat
              icon="outline-rotate-clockwise"
              label={language.t("settings.usage.longestStreakLabel")}
              value={`${history()?.streak ?? 0}${language.t("settings.usage.unit.days")}`}
              hint={language.t("settings.usage.longestStreakHint")}
            />
          </div>
        </div>

        <div class="settings-section">
          <div class="flex flex-col gap-2">
            <h3 class="settings-section-title">{language.t("settings.usage.section.range")}</h3>
            {/* Eight ranges do not fit the 232px segmented control, and this reads as the tab row it is. */}
            <div role="group" aria-label={language.t("settings.usage.section.range")} class="flex flex-wrap items-center gap-1">
              <For each={RANGES}>
                {(key) => (
                  <button
                    type="button"
                    data-action={`settings-usage-range-${key}`}
                    aria-pressed={range() === key}
                    onClick={() => setRange(key)}
                    class="rounded-md px-2 py-1 text-11-regular outline-none"
                    classList={{
                      "bg-v2-background-bg-base font-[530] text-v2-text-text-base shadow-[0_0_0_0.5px_var(--v2-border-border-base)]":
                        range() === key,
                      "text-v2-text-text-muted": range() !== key,
                    }}
                  >
                    {language.t(`settings.usage.range.${key}`)}
                  </button>
                )}
              </For>
            </div>
          </div>

          <Show when={range() === "custom"}>
            <div class="flex flex-wrap items-center gap-2 pt-1">
              <input
                data-action="settings-usage-from"
                type="date"
                value={custom().from}
                onInput={(event) => setCustom({ ...custom(), from: event.currentTarget.value })}
                class="rounded-md border border-v2-border-border-base bg-v2-background-bg-deep px-2 py-1 text-11-regular text-v2-text-text-base outline-none"
              />
              <span class="text-11-regular text-v2-text-text-faint">—</span>
              <input
                data-action="settings-usage-to"
                type="date"
                value={custom().to}
                onInput={(event) => setCustom({ ...custom(), to: event.currentTarget.value })}
                class="rounded-md border border-v2-border-border-base bg-v2-background-bg-deep px-2 py-1 text-11-regular text-v2-text-text-base outline-none"
              />
            </div>
          </Show>

          <div class="grid grid-cols-2 gap-x-6 gap-y-5 pt-2 md:grid-cols-3">
            <Stat
              icon="outline-dots"
              label={language.t("settings.usage.window")}
              value={number(tokenTotal(current()?.tokens ?? empty))}
              hint={exact(tokenTotal(current()?.tokens ?? empty))}
            />
            <Stat
              icon="calendar"
              label={language.t("settings.usage.activeDays")}
              value={`${current()?.activeDays ?? 0}${language.t("settings.usage.unit.days")}`}
              hint={language.t("settings.usage.activeDaysHint")}
            />
            <Stat
              icon="waveform"
              label={language.t("settings.usage.dailyAverage")}
              value={number(
                Math.round(tokenTotal(current()?.tokens ?? empty) / Math.max(1, current()?.activeDays ?? 0)),
              )}
              hint={language.t("settings.usage.dailyAverageHint")}
            />
            <Stat
              icon="window-analytics"
              label={language.t("settings.usage.sessions")}
              value={exact(current()?.sessions ?? 0)}
              hint={language.t("settings.usage.sessionsHint")}
            />
            <Stat
              icon="outline-text"
              label={language.t("settings.usage.messages")}
              value={exact(current()?.messages ?? 0)}
              hint={language.t("settings.usage.messagesHint")}
            />
            <Stat
              icon="providers"
              label={language.t("settings.usage.topModel")}
              value={ranked().top.at(0)?.label ?? language.t("settings.usage.none")}
              hint={language.t("settings.usage.topModelShare", { percent: ranked().top.at(0)?.percent ?? 0 })}
            />
          </div>
        </div>

        <div class="settings-section" data-action="settings-usage-trend">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h3 class="settings-section-title">{language.t("settings.usage.section.trend")}</h3>
            <SegmentedControl
              aria-label={language.t("settings.usage.section.trend")}
              value={mode()}
              onChange={(value) => setMode(value === "weekly" || value === "cumulative" ? value : "daily")}
            >
              <SegmentedControlItem value="daily">{language.t("settings.usage.mode.daily")}</SegmentedControlItem>
              <SegmentedControlItem value="weekly">{language.t("settings.usage.mode.weekly")}</SegmentedControlItem>
              <SegmentedControlItem value="cumulative">
                {language.t("settings.usage.mode.cumulative")}
              </SegmentedControlItem>
            </SegmentedControl>
          </div>
          <Trend buckets={series()} />
        </div>

        <div class="settings-section" data-action="settings-usage-models">
          <h3 class="settings-section-title">{language.t("settings.usage.section.models")}</h3>
          <Show
            when={ring().segments.length > 0}
            fallback={<p class="text-11-regular text-v2-text-text-muted">{language.t("settings.usage.empty")}</p>}
          >
            <div class="flex flex-wrap items-center gap-6 pt-1">
              <Ring cells={ring().cells} />
              <ul class="flex min-w-0 flex-col gap-1.5">
                <For each={ring().segments}>
                  {(segment, index) => (
                    <li class="flex items-center gap-2 text-11-regular text-v2-text-text-base">
                      <span
                        aria-hidden="true"
                        class="size-2 shrink-0 rounded-[2px] bg-v2-icon-icon-accent"
                        style={{ opacity: `${LEVELS[Math.min(index(), LEVELS.length - 1)]}` }}
                      />
                      <span class="min-w-0 max-w-[180px] truncate">{segment.label}</span>
                      <span class="shrink-0 tabular-nums text-v2-text-text-muted">
                        {language.t("settings.usage.share", { percent: segment.percent })}
                      </span>
                      <span class="shrink-0 tabular-nums text-v2-text-text-faint">{exact(segment.tokens)}</span>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </Show>
        </div>

        <div class="settings-section" data-action="settings-usage-distribution">
          <h3 class="settings-section-title">{language.t("settings.usage.section.distribution")}</h3>
          <p class="text-11-regular text-v2-text-text-faint">{language.t("settings.usage.distributionHint")}</p>
          <div class="flex items-center gap-2 pt-1">
            <span class="text-11-regular text-v2-text-text-faint">{language.t("settings.usage.legend.less")}</span>
            <For each={LEVELS}>{(opacity) => <Cell scale={1} opacity={opacity} />}</For>
            <span class="text-11-regular text-v2-text-text-faint">{language.t("settings.usage.legend.more")}</span>
          </div>
          <Show
            when={buckets().length > 0}
            fallback={<p class="text-11-regular text-v2-text-text-muted">{language.t("settings.usage.empty")}</p>}
          >
            <div class="flex items-end gap-1.5 overflow-x-auto px-1 pt-4 pb-1">
              <For each={buckets()}>
                {(bucket) => (
                  <div
                    class="flex shrink-0 flex-col items-center"
                    title={`${bucket.label} · ${exact(bucket.tokens)}`}
                  >
                    <Cell
                      scale={areaScale(bucket.tokens, largest())}
                      peak={bucket.tokens > 0 && bucket.tokens === largest()}
                    />
                    <Show when={bucket.tokens === largest()}>
                      <span class="pt-1 text-10-regular text-v2-text-text-muted">
                        {language.t("settings.usage.peakValue", { value: number(bucket.tokens) })}
                      </span>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </>
  )
}

const empty = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

function Stat(props: { icon: IconProps["name"]; label: string; value: string; hint: string }) {
  return (
    <div class="flex min-w-0 flex-col gap-1">
      <div class="flex items-center gap-1.5">
        <Icon name={props.icon} class="size-3 shrink-0 text-v2-text-text-faint" />
        <span class="min-w-0 truncate text-11-regular text-v2-text-text-faint">{props.label}</span>
      </div>
      <span class="truncate text-[22px] leading-[26px] font-[560] tabular-nums text-v2-text-text-base">
        {props.value}
      </span>
      <span class="min-w-0 truncate text-11-regular text-v2-text-text-muted">{props.hint}</span>
    </div>
  )
}

/** A day's coverage: side and opacity both follow the square root, so area is proportional to tokens. */
function Cell(props: { scale: number; opacity?: number; peak?: boolean }) {
  const side = () => 4 + Math.round(props.scale * 12)

  return (
    <span
      aria-hidden="true"
      class="rounded-[2px] bg-v2-icon-icon-muted"
      classList={{ "outline outline-1 outline-dashed outline-v2-state-fg-warning": !!props.peak }}
      style={{
        width: `${side()}px`,
        height: `${side()}px`,
        opacity: `${props.opacity ?? 0.25 + props.scale * 0.75}`,
      }}
    />
  )
}

/** 100 ticks around a ring, a longer one every tenth, so a share is read at a glance and a 1% slice still shows. */
function Ring(props: { cells: number[] }) {
  const tick = (index: number) => {
    const angle = (index * 3.6 - 90) * (Math.PI / 180)
    const outer = index % 10 === 0 ? 46 : 42
    return {
      x1: 50 + Math.cos(angle) * 34,
      y1: 50 + Math.sin(angle) * 34,
      x2: 50 + Math.cos(angle) * outer,
      y2: 50 + Math.sin(angle) * outer,
    }
  }

  return (
    <svg viewBox="0 0 100 100" class="size-36 shrink-0 text-v2-icon-icon-accent" role="img">
      <For each={props.cells}>
        {(owner, index) => (
          <line
            {...tick(index())}
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            opacity={owner < 0 ? 0.12 : LEVELS[Math.min(owner, LEVELS.length - 1)]}
          />
        )}
      </For>
    </svg>
  )
}

/** One line over the whole range with a dot per period, measured to the container so the dots stay round. */
type Point = { label: string; tokens: number; x: number; y: number }

function Trend(props: { buckets: { label: string; tokens: number }[] }) {
  const [width, setWidth] = createSignal(640)
  const height = 88
  const pad = 6
  const max = createMemo(() => props.buckets.reduce((value, bucket) => Math.max(value, bucket.tokens), 0))
  const points = createMemo(() => {
    const list = props.buckets
    const span = Math.max(1, width() - pad * 2)
    const top = max()

    return list.map((bucket, index) => ({
      label: bucket.label,
      tokens: bucket.tokens,
      x: pad + (list.length === 1 ? span / 2 : (index / (list.length - 1)) * span),
      y: height - pad - (top === 0 ? 0 : (bucket.tokens / top) * (height - pad * 2)),
    }))
  })
  const peak = createMemo(() => {
    let best: Point | undefined
    for (const point of points()) if (best === undefined || point.tokens > best.tokens) best = point
    return best
  })

  return (
    <Show
      when={props.buckets.length > 1}
      fallback={<p class="pt-2 text-11-regular text-v2-text-text-muted">{`—`}</p>}
    >
      <div class="pt-2" ref={(element) => createResizeObserver(() => element, ({ width }) => setWidth(width))}>
        <svg
          viewBox={`0 0 ${width()} ${height}`}
          width="100%"
          height={height}
          class="text-v2-icon-icon-accent"
          role="img"
        >
          <polyline
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linejoin="round"
            stroke-linecap="round"
            points={points()
              .map((point) => `${point.x},${point.y}`)
              .join(" ")}
          />
          <For each={points()}>
            {(point) => (
              <circle cx={point.x} cy={point.y} r={point.tokens === 0 ? 1.5 : 2.5} fill="currentColor">
                <title>{`${point.label} · ${point.tokens}`}</title>
              </circle>
            )}
          </For>
          <Show when={peak()}>
            {(point) => (
              <>
                <circle cx={point().x} cy={point().y} r="4.5" fill="none" stroke="currentColor" stroke-dasharray="2 2" />
                <text
                  x={Math.min(width() - 40, Math.max(4, point().x - 12))}
                  y={Math.max(10, point().y - 8)}
                  class="fill-current text-[9px]"
                >
                  {point().tokens.toLocaleString()}
                </text>
              </>
            )}
          </Show>
        </svg>
      </div>
    </Show>
  )
}
