import type { PermissionRule, PermissionRuleset } from "@opencode/client/promise"

/**
 * The composer's approval modes, each one session ruleset. Expressing them as rules means the server enforces the
 * choice for every client — desktop, web, TUI, CLI, SDK — and it survives a restart, instead of living in whichever
 * client happens to be attached.
 */
export type PermissionMode = "ask" | "auto" | "full"

/** A ruleset this selector never wrote, such as one from config or another client. */
export type PermissionSelection = PermissionMode | "custom"

export const MODES: readonly PermissionMode[] = ["ask", "auto", "full"]

/**
 * `ask` is already the fallback when nothing matches, so this rule changes no behaviour: it records that the user
 * chose the mode. An untouched session keeps `[]`, which leaves the client-side auto-approve setting in charge.
 */
const ASK: PermissionRuleset = [{ action: "*", resource: "*", effect: "ask" }]

/**
 * What "Auto approve" still asks about: writing files, running commands, touching anything outside the project, and
 * reaching the network. `edit` is the shared action behind edit, write and patch; env files stay questions because
 * they hold credentials rather than because they are files.
 */
const RISKY_ACTIONS = ["edit", "shell", "external_directory", "webfetch", "websearch"]

const RISKY_READS = ["*.env*"]

export function ruleset(mode: PermissionMode): PermissionRuleset {
  if (mode === "ask") return [...ASK]
  const allow: PermissionRule = { action: "*", resource: "*", effect: "allow" }
  if (mode === "full") return [allow]

  // Permission.evaluate takes the last matching rule, so the exceptions have to follow the blanket allow.
  return [
    allow,
    ...RISKY_ACTIONS.map((action): PermissionRule => ({ action, resource: "*", effect: "ask" })),
    ...RISKY_READS.map((resource): PermissionRule => ({ action: "read", resource, effect: "ask" })),
  ]
}

/** The mode a session's rules currently mean. An empty ruleset reads as the agent's own policy, which asks. */
export function modeOf(permissions: PermissionRuleset | undefined): PermissionSelection {
  const written = permissions ?? []
  if (written.length === 0) return "ask"
  return MODES.find((mode) => same(ruleset(mode), written)) ?? "custom"
}

/**
 * Whether the session explicitly opted out of prompts being answered for it. Only this case overrides the
 * auto-approve setting; a session nobody has configured keeps behaving as that setting says.
 */
export function declinesAutoApproval(permissions: PermissionRuleset | undefined) {
  return same(ASK, permissions ?? [])
}

const same = (left: PermissionRuleset, right: PermissionRuleset) =>
  left.length === right.length && left.every((rule, index) => JSON.stringify(rule) === JSON.stringify(right[index]))
