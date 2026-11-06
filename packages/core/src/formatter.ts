export * as Formatter from "./formatter.js"

import { Context, Effect, Layer } from "effect"
import { ChildProcess } from "effect/process"
import path from "path"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { AppProcess } from "@opencode/util/process"
import { Location } from "./location.js"
import type { Info } from "./formatter/builtins.js"
import { State } from "./state.js"

type Data = {
  formatters: Info[]
}

export type Editor = {
  set: (formatter: Info) => void
  remove: (name: string) => void
}

/** A configured formatter was selected but did not run clean, so the file is left as written. */
export type Failure = {
  readonly formatter: string
  readonly message: string
}

export type Outcome = {
  /** A formatter ran and exited 0, so the file on disk is the formatted text. */
  readonly formatted: boolean
  /** Set when a configured formatter failed; absent when none matched or all were disabled. */
  readonly failure?: Failure
}

export interface Interface extends State.Transformable<Editor> {
  readonly file: (filepath: string) => Effect.Effect<Outcome>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Formatter") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const processes = yield* AppProcess.Service
    const commands = new WeakMap<Info, string[] | false>()
    const state = State.create<Data, Editor>({
      name: "formatter",
      initial: () => ({ formatters: [] }),
      editor: (editor) => ({
        set: (formatter) => {
          const index = editor.formatters.findIndex((item) => item.name === formatter.name)
          if (index === -1) editor.formatters.push(formatter)
          else editor.formatters[index] = formatter
        },
        remove: (name) => {
          editor.formatters = editor.formatters.filter((formatter) => formatter.name !== name)
        },
      }),
    })

    const command = Effect.fnUntraced(function* (formatter: Info) {
      const cached = commands.get(formatter)
      if (cached !== undefined) return cached
      const result = yield* formatter.enabled
      if (result !== false) commands.set(formatter, result)
      return result
    })

    const file = Effect.fn("Formatter.file")(function* (filepath: string) {
      const extension = path.extname(filepath)
      const matching = state.get().formatters.filter((formatter) => formatter.extensions.includes(extension))

      let failure: Failure | undefined
      for (const formatter of matching) {
        const enabled = yield* command(formatter)
        if (enabled === false) continue
        const cmd = enabled.map((argument) => argument.replace("$FILE", filepath))
        yield* Effect.logInfo("formatting file", { file: filepath, command: cmd })
        const result = yield* processes
          .run(
            ChildProcess.make(cmd[0], cmd.slice(1), {
              cwd: location.directory,
              env: formatter.environment,
              extendEnv: true,
              stdin: "ignore",
              stdout: "ignore",
              stderr: "ignore",
            }),
          )
          .pipe(
            Effect.catch((error) => {
              failure = failure ?? { formatter: formatter.name, message: error.message }
              return Effect.logError("failed to format file", {
                file: filepath,
                command: cmd,
                error: error.message,
              }).pipe(Effect.as(undefined))
            }),
          )
        if (!result) continue
        if (result.exitCode === 0) return { formatted: true }
        failure = failure ?? { formatter: formatter.name, message: `exited with code ${result.exitCode}` }
        yield* Effect.logError("formatter exited unsuccessfully", {
          file: filepath,
          command: cmd,
          exitCode: result.exitCode,
        })
      }
      return { formatted: false, failure }
    })

    return Service.of({ transform: state.transform, reload: state.reload, file })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Location.node, AppProcess.node],
})
