export * as SkillInstructions from "./instructions.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Schema } from "effect"
import { Permission } from "../permission.js"
import { Skill } from "../skill.js"
import { Instructions } from "../instructions/index.js"

const Summary = Schema.Struct({
  id: Skill.ID,
  name: Skill.Name,
  description: Schema.String,
})
type Summary = typeof Summary.Type

/** The disclosure travels as plain paths; the wire form is the same shape the state reports. */
const Conflict = Schema.Struct({
  id: Skill.ID,
  kept: Schema.String,
  shadowed: Schema.Array(Schema.String),
})
type Conflict = typeof Conflict.Type

/**
 * The listing is ambient context on every request, so one verbose skill cannot spend the whole
 * budget. A truncated description says so rather than passing as the complete sentence.
 */
const MAX_DESCRIPTION_CHARS = 400
const describe = (description: string) =>
  description.length <= MAX_DESCRIPTION_CHARS
    ? description
    : `${description.slice(0, MAX_DESCRIPTION_CHARS - 1).trimEnd()}… (description truncated)`

const entries = (skills: ReadonlyArray<Summary>) =>
  skills.flatMap((skill) => [
    "  <skill>",
    `    <id>${skill.id}</id>`,
    `    <name>${skill.name}</name>`,
    `    <description>${skill.description}</description>`,
    "  </skill>",
  ])

const render = (skills: ReadonlyArray<Summary>) =>
  [
    "Skills provide specialized instructions and workflows for specific tasks.",
    "Use the skill tool to load a skill when a task matches its description.",
    "The user may also invoke a skill directly. When that happens, its instructions appear in the conversation as a <skill_content> block, the same shape the skill tool returns. A skill that is already present this way does not need to be invoked again.",
    ...(skills.length === 0
      ? ["No skills are currently available."]
      : ["<available_skills>", ...entries(skills), "</available_skills>"]),
  ].join("\n")

const update = Instructions.listUpdate<Summary>({
  key: (skill) => skill.id,
  changed: (before, after) => before.name !== after.name || before.description !== after.description,
  entries,
  render,
  text: {
    replaced: "The available skills have changed. This list supersedes the previous available skills list.",
    added: "New skills are available in addition to those previously listed:",
    changed: "The following skills have changed. Each entry replaces the previously listed skill with the same ID:",
    removed: (ids) => `The following skill IDs are no longer available and must not be used: ${ids}.`,
  },
})

const renderConflicts = (conflicts: ReadonlyArray<Conflict>) =>
  [
    "Skill conflicts (visible, not auto-resolved):",
    "Each ID below is defined in more than one location. The first path is the one in effect; the shadowed paths are not loaded.",
    ...conflicts.map((conflict) => `- id "${conflict.id}": ${conflict.kept} shadows ${conflict.shadowed.join(", ")}`),
  ].join("\n")

const updateConflicts = (_previous: ReadonlyArray<Conflict>, current: ReadonlyArray<Conflict>) =>
  ["The reported skill conflicts have changed. This list supersedes the previous one:", renderConflicts(current)].join(
    "\n",
  )

export interface Interface {
  /** Lists skills the given ruleset does not deny, plus the skill-conflict disclosure source. */
  readonly load: (permissions: Permission.Ruleset) => Effect.Effect<Instructions.List>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SkillInstructions") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const skills = yield* Skill.Service

    return Service.of({
      load: Effect.fn("SkillInstructions.load")(function* (permissions) {
        const available = Skill.available(yield* skills.list(), permissions)
          .flatMap((skill) =>
            skill.description === undefined || skill.autoinvoke === false
              ? []
              : [{ id: skill.id, name: skill.name, description: describe(skill.description) }],
          )
          .toSorted((a, b) => a.id.localeCompare(b.id))
        // Sorted by id so identical conflicts render identical bytes, which is what keeps the prompt prefix stable.
        const conflicts = (yield* skills.conflicts()).toSorted((a, b) => a.id.localeCompare(b.id))
        return Instructions.combine([
          Instructions.make<ReadonlyArray<Summary>>({
            key: Instructions.Key.make("core/skill-guidance"),
            scope: "global",
            codec: Schema.toCodecJson(Schema.Array(Summary)),
            read: Effect.succeed(available.length === 0 ? Instructions.removed : available),
            render: {
              initial: render,
              changed: update,
              removed: () => "Skill guidance is no longer available. Do not use any previously listed skill.",
            },
          }),
          Instructions.make<ReadonlyArray<Conflict>>({
            key: Instructions.Key.make("core/skill-conflicts"),
            scope: "global",
            codec: Schema.toCodecJson(Schema.Array(Conflict)),
            read: Effect.succeed(conflicts.length === 0 ? Instructions.removed : conflicts),
            render: {
              initial: renderConflicts,
              changed: updateConflicts,
              removed: () => "The previously reported skill conflicts no longer apply.",
            },
          }),
        ])
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Skill.node] })
