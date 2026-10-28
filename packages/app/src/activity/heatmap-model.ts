import type { ActivityDay } from "./activity"

export type HeatmapCell = { key: string; date: Date; steps: number }

export type Heatmap = {
  columns: Array<Array<HeatmapCell | undefined>>
  start: Date
  end: Date
}

export function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

/** Weeks of days ending today, aligned so every column is one weekday row. */
export function buildHeatmap(days: readonly ActivityDay[], weeks: number, end = new Date()): Heatmap {
  const steps = new Map(days.map((day) => [day.date, day.steps]))
  const last = new Date(end)
  last.setHours(0, 0, 0, 0)
  const start = new Date(last)
  start.setDate(start.getDate() - start.getDay() - (weeks - 1) * 7)

  const columns = Array.from({ length: weeks }, (_, column) =>
    Array.from({ length: 7 }, (_, row) => {
      const date = new Date(start)
      date.setDate(start.getDate() + column * 7 + row)

      if (date > last) return
      const key = dateKey(date)

      return { key, date, steps: steps.get(key) ?? 0 }
    }),
  )

  return { columns, start, end: last }
}

/** Columns whose first visible day opens a new month, for the heatmap's month labels. */
export function monthStarts(columns: Heatmap["columns"]) {
  const result: { index: number; date: Date }[] = []
  let month = -1

  columns.forEach((column, index) => {
    const date = column.find((cell): cell is HeatmapCell => !!cell)?.date

    if (!date || date.getMonth() === month) return
    month = date.getMonth()
    result.push({ index, date })
  })

  return result
}

/** The last `count` calendar days, oldest first, with missing days counted as zero. */
export function recentDays(days: readonly ActivityDay[], count: number, end = new Date()) {
  const steps = new Map(days.map((day) => [day.date, day.steps]))
  const last = new Date(end)
  last.setHours(0, 0, 0, 0)

  return Array.from({ length: count }, (_, index) => {
    const date = new Date(last)
    date.setDate(last.getDate() - (count - 1 - index))
    const key = dateKey(date)

    return { key, date, steps: steps.get(key) ?? 0 }
  })
}

/** Four intensity steps over the busiest day, so a sparse history still shows its shape. */
export function activityLevel(steps: number, max: number) {
  if (steps <= 0) return 0

  return Math.min(4, Math.ceil((steps / Math.max(1, max)) * 4))
}
