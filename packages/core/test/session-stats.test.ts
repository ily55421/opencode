import { describe, expect } from "bun:test"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Money } from "@opencode/schema/money"
import { Project } from "@opencode/schema/project"
import { Provider } from "@opencode/schema/provider"
import { Session } from "@opencode/schema/session"
import { SessionEvent } from "@opencode/schema/session-event"
import { SessionMessage } from "@opencode/schema/session-message"
import { AbsolutePath } from "@opencode/core/schema"
import { Bus } from "@opencode/core/bus"
import { DatabaseBatch } from "@opencode/core/database/batch"
import { Database } from "@opencode/core/database/database"
import { sqliteLayer } from "@opencode/core/database/sqlite.workerd"
import { ProjectTable } from "@opencode/core/project/sql"
import { SessionMessageTable, SessionPartTable, SessionTable } from "@opencode/core/session/sql"
import { SessionHistory } from "@opencode/core/session/history"
import { SessionStats } from "@opencode/core/session/stats"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { DateTime, Effect, Layer, Schema } from "effect"
import { TestClock } from "effect/testing"
import { makeDurableObjectStorage } from "./fixture/durable-object-storage"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]), [
    Bus.node.replace(Bus.configured({ persist: true })),
  ]),
)
const durableIt = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]), [
    Bus.node.replace(Bus.configured({ persist: true })),
    Database.node.replace(
      Database.configuredClient(Layer.suspend(() => sqliteLayer({ storage: makeDurableObjectStorage() }))),
    ),
  ]),
)
const projectID = Project.ID.make("stats-project")
const otherProjectID = Project.ID.make("stats-other-project")
const sessionID = Session.ID.make("ses_stats_root")
const childID = Session.ID.make("ses_stats_child")
const forkID = Session.ID.make("ses_stats_fork")
const usageOnlyID = Session.ID.make("ses_stats_usage_only")
const otherSessionID = Session.ID.make("ses_stats_other")
const encodeMessage = Schema.encodeSync(SessionMessage.Info)

describe("SessionStats", () => {
  it.effect("aggregates activity and tool reliability without reading message payloads outside the range", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      yield* db
        .insert(ProjectTable)
        .values([
          { id: projectID, worktree: AbsolutePath.make("/stats"), name: "stats", sandboxes: [] },
          { id: otherProjectID, worktree: AbsolutePath.make("/other"), name: "other", sandboxes: [] },
        ])
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values([
          { id: sessionID, project_id: projectID, slug: "root", directory: "/stats", version: "test" },
          {
            id: childID,
            project_id: projectID,
            parent_id: sessionID,
            slug: "child",
            directory: "/stats",
            version: "test",
          },
          {
            id: forkID,
            project_id: projectID,
            fork_session_id: sessionID,
            slug: "fork",
            directory: "/stats",
            version: "test",
            time_created: Date.UTC(2026, 0, 4),
          },
          { id: usageOnlyID, project_id: projectID, slug: "usage", directory: "/stats", version: "test" },
          { id: otherSessionID, project_id: otherProjectID, slug: "other", directory: "/other", version: "test" },
        ])
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionMessageTable)
        .values([
          messageRow(
            sessionID,
            1,
            SessionMessage.User.make({
              id: SessionMessage.ID.make("msg_stats_user"),
              type: "user",
              text: "hello",
              time: { created: DateTime.makeUnsafe(Date.UTC(2026, 0, 2, 9)) },
            }),
          ),
          messageRow(
            sessionID,
            2,
            assistant("msg_stats_assistant", Date.UTC(2026, 0, 2, 10), [
              SessionMessage.AssistantTool.make({
                type: "tool",
                id: "call_read",
                name: "read",
                state: SessionMessage.ToolStateCompleted.make({
                  status: "completed",
                  input: {},
                  content: [{ type: "text", text: "ok" }],
                }),
                time: {
                  created: DateTime.makeUnsafe(Date.UTC(2026, 0, 2, 10)),
                  ran: DateTime.makeUnsafe(Date.UTC(2026, 0, 2, 10, 0, 1)),
                  completed: DateTime.makeUnsafe(Date.UTC(2026, 0, 2, 10, 0, 1, 250)),
                },
              }),
              SessionMessage.AssistantTool.make({
                type: "tool",
                id: "call_edit",
                name: "edit",
                state: SessionMessage.ToolStateError.make({
                  status: "error",
                  input: {},
                  error: { type: "tool", message: "failed" },
                }),
                time: {
                  created: DateTime.makeUnsafe(Date.UTC(2026, 0, 2, 10)),
                  completed: DateTime.makeUnsafe(Date.UTC(2026, 0, 2, 10, 0, 2)),
                },
              }),
              SessionMessage.AssistantTool.make({
                type: "tool",
                id: "call_pending",
                name: "pending",
                state: SessionMessage.ToolStateRunning.make({ status: "running", input: {}, metadata: {} }),
                time: { created: DateTime.makeUnsafe(Date.UTC(2026, 0, 2, 10)) },
              }),
            ]),
          ),
          messageRow(childID, 1, assistant("msg_stats_child", Date.UTC(2026, 0, 3, 10), [], "large", 2)),
          messageRow(
            forkID,
            1,
            SessionMessage.User.make({
              id: SessionMessage.ID.make("msg_stats_fork_copied_user"),
              type: "user",
              text: "copied",
              time: { created: DateTime.makeUnsafe(Date.UTC(2026, 0, 2, 9)) },
            }),
          ),
          messageRow(
            forkID,
            2,
            assistant("msg_stats_fork_copied_assistant", Date.UTC(2026, 0, 2, 10), [
              SessionMessage.AssistantTool.make({
                type: "tool",
                id: "call_copied",
                name: "copied",
                state: SessionMessage.ToolStateCompleted.make({
                  status: "completed",
                  input: {},
                  content: [{ type: "text", text: "copied" }],
                }),
                time: {
                  created: DateTime.makeUnsafe(Date.UTC(2026, 0, 2, 10)),
                  completed: DateTime.makeUnsafe(Date.UTC(2026, 0, 2, 10, 0, 1)),
                },
              }),
            ]),
          ),
          messageRow(forkID, 3, assistant("msg_stats_fork_new", Date.UTC(2026, 0, 5, 10), [], "fork-new")),
          messageRow(sessionID, 3, assistant("msg_stats_outside", Date.UTC(2025, 11, 31, 10), [])),
          messageRow(usageOnlyID, 1, assistant("msg_stats_usage_only", Date.UTC(2025, 11, 30, 10), [])),
          messageRow(otherSessionID, 1, assistant("msg_stats_other", Date.UTC(2020, 0, 1, 10), [])),
        ])
        .run()
        .pipe(Effect.orDie)
      // Publish through the real Bus so the stored event type is whatever the
      // writer persists rather than a string the test assumes.
      const bus = yield* Bus.Service
      yield* TestClock.setTime(Date.UTC(2026, 0, 2, 10, 0, 3))
      yield* bus.publish(SessionEvent.UsageRecorded, {
        sessionID,
        source: "title",
        cost: Money.USD.make(0.5),
        tokens: { input: 1, output: 1, reasoning: 1, cache: { read: 1, write: 1 } },
      })
      yield* bus.publish(SessionEvent.UsageRecorded, {
        sessionID: usageOnlyID,
        source: "compaction",
        cost: Money.USD.make(0.25),
        tokens: { input: 2, output: 2, reasoning: 2, cache: { read: 2, write: 2 } },
      })

      const stats = yield* SessionStats.get({
        from: Date.UTC(2026, 0, 1),
        to: Date.UTC(2026, 1, 1),
        timezone: "UTC",
        tools: "detail",
      })

      expect(stats.sessions).toBe(2)
      expect(stats.subagents).toBe(1)
      expect(stats.prompts).toBe(1)
      expect(stats.steps).toBe(3)
      // The title-generation event (1/1/1/1/1 at 0.5) is booked on top of the message totals and the
      // compaction event: auxiliary spend is part of the bill, not a rounding error to hide.
      expect(stats.tokens).toEqual({ input: 43, output: 23, reasoning: 11, cache: { read: 19, write: 7 } })
      expect(stats.cost).toBe(Money.USD.make(6.75))
      expect(stats.tools).toMatchObject({
        mode: "detail",
        totals: { calls: 3, succeeded: 1, failed: 1, unfinished: 1 },
      })
      expect(stats.activity).toEqual([
        { date: "2026-01-02", steps: 1, tokens: 22 },
        { date: "2026-01-03", steps: 1, tokens: 44 },
        { date: "2026-01-05", steps: 1, tokens: 22 },
      ])
      expect(stats.streak).toBe(2)
      // The run ending on the last active day is its own number: 01-03 to 01-05 is a gap.
      expect(stats.currentStreak).toBe(1)
      expect(stats.messages).toBe(4)
      // Every other session here was created and stamped in the same instant, so the fork — the one row with an
      // explicit creation time apart from its update — is the only measurable span in this fixture.
      expect(stats.longestSession?.sessionID).toBe("ses_stats_fork")
      expect(stats.models.map((model) => String(model.model.id))).toEqual(["large", "sonnet", "fork-new"])
      expect(stats.tools.mode).toBe("detail")
      if (stats.tools.mode !== "detail") throw new Error("Expected detailed tool statistics")
      expect(stats.tools.usage).toMatchObject([
        { name: "read", calls: 1, succeeded: 1, failed: 0, durationP50: 250 },
        { name: "edit", calls: 1, succeeded: 0, failed: 1, durationP50: 2_000 },
        { name: "pending", calls: 1, succeeded: 0, failed: 0, unfinished: 1 },
      ])

      const summary = yield* SessionStats.get({
        from: Date.UTC(2026, 0, 1),
        to: Date.UTC(2026, 1, 1),
        timezone: "UTC",
      })
      expect(summary.models.map((model) => String(model.model.id))).toEqual(["large", "sonnet", "fork-new"])
      expect(summary.tools).toEqual({
        mode: "summary",
        totals: { calls: 3, succeeded: 1, failed: 1, unfinished: 1 },
      })

      const withoutTools = yield* SessionStats.get({
        from: Date.UTC(2026, 0, 1),
        to: Date.UTC(2026, 1, 1),
        timezone: "UTC",
        tools: "none",
      })
      expect(withoutTools.tools).toEqual({ mode: "none" })

      const project = yield* SessionStats.get({ projectID, timezone: "UTC", tools: "none" })
      expect(DateTime.toEpochMillis(project.range.from)).toBe(Date.UTC(2025, 11, 30, 10))

      const error = yield* Effect.flip(
        SessionStats.get({ from: Date.UTC(2026, 1, 1), to: Date.UTC(2026, 0, 1), tools: "none" }),
      )
      expect(error).toEqual(
        new SessionStats.InvalidRangeError({ from: Date.UTC(2026, 1, 1), to: Date.UTC(2026, 0, 1) }),
      )

      const future = yield* Effect.flip(SessionStats.get({ from: Number.MAX_SAFE_INTEGER, tools: "none" }))
      expect(future._tag).toBe("SessionStats.InvalidRangeError")
    }),
  )

  it.effect("counts tool calls in both session_part rows and inline content an older build left on one message", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      yield* db
        .insert(ProjectTable)
        .values({ id: projectID, worktree: AbsolutePath.make("/stats"), name: "stats", sandboxes: [] })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({ id: sessionID, project_id: projectID, slug: "root", directory: "/stats", version: "test" })
        .run()
        .pipe(Effect.orDie)
      const created = Date.UTC(2026, 0, 2, 10)
      const time = { created: DateTime.makeUnsafe(created), completed: DateTime.makeUnsafe(created + 1_000) }
      const row = messageRow(
        sessionID,
        1,
        assistant("msg_stats_hybrid", created, [
          SessionMessage.AssistantTool.make({
            type: "tool",
            id: "call_inline",
            name: "edit",
            state: SessionMessage.ToolStateError.make({
              status: "error",
              input: {},
              error: { type: "tool", message: "failed" },
            }),
            time,
          }),
        ]),
      )
      yield* db.insert(SessionMessageTable).values(row).run().pipe(Effect.orDie)
      yield* db
        .insert(SessionPartTable)
        .values({
          message_id: row.id,
          session_id: sessionID,
          ordinal: 0,
          type: "tool",
          call_id: "call_part",
          time_created: created,
          time_updated: created,
          data: SessionHistory.encodePart(
            SessionMessage.AssistantTool.make({
              type: "tool",
              id: "call_part",
              name: "read",
              state: SessionMessage.ToolStateCompleted.make({
                status: "completed",
                input: {},
                content: [{ type: "text", text: "ok" }],
              }),
              time,
            }),
          ),
        })
        .run()
        .pipe(Effect.orDie)

      const range = { from: Date.UTC(2026, 0, 1), to: Date.UTC(2026, 1, 1), timezone: "UTC" }
      expect((yield* SessionStats.get(range)).tools).toEqual({
        mode: "summary",
        totals: { calls: 2, succeeded: 1, failed: 1, unfinished: 0 },
      })
      const detail = (yield* SessionStats.get({ ...range, tools: "detail" })).tools
      if (detail.mode !== "detail") throw new Error("Expected detailed tool statistics")
      expect(detail.usage.map((tool) => tool.name).toSorted()).toEqual(["edit", "read"])
    }),
  )

  durableIt.effect("aggregates compaction usage across more than 100 sessions under the 100-parameter limit", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const bus = yield* Bus.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: projectID, worktree: AbsolutePath.make("/stats"), name: "stats", sandboxes: [] })
        .run()
        .pipe(Effect.orDie)

      const ids = Array.from({ length: 120 }, (_, i) => Session.ID.make(`ses_stats_${String(i).padStart(3, "0")}`))
      const created = Date.UTC(2026, 0, 2, 10)
      yield* Effect.forEach(
        DatabaseBatch.insertBatches(
          SessionTable,
          ids.map((id, i) => ({
            id,
            project_id: projectID,
            slug: `session-${i}`,
            directory: "/stats",
            version: "test",
          })),
        ),
        (batch) => db.insert(SessionTable).values(batch).run().pipe(Effect.orDie),
        { discard: true },
      )
      yield* Effect.forEach(
        DatabaseBatch.insertBatches(
          SessionMessageTable,
          ids.map((id, i) => messageRow(id, 1, assistant(`msg_stats_${i}`, created, []))),
        ),
        (batch) => db.insert(SessionMessageTable).values(batch).run().pipe(Effect.orDie),
        { discard: true },
      )

      yield* TestClock.setTime(created + 1_000)
      yield* bus.publish(SessionEvent.UsageRecorded, {
        sessionID: ids[0]!,
        source: "compaction",
        cost: Money.USD.make(0.25),
        tokens: { input: 2, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      })
      yield* bus.publish(SessionEvent.UsageRecorded, {
        sessionID: ids.at(-1)!,
        source: "compaction",
        cost: Money.USD.make(0.75),
        tokens: { input: 3, output: 4, reasoning: 0, cache: { read: 0, write: 0 } },
      })
      const stats = yield* SessionStats.get({
        from: Date.UTC(2026, 0, 1),
        to: Date.UTC(2026, 1, 1),
        projectID,
        timezone: "UTC",
        tools: "none",
      })
      expect(stats.sessions).toBe(120)
      expect(stats.steps).toBe(120)
      expect(stats.tokens).toEqual({
        input: 120 * 10 + 5,
        output: 120 * 5 + 5,
        reasoning: 120 * 2,
        cache: { read: 120 * 4, write: 120 },
      })
      expect(stats.cost).toBe(Money.USD.make(120 * 1.5 + 1))
    }),
  )

  durableIt.effect("books title-generation usage into the totals", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const bus = yield* Bus.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: projectID, worktree: AbsolutePath.make("/stats"), name: "stats", sandboxes: [] })
        .run()
        .pipe(Effect.orDie)

      // Title generation spends tokens without writing an assistant message, so the only durable
      // trace is the UsageRecorded event; the report must read it or the spend is invisible.
      const id = Session.ID.make("ses_stats_titled")
      const created = Date.UTC(2026, 0, 2, 10)
      yield* db
        .insert(SessionTable)
        .values({ id, project_id: projectID, slug: "titled", directory: "/stats", version: "test" })
        .run()
        .pipe(Effect.orDie)
      yield* Effect.forEach(
        DatabaseBatch.insertBatches(
          SessionMessageTable,
          [messageRow(id, 1, assistant(`msg_stats_titled`, created, []))],
        ),
        (batch) => db.insert(SessionMessageTable).values(batch).run().pipe(Effect.orDie),
        { discard: true },
      )

      yield* TestClock.setTime(created + 1_000)
      yield* bus.publish(SessionEvent.UsageRecorded, {
        sessionID: id,
        source: "title",
        cost: Money.USD.make(0.02),
        tokens: { input: 900, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
      })
      const stats = yield* SessionStats.get({
        from: Date.UTC(2026, 0, 1),
        to: Date.UTC(2026, 1, 1),
        projectID,
        timezone: "UTC",
        tools: "none",
      })
      // The fixture message row carries 10/5/2/4/1 tokens at a 1.5 cost; the title spend rides on top.
      expect(stats.tokens.input).toBe(10 + 900)
      expect(stats.tokens.output).toBe(5 + 20)
      expect(stats.tokens.reasoning).toBe(2)
      expect(stats.cost).toBe(Money.USD.make(1.5 + 0.02))
    }),
  )

  it.effect("measures the longest session by its own span and lets one that started earlier overlap the range", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      yield* db
        .insert(ProjectTable)
        .values({ id: projectID, worktree: AbsolutePath.make("/stats"), name: "stats", sandboxes: [] })
        .run()
        .pipe(Effect.orDie)
      const day = 24 * 60 * 60 * 1_000
      yield* db
        .insert(SessionTable)
        .values([
          // Started before the window and kept going into it: the longest span the range contains.
          {
            id: Session.ID.make("ses_stats_overlap"),
            project_id: projectID,
            slug: "overlap",
            directory: "/stats",
            version: "test",
            time_created: Date.UTC(2025, 11, 20),
            time_updated: Date.UTC(2026, 0, 5),
            time_idle: Date.UTC(2026, 0, 5),
          },
          // Still running at the cut, so it measures through time_updated.
          {
            id: Session.ID.make("ses_stats_running"),
            project_id: projectID,
            slug: "running",
            directory: "/stats",
            version: "test",
            time_created: Date.UTC(2026, 0, 2),
            time_updated: Date.UTC(2026, 0, 4),
          },
          // Longer than everything, but a subagent: the metric is about the session a person opened.
          {
            id: Session.ID.make("ses_stats_child"),
            project_id: projectID,
            parent_id: Session.ID.make("ses_stats_overlap"),
            slug: "child",
            directory: "/stats",
            version: "test",
            time_created: Date.UTC(2025, 10, 1),
            time_updated: Date.UTC(2026, 0, 31),
            time_idle: Date.UTC(2026, 0, 31),
          },
          // Finished before the window opened.
          {
            id: Session.ID.make("ses_stats_before"),
            project_id: projectID,
            slug: "before",
            directory: "/stats",
            version: "test",
            time_created: Date.UTC(2025, 11, 1),
            time_updated: Date.UTC(2025, 11, 2),
            time_idle: Date.UTC(2025, 11, 2),
          },
        ])
        .run()
        .pipe(Effect.orDie)
      const stats = yield* SessionStats.get({
        from: Date.UTC(2026, 0, 1),
        to: Date.UTC(2026, 1, 1),
        projectID,
        timezone: "UTC",
        tools: "none",
      })
      expect(stats.longestSession).toEqual({
        sessionID: "ses_stats_overlap",
        duration: 16 * day,
      })
    }),
  )
})


function assistant(
  id: string,
  created: number,
  content: SessionMessage.AssistantContent[],
  model = "sonnet",
  scale = 1,
) {
  return SessionMessage.Assistant.make({
    id: SessionMessage.ID.make(id),
    type: "assistant",
    agent: Agent.ID.make("build"),
    model: { id: Model.ID.make(model), providerID: Provider.ID.make("anthropic") },
    content,
    cost: Money.USD.make(1.5 * scale),
    tokens: { input: 10 * scale, output: 5 * scale, reasoning: 2 * scale, cache: { read: 4 * scale, write: scale } },
    time: { created: DateTime.makeUnsafe(created), completed: DateTime.makeUnsafe(created + 2_000) },
  })
}

function messageRow(
  sessionID: Session.ID,
  seq: number,
  message: SessionMessage.Info,
): typeof SessionMessageTable.$inferInsert {
  const encoded = encodeMessage(message)
  const { id, type, ...data } = encoded
  return { id: SessionMessage.ID.make(id), session_id: sessionID, type, seq, time_created: encoded.time.created, data }
}
