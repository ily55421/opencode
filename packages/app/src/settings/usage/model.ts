import type { SessionStatsActivity, SessionStatsModelUsage } from "@opencode/client/promise"

/**
 * The ranges the usage page offers. `custom` is the only one whose window the person picks, so it is the only
 * one whose computation needs the two date fields.
 */
export type RangeKey = "today" | "yesterday" | "7d" | "30d" | "month" | "lastMonth" | "all" | "custom"

export const RANGES = ["today", "yesterday", "7d", "30d", "month", "lastMonth", "all", "custom"] as const satisfies readonly RangeKey[]

export type Window = { readonly from?: number; readonly to: number }

const DAY = 86_400_000

/**
 * The window for a range, in the renderer's own timezone: the page is about the person's day, so midnight here
 * is midnight there. `all` sends no lower bound and lets the server start at the oldest message — sending 0
 * would make it walk one SQL window per 31 days since 1970.
 */
export function rangeWindow(key: RangeKey, now: number, custom?: { from: string; to: string }): Window {
  const today = new Date(now)
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()

  if (key === "today") return { from: start, to: now }
  if (key === "yesterday") return { from: start - DAY, to: start }
  if (key === "7d") return { from: start - 6 * DAY, to: now }
  if (key === "30d") return { from: start - 29 * DAY, to: now }
  if (key === "month") return { from: new Date(today.getFullYear(), today.getMonth(), 1).getTime(), to: now }
  if (key === "lastMonth")
    return {
      from: new Date(today.getFullYear(), today.getMonth() - 1, 1).getTime(),
      to: new Date(today.getFullYear(), today.getMonth(), 1).getTime(),
    }
  if (key === "all") return { to: now }

  const from = custom?.from ? new Date(`${custom.from}T00:00:00`).getTime() : undefined
  const until = custom?.to ? new Date(`${custom.to}T23:59:59.999`).getTime() : undefined
  if (from === undefined || until === undefined || Number.isNaN(from) || Number.isNaN(until)) return { to: now }

  return { from, to: Math.max(from + 1, until) }
}

/** The busiest day in the window, which is what the page calls the single-day peak. */
export function peakDay(activity: readonly SessionStatsActivity[]): SessionStatsActivity | undefined {
  return activity.reduce<SessionStatsActivity | undefined>(
    (best, day) => (best === undefined || day.tokens > best.tokens ? day : best),
    undefined,
  )
}

export type Bucket = {
  label: string
  tokens: number
}

/**
 * The distribution strip. Days without usage are filled in when a window is given, so the x axis is time
 * rather than "the days that happened to have activity"; `daily` is one dot per day, `weekly` sums whole
 * weeks, and `cumulative` runs the total up.
 */
export function distribution(
  activity: readonly SessionStatsActivity[],
  mode: "daily" | "weekly" | "cumulative",
  window?: { from: number; to: number },
): Bucket[] {
  const days = new Map(activity.map((day) => [day.date, day.tokens]))
  if (window) fill(days, window.from, window.to)

  const ordered = [...days.entries()].toSorted(([a], [b]) => a.localeCompare(b))

  if (mode === "daily") return ordered.map(([label, tokens]) => ({ label, tokens }))

  if (mode === "weekly") {
    const weeks = new Map<string, number>()
    for (const [date, tokens] of ordered) weeks.set(weekStart(date), (weeks.get(weekStart(date)) ?? 0) + tokens)
    return [...weeks.entries()].map(([label, tokens]) => ({ label, tokens }))
  }

  let total = 0

  return ordered.map(([label, tokens]) => {
    total += tokens
    return { label, tokens: total }
  })
}

/** Every local day between two instants, so a gap reads as a zero instead of a missing point. */
function fill(days: Map<string, number>, from: number, to: number) {
  const cursor = new Date(from)
  cursor.setHours(0, 0, 0, 0)

  for (let guard = 0; guard < 3_700; guard++) {
    const key = localDate(cursor)
    if (!days.has(key)) days.set(key, 0)
    cursor.setDate(cursor.getDate() + 1)
    if (cursor.getTime() > to) return
  }
}

function localDate(date: Date) {
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")

  return `${date.getFullYear()}-${month}-${day}`
}

/** Monday of the week a date falls in, as a `YYYY-MM-DD` key. */
function weekStart(date: string) {
  const day = new Date(`${date}T00:00:00Z`)
  const weekday = (day.getUTCDay() + 6) % 7
  day.setUTCDate(day.getUTCDate() - weekday)

  return day.toISOString().slice(0, 10)
}

/** Share of the window's tokens that the busiest model produced, as a whole percentage. */
export function topModelShare(models: readonly SessionStatsModelUsage[]): number {
  const top = shares(models).top.at(0)
  return top?.percent ?? 0
}

export type Share = { label: string; tokens: number; percent: number }

/**
 * Per-model shares with the tail folded into one entry, because a ring with fourteen slices is a ring nobody
 * can read. Percentages are whole numbers and the tail takes the remainder, so they always add up to 100.
 */
export function shares(
  models: readonly SessionStatsModelUsage[],
  limit = 6,
): { top: Share[]; other: Share | undefined; total: number } {
  // The server keys usage by provider/model#variant, so one model reached through two variants would otherwise
  // list twice; a person reading the ring cares which model, not which variant of it.
  const merged = new Map<string, number>()
  for (const model of models)
    merged.set(model.model.id, (merged.get(model.model.id) ?? 0) + tokenTotal(model.tokens))

  const ranked = [...merged.entries()]
    .map(([label, tokens]) => ({ label, tokens }))
    .filter((model) => model.tokens > 0)
    .toSorted((a, b) => b.tokens - a.tokens)
  const total = ranked.reduce((sum, model) => sum + model.tokens, 0)
  if (total === 0) return { top: [], other: undefined, total: 0 }

  const head = ranked.slice(0, limit).map((model) => ({
    ...model,
    percent: Math.round((model.tokens / total) * 100),
  }))
  const rest = ranked.slice(limit).reduce((sum, model) => sum + model.tokens, 0)
  const used = head.reduce((sum, model) => sum + model.percent, 0)

  return {
    top: head,
    other: rest > 0 ? { label: "", tokens: rest, percent: Math.max(0, 100 - used) } : undefined,
    total,
  }
}

/** One entry per ring tick (100 of them), naming the share that owns it; -1 for the empty tail of a short list. */
export function ticks(list: readonly Share[]): number[] {
  return Array.from({ length: 100 }, (_, tick) => {
    let end = 0
    for (const [index, share] of list.entries()) {
      end += share.percent
      if (tick < end) return index
    }
    return list.length === 0 ? -1 : list.length - 1
  })
}

/**
 * Area-proportional coverage: ten times the tokens covers ten times the area rather than ten times the radius,
 * which is the only scale that makes a heatmap read as quantity instead of as alarm.
 */
export function areaScale(value: number, max: number) {
  if (value <= 0 || max <= 0) return 0
  return Math.sqrt(value / max)
}

/** Tokens across all five buckets, which is what every "total" on the page means. */
export function tokenTotal(tokens: SessionStatsModelUsage["tokens"]) {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
}

/** Days and hours of a session span, the pair the page renders as `45天20时`. */
export function span(duration: number) {
  return { days: Math.floor(duration / DAY), hours: Math.floor((duration % DAY) / 3_600_000) }
}
