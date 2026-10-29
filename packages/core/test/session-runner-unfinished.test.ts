import { describe, expect, test } from "bun:test"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { Agent } from "@opencode/core/agent"
import { SessionMessage } from "@opencode/core/session/message"
import {
  NOTICE,
  NOTICE_STOPPED,
  TODO_RESIDUE,
  TODO_RESIDUE_ESCALATED,
  TODO_RESIDUE_STOPPED,
  decide,
} from "@opencode/core/session/runner/unfinished"
import { TodoTool } from "@opencode/core/tool/plugin/todo"
import { DateTime } from "effect"

const created = DateTime.makeUnsafe(0)
const model = Model.Ref.make({ id: Model.ID.make("model"), providerID: Provider.ID.make("provider") })
const id = (value: string) => SessionMessage.ID.make(`msg_${value}`)

const user = (text: string) =>
  SessionMessage.User.make({
    id: id(`user-${text}`),
    type: "user",
    text,
    files: [],
    time: { created },
  })

const idle = () =>
  SessionMessage.Idle.make({ id: id("idle"), type: "idle", outcome: "succeeded", time: { created } })

const assistant = (value: string, content: ReadonlyArray<SessionMessage.AssistantContent>) =>
  SessionMessage.Assistant.make({
    id: id(value),
    type: "assistant",
    agent: Agent.defaultID,
    model,
    content: [...content],
    time: { created },
  })

const text = (value: string) => [SessionMessage.AssistantText.make({ type: "text", text: value })]

/** A settled tool call. `todowrite` carries its list in metadata, exactly as the projector stores it. */
const tool = (name: string, value?: unknown) =>
  SessionMessage.AssistantTool.make({
    type: "tool",
    id: `call-${name}`,
    name,
    state: SessionMessage.ToolStateCompleted.make({
      status: "completed",
      input: {},
      content: [SessionMessage.AssistantText.make({ type: "text", text: `${name} settled` })],
      ...(value === undefined ? {} : { metadata: { todos: value } }),
    }),
    time: { created },
  })

const todo = (content: string, status: "pending" | "in_progress" | "completed" | "cancelled"): TodoTool.Info => ({
  content,
  status,
})

const notice = (value: string) =>
  SessionMessage.Synthetic.make({ id: id(`synthetic-${value}`), type: "synthetic", text: value, time: { created } })

const open = [todo("write tests", "pending"), todo("ship it", "in_progress")]
const done = [todo("write tests", "completed"), todo("ship it", "cancelled")]

describe("SessionRunnerUnfinished", () => {
  test("says nothing when the turn never wrote a todo list", () => {
    expect(decide([user("explain this"), assistant("answer", text("It parses the file."))])).toBeUndefined()
  })

  test("says nothing when every item is settled", () => {
    expect(decide([user("do it"), assistant("todos", [tool(TodoTool.name, done)])])).toBeUndefined()
  })

  test("nudges once the model stops with items still open", () => {
    const decision = decide([user("do it"), assistant("todos", [tool(TodoTool.name, open)]), assistant("stop", text("Done"))])

    expect(decision).toMatchObject({ text: TODO_RESIDUE, notice: NOTICE, continue: true })
    expect(decision?.description).toContain("2 unfinished")
  })

  test("names todowrite instead of tools in general", () => {
    expect(TODO_RESIDUE).toContain("`todowrite`")
    expect(TODO_RESIDUE_ESCALATED).toContain("`todowrite`")
  })

  test("a successful edit counts as progress and keeps the turn alive", () => {
    const decision = decide([
      user("do it"),
      assistant("todos", [tool(TodoTool.name, open)]),
      notice(TODO_RESIDUE),
      assistant("edit", [tool("edit")]),
      assistant("stop", text("Done")),
    ])

    expect(decision).toMatchObject({ text: TODO_RESIDUE, continue: true })
  })

  test("rewriting the same list is not progress", () => {
    const decision = decide([
      user("do it"),
      assistant("first", [tool(TodoTool.name, open)]),
      notice(TODO_RESIDUE),
      assistant("again", [tool(TodoTool.name, open)]),
      notice(TODO_RESIDUE),
      assistant("again", [tool(TodoTool.name, open)]),
      notice(TODO_RESIDUE),
      assistant("stop", text("Done")),
    ])

    expect(decision).toMatchObject({ text: TODO_RESIDUE_STOPPED, notice: NOTICE_STOPPED, continue: false })
  })

  test("checking an item off resets the stall run", () => {
    const decision = decide([
      user("do it"),
      assistant("first", [tool(TodoTool.name, open)]),
      notice(TODO_RESIDUE),
      assistant("second", [tool(TodoTool.name, [todo("write tests", "completed"), todo("ship it", "in_progress")])]),
      notice(TODO_RESIDUE),
      assistant("third", [tool(TodoTool.name, [todo("write tests", "completed"), todo("ship it", "pending")])]),
      notice(TODO_RESIDUE),
      assistant("stop", text("Done")),
    ])

    expect(decision).toMatchObject({ text: TODO_RESIDUE_ESCALATED, continue: true })
  })

  test("escalates the wording after three nudges", () => {
    const steps = [user("do it"), assistant("list", [tool(TodoTool.name, open)])]
    for (let index = 0; index < 3; index++)
      steps.push(notice(index === 0 ? TODO_RESIDUE : TODO_RESIDUE_ESCALATED), assistant(`edit${index}`, [tool("edit")]))

    expect(decide(steps)).toMatchObject({ text: TODO_RESIDUE_ESCALATED, continue: true })
  })

  test("stops at the hard cap even while the model keeps working", () => {
    const steps = [user("do it"), assistant("list", [tool(TodoTool.name, open)])]
    for (let index = 0; index < 10; index++)
      steps.push(notice(index < 3 ? TODO_RESIDUE : TODO_RESIDUE_ESCALATED), assistant(`edit${index}`, [tool("edit")]))

    expect(decide(steps)).toMatchObject({ text: TODO_RESIDUE_STOPPED, continue: false })
  })

  test("does not repeat a stop notice inside the same turn", () => {
    const decision = decide([
      user("do it"),
      assistant("list", [tool(TodoTool.name, open)]),
      notice(TODO_RESIDUE_STOPPED),
      assistant("stop", text("Leaving it here")),
    ])

    expect(decision).toBeUndefined()
  })

  test("starts a fresh allowance in the next turn", () => {
    const decision = decide([
      user("do it"),
      assistant("list", [tool(TodoTool.name, open)]),
      ...Array.from({ length: 3 }, () => notice(TODO_RESIDUE)),
      idle(),
      user("and the rest"),
      assistant("stop", text("Done")),
    ])

    expect(decision).toBeUndefined()
  })

  test("an errored todowrite neither reports a list nor makes progress", () => {
    const failed = SessionMessage.AssistantTool.make({
      type: "tool",
      id: "call-failed",
      name: TodoTool.name,
      state: SessionMessage.ToolStateError.make({
        status: "error",
        input: {},
        error: { type: "tool.result-missing", message: "Provider did not return a tool result" },
      }),
      time: { created },
    })

    expect(decide([user("do it"), assistant("failed", [failed]), assistant("stop", text("Done"))])).toBeUndefined()
  })

  test("ignores a malformed todo list", () => {
    expect(decide([user("do it"), assistant("bad", [tool(TodoTool.name, [{ status: "pending" }])])])).toBeUndefined()
    expect(decide([user("do it"), assistant("bad", [tool(TodoTool.name, "not a list")])])).toBeUndefined()
  })
})
