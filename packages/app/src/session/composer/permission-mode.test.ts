import { describe, expect, test } from "bun:test"
import { MODES, declinesAutoApproval, modeOf, ruleset } from "./permission-mode"

describe("permission modes", () => {
  test("every mode reads back as itself", () => {
    for (const mode of MODES) expect(modeOf(ruleset(mode))).toBe(mode)
  })

  test("an untouched session asks and keeps the client setting in charge", () => {
    expect(modeOf(undefined)).toBe("ask")
    expect(modeOf([])).toBe("ask")
    expect(declinesAutoApproval([])).toBe(false)
    expect(declinesAutoApproval(undefined)).toBe(false)
  })

  test("choosing ask explicitly opts out of client-side auto approval", () => {
    expect(declinesAutoApproval(ruleset("ask"))).toBe(true)
  })

  test("full access allows everything with one rule", () => {
    expect(ruleset("full")).toEqual([{ action: "*", resource: "*", effect: "allow" }])
  })

  // Permission.evaluate takes the last matching rule, so the order below is the behaviour, not cosmetics.
  test("auto approve allows the ordinary and keeps asking about the risky", () => {
    const auto = ruleset("auto")

    expect(auto[0]).toEqual({ action: "*", resource: "*", effect: "allow" })
    for (const action of ["edit", "shell", "external_directory", "webfetch", "websearch"])
      expect(auto).toContainEqual({ action, resource: "*", effect: "ask" })
    expect(auto).toContainEqual({ action: "read", resource: "*.env*", effect: "ask" })
  })

  test("auto approve leaves the ordinary actions to the blanket allow", () => {
    const auto = ruleset("auto")

    for (const action of ["grep", "glob", "todowrite", "subagent", "question", "skill"])
      expect(auto.some((rule) => rule.action === action)).toBe(false)

    // Reading files is allowed; only the credentials-shaped ones stay a question.
    expect(auto.filter((rule) => rule.action === "read")).toEqual([
      { action: "read", resource: "*.env*", effect: "ask" },
    ])
  })

  test("a ruleset from elsewhere reads as custom instead of claiming a mode", () => {
    expect(modeOf([{ action: "edit", resource: "*", effect: "deny" }])).toBe("custom")
    expect(declinesAutoApproval([{ action: "edit", resource: "*", effect: "deny" }])).toBe(false)
  })

  test("each mode writes its own ruleset without mutating the shared default", () => {
    const ask = ruleset("ask")
    ask.push({ action: "read", resource: "*", effect: "allow" })

    expect(ruleset("ask")).toEqual([{ action: "*", resource: "*", effect: "ask" }])
  })
})
