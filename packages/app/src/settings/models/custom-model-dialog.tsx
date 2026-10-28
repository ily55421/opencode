import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Field } from "@opencode/ui/field"
import { Switch } from "@opencode/ui/switch"
import { TextInput } from "@opencode/ui/text-input"
import { type Component, createEffect, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { configuredProviders, type ModelConfig, type ProviderConfig } from "@/settings/providers/configured"
import { showToast } from "@/shell/notifications/toast"

const MODEL_ID = /^\S+$/

type ModelDefaults = {
  id: string
  name: string
  context?: number
  output?: number
  tools?: boolean
  image?: boolean
}

export const DialogCustomModel: Component<{
  providerID: string
  providerName: string
  /** Edits this model instead of adding a new one. */
  model?: ModelDefaults
  onSaved?: () => void
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const editing = () => props.model !== undefined

  const [store, setStore] = createStore({
    id: props.model?.id ?? "",
    name: props.model?.name ?? "",
    context: props.model?.context?.toString() ?? "",
    output: props.model?.output?.toString() ?? "",
    tools: props.model?.tools ?? true,
    image: props.model?.image ?? false,
    reasoning: false,
    saving: false,
    error: "",
  })

  createEffect(() => {
    const id = props.model?.id

    if (!id) return

    void serverSdk.api.config
      .get()
      .then((entries) => {
        const current = configuredProviders(entries).get(props.providerID)?.models?.[id]

        if (!current) return

        setStore({
          name: current.name ?? store.name,
          context: current.limit?.context?.toString() ?? "",
          output: current.limit?.output?.toString() ?? "",
          tools: current.capabilities?.tools ?? store.tools,
          image: current.capabilities?.input?.includes("image") ?? store.image,
          reasoning: current.capabilities?.reasoning?.supported ?? false,
        })
      })
      .catch(() => undefined)
  })

  const limit = (value: string) => {
    const parsed = Number.parseInt(value.trim(), 10)

    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  }

  const save = async () => {
    const id = store.id.trim()

    if (!MODEL_ID.test(id)) return setStore("error", language.t("settings.models.custom.error.id"))

    const context = limit(store.context)
    const output = limit(store.output)

    if ((store.context.trim() && context === undefined) || (store.output.trim() && output === undefined))
      return setStore("error", language.t("settings.models.custom.error.limit"))

    setStore({ saving: true, error: "" })

    const entries = await serverSdk.api.config.get().catch(() => [])
    const current = configuredProviders(entries).get(props.providerID)
    const previous = current?.models?.[id]
    const reasoning = previous?.capabilities?.reasoning

    const model: ModelConfig = {
      ...previous,
      name: store.name.trim() || undefined,
      capabilities: {
        ...previous?.capabilities,
        tools: store.tools,
        input: [
          "text",
          ...(store.image ? ["image"] : []),
          ...(previous?.capabilities?.input ?? []).filter((item) => item !== "text" && item !== "image"),
        ],
        output: previous?.capabilities?.output ?? ["text"],
        reasoning: store.reasoning
          ? reasoning?.supported
            ? reasoning
            : { supported: true, effort: ["low", "medium", "high"] }
          : { supported: false },
      },
      ...(context === undefined && output === undefined
        ? { limit: undefined }
        : { limit: { ...previous?.limit, context, output } }),
    }

    const info: ProviderConfig = { ...current, models: { ...current?.models, [id]: model } }

    const failure = await serverSdk.api.config
      .update({ providers: { [props.providerID]: info } })
      .then(() => undefined)
      .catch((error) => (error instanceof Error ? error.message : language.t("common.requestFailed")))

    if (failure) {
      setStore({ saving: false, error: failure })

      return
    }

    props.onSaved?.()
    dialog.close()
    showToast({
      variant: "success",
      icon: "circle-check",
      title: language.t(
        editing() ? "settings.models.custom.saved.editTitle" : "settings.models.custom.saved.title",
      ),
      description: language.t(
        editing() ? "settings.models.custom.saved.editDescription" : "settings.models.custom.saved.description",
        { model: id, provider: props.providerName },
      ),
    })
  }

  return (
    <Dialog fit containerClass="settings-form-dialog">
      <DialogHeader>
        <DialogTitleGroup
          title={language.t(editing() ? "settings.models.custom.editTitle" : "settings.models.custom.title")}
          description={language.t(
            editing() ? "settings.models.custom.editDescription" : "settings.models.custom.description",
            { provider: props.providerName },
          )}
        />
      </DialogHeader>
      <DialogBody>
        <div class="flex w-full min-w-0 flex-col gap-5">
          <Field>
            <Field.Label>{language.t("settings.models.custom.id")}</Field.Label>
            <Field.Control>
              <TextInput
                autofocus={!editing()}
                disabled={editing()}
                appearance="large"
                spellcheck={false}
                value={store.id}
                placeholder={language.t("settings.models.custom.id.placeholder")}
                onInput={(event) => setStore("id", event.currentTarget.value)}
              />
            </Field.Control>
          </Field>

          <Field>
            <Field.Label>{language.t("settings.models.custom.name")}</Field.Label>
            <Field.Control>
              <TextInput
                appearance="large"
                value={store.name}
                onInput={(event) => setStore("name", event.currentTarget.value)}
              />
            </Field.Control>
          </Field>

          <div class="grid grid-cols-2 gap-4">
            <Field>
              <Field.Label>{language.t("settings.models.custom.context")}</Field.Label>
              <Field.Control>
                <TextInput
                  numeric
                  appearance="large"
                  value={store.context}
                  onInput={(event) => setStore("context", event.currentTarget.value)}
                />
              </Field.Control>
            </Field>
            <Field>
              <Field.Label>{language.t("settings.models.custom.output")}</Field.Label>
              <Field.Control>
                <TextInput
                  numeric
                  appearance="large"
                  value={store.output}
                  onInput={(event) => setStore("output", event.currentTarget.value)}
                />
              </Field.Control>
            </Field>
          </div>

          <div class="settings-form-dialog-section">
            <span class="settings-form-dialog-section-title">
              {language.t("settings.models.custom.capabilities")}
            </span>
            <SwitchRow
              title={language.t("settings.models.custom.tools.title")}
              description={language.t("settings.models.custom.tools.description")}
              checked={store.tools}
              onChange={(checked) => setStore("tools", checked)}
            />
            <SwitchRow
              title={language.t("settings.models.custom.image.title")}
              description={language.t("settings.models.custom.image.description")}
              checked={store.image}
              onChange={(checked) => setStore("image", checked)}
            />
            <SwitchRow
              title={language.t("settings.models.custom.reasoning.title")}
              description={language.t("settings.models.custom.reasoning.description")}
              checked={store.reasoning}
              onChange={(checked) => setStore("reasoning", checked)}
            />
          </div>

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
          {language.t("common.save")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function SwitchRow(props: {
  title: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div class="settings-form-dialog-row">
      <div class="settings-form-dialog-row-copy">
        <span class="settings-form-dialog-row-title">{props.title}</span>
        <span class="settings-form-dialog-row-description">{props.description}</span>
      </div>
      <Switch checked={props.checked} onChange={props.onChange} hideLabel>
        {props.title}
      </Switch>
    </div>
  )
}
