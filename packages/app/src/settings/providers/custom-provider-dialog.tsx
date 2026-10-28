import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Field } from "@opencode/ui/field"
import { TextInput } from "@opencode/ui/text-input"
import { Textarea } from "@opencode/ui/textarea"
import { Option, Schema } from "effect"
import { type Component, createEffect, createSignal, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { showToast } from "@/shell/notifications/toast"
import {
  CUSTOM_PROVIDER_PACKAGE,
  configuredProviders,
  type ModelConfig,
  type ProviderConfig,
} from "./configured"

const PROVIDER_ID = /^[a-z0-9][a-z0-9._-]*$/

const BASE_URL = /^https?:\/\//i

/** Conservative defaults for an OpenAI-compatible endpoint; capabilities are editable per model. */
const defaultModel = (): ModelConfig => ({
  capabilities: { tools: true, input: ["text"], output: ["text"] },
})

export const DialogCustomProvider: Component<{
  /** Edits the provider with this id instead of creating one. */
  providerID?: string
  onSaved?: (providerID: string) => void
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const editing = () => props.providerID !== undefined

  const [existing, setExisting] = createSignal<ProviderConfig | undefined>(undefined)

  const [store, setStore] = createStore({
    id: props.providerID ?? "",
    name: "",
    baseURL: "",
    apiKey: "",
    models: "",
    saving: false,
    error: "",
  })

  createEffect(() => {
    const providerID = props.providerID

    if (!providerID) return

    void serverSdk.api.config
      .get()
      .then((entries) => {
        const info = configuredProviders(entries).get(providerID)

        if (!info) return

        setExisting(info)

        setStore({
          name: info.name ?? "",
          baseURL: Option.getOrElse(
            Schema.decodeUnknownOption(Schema.String)(info.settings?.baseURL),
            () => "",
          ),
          models: Object.keys(info.models ?? {}).join("\n"),
        })
      })
      .catch(() => undefined)
  })

  const storeKey = async (integrationID: string, key: string) => {
    // The provider's integration only exists once the server reloads the written config,
    // so a fresh provider can reject the key for a moment after the update resolves.
    for (let attempt = 0; attempt < 10; attempt++) {
      const saved = await serverSdk.api.integration.connect
        .key({ integrationID, key })
        .then(() => true)
        .catch(() => false)

      if (saved) return true

      await new Promise((resolve) => setTimeout(resolve, 200))
    }

    return false
  }

  const save = async () => {
    const id = store.id.trim()

    const models = [...new Set(store.models.split(/[\n,]/).map((model) => model.trim()))].filter(Boolean)

    const baseURL = store.baseURL.trim()

    if (!editing() && !PROVIDER_ID.test(id))
      return setStore("error", language.t("settings.providers.custom.error.id"))

    if (models.length === 0) return setStore("error", language.t("settings.providers.custom.error.models"))

    if (models.some((model) => /\s/.test(model)))
      return setStore("error", language.t("settings.providers.custom.error.modelId"))

    if (!baseURL || !BASE_URL.test(baseURL))
      return setStore("error", language.t("settings.providers.custom.error.baseURL"))

    setStore({ saving: true, error: "" })
    const current = existing()
    const settings: NonNullable<ProviderConfig["settings"]> = { ...current?.settings, baseURL }

    const info: ProviderConfig = {
      ...current,
      name: store.name.trim() || id,
      package: current?.package ?? CUSTOM_PROVIDER_PACKAGE,
      settings,
      models: Object.fromEntries(models.map((model) => [model, current?.models?.[model] ?? defaultModel()])),
    }

    const failure = await serverSdk.api.config
      .update({ providers: { [id]: info } })
      .then(() => undefined)
      .catch((error) => (error instanceof Error ? error.message : language.t("common.requestFailed")))

    if (failure) {
      setStore({ saving: false, error: failure })

      return
    }

    const key = store.apiKey.trim()
    const connected = key ? await storeKey(id, key) : true

    props.onSaved?.(id)
    dialog.close()
    showToast({
      variant: "success",
      icon: "circle-check",
      title: language.t("settings.providers.custom.saved.title"),
      description: connected
        ? language.t("settings.providers.custom.saved.description", { provider: info.name ?? id })
        : language.t("settings.providers.custom.saved.keyPending", { provider: info.name ?? id }),
    })
  }

  return (
    <Dialog fit containerClass="settings-form-dialog">
      <DialogHeader>
        <DialogTitleGroup
          title={language.t(editing() ? "settings.providers.custom.editTitle" : "settings.providers.custom.title")}
          description={language.t("settings.providers.custom.description")}
        />
      </DialogHeader>
      <DialogBody>
        <div class="flex w-full min-w-0 flex-col gap-5">
          <Field>
            <Field.Label>{language.t("settings.providers.custom.name")}</Field.Label>
            <Field.Control>
              <TextInput
                autofocus
                appearance="large"
                value={store.name}
                placeholder={language.t("settings.providers.custom.name.placeholder")}
                onInput={(event) => setStore("name", event.currentTarget.value)}
              />
            </Field.Control>
          </Field>

          <Field>
            <Field.Label>{language.t("settings.providers.custom.id")}</Field.Label>
            <Field.Control>
              <TextInput
                appearance="large"
                value={store.id}
                disabled={editing()}
                placeholder={language.t("settings.providers.custom.id.placeholder")}
                onInput={(event) => setStore("id", event.currentTarget.value)}
              />
            </Field.Control>
            <Field.Suffix>{language.t("settings.providers.custom.id.hint")}</Field.Suffix>
          </Field>

          <Field>
            <Field.Label>{language.t("settings.providers.custom.baseURL")}</Field.Label>
            <Field.Control>
              <TextInput
                appearance="large"
                dir="ltr"
                value={store.baseURL}
                placeholder={language.t("settings.providers.custom.baseURL.placeholder")}
                onInput={(event) => setStore("baseURL", event.currentTarget.value)}
              />
            </Field.Control>
            <Field.Suffix>{language.t("settings.providers.custom.baseURL.hint")}</Field.Suffix>
          </Field>

          <Field>
            <Field.Label>{language.t("settings.providers.custom.apiKey")}</Field.Label>
            <Field.Control>
              <TextInput
                appearance="large"
                type="password"
                dir="ltr"
                value={store.apiKey}
                placeholder={language.t("settings.providers.custom.apiKey.placeholder")}
                onInput={(event) => setStore("apiKey", event.currentTarget.value)}
              />
            </Field.Control>
            <Field.Suffix>{language.t("settings.providers.custom.apiKey.hint")}</Field.Suffix>
          </Field>

          <Field>
            <Field.Label>{language.t("settings.providers.custom.models")}</Field.Label>
            <Field.Control>
              <Textarea
                rows={4}
                class="settings-form-dialog-models"
                spellcheck={false}
                value={store.models}
                placeholder={language.t("settings.providers.custom.models.placeholder")}
                onInput={(event) => setStore("models", event.currentTarget.value)}
              />
            </Field.Control>
            <Field.Suffix>{language.t("settings.providers.custom.models.hint")}</Field.Suffix>
          </Field>

          <Show when={store.error}>
            {(error) => (
              <span class="settings-server-dialog-error" role="alert">
                {error()}
              </span>
            )}
          </Show>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="neutral" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="contrast" disabled={store.saving} onClick={() => void save()}>
          {language.t(editing() ? "common.save" : "settings.providers.custom.add")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
