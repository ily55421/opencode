export * as Skill from "./skill.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import path from "path"
import { Context, Effect, Layer, Types } from "effect"
import { Skill } from "@opencode/schema/skill"
import { Bus } from "./bus.js"
import { Permission } from "./permission.js"
import { AbsolutePath } from "./schema.js"
import { State } from "./state.js"

export const DirectorySource = Skill.DirectorySource
export type DirectorySource = Skill.DirectorySource

export const UrlSource = Skill.UrlSource
export type UrlSource = Skill.UrlSource

export const EmbeddedSource = Skill.EmbeddedSource
export type EmbeddedSource = Skill.EmbeddedSource

export const Source = Skill.Source
export type Source = Skill.Source

export const Info = Skill.Info
export type Info = Skill.Info
export const ID = Skill.ID
export type ID = Skill.ID
export const Name = Skill.Name
export type Name = Skill.Name

export { Event } from "@opencode/schema/skill"

export const available = (skills: ReadonlyArray<Info>, permissions: Permission.Ruleset) =>
  skills.filter((skill) => Permission.evaluate("skill", skill.id, permissions).effect !== "deny")

export const uri = (id: string, file?: string) => (file ? `skill://${id}/${file}` : `skill://${id}`)

export const isUri = (value: string) => value.startsWith("skill://")

export const toModelOutput = (skill: Info, files: ReadonlyArray<string>) => {
  const directory = isUri(skill.path) ? uri(skill.id) : path.dirname(skill.path)
  return [
    `<skill_content name="${skill.name}">`,
    `# Skill: ${skill.name}`,
    "",
    skill.content.trim(),
    "",
    `Base directory for this skill: ${directory}`,
    "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
    "Note: file list is sampled.",
    "",
    "<skill_files>",
    ...files.map((file) => `<file>${file}</file>`),
    "</skill_files>",
    "</skill_content>",
  ].join("\n")
}

export const prepare = Effect.fn("Skill.prepare")(function* (
  fs: FSUtil.Interface,
  skill: Info,
  virtualFiles?: ReadonlyMap<string, string>,
) {
  if (isUri(skill.path)) {
    const directory = uri(skill.id)
    const files = Array.from(virtualFiles?.keys() ?? [])
      .filter((file) => file !== "SKILL.md")
      .toSorted()
      .slice(0, 10)
      .map((file) => uri(skill.id, file))
    return {
      directory,
      output: toModelOutput(skill, files),
    }
  }
  const directory = path.dirname(skill.path)
  const files =
    path.basename(skill.path) === "SKILL.md"
      ? (yield* fs.scan("**/*", {
          cwd: directory,
          absolute: true,
          include: "file",
          dot: true,
          ignore: FSUtil.ignoreGlobs,
        }))
          .filter((file) => path.basename(file) !== "SKILL.md")
          .toSorted()
          .slice(0, 10)
      : []
  return {
    directory,
    output: toModelOutput(skill, files),
  }
})

/**
 * One skill ID defined in more than one place: `kept` is the path that loaded, the
 * `shadowed` paths exist but were not loaded. Precedence is unchanged — this exists
 * so the model and the user can see which file actually provides a listed skill.
 */
export type Conflict = {
  readonly id: ID
  readonly kept: AbsolutePath
  readonly shadowed: ReadonlyArray<AbsolutePath>
}

export type Data = {
  skills: Map<ID, Types.DeepMutable<Info>>
  files: Map<ID, ReadonlyMap<string, string>>
  conflicts: Map<ID, Conflict>
}

export type Editor = {
  list: () => readonly Types.DeepMutable<Info>[]
  get: (id: string) => Types.DeepMutable<Info> | undefined
  /** `shadowed` names paths this skill displaced across sources; `files` carries the skill's extra files. */
  add: (skill: Info, shadowed?: ReadonlyArray<AbsolutePath>, files?: Readonly<Record<string, string>>) => void
  update: (id: string, update: (skill: Types.DeepMutable<Info>) => void) => void
  remove: (id: string) => void
}

export interface Interface extends State.Transformable<Editor> {
  readonly get: (id: ID) => Effect.Effect<Info | undefined>
  readonly files: (id: ID) => Effect.Effect<ReadonlyMap<string, string> | undefined>
  readonly list: () => Effect.Effect<Info[]>
  readonly conflicts: () => Effect.Effect<Conflict[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Skill") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service

    const state = State.create<Data, Editor>({
      name: "skill",
      initial: () => ({ skills: new Map(), files: new Map(), conflicts: new Map() }),
      editor: (editor) => ({
        list: () => Array.from(editor.skills.values()),
        get: (id) => editor.skills.get(ID.make(id)),
        add: (skill, shadowed, files) => {
          const previous = editor.skills.get(skill.id)
          // A rebuild replays every transform from empty, so a shadowing overwrite can be recorded
          // directly: nothing stale survives into the next rebuild. The incoming skill wins, and the
          // paths it displaced sit in front of the deeper chain the earlier winner displaced, so the
          // direct predecessor reads first.
          const paths = new Set(shadowed)
          if (previous !== undefined && previous.path !== skill.path) paths.add(previous.path)
          paths.delete(skill.path)
          if (paths.size > 0) {
            const deeper = (editor.conflicts.get(skill.id)?.shadowed ?? []).filter(
              (path) => !paths.has(path) && path !== skill.path,
            )
            editor.conflicts.set(skill.id, { id: skill.id, kept: skill.path, shadowed: [...paths, ...deeper] })
          }
          editor.skills.set(skill.id, { ...skill })
          const entries = files
            ? Object.entries(files)
                .filter(([file]) => file !== "SKILL.md")
                .toSorted(([a], [b]) => a.localeCompare(b))
            : []
          if (entries.length === 0) {
            editor.files.delete(skill.id)
            return
          }
          editor.files.set(skill.id, new Map(entries))
        },
        update: (id, update) => {
          const key = ID.make(id)
          const current = editor.skills.get(key)
          if (!current) return
          update(current)
          current.id = key
        },
        remove: (id) => {
          const key = ID.make(id)
          editor.skills.delete(key)
          editor.files.delete(key)
        },
      }),
      notify: State.changes(
        (data) => [
          Array.from(data.skills.values()),
          Array.from(data.files, ([id, entries]) => [id, Array.from(entries)]),
        ],
        () => bus.publish(Skill.Event.Updated, {}).pipe(Effect.asVoid),
      ),
    })

    return Service.of({
      transform: state.transform,
      reload: state.reload,
      get: Effect.fn("Skill.get")(function* (id) {
        return state.get().skills.get(id)
      }),
      files: Effect.fn("Skill.files")(function* (id) {
        const current = state.get()
        return current.skills.has(id) ? current.files.get(id) : undefined
      }),
      list: Effect.fn("Skill.list")(function* () {
        return Array.from(state.get().skills.values())
      }),
      conflicts: Effect.fn("Skill.conflicts")(function* () {
        return Array.from(state.get().conflicts.values())
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Bus.node],
})
