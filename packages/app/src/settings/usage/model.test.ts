import { expect, test } from "bun:test"
import type { SessionStatsActivity, SessionStatsModelUsage } from "@opencode/client/promise"
import { areaScale, distribution, peakDay, rangeWindow, shares, span, ticks, tokenTotal, topModelShare, RANGES } from "./model"

const DAY = 86_400_000
// Local noon, so every day boundary below is unambiguous whatever timezone the runner is in.
const now = new Date(2026, 9, 30, 12, 0, 0).getTime()
const midnight = new Date(2026, 9, 30).getTime()

const day = (date: string, tokens: number, steps = 1): SessionStatsActivity => ({ date, steps, tokens })

const usage = (input: number, output: number): SessionStatsModelUsage["tokens"] => ({
  input,
  output,
  reasoning: 0,
  cache: { read: 0, write: 0 },
})

const model = (id: string, tokens: SessionStatsModelUsage["tokens"]): SessionStatsModelUsage => ({
  model: { id, providerID: "anthropic" },
  steps: 1,
  tokens,
  cost: 0,
})

test("every offered range has a window", () => {
  expect(RANGES.map((key) => rangeWindow(key, now).from !== undefined)).toEqual([
    true,
    true,
    true,
    true,
    true,
    true,
    false,
    false,
  ])
})

test("today and yesterday cut at local midnight", () => {
  expect(rangeWindow("today", now)).toEqual({ from: midnight, to: now })
  expect(rangeWindow("yesterday", now)).toEqual({ from: midnight - DAY, to: midnight })
})

test("the rolling ranges start whole days back and run to now", () => {
  expect(rangeWindow("7d", now).from).toBe(midnight - 6 * DAY)
  expect(rangeWindow("30d", now).from).toBe(midnight - 29 * DAY)
})

test("month boundaries use calendar months, not a fixed count of days", () => {
  expect(rangeWindow("month", now).from).toBe(new Date(2026, 9, 1).getTime())
  const last = rangeWindow("lastMonth", now)
  expect(last.from).toBe(new Date(2026, 8, 1).getTime())
  expect(last.to).toBe(new Date(2026, 9, 1).getTime())
})

test("all sends no lower bound so the server starts at the oldest message", () => {
  expect(rangeWindow("all", now)).toEqual({ to: now })
})

test("custom reads the picked dates as local days and falls back when they are missing", () => {
  const picked = rangeWindow("custom", now, { from: "2026-10-05", to: "2026-10-08" })
  expect(picked.from).toBe(new Date(2026, 9, 5).getTime())
  expect(picked.to).toBe(new Date(2026, 9, 8, 23, 59, 59, 999).getTime())
  expect(rangeWindow("custom", now).to).toBe(now)
  expect(rangeWindow("custom", now, { from: "2026-10-08", to: "2026-10-05" }).from).toBe(
    new Date(2026, 9, 8).getTime(),
  )
})

test("the peak is the busiest day, and an empty window has none", () => {
  const activity = [day("2026-10-01", 10), day("2026-10-02", 90), day("2026-10-03", 40)]
  expect(peakDay(activity)?.date).toBe("2026-10-02")
  expect(peakDay([])).toBeUndefined()
})

test("weekly groups whole weeks and cumulative runs the total up", () => {
  // 2026-10-05 is a Monday, so 05 and 07 share a week and 12 opens the next one.
  const activity = [day("2026-10-07", 5), day("2026-10-05", 5), day("2026-10-12", 20)]
  expect(distribution(activity, "daily")).toEqual([
    { label: "2026-10-05", tokens: 5 },
    { label: "2026-10-07", tokens: 5 },
    { label: "2026-10-12", tokens: 20 },
  ])
  expect(distribution(activity, "weekly")).toEqual([
    { label: "2026-10-05", tokens: 10 },
    { label: "2026-10-12", tokens: 20 },
  ])
  expect(distribution(activity, "cumulative").at(-1)?.tokens).toBe(30)
  expect(distribution(activity, "cumulative")[0]).toEqual({ label: "2026-10-05", tokens: 5 })
})

test("a window fills the days without usage so the axis is time", () => {
  const activity = [day("2026-10-05", 5), day("2026-10-08", 20)]
  const series = distribution(activity, "daily", { from: new Date(2026, 9, 4).getTime(), to: new Date(2026, 9, 8, 23).getTime() })
  expect(series.map((bucket) => bucket.label)).toEqual([
    "2026-10-04",
    "2026-10-05",
    "2026-10-06",
    "2026-10-07",
    "2026-10-08",
  ])
  expect(series.map((bucket) => bucket.tokens)).toEqual([0, 5, 0, 0, 20])
})

test("one model reached through two variants is one share", () => {
  const variant = (id: string, tokens: SessionStatsModelUsage["tokens"], name: string): SessionStatsModelUsage => ({
    model: { id, providerID: "anthropic", variant: name },
    steps: 1,
    tokens,
    cost: 0,
  })
  const result = shares([variant("sonnet", usage(60, 0), "high"), variant("sonnet", usage(30, 0), "low"), variant("flash", usage(10, 0), "default")])
  expect(result.top).toEqual([
    { label: "sonnet", tokens: 90, percent: 90 },
    { label: "flash", tokens: 10, percent: 10 },
  ])
})

test("the top model's share is a whole percentage of the window", () => {
  expect(topModelShare([model("large", usage(60, 20)), model("flash", usage(10, 10))])).toBe(80)
  expect(topModelShare([])).toBe(0)
  expect(tokenTotal(usage(10, 5))).toBe(15)
})

test("a long model list folds its tail into one share that closes the ring at 100", () => {
  const many = Array.from({ length: 9 }, (_, index) => model(`m${index}`, usage(100 - index, 0)))
  const result = shares(many)
  expect(result.top).toHaveLength(6)
  // Nine models at 100…92: the first six keep their own slice and the last three fold together.
  expect(result.other?.tokens).toBe(94 + 93 + 92)
  expect(result.top.reduce((sum, share) => sum + share.percent, 0) + (result.other?.percent ?? 0)).toBe(100)
  expect(shares([])).toEqual({ top: [], other: undefined, total: 0 })
})

test("every ring tick names a share and never runs past the list", () => {
  const list = [
    { label: "a", tokens: 60, percent: 60 },
    { label: "b", tokens: 40, percent: 40 },
  ]
  const ring = ticks(list)
  expect(ring).toHaveLength(100)
  expect(ring.filter((index) => index === 0)).toHaveLength(60)
  expect(ring.at(-1)).toBe(1)
  expect(ticks([]).every((index) => index === -1)).toBe(true)
})

test("coverage scales by area, not by radius", () => {
  expect(areaScale(100, 100)).toBe(1)
  expect(areaScale(25, 100)).toBe(0.5)
  expect(areaScale(0, 100)).toBe(0)
  expect(areaScale(10, 0)).toBe(0)
})

test("a session span reads as days and hours", () => {
  expect(span(45 * DAY + 20 * 3_600_000)).toEqual({ days: 45, hours: 20 })
  expect(span(45 * 60_000)).toEqual({ days: 0, hours: 0 })
})
