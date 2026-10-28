import { describe, expect, test } from "bun:test"
import type { ConfigEntry } from "@opencode/client/promise"
import { configuredProviders } from "./configured"

const document = (providers: Record<string, { name?: string }>): ConfigEntry => ({
  type: "document",
  info: { providers },
})

// SAFETY: a directory entry carries a branded absolute path; any string satisfies it here.
const directory = { type: "directory", path: "/tmp" } as ConfigEntry

describe("configuredProviders", () => {
  test("keeps the highest precedence definition of every provider", () => {
    const providers = configuredProviders([
      document({ "my-llm": { name: "First" } }),
      directory,
      document({ "my-llm": { name: "Second" }, other: { name: "Other" } }),
    ])

    expect(providers.get("my-llm")?.name).toBe("Second")
    expect(providers.get("other")?.name).toBe("Other")
  })

  test("ignores providers a connection contributes", () => {
    const integration: Extract<ConfigEntry, { type: "document" }> & { integrationID: string } = {
      type: "document",
      integrationID: "opencode",
      info: { providers: { "console-model": { name: "Console" } } },
    }

    expect(configuredProviders([integration, document({ "my-llm": { name: "Mine" } })]).has("console-model")).toBe(
      false,
    )
  })
})
