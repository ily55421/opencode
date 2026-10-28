import { lastAssistantWithUsage } from "@opencode/client/solid"
import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client/promise"
import { Tooltip } from "@opencode/ui/tooltip"
import { createEffect, createMemo, createSignal, For, onCleanup, Show, type Accessor } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { cacheHitRate, contextSize, estimateOutputTokens, stepTokensPerSecond } from "./stats"

const WINDOW_MS = 2_500

const SAMPLE_MS = 400

const MIN_WINDOW_MS = 800

/**
 * Output speed, cache reuse and context usage for the routed session, under its composer. While a step streams, the
 * speed follows sampled output; once the provider finishes, the step's recorded tokens replace the estimate.
 */
export function SessionComposerStats(props: {
  messages: Accessor<readonly SessionMessageInfo[]>
  working: Accessor<boolean>
  boundary: Accessor<string | undefined>
  contextLimit: (model: { providerID: string; id: string }) => number | undefined
  status?: {
    /** The routed server's name, or the local-mode label when the session runs on this machine. */
    server: Accessor<string>
    project: Accessor<string | undefined>
    branch: Accessor<string | undefined>
  }
}) {
  const language = useLanguage()

  const streaming = createMemo(() => {
    if (!props.working()) return
    const message = props.messages().findLast((item): item is SessionMessageAssistant => item.type === "assistant")

    if (
      !message ||
      message.time.completed !== undefined ||
      message.time.streamed !== undefined ||
      message.tokens !== undefined
    )
      return

    return message
  })

  const completed = createMemo(() => {
    const message = props
      .messages()
      .findLast(
        (item): item is SessionMessageAssistant =>
          item.type === "assistant" && item.tokens !== undefined && item.time.streamed !== undefined,
      )

    return message ? stepTokensPerSecond(message) : undefined
  })

  const usage = createMemo(() => {
    const message = lastAssistantWithUsage(props.messages(), props.boundary())

    if (!message) return
    const limit = props.contextLimit(message.model)
    const total = contextSize(message.tokens)

    return {
      cache: cacheHitRate(message.tokens),
      cached: message.tokens.cache.read,
      prompt: message.tokens.input + message.tokens.cache.read + message.tokens.cache.write,
      context: limit && limit > 0 ? { percent: (total / limit) * 100, limit } : undefined,
      total,
    }
  })

  const [live, setLive] = createSignal<number>()
  let samples: { at: number; tokens: number }[] = []
  let sampledID: string | undefined

  const resetSamples = () => {
    samples = []
    sampledID = undefined
    setLive(undefined)
  }

  const sample = () => {
    const current = streaming()

    if (!current) return resetSamples()
    const at = performance.now()

    if (current.id !== sampledID) {
      resetSamples()
      sampledID = current.id
    }

    const tokens = estimateOutputTokens(current.content)
    samples.push({ at, tokens })

    while (samples.length > 1 && at - samples[0]!.at > WINDOW_MS) samples.shift()

    const first = samples[0]!
    const elapsed = at - first.at

    if (elapsed < MIN_WINDOW_MS) return setLive(undefined)
    const grown = tokens - first.tokens
    setLive(grown > 0 ? (grown / elapsed) * 1_000 : 0)
  }

  createEffect(() => {
    if (!props.working()) return resetSamples()
    const timer = setInterval(sample, SAMPLE_MS)
    onCleanup(() => clearInterval(timer))
  })

  const speed = () => (streaming() ? (live() ?? 0) : completed())

  const speedFormat = createMemo(() => new Intl.NumberFormat(language.locale(), { maximumFractionDigits: 1 }))
  const percentFormat = createMemo(() => new Intl.NumberFormat(language.locale(), { maximumFractionDigits: 0 }))

  const countFormat = createMemo(
    () => new Intl.NumberFormat(language.locale(), { notation: "compact", maximumFractionDigits: 1 }),
  )

  const items = createMemo(() => {
    const result: { key: string; label: string; tooltip: string }[] = []
    const value = speed()

    if (value !== undefined) {
      result.push({
        key: "speed",
        label: language.t("session.stats.speed", { value: speedFormat().format(value) }),
        tooltip: language.t("session.stats.speed.tooltip"),
      })
    }

    const current = usage()

    if (current?.cache !== undefined) {
      result.push({
        key: "cache",
        label: language.t("session.stats.cacheHit", { percent: percentFormat().format(current.cache) }),
        tooltip: language.t("session.stats.cacheHit.tooltip", {
          cached: countFormat().format(current.cached),
          prompt: countFormat().format(current.prompt),
        }),
      })
    }

    if (current?.context) {
      result.push({
        key: "context",
        label: language.t("session.stats.context", {
          percent: percentFormat().format(current.context.percent),
        }),
        tooltip: language.t("session.stats.context.tooltip", {
          used: countFormat().format(current.total),
          limit: countFormat().format(current.context.limit),
        }),
      })
    }

    return result
  })

  return (
    <Show when={items().length > 0 || !!props.status}>
      <div
        data-slot="session-composer-stats"
        aria-live="off"
        class="flex min-w-0 items-center justify-between gap-3 overflow-hidden px-1 pt-1.5 text-[11px] font-[440] leading-4 tabular-nums whitespace-nowrap text-v2-text-text-faint"
      >
        <Show when={props.status}>
          {(status) => (
            <div class="hidden min-w-0 items-center gap-1.5 md:flex">
              <Show when={status().project()}>
                {(project) => (
                  <>
                    <span class="max-w-[160px] truncate">{project()}</span>
                    <span aria-hidden="true">·</span>
                  </>
                )}
              </Show>
              <span class="shrink-0">{status().server()}</span>
              <span aria-hidden="true">·</span>
              <span class="max-w-[180px] truncate">{status().branch() ?? language.t("composer.status.noBranch")}</span>
            </div>
          )}
        </Show>
        <div class="flex min-w-0 shrink-0 items-center gap-2">
          <For each={items()}>
            {(item, index) => (
              <>
                <Show when={index() > 0}>
                  <span aria-hidden="true">·</span>
                </Show>
                <Tooltip value={item.tooltip} placement="top">
                  <span>{item.label}</span>
                </Tooltip>
              </>
            )}
          </For>
        </div>
      </div>
    </Show>
  )
}
