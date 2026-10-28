import type { ConfigEntry } from "@opencode/client/promise"
import { createMemo, createResource, type Accessor } from "solid-js"
import { useServerSDK } from "@/runtime/server/client"

export type ConfigDocument = Extract<ConfigEntry, { type: "document" }>

export type ProviderConfig = NonNullable<NonNullable<ConfigDocument["info"]["providers"]>[string]>

export type ModelConfig = NonNullable<NonNullable<ProviderConfig["models"]>[string]>

/** The package OpenCode uses for an OpenAI-compatible endpoint. */
export const CUSTOM_PROVIDER_PACKAGE = "@opencode/ai/providers/openai-compatible"

/**
 * Providers defined by local configuration documents; later documents take precedence.
 * Integration documents share the entry list but their providers belong to a connection,
 * so they are not user-managed custom providers.
 */
export function configuredProviders(entries: readonly ConfigEntry[]) {
  const providers = new Map<string, ProviderConfig>()

  entries.forEach((entry) => {
    if (entry.type !== "document" || "integrationID" in entry) return

    Object.entries(entry.info.providers ?? {}).forEach(([id, info]) => providers.set(id, info))
  })

  return providers
}

export function useConfiguredProviders(directory: Accessor<string | undefined>) {
  const serverSdk = useServerSDK()

  const [entries, actions] = createResource(
    // Solid skips the fetcher for a nullish source; "" stands for the default (global) location.
    () => directory() ?? "",
    () => {
      const dir = directory()

      return dir === undefined ? serverSdk.api.config.get() : serverSdk.api.config.get({ location: { directory: dir } })
    },
    // SAFETY: the resource starts from an empty list before its first request resolves.
    { initialValue: [] as ConfigEntry[] },
  )

  const providers = createMemo(() => configuredProviders(entries.latest))

  return { providers, refresh: () => void actions.refetch() }
}
