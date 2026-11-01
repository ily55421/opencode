export * as ConfigNormalize from "./normalize.js"

import { isDeepStrictEqual } from "node:util"
import { isRecord } from "@opencode/util/record"
import { Option, Schema } from "effect"
import { Info } from "@opencode/schema/config"
import { ConfigAgent } from "@opencode/schema/config/agent"
import { ConfigCommand } from "@opencode/schema/config/command"
import { ConfigCompaction } from "@opencode/schema/config/compaction"
import { ConfigFormatter } from "@opencode/schema/config/formatter"
import { ConfigLSP } from "@opencode/schema/config/lsp"
import { ConfigMedia } from "@opencode/schema/config/media"
import { ConfigModel } from "@opencode/schema/config/model"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { ConfigPlugin } from "@opencode/schema/config/plugin"
import { ConfigPolicy } from "@opencode/schema/config/policy"
import { ConfigProvider } from "@opencode/schema/config/provider"
import { ConfigReference } from "@opencode/schema/config/reference"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { Permission } from "@opencode/schema/permission"
import { ConfigAgentV1 } from "../v1/config/agent.js"
import { ConfigCommandV1 } from "../v1/config/command.js"
import { ConfigMCPV1 } from "../v1/config/mcp.js"
import { ConfigPermissionV1 } from "../v1/config/permission.js"
import { ConfigPluginV1 } from "../v1/config/plugin.js"
import { ConfigProviderV1 } from "../v1/config/provider.js"
import { ConfigMigrateV1 } from "../v1/config/migrate.js"
import { PositiveInt } from "../schema.js"

export interface Diagnostic {
  readonly kind: "conflict" | "invalid" | "unsupported"
  readonly path: readonly string[]
  readonly message: string
}

export type Result =
  | {
      readonly type: "normalized"
      readonly encoded: Readonly<Record<string, unknown>>
      readonly diagnostics: readonly Diagnostic[]
    }
  | { readonly type: "rejected"; readonly diagnostics: readonly Diagnostic[] }

const options = { errors: "all", onExcessProperty: "ignore" } as const
const unsupportedTopLevel = ["logLevel", "server", "subagent_depth", "layout"] as const
const unsupportedExperimental = [
  "disable_paste_summary",
  "batch_tool",
  "openTelemetry",
  "primary_tools",
  "continue_loop_on_deny",
] as const
const unsupportedProvider = ["id", "whitelist", "blacklist"] as const
const unsupportedModel = ["release_date", "attachment", "reasoning", "temperature", "experimental"] as const
const LegacyAutoupdate = Schema.Literals([true, false, "notify"])

export function normalize(input: unknown): Result {
  if (!isRecord(input))
    return {
      type: "rejected",
      diagnostics: [
        { kind: "invalid", path: ["$"], message: "rejected configuration because its root is not an object" },
      ],
    }

  const diagnostics: Diagnostic[] = []
  const encoded: Record<string, unknown> = {}
  unsupportedTopLevel.forEach((key) => unsupportedIfPresent(input, key, [key], diagnostics))

  const legacySnapshots = own(input, "snapshot")
    ? decodeEncoded(Schema.Boolean, input.snapshot, ["snapshot"], diagnostics)
    : undefined
  const legacyUpdate = own(input, "autoupdate")
    ? decodeValue(LegacyAutoupdate, input.autoupdate, ["autoupdate"], diagnostics)
    : undefined
  const nativeUpdate = own(input, "update")
    ? decodeEncoded(Info.fields.update, input.update, ["update"], diagnostics)
    : undefined
  const legacyShare = own(input, "autoshare")
    ? decodeValue(Schema.Boolean, input.autoshare, ["autoshare"], diagnostics) === true
      ? "auto"
      : undefined
    : undefined
  const legacyMedia = own(input, "attachment")
    ? decodeEncoded(ConfigMedia.Info, input.attachment, ["attachment"], diagnostics)
    : undefined
  if (legacyMedia !== undefined) encoded.media = legacyMedia
  if (legacySnapshots !== undefined) encoded.snapshots = legacySnapshots
  const migratedUpdate =
    legacyUpdate === false
      ? "disable"
      : legacyUpdate === "notify"
        ? "notify"
        : legacyUpdate === true
          ? "auto"
          : undefined
  const update = prefer(migratedUpdate, nativeUpdate, ["update"], diagnostics)
  if (update !== undefined) encoded.update = update
  if (legacyShare !== undefined) encoded.share = legacyShare

  const legacyReferences = decodeMap(input.reference, ConfigReference.Entry, ["reference"], diagnostics, decodeEncoded)
  const nativeReferences = decodeMap(
    input.references,
    ConfigReference.Entry,
    ["references"],
    diagnostics,
    decodeEncoded,
  )
  mergeMap(
    encoded,
    "references",
    legacyReferences,
    nativeReferences,
    isRecord(input.reference) || isRecord(input.references),
    diagnostics,
  )

  const legacyCommands = decodeMap(input.command, ConfigCommandV1.Info, ["command"], diagnostics, decodeValue)
  diagnoseSelectionMap(input.command, ["command"], diagnostics)
  const migratedCommands = mapValues(legacyCommands, (value) =>
    canonical(ConfigCommand.Info, ConfigMigrateV1.migrateCommand(value)),
  )
  const nativeCommands = decodeMap(input.commands, ConfigCommand.Info, ["commands"], diagnostics, decodeEncoded)
  mergeMap(
    encoded,
    "commands",
    migratedCommands,
    nativeCommands,
    isRecord(input.command) || isRecord(input.commands),
    diagnostics,
  )

  const legacyAgents = mapValues(
    decodeMap(input.agent, ConfigAgentV1.Info, ["agent"], diagnostics, decodeValue),
    (value) => canonical(ConfigAgent.Info, ConfigMigrateV1.migrateAgent(value)),
  )
  const legacySmallModel = own(input, "small_model")
    ? decodeValue(Schema.String, input.small_model, ["small_model"], diagnostics)
    : undefined
  const migratedSmallModel = ConfigMigrateV1.modelSelection(legacySmallModel)
  if (legacySmallModel && !migratedSmallModel)
    diagnostics.push({
      kind: "unsupported",
      path: ["small_model"],
      message: "omitted unsupported legacy model reference",
    })
  if (migratedSmallModel)
    legacyAgents.title = {
      model: migratedSmallModel,
      ...legacyAgents.title,
    }
  const modeAgents = mapValues(decodeMap(input.mode, ConfigAgentV1.Info, ["mode"], diagnostics, decodeValue), (value) =>
    canonical(ConfigAgent.Info, ConfigMigrateV1.migrateAgent({ ...value, mode: "primary" })),
  )
  const migratedAgents = mergeMaps(legacyAgents, modeAgents, ["agents"], diagnostics)
  const nativeAgents = decodeMap(input.agents, ConfigAgent.Info, ["agents"], diagnostics, decodeEncoded)
  diagnoseAgentUnsupported(input.agent, ["agent"], diagnostics)
  diagnoseAgentUnsupported(input.mode, ["mode"], diagnostics)
  mergeMap(
    encoded,
    "agents",
    migratedAgents,
    nativeAgents,
    migratedSmallModel !== undefined || isRecord(input.agent) || isRecord(input.mode) || isRecord(input.agents),
    diagnostics,
  )

  const legacyProviders = migrateProviders(input.provider, diagnostics)
  const nativeProviders = decodeMap(input.providers, ConfigProvider.Info, ["providers"], diagnostics, decodeEncoded)
  mergeMap(
    encoded,
    "providers",
    legacyProviders,
    nativeProviders,
    isRecord(input.provider) || isRecord(input.providers),
    diagnostics,
  )

  const toolRules = migrateTools(input.tools, diagnostics)
  const permissionRules = migratePermissions(input.permission, diagnostics)
  const nativePermissions = decodeList(input.permissions, Permission.Rule, ["permissions"], diagnostics, decodeEncoded)
  const permissions = [...toolRules, ...permissionRules, ...nativePermissions]
  if (permissions.length || Array.isArray(input.permissions)) encoded.permissions = permissions

  const legacyPlugins = decodeList(input.plugin, ConfigPluginV1.Spec, ["plugin"], diagnostics, decodeValue).map(
    (plugin) => (typeof plugin === "string" ? plugin : { package: plugin[0], options: plugin[1] }),
  )
  const nativePlugins = decodeList(input.plugins, ConfigPlugin.Plugin, ["plugins"], diagnostics, decodeEncoded)
  if (legacyPlugins.length || nativePlugins.length || Array.isArray(input.plugin) || Array.isArray(input.plugins))
    encoded.plugins = [...legacyPlugins, ...nativePlugins]

  normalizeSkills(input, encoded, diagnostics)
  normalizeMcp(input, encoded, diagnostics)
  normalizeCompaction(input, encoded, diagnostics)
  normalizePolicies(input, encoded, diagnostics)
  normalizeExperimental(input, encoded, diagnostics)
  normalizeWatcher(input, encoded, diagnostics)
  normalizeFormatter(input, encoded, diagnostics)
  normalizeLsp(input, encoded, diagnostics)

  const model = own(input, "model")
    ? decodeValue(ConfigModel.Selection, input.model, ["model"], diagnostics)
    : undefined
  if (model) encoded.model = { ...model, providerID: ConfigMigrateV1.providerID(model.providerID) }

  const nativeAtomic = {
    $schema: Info.fields.$schema,
    shell: Info.fields.shell,
    default_agent: Info.fields.default_agent,
    share: Info.fields.share,
    enterprise: Info.fields.enterprise,
    username: Info.fields.username,
    timezone: Info.fields.timezone,
    snapshots: Info.fields.snapshots,
    media: Info.fields.media,
    tool_output: Info.fields.tool_output,
    websearch: Info.fields.websearch,
    worktree: Info.fields.worktree,
    warming: Info.fields.warming,
  }
  Object.entries(nativeAtomic).forEach(([key, schema]) => {
    if (!own(input, key)) return
    const value = decodeEncoded(schema, input[key], [key], diagnostics)
    if (value === undefined) return
    overlay(encoded, key, value, [key], diagnostics)
  })

  const instructions = decodeList(input.instructions, Schema.String, ["instructions"], diagnostics, decodeEncoded)
  if (instructions.length || Array.isArray(input.instructions)) encoded.instructions = instructions

  return { type: "normalized", encoded, diagnostics }
}

function normalizeSkills(input: Record<string, unknown>, encoded: Record<string, unknown>, diagnostics: Diagnostic[]) {
  if (!own(input, "skills")) return
  if (Array.isArray(input.skills)) {
    encoded.skills = decodeList(input.skills, Schema.String, ["skills"], diagnostics, decodeEncoded)
    return
  }
  if (!isRecord(input.skills)) {
    invalid(["skills"], diagnostics)
    return
  }
  encoded.skills = [
    ...decodeList(input.skills.paths, Schema.String, ["skills", "paths"], diagnostics, decodeEncoded),
    ...decodeList(input.skills.urls, Schema.String, ["skills", "urls"], diagnostics, decodeEncoded),
  ]
}

function normalizeMcp(input: Record<string, unknown>, encoded: Record<string, unknown>, diagnostics: Diagnostic[]) {
  const legacyServers: Record<string, unknown> = {}
  const nativeServers: Record<string, unknown> = {}
  const timeout: Record<string, unknown> = {}
  if (isRecord(input.experimental) && own(input.experimental, "mcp_timeout")) {
    const value = decodeEncoded(
      PositiveInt,
      input.experimental.mcp_timeout,
      ["experimental", "mcp_timeout"],
      diagnostics,
    )
    // V1 never applied this to connecting, unlike a per-server timeout.
    if (value !== undefined) {
      timeout.catalog = value
      timeout.execution = value
    }
  }
  if (own(input, "mcp")) {
    if (!isRecord(input.mcp)) invalid(["mcp"], diagnostics)
    if (isRecord(input.mcp)) {
      Object.entries(input.mcp).forEach(([name, value]) => {
        const path = ["mcp", name]
        if (isEnabledOnlyMcp(value)) {
          diagnostics.push({ kind: "unsupported", path, message: "omitted enabled-only legacy MCP entry" })
          return
        }
        if (name === "servers" && !isDirectLegacyMcp(value)) {
          Object.entries(
            decodeMap(expandServerTimeouts(value), ConfigMCP.Server, path, diagnostics, decodeEncoded),
          ).forEach(([key, server]) => setOwn(nativeServers, key, server))
          return
        }
        if (name === "timeout" && !isDirectLegacyMcp(value)) {
          normalizeMcpTimeout(
            typeof value === "number" ? ConfigMigrateV1.migrateMcpTimeout(value) : value,
            timeout,
            path,
            diagnostics,
          )
          return
        }
        const server = decodeValue(ConfigMCPV1.Info, value, path, diagnostics)
        if (server !== undefined)
          setOwn(legacyServers, name, canonical(ConfigMCP.Server, ConfigMigrateV1.migrateMcp(server)))
      })
    }
  }
  const servers = mergeMaps(legacyServers, nativeServers, ["mcp", "servers"], diagnostics)
  if (!Object.keys(servers).length && !Object.keys(timeout).length) {
    if (isRecord(input.mcp) && !Object.keys(input.mcp).length) encoded.mcp = {}
    return
  }
  encoded.mcp = {
    ...(Object.keys(timeout).length ? { timeout } : {}),
    ...(Object.keys(servers).length ? { servers } : {}),
  }
}

// Native servers accept the V1 bare-number timeout so one V1-shaped field does not drop the whole server.
function expandServerTimeouts(value: unknown) {
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([name, server]) => [
      name,
      isRecord(server) && typeof server.timeout === "number"
        ? { ...server, timeout: ConfigMigrateV1.migrateMcpTimeout(server.timeout) }
        : server,
    ]),
  )
}

function normalizeMcpTimeout(
  value: unknown,
  timeout: Record<string, unknown>,
  path: string[],
  diagnostics: Diagnostic[],
) {
  if (!isRecord(value)) {
    invalid(path, diagnostics)
    return
  }
  const recognized = Object.entries(ConfigMCP.Timeout.fields).filter(([key]) => own(value, key))
  if (Object.keys(value).length && !recognized.length) {
    invalid(path, diagnostics)
    return
  }
  recognized.forEach(([key, field]) => {
    const leaf = decodeEncoded(field, value[key], [...path, key], diagnostics)
    if (leaf === undefined) return
    overlay(timeout, key, leaf, [...path, key], diagnostics)
  })
}

function normalizeCompaction(
  input: Record<string, unknown>,
  encoded: Record<string, unknown>,
  diagnostics: Diagnostic[],
) {
  if (!own(input, "compaction")) return
  if (!isRecord(input.compaction)) {
    invalid(["compaction"], diagnostics)
    return
  }
  unsupportedIfPresent(input.compaction, "tail_turns", ["compaction", "tail_turns"], diagnostics)
  unsupportedIfPresent(input.compaction, "prune", ["compaction", "prune"], diagnostics)
  const result: Record<string, unknown> = {}
  if (own(input.compaction, "auto")) {
    const value = decodeEncoded(
      ConfigCompaction.Info.fields.auto,
      input.compaction.auto,
      ["compaction", "auto"],
      diagnostics,
    )
    if (value !== undefined) result.auto = value
  }
  const legacyTokens = own(input.compaction, "preserve_recent_tokens")
    ? decodeEncoded(
        ConfigCompaction.Keep.fields.tokens,
        input.compaction.preserve_recent_tokens,
        ["compaction", "preserve_recent_tokens"],
        diagnostics,
      )
    : undefined
  const nativeKeep = isRecord(input.compaction.keep) ? input.compaction.keep : undefined
  if (own(input.compaction, "keep") && !nativeKeep) invalid(["compaction", "keep"], diagnostics)
  const nativeTokens =
    nativeKeep && own(nativeKeep, "tokens")
      ? decodeEncoded(
          ConfigCompaction.Keep.fields.tokens,
          nativeKeep.tokens,
          ["compaction", "keep", "tokens"],
          diagnostics,
        )
      : undefined
  const tokens = prefer(legacyTokens, nativeTokens, ["compaction", "keep", "tokens"], diagnostics)
  if (tokens !== undefined) result.keep = { tokens }
  const legacyBuffer = own(input.compaction, "reserved")
    ? decodeEncoded(
        ConfigCompaction.Info.fields.buffer,
        input.compaction.reserved,
        ["compaction", "reserved"],
        diagnostics,
      )
    : undefined
  const nativeBuffer = own(input.compaction, "buffer")
    ? decodeEncoded(ConfigCompaction.Info.fields.buffer, input.compaction.buffer, ["compaction", "buffer"], diagnostics)
    : undefined
  const buffer = prefer(legacyBuffer, nativeBuffer, ["compaction", "buffer"], diagnostics)
  if (buffer !== undefined) result.buffer = buffer
  if (Object.keys(result).length || !Object.keys(input.compaction).length) encoded.compaction = result
}

// V1 provider lists and `experimental.policies` stay supported and merge into
// top-level `policies`; within a document, later sources win ties.
function normalizePolicies(
  input: Record<string, unknown>,
  encoded: Record<string, unknown>,
  diagnostics: Diagnostic[],
) {
  const generated: unknown[] = []
  const enabled = decodeProviderList(input, "enabled_providers", diagnostics)
  if (enabled.present && (!enabled.nonEmpty || enabled.values.length)) {
    generated.push({ action: "provider.use", resource: "*", effect: "deny" })
    generated.push(
      ...enabled.values.map((resource) => ({
        action: "provider.use",
        resource: ConfigMigrateV1.providerID(resource),
        effect: "allow",
      })),
    )
  }
  const disabled = decodeProviderList(input, "disabled_providers", diagnostics)
  generated.push(
    ...disabled.values.map((resource) => ({
      action: "provider.use",
      resource: ConfigMigrateV1.providerID(resource),
      effect: "deny",
    })),
  )
  const experimental = isRecord(input.experimental)
    ? decodeList(
        input.experimental.policies,
        ConfigPolicy.Info,
        ["experimental", "policies"],
        diagnostics,
        decodeEncoded,
      )
    : []
  const native = decodeList(input.policies, ConfigPolicy.Info, ["policies"], diagnostics, decodeEncoded)
  if (
    generated.length ||
    experimental.length ||
    native.length ||
    Array.isArray(input.policies) ||
    (isRecord(input.experimental) && Array.isArray(input.experimental.policies))
  )
    encoded.policies = [...generated, ...experimental, ...native]
}

function normalizeExperimental(
  input: Record<string, unknown>,
  encoded: Record<string, unknown>,
  diagnostics: Diagnostic[],
) {
  const result: Record<string, unknown> = {}
  if (own(input, "experimental")) {
    if (!isRecord(input.experimental)) invalid(["experimental"], diagnostics)
    if (isRecord(input.experimental)) {
      const experimental = input.experimental
      unsupportedExperimental.forEach((key) =>
        unsupportedIfPresent(experimental, key, ["experimental", key], diagnostics),
      )
      // `policies` merges into top-level `policies` in normalizePolicies.
      Object.entries(ConfigExperimental.Info.fields).forEach(([key, schema]) => {
        if (key === "policies" || !own(experimental, key)) return
        const value = decodeEncoded(schema, experimental[key], ["experimental", key], diagnostics)
        if (value !== undefined) result[key] = value
      })
