import type { ServerApi } from "@/runtime/server/api"
import { createMemo, createResource } from "solid-js"

const DAY = 86_400_000

export type ActivityDay = { date: string; steps: number }

export type ActivityInfo = {
  sessions: number
  steps: number
  tokens: number
  days: ActivityDay[]
}

/**
 * Daily session activity for the focused server, refreshed with the page. A failed request is its own state rather
 * than a resource error: reading an errored Solid resource rethrows, which would take the whole page down.
 */
export function createActivity(input: {
  api: () => ServerApi | undefined
  project?: () => string | undefined
  days?: number
}) {
  const source = createMemo(
    () => {
      const api = input.api()

      return api ? { api, project: input.project?.() } : undefined
    },
    undefined,
    { equals: (a, b) => a?.api === b?.api && a?.project === b?.project },
  )

  const [activity] = createResource(source, async (current) => {
    const to = Date.now()

    return current.api.session
      .stats({
        from: to - (input.days ?? 365) * DAY,
        to,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        tools: "none",
        project: current.project,
      })
      .then((stats) => ({
        ok: true as const,
        info: {
          sessions: stats.sessions,
          steps: stats.steps,
          tokens:
            stats.tokens.input +
            stats.tokens.output +
            stats.tokens.reasoning +
            stats.tokens.cache.read +
            stats.tokens.cache.write,
          days: stats.activity,
        } satisfies ActivityInfo,
      }))
      .catch(() => ({ ok: false as const }))
  })

  return activity
}

export type ActivityResource = ReturnType<typeof createActivity>
