import { describe, expect, test } from "bun:test"
import { activityLevel, buildHeatmap, dateKey, monthStarts, recentDays } from "./heatmap-model"

describe("buildHeatmap", () => {
  test("aligns weeks by weekday and stops at the end date", () => {
    const end = new Date(2026, 9, 28)
    const heatmap = buildHeatmap([{ date: "2026-10-28", steps: 4 }], 2, end)

    expect(heatmap.columns).toHaveLength(2)
    expect(heatmap.columns[1]![3]).toMatchObject({ key: "2026-10-28", steps: 4 })
    expect(heatmap.columns[1]![4]).toBeUndefined()
  })

  test("fills every other day with zero", () => {
    const heatmap = buildHeatmap([], 1, new Date(2026, 9, 28))
    const cells = heatmap.columns.flat().filter((cell) => !!cell)

    expect(cells).toHaveLength(4)
    expect(cells.every((cell) => cell!.steps === 0)).toBe(true)
  })
})

describe("monthStarts", () => {
  test("labels the first week of each month", () => {
    const heatmap = buildHeatmap([], 8, new Date(2026, 9, 28))
    const months = monthStarts(heatmap.columns)

    expect(months.length).toBeGreaterThan(1)
    expect(
      months.every((month, index) => index === 0 || month.date.getMonth() !== months[index - 1]!.date.getMonth()),
    ).toBe(true)
  })
})

describe("recentDays", () => {
  test("returns the last days oldest first and fills gaps", () => {
    const days = recentDays([{ date: "2026-10-27", steps: 3 }], 3, new Date(2026, 9, 28))

    expect(days.map((day) => dateKey(day.date))).toEqual(["2026-10-26", "2026-10-27", "2026-10-28"])
    expect(days.map((day) => day.steps)).toEqual([0, 3, 0])
  })
})

describe("activityLevel", () => {
  test("spreads a quiet history across four steps", () => {
    expect(activityLevel(0, 10)).toBe(0)
    expect(activityLevel(1, 10)).toBe(1)
    expect(activityLevel(5, 10)).toBe(2)
    expect(activityLevel(10, 10)).toBe(4)
  })
})
