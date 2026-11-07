#!/usr/bin/env bun
// Measures SessionStats.get — the usage page's aggregation — over a synthetic month of activity,
// including the auxiliary usage rows the report must bill (P0 OH-0: title-generation spend used to
// be read by no report at all).
//
// The standard this benchmark enforces:
//   1. Billing     — the totals include the message-derived tokens AND the title/compaction event
//                    rows; an undercount is a FAIL (it means a source dropped out of the query).
//   2. Latency     — the aggregation for 500 sessions (messages + 550 durable usage events)
//                    completes under 1000 ms, the interactive budget for a settings-page load.
//
// Run: bun script/benchmark-session-stats.ts

import { AbsolutePath } from "../src/schema"
import { Bus } from "../src/bus"
import { DatabaseBatch } from "../src/database/batch"
import { Database } from "../src/database/database"
import { ProjectTable } from "../src/project/sql"
import { SessionMessageTable, SessionTable } from "../src/session/sql"
import { SessionStats } from "../src/session/stats"
import { SessionEvent } from "@opencode/schema/session-event"
import { SessionMessage } from "../src/session/message"
import { Session } from "@opencode/schema/session"
import { Money } from "@opencode/schema/money"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Project } from "@opencode/schema/project"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { DateTime, Effect, Schema } from "effect"
import { performance } from "node:perf_hooks"

const SESSIONS = 500
const ROUNDS = 5

const program = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  const bus = yield* Bus.Service

  const projectID = Project.ID.make("bench-stats")
  const now = Date.now()
  const created = now - 60 * 60 * 1_000

  yield* db.insert(ProjectTable).values({ id: projectID, worktree: AbsolutePath.make("/bench"), name: "bench", sandboxes: [] }).run().pipe(Effect.orDie)

  const ids = Array.from({ length: SESSIONS }, (_, i) => Session.ID.make(`ses_bench_${String(i).padStart(4, "0")}`))

  yield* db
    .insert(SessionTable)
    .values(
      ids.map((id, i) => ({
        id,
        project_id: projectID,
        slug: `bench-${i}`,
        directory: "/bench",
        version: "test",
        time_created: created,
        time_updated: created + 60_000,
      })),
    )
    .run()
    .pipe(Effect.orDie)

  // One assistant message per session: the fixture's 10/5/2/4/1 tokens at a 1.5 cost.
  const message = (id: string) =>
    SessionMessage.Assistant.make({
      id: SessionMessage.ID.make(id),
      type: "assistant",
      agent: Agent.ID.make("build"),
      model: { id: Model.ID.make("bench"), providerID: Provider.ID.make("anthropic") },
      content: [],
      cost: Money.USD.make(1.5),
      tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 4, write: 1 } },
      time: { created: DateTime.makeUnsafe(created), completed: DateTime.makeUnsafe(created + 2_000) },
    })

  yield* Effect.forEach(
    DatabaseBatch.insertBatches(
      SessionMessageTable,
      ids.map((id) => {
        const encoded = Schema.encodeSync(SessionMessage.Info)(message(`msg_bench_${id}`))
        const { id: messageID, type, ...data } = encoded
        return {
          id: SessionMessage.ID.make(messageID),
          session_id: id,
          type,
          seq: 1,
          time_created: created,
          time_updated: created + 2_000,
          data,
        }
      }),
    ),
    (batch) => db.insert(SessionMessageTable).values(batch).run().pipe(Effect.orDie),
    { discard: true },
  )

  // Durable auxiliary usage: a title event per session, a compaction event every tenth session.
  for (const [index, id] of ids.entries()) {
    yield* bus.publish(SessionEvent.UsageRecorded, {
      sessionID: id,
      source: "title",
      cost: Money.USD.make(0.5),
      tokens: { input: 1, output: 1, reasoning: 1, cache: { read: 1, write: 1 } },
    })
    if (index % 10 === 0)
      yield* bus.publish(SessionEvent.UsageRecorded, {
        sessionID: id,
        source: "compaction",
        cost: Money.USD.make(0.25),
        tokens: { input: 2, output: 2, reasoning: 2, cache: { read: 2, write: 2 } },
      })
  }

  const from = now - 2 * 60 * 60 * 1_000
  const to = now + 2 * 60 * 60 * 1_000

  const get = () => SessionStats.get({ from, to, projectID, timezone: "UTC", tools: "none" })
  const timings: number[] = []
  let stats: Effect.Success<ReturnType<typeof get>> | undefined
  for (let round = 0; round < ROUNDS; round++) {
    const start = performance.now()
    stats = yield* get()
    timings.push(performance.now() - start)
  }
  timings.sort((a, b) => a - b)
  const median = timings[Math.floor(timings.length / 2)]

  // Billing standard: 500 messages (10/5/2/4/1 @ 1.5) + 500 title rows (1/1/1/1/1 @ 0.5) + 50
  // compaction rows (2/2/2/2/2 @ 0.25). A source that drops out of the query undercounts here.
  const expected = {
    input: SESSIONS * (10 + 1) + Math.floor(SESSIONS / 10) * 2,
    output: SESSIONS * (5 + 1) + Math.floor(SESSIONS / 10) * 2,
    reasoning: SESSIONS * (2 + 1) + Math.floor(SESSIONS / 10) * 2,
    cache: {
      read: SESSIONS * (4 + 1) + Math.floor(SESSIONS / 10) * 2,
      write: SESSIONS * (1 + 1) + Math.floor(SESSIONS / 10) * 2,
    },
  }
  const billed =
    stats &&
    stats.tokens.input === expected.input &&
    stats.tokens.output === expected.output &&
    stats.tokens.reasoning === expected.reasoning &&
    stats.tokens.cache.read === expected.cache.read &&
    stats.tokens.cache.write === expected.cache.write

  console.log("SessionStats aggregation benchmark")
  console.log("==================================")
  console.log(`dataset: ${SESSIONS} sessions, ${SESSIONS} messages, ${SESSIONS + Math.floor(SESSIONS / 10)} usage events`)
  console.log("")
  console.log("1. billing (the OH-0 standard)")
  console.log(`   totals include message + title + compaction sources: ${billed ? "PASS" : "FAIL"}`)
  console.log(`   input ${stats?.tokens.input}/${expected.input}, output ${stats?.tokens.output}/${expected.output}, cost ${stats?.cost}`)
  console.log("")
  console.log("2. latency (the interactive standard: under 1000 ms)")
  console.log(
    `   median ${median.toFixed(1)} ms over ${ROUNDS} rounds (min ${timings[0].toFixed(1)}, max ${timings[timings.length - 1].toFixed(1)})` +
      ` — ${median < 1000 ? "PASS" : "FAIL"}`,
  )
  const pass = Boolean(billed && median < 1000)
  console.log("")
  console.log(`verdict: ${pass ? "PASS" : "FAIL"}`)
  process.exit(pass ? 0 : 1)
})

void program.pipe(Effect.provide(AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]), [Bus.node.replace(Bus.configured({ persist: true }))]))).pipe(Effect.runPromise).catch((cause) => {
  console.error(cause)
  process.exit(1)
})
