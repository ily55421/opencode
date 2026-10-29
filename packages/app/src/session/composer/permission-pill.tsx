import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import type { PermissionRuleset } from "@opencode/client/promise"
import { For } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { projectSettingsKey, useSettings } from "@/settings/model"
import { useComposerLaneAlignment } from "./composer-lane"
import { MODES, modeOf, ruleset, type PermissionMode, type PermissionSelection } from "./permission-mode"

const ICONS: Record<PermissionSelection, string> = {
  ask: "outline-eye",
  auto: "status-active",
  full: "outline-globe",
  custom: "outline-sliders",
}

/**
 * The session's approval mode as one capsule in the composer lane.
 *
 * The choice is written to the session as its permission ruleset, so the server enforces it for every client —
 * another tab, the TUI, the SDK — instead of this tab answering prompts on the user's behalf.
 */
export function SessionPermissionPill(props: {
  sessionID: string
  projectID: string | undefined
  permissions: PermissionRuleset | undefined
}) {
  const language = useLanguage()
  const sdk = useServerSDK()
  const settings = useSettings()
  const alignment = useComposerLaneAlignment()
  const selection = () => modeOf(props.permissions)
  const placement = () => (({ center: "top", start: "top-start", end: "top-end" }) as const)[alignment()]

  function choose(mode: string) {
    if (mode !== "ask" && mode !== "auto" && mode !== "full") return
    const project = projectSettingsKey(sdk.scope, props.projectID)

    // Remembered per project so a new session there starts where the user left off; "ask" is the plain default,
    // so choosing it clears the memory instead of pinning every future session to it.
    if (project) settings.permissions.setModeOverride(project, mode === "ask" ? undefined : mode)
    void sdk.api.session.update({ sessionID: props.sessionID, permissions: ruleset(mode as PermissionMode) })
  }

  return (
    <div data-component="session-permission-pill" class="flex min-w-0 shrink items-center">
      <Menu gutter={8} placement={placement()}>
        <Menu.Trigger
          as="button"
          type="button"
          data-slot="session-permission-trigger"
          data-mode={selection()}
          aria-label={language.t(`composer.permission.${selection()}.title`)}
          class="pointer-events-auto flex h-7 min-w-0 items-center gap-1.5 rounded-[12px] border-[0.5px] border-v2-border-border-muted bg-v2-background-bg-base ps-2.5 pe-2 text-[13px] font-[440] leading-text-compact tracking-[-0.04px] whitespace-nowrap text-v2-text-text-base shadow-[var(--v2-elevation-raised)] outline-none"
          classList={{ "text-v2-text-text-danger": selection() === "full" }}
        >
          <Icon name={ICONS[selection()]} class="size-3.5 shrink-0" />
          <span class="min-w-0 truncate">{language.t(`composer.permission.${selection()}.title`)}</span>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content data-slot="session-permission-panel" aria-label={language.t("composer.permission.title")}>
            <Menu.RadioGroup value={selection()} onChange={choose}>
              <For each={MODES}>
                {(mode) => (
                  <Menu.RadioItem
                    value={mode}
                    data-slot="session-permission-option"
                    data-mode={mode}
                    class="flex w-full items-start gap-2"
                  >
                    <Icon
                      name={ICONS[mode]}
                      class="mt-0.5 size-3.5 shrink-0"
                      classList={{ "text-v2-text-text-danger": mode === "full" }}
                    />
                    <span class="min-w-0 flex-1">
                      <span
                        data-slot="session-permission-option-title"
                        class="block text-[13px] font-[530] leading-text-compact"
                        classList={{ "text-v2-text-text-danger": mode === "full" }}
                      >
                        {language.t(`composer.permission.${mode}.title`)}
                      </span>
                      <span
                        data-slot="session-permission-option-description"
                        class="block text-[12px] font-[400] leading-text-compact text-v2-text-text-muted"
                        classList={{ "text-v2-text-text-danger": mode === "full" }}
                      >
                        {language.t(`composer.permission.${mode}.description`)}
                      </span>
                    </span>
                  </Menu.RadioItem>
                )}
              </For>
            </Menu.RadioGroup>
          </Menu.Content>
        </Menu.Portal>
      </Menu>
    </div>
  )
}
