import type { SkillApi } from "@opencode/client/effect/api"
import { Skill } from "@opencode/schema/skill"
import type { Effect, Types } from "effect"
import type { Transform } from "./registration.js"

export interface SkillEditor {
  list(): readonly Types.DeepMutable<Skill.Info>[]
  get(id: string): Types.DeepMutable<Skill.Info> | undefined
  /** `shadowed` names skill paths this skill displaced across sources, for the conflict disclosure. */
  add(skill: Skill.Info, shadowed?: readonly string[]): void
  update(id: string, update: (skill: Types.DeepMutable<Skill.Info>) => void): void
  remove(id: string): void
}

export interface SkillDomain extends SkillApi<unknown> {
  readonly transform: Transform<SkillEditor>
  readonly reload: () => Effect.Effect<void>
}
