import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "@opencode/core/agent"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { PermissionSaved } from "@opencode/core/permission/saved"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { testEffect } from "./lib/effect"
import { location } from "./fixture/location"

const sessionID = Session.ID.make("ses_escalation")
const current = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionStore.node, PermissionSaved.node, Agent.node, Permission.node]),
    [Location.node.replace(current)],
  ),
)

/** The session's own rules, which is where the composer's Full access mode lands. */
function setup(agent: Permission.Ruleset, session: Permission.Ruleset) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        slug: "test",
        directory: "/project",
        title: "test",
        version: "test",
        agent: Agent.ID.make("test"),
        permission: session,
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* (yield* Agent.Service)
      .transform((editor) =>
        editor.update(Agent.ID.make("test"), (item) => {
          item.permissions = [...agent]
        }),
      )
      .pipe(Effect.orDie)
  })
}

const shell = (risk: Permission.Escalation | undefined, resource = "rm -rf /") =>
  ({
    id: Permission.ID.create(),
    sessionID,
    action: "shell",
    resources: [resource],
    save: ["rm *"],
    ...(risk === undefined ? {} : { risk }),
  }) satisfies Permission.AssertInput

const BROAD_ALLOW: Permission.Ruleset = [{ action: "shell", resource: "*", effect: "allow" }]
const FULL_ACCESS: Permission.Ruleset = [{ action: "*", resource: "*", effect: "allow" }]

describe("Permission escalation", () => {
  // The shape this replaced: one broad allow rule silenced every command, including `rm -rf /`.
  it.effect("a broad allow rule cannot clear a dangerous command", () =>
    Effect.gen(function* () {
      yield* setup(BROAD_ALLOW, [])
      const service = yield* Permission.Service

      expect(yield* service.ask(shell(undefined))).toMatchObject({ effect: "allow" })
      expect(yield* service.ask(shell("dangerous"))).toMatchObject({ effect: "ask" })
      expect(yield* service.ask(shell("unanalyzable", 'rm -rf "$X"'))).toMatchObject({ effect: "ask" })
    }),
  )

  it.effect("a deny still wins over an escalation", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "shell", resource: "*", effect: "deny" }], [])
      const service = yield* Permission.Service

      expect(yield* service.ask(shell("dangerous"))).toMatchObject({ effect: "deny" })
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("only a session that allowed everything outright opts out", () =>
    Effect.gen(function* () {
      yield* setup(BROAD_ALLOW, FULL_ACCESS)
      const service = yield* Permission.Service

      expect(yield* service.ask(shell("dangerous"))).toMatchObject({ effect: "allow" })
    }),
  )

  it.effect("an agent's own allow-all is not an opt-out", () =>
    Effect.gen(function* () {
      // The default build agent carries `*/* allow`, so reading the merged set would silence this everywhere.
      yield* setup(FULL_ACCESS, [])
      const service = yield* Permission.Service

      expect(yield* service.ask(shell("dangerous"))).toMatchObject({ effect: "ask" })
    }),
  )

  it.effect("an unrelated session rule does not opt out", () =>
    Effect.gen(function* () {
      yield* setup(BROAD_ALLOW, [{ action: "read", resource: "*", effect: "allow" }])
      const service = yield* Permission.Service

      expect(yield* service.ask(shell("dangerous"))).toMatchObject({ effect: "ask" })
    }),
  )

  // A remembered decision must not become a standing one for the destructive shape it matched.
  it.effect("an always-allow cannot clear the escalation", () =>
    Effect.gen(function* () {
      yield* setup([], [])
      const service = yield* Permission.Service
      const request = shell("dangerous")

      expect(yield* service.ask(request)).toMatchObject({ effect: "ask" })
      // The request itself offers nothing to remember, so an "always" answer persists no rule.
      expect((yield* service.get(request.id))?.save).toEqual([])

      yield* (yield* PermissionSaved.Service).add({
        projectID: Project.ID.global,
        action: "shell",
        resources: [request.resources[0]!],
      })
      expect(yield* service.ask(shell("dangerous"))).toMatchObject({ effect: "ask" })
      // The same saved rule does govern an ordinary request, so remembering decisions still works where it is safe.
      expect(yield* service.ask(shell(undefined))).toMatchObject({ effect: "allow" })
    }),
  )

  it.effect("an unescalated request keeps its save list", () =>
    Effect.gen(function* () {
      yield* setup([], [])
      const service = yield* Permission.Service
      const request = shell(undefined, "rm -rf /var")

      expect(yield* service.ask(request)).toMatchObject({ effect: "ask" })
      expect((yield* service.get(request.id))?.save).toEqual(["rm *"])
    }),
  )
})
