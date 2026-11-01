import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { AbsolutePath } from "@opencode/core/schema"
import { Skill } from "@opencode/core/skill"
import { SkillInstructions } from "@opencode/core/skill/instructions"
import { it } from "../lib/effect"
import { readInitial, readUpdate } from "../lib/instructions"

const skill = (id: string, path: string) =>
  Skill.Info.make({
    id: Skill.ID.make(id),
    name: Skill.Name.make(id),
    description: `${id} guidance`,
    path: AbsolutePath.make(path),
    content: `# ${id}`,
  })

const repo = "/repo/.opencode/skills/review/SKILL.md"
const home = "/home/user/.config/opencode/skills/review/SKILL.md"

const conflict = (id: string, kept: string, ...shadowed: string[]): Skill.Conflict => ({
  id: Skill.ID.make(id),
  kept: AbsolutePath.make(kept),
  shadowed: shadowed.map((path) => AbsolutePath.make(path)),
})

const layer = (skills: () => Skill.Info[], conflicts: () => Skill.Conflict[]) =>
  AppNodeBuilder.build(SkillInstructions.node, [
    Skill.node.replace(
      Layer.mock(Skill.Service, {
        list: () => Effect.succeed(skills()),
        conflicts: () => Effect.succeed(conflicts()),
      }),
    ),
  ])

const state = AppNodeBuilder.build(LayerNode.group([Skill.node, Bus.node]))

describe("SkillInstructions conflict disclosure", () => {
  it.effect("discloses shadowed skill locations in a dedicated instruction source", () => {
    const skills = [skill("review", repo)]
    const conflicts = [conflict("review", repo, home)]
    return Effect.gen(function* () {
      const instructions = yield* SkillInstructions.Service
      const initialized = yield* instructions.load([]).pipe(Effect.flatMap(readInitial))
      expect(initialized.text).toContain(
        [
          "Skill conflicts (visible, not auto-resolved):",
          "Each ID below is defined in more than one location. The first path is the one in effect; the shadowed paths are not loaded.",
          `- id "review": ${repo} shadows ${home}`,
        ].join("\n"),
      )
      expect(Object.hasOwn(initialized.values, "core/skill-conflicts")).toBe(true)
    }).pipe(Effect.provide(layer(() => skills, () => conflicts)))
  })

  it.effect("names no conflict when every id loads from one place", () => {
    const skills = [skill("review", repo)]
    return Effect.gen(function* () {
      const instructions = yield* SkillInstructions.Service
      const initialized = yield* instructions.load([]).pipe(Effect.flatMap(readInitial))
      expect(initialized.text).not.toContain("Skill conflicts")
      expect(Object.hasOwn(initialized.values, "core/skill-conflicts")).toBe(false)
    }).pipe(Effect.provide(layer(() => skills, () => [])))
  })

  it.effect("restates the list when a conflict changes and clears it when it resolves", () => {
    const skills = [skill("review", repo)]
    let conflicts = [conflict("review", repo, home)]
    return Effect.gen(function* () {
      const instructions = yield* SkillInstructions.Service
      const initialized = yield* instructions.load([]).pipe(Effect.flatMap(readInitial))

      const project = "/repo/skills/review/SKILL.md"
      conflicts = [conflict("review", repo, home, project)]
      const changed = yield* instructions
        .load([])
        .pipe(Effect.flatMap((context) => readUpdate(context, initialized)))
      expect(changed.text).toBe(
        [
          "The reported skill conflicts have changed. This list supersedes the previous one:",
          "Skill conflicts (visible, not auto-resolved):",
          "Each ID below is defined in more than one location. The first path is the one in effect; the shadowed paths are not loaded.",
          `- id "review": ${repo} shadows ${home}, ${project}`,
        ].join("\n"),
      )

      conflicts = []
      const removed = yield* instructions
        .load([])
        .pipe(Effect.flatMap((context) => readUpdate(context, changed)))
      expect(removed.text).toBe("The previously reported skill conflicts no longer apply.")
    }).pipe(Effect.provide(layer(() => skills, () => conflicts)))
  })
})

describe("Skill conflict state", () => {
  it.effect(
    "records a shadowing overwrite from contributor order, and forgets it when the contributor leaves",
    () =>
      Effect.gen(function* () {
        const skills = yield* Skill.Service
        yield* skills.transform((editor) => editor.add(skill("review", home)))
        const registration = yield* skills.transform((editor) => editor.add(skill("review", repo)))

        expect(yield* skills.conflicts()).toEqual([conflict("review", repo, home)])
        expect((yield* skills.list()).map((item) => item.path)).toEqual([AbsolutePath.make(repo)])

        yield* registration.dispose
        expect(yield* skills.conflicts()).toEqual([])
        expect((yield* skills.list()).map((item) => item.path)).toEqual([AbsolutePath.make(home)])
      }).pipe(Effect.provide(state)),
  )

  it.effect("keeps an explicit shadowing chain and a same-path re-add is not a conflict", () =>
    Effect.gen(function* () {
      const skills = yield* Skill.Service
      const vendored = "/repo/skills/review/SKILL.md"
      yield* skills.transform((editor) => editor.add(skill("review", repo), [AbsolutePath.make(home)]))

      expect(yield* skills.conflicts()).toEqual([conflict("review", repo, home)])

      // A rescan re-adds the winner from its own path; the record must survive untouched.
      yield* skills.reload()
      yield* skills.transform((editor) => editor.add(skill("review", repo), [AbsolutePath.make(home)]))
      expect(yield* skills.conflicts()).toEqual([conflict("review", repo, home)])

      yield* skills.transform((editor) => editor.add(skill("review", vendored)))
      expect(yield* skills.conflicts()).toEqual([conflict("review", vendored, repo, home)])
      expect(yield* skills.list()).toEqual([skill("review", vendored)])
    }).pipe(Effect.provide(state)),
  )
})
