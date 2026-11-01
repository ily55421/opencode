import { describe, expect, test } from "bun:test"
import { InstructionBudget } from "@opencode/core/instructions/budget"
import { Token } from "@opencode/core/util/token"

const part = (key: string, lines: number, scope: "global" | "project" = "global") => ({
  key,
  text: Array.from({ length: lines }, (_, i) => `line ${i} ${key}`).join("\n"),
  scope,
})
const pools = (global: number, project = global): InstructionBudget.Pools => ({ global, project })

describe("InstructionBudget.forWindow", () => {
  test("takes the smaller of the share and the ceiling", () => {
    expect(InstructionBudget.forWindow(200_000)).toEqual({ global: 50_000, project: 50_000 })
    expect(InstructionBudget.forWindow(1_000_000)).toEqual({ global: 100_000, project: 100_000 })
  })

  test("keeps the ceiling for a model that reports no window", () => {
    expect(InstructionBudget.forWindow(0)).toEqual({ global: 100_000, project: 100_000 })
  })
})

describe("InstructionBudget.fit", () => {
  test("passes a baseline that fits through untouched", () => {
    const parts = [part("core/instructions", 3), part("core/skill-guidance", 2)]
    expect(InstructionBudget.fit(parts, pools(10_000))).toBe([parts[0].text, parts[1].text].join("\n\n"))
  })

  test("names the part it trimmed and how much went missing", () => {
    const parts = [part("core/instructions", 40), part("core/skill-guidance", 4)]
    const budget = Token.estimateWide(parts[0].text) + 10
    const fitted = InstructionBudget.fit(parts, pools(budget))
    expect(fitted).toContain("[instructions budget: core/skill-guidance trimmed")
    expect(fitted).not.toContain("line 3 core/skill-guidance")
  })

  test("drops a part that cannot keep even its first line", () => {
    const parts = [part("core/instructions", 20), part("api/verbose", 20)]
    const fitted = InstructionBudget.fit(parts, pools(Token.estimateWide(parts[0].text)))
    expect(fitted).toContain("api/verbose dropped")
  })

  test("never spends more than the budget on kept text", () => {
    const parts = Array.from({ length: 6 }, (_, index) => part(`core/part-${index}`, 30))
    const budget = 120
    const fitted = InstructionBudget.fit(parts, pools(budget))
    const kept = fitted.replace(/\n\n\[instructions budget: [^\]]*\]$/, "").split("\n\n")
    expect(kept.length).toBeLessThan(parts.length)
    expect(kept.reduce((sum, text) => sum + Token.estimateWide(text), 0)).toBeLessThanOrEqual(budget)
  })

  test("is deterministic, which is what keeps the cached prefix stable", () => {
    const parts = [part("core/instructions", 50), part("core/skill-guidance", 50)]
    expect(InstructionBudget.fit(parts, pools(60))).toBe(InstructionBudget.fit(parts, pools(60)))
  })

  test("spends the project pool independently of the global pool", () => {
    const agents = part("project/agents-md", 40, "project")
    const skills = part("core/skill-guidance", 40)
    const fitted = InstructionBudget.fit([skills, agents], pools(Token.estimateWide(skills.text), 20))
    // The project cut does not touch the global part, and the note names only the project source.
    expect(fitted).toContain(skills.text)
    expect(fitted).toContain("project/agents-md trimmed")
    expect(fitted).not.toContain("line 20 project/agents-md")
  })

  test("spends the global pool independently of the project pool", () => {
    const agents = part("project/agents-md", 40, "project")
    const skills = part("core/skill-guidance", 40)
    const fitted = InstructionBudget.fit([skills, agents], pools(20, Token.estimateWide(agents.text)))
    expect(fitted).toContain(agents.text)
    expect(fitted).toContain("core/skill-guidance trimmed")
  })

  test("keeps trimming within one scope after the other scope is exhausted", () => {
    const first = part("project/agents-md", 30, "project")
    const second = part("project/entries", 30, "project")
    const shared = part("core/skill-guidance", 30)
    const budget = Token.estimateWide(first.text)
    const fitted = InstructionBudget.fit([first, shared, second], pools(1, budget))
    expect(fitted.replace(/\n\n\[instructions budget: [^\]]*\]$/, "")).toBe(first.text)
    expect(fitted).toContain("core/skill-guidance dropped")
    expect(fitted).toContain("project/entries dropped")
  })
})
