import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Field } from "@opencode/ui/field"
import { Select } from "@opencode/ui/select"
import { Switch } from "@opencode/ui/switch"
import { TextInput } from "@opencode/ui/text-input"
import { type Component, createEffect, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { configuredProviders, type ModelConfig, type ProviderConfig } from "@/settings/providers/configured"
import { showToast } from "@/shell/notifications/toast"

const MODEL_ID = /^\S+$/

const AUTO = "auto"

const CONTEXT_PRESETS = [
  { label: "128k", value: "131072" },
  { label: "256k", value: "262144" },
  { label: "312k", value: "327680" },
  { label: "500k", value: "512000" },
  { label: "1M", value: "1048576" },
]

const OUTPUT_PRESETS = [
  { label: "4k", value: "4096" },
  { label: "8k", value: "8192" },
  { label: "16k", value: "16384" },
  { label: "32k", value: "32768" },
  { label: "128k", value: "131072" },
]

const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"]

const LEVEL_OPTIONS = LEVELS.map((level) => ({ label: level, value: level }))

type ProtocolId = "auto" | "effort" | "thinking" | "anthropic" | "gemini" | "toggle"

const PROTOCOLS: readonly ProtocolId[] = ["auto", "effort", "thinking", "anthropic", "gemini", "toggle"]

// Each protocol is labelled by the request field it spells, which reads better than a translated brand name.
const PROTOCOL_LABELS = new Map<string, string>([
  ["effort", "reasoning_effort"],
  ["thinking", "thinking.type"],
  ["anthropic", "thinking + effort"],
  ["gemini", "thinkingLevel"],
  ["toggle", "on/off"],
])

type LevelParamId =
  | "auto"
  | "reasoning_effort"
  | "thinking.level"
  | "thinking_config.thinking_level"
  | "chat_template_kwargs.reasoning_effort"
  | "enable_thinking"
  | "chat_template_kwargs.enable_thinking"

const LEVEL_PARAMS: readonly LevelParamId[] = [
  "auto",
  "reasoning_effort",
  "thinking.level",
  "thinking_config.thinking_level",
  "chat_template_kwargs.reasoning_effort",
  "enable_thinking",
  "chat_template_kwargs.enable_thinking",
]

// A boolean switch only carries on or off, so it pairs with the toggle protocol and nothing else.
const BOOLEAN_PARAMS = new Set(["enable_thinking", "chat_template_kwargs.enable_thinking"])

const TOGGLE = "toggle"

type State = {
  id: string
  name: string
  context: string
  output: string
  tools: boolean
  image: boolean
  pdf: boolean
  imageOutput: boolean
  webSearch: boolean
  autoScheduled: boolean
  reasoning: boolean
  protocol: ProtocolId
  levelParam: LevelParamId
  defaultLevel: string
  levels: string[]
  saving: boolean
  error: string
}

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

  const [store, setStore] = createStore<State>({
    id: props.model?.id ?? "",
    name: props.model?.name ?? "",
    context: props.model?.context?.toString() ?? "",
    output: props.model?.output?.toString() ?? "",
    tools: props.model?.tools ?? true,
    image: props.model?.image ?? false,
    pdf: false,
    imageOutput: false,
    webSearch: false,
    autoScheduled: false,
    reasoning: false,
    protocol: AUTO,
    levelParam: AUTO,
    defaultLevel: AUTO,
    levels: [],
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
        const reasoning = current.capabilities?.reasoning
        const controls = reasoning?.supported ? reasoning : undefined

        setStore({
          name: current.name ?? store.name,
          context: current.limit?.context?.toString() ?? "",
          output: current.limit?.output?.toString() ?? "",
          tools: current.capabilities?.tools ?? store.tools,
          image: current.capabilities?.input?.includes("image") ?? store.image,
          pdf: current.capabilities?.input?.includes("pdf") ?? store.pdf,
          imageOutput: current.capabilities?.output?.includes("image") ?? store.imageOutput,
          webSearch: current.capabilities?.webSearch ?? store.webSearch,
          autoScheduled: current.capabilities?.autoScheduled ?? store.autoScheduled,
          reasoning: reasoning?.supported ?? false,
          protocol: controls?.protocol ?? AUTO,
          levelParam: controls?.levelParam ?? AUTO,
          defaultLevel: controls?.default ?? AUTO,
          levels: controls?.effort ?? [],
        })
      })
      .catch(() => undefined)
  })

  const limit = (value: string) => {
    const parsed = Number.parseInt(value.trim(), 10)

    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  }

  const toggleLevel = (level: string) =>
    setStore(
      "levels",
      store.levels.includes(level) ? store.levels.filter((item) => item !== level) : [...store.levels, level],
    )

  const optionLabel = (option: string, labels?: Map<string, string>) =>
    option === AUTO ? language.t("settings.models.custom.thinking.auto") : (labels?.get(option) ?? option)

  const selectProtocol = (protocol: ProtocolId) =>
    setStore({
      protocol,
      levelParam: BOOLEAN_PARAMS.has(store.levelParam) === (protocol === TOGGLE) ? store.levelParam : AUTO,
    })

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
    const defaultLevel = store.levels.includes(store.defaultLevel) ? store.defaultLevel : undefined

    const model: ModelConfig = {
      ...previous,
      name: store.name.trim() || undefined,
      type: store.imageOutput ? "image" : previous?.type,
      capabilities: {
        ...previous?.capabilities,
        tools: store.tools,
        input: [
          "text",
          ...(store.image ? ["image"] : []),
          ...(store.pdf ? ["pdf"] : []),
          ...(previous?.capabilities?.input ?? []).filter((item) => item !== "text" && item !== "image" && item !== "pdf"),
        ],
        output: [
          "text",
          ...(store.imageOutput ? ["image"] : []),
          ...(previous?.capabilities?.output ?? []).filter((item) => item !== "text" && item !== "image"),
        ],
        reasoning: store.reasoning
          ? {
              ...previous?.capabilities?.reasoning,
              supported: true,
              effort: store.levels,
              protocol: store.protocol === AUTO ? undefined : store.protocol,
              levelParam: store.levelParam === AUTO ? undefined : store.levelParam,
              default: defaultLevel,
            }
          : { supported: false },
        webSearch: store.webSearch,
        autoScheduled: store.autoScheduled,
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
      title: language.t(editing() ? "settings.models.custom.saved.editTitle" : "settings.models.custom.saved.title"),
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

          <Field>
            <Field.Label>{language.t("settings.models.custom.context")}</Field.Label>
            <Field.Control>
              <div class="settings-form-dialog-limit">
                <Chips
                  options={CONTEXT_PRESETS}
                  isSelected={(value) => store.context.trim() === value}
                  onPick={(value) => setStore("context", value)}
                />
                <TextInput
                  numeric
                  appearance="large"
                  value={store.context}
                  onInput={(event) => setStore("context", event.currentTarget.value)}
                />
              </div>
            </Field.Control>
          </Field>

          <Field>
            <Field.Label>{language.t("settings.models.custom.output")}</Field.Label>
            <Field.Control>
              <div class="settings-form-dialog-limit">
                <Chips
                  options={OUTPUT_PRESETS}
                  isSelected={(value) => store.output.trim() === value}
                  onPick={(value) => setStore("output", value)}
                />
                <TextInput
                  numeric
                  appearance="large"
                  value={store.output}
                  onInput={(event) => setStore("output", event.currentTarget.value)}
                />
              </div>
            </Field.Control>
          </Field>

          <div class="settings-form-dialog-section">
            <span class="settings-form-dialog-section-title">{language.t("settings.models.custom.thinking")}</span>
            <SwitchRow
              title={language.t("settings.models.custom.reasoning.title")}
              description={language.t("settings.models.custom.reasoning.description")}
              checked={store.reasoning}
              onChange={(checked) => setStore("reasoning", checked)}
            />
            <Show when={store.reasoning}>
              <div class="settings-form-dialog-pickers">
                <PickerRow
                  label={language.t("settings.models.custom.thinking.protocol")}
                  options={PROTOCOLS}
                  value={store.protocol}
                  labelFor={(option) => optionLabel(option, PROTOCOL_LABELS)}
                  onSelect={selectProtocol}
                />
                <PickerRow
                  label={language.t("settings.models.custom.thinking.levelParam")}
                  options={LEVEL_PARAMS.filter(
                    (option) => option === AUTO || BOOLEAN_PARAMS.has(option) === (store.protocol === TOGGLE),
                  )}
                  value={store.levelParam}
                  labelFor={optionLabel}
                  onSelect={(option) => setStore("levelParam", option)}
                />
                <PickerRow
                  label={language.t("settings.models.custom.thinking.default")}
                  options={[AUTO, ...store.levels]}
                  value={store.defaultLevel}
                  labelFor={optionLabel}
                  onSelect={(option) => setStore("defaultLevel", option)}
                />
              </div>
              <Chips
                class="settings-form-dialog-levels"
                options={LEVEL_OPTIONS}
                isSelected={(level) => store.levels.includes(level)}
                onPick={toggleLevel}
              />
            </Show>
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
              title={language.t("settings.models.custom.pdf.title")}
              description={language.t("settings.models.custom.pdf.description")}
              checked={store.pdf}
              onChange={(checked) => setStore("pdf", checked)}
            />
            <SwitchRow
              title={language.t("settings.models.custom.imageOutput.title")}
              description={language.t("settings.models.custom.imageOutput.description")}
              checked={store.imageOutput}
              onChange={(checked) => setStore("imageOutput", checked)}
            />
            <SwitchRow
              title={language.t("settings.models.custom.autoScheduled.title")}
              description={language.t("settings.models.custom.autoScheduled.description")}
              checked={store.autoScheduled}
              onChange={(checked) => setStore("autoScheduled", checked)}
            />
            <SwitchRow
              title={language.t("settings.models.custom.webSearch.title")}
              description={language.t("settings.models.custom.webSearch.description")}
              checked={store.webSearch}
              onChange={(checked) => setStore("webSearch", checked)}
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

/** Pill buttons over a fixed value list: single-select for the token presets, multi-select for the levels. */
function Chips(props: {
  class?: string
  options: readonly { label: string; value: string }[]
  isSelected: (value: string) => boolean
  onPick: (value: string) => void
}) {
  return (
    <div class={props.class ?? "settings-form-dialog-chips"}>
      {props.options.map((option) => (
        <button
          type="button"
          class="settings-form-dialog-chip"
          aria-pressed={props.isSelected(option.value)}
          data-selected={props.isSelected(option.value) ? "" : undefined}
          onClick={() => props.onPick(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function PickerRow<T extends string>(props: {
  label: string
  options: readonly T[]
  value: string
  labelFor: (option: T) => string
  onSelect: (option: T) => void
}) {
  return (
    <div class="settings-form-dialog-picker">
      <span class="settings-form-dialog-picker-label">{props.label}</span>
      <Select
        class="settings-form-dialog-picker-select"
        options={[...props.options]}
        current={props.options.find((option) => option === props.value)}
        value={(option) => option}
        label={props.labelFor}
        placement="bottom-end"
        gutter={6}
        onSelect={(option) => option && props.onSelect(option)}
      />
    </div>
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
