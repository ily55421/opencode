#!/usr/bin/env bun
// Checks the docs that carry change knowledge: `doc/**` and every `AGENTS.md`. Fails, naming each file and line, when
// such a doc
// - cites a file with a colon and a line number, which is wrong the first time code above it moves;
// - names a repository path that no longer exists;
// - names `path#Symbol` in a file that no longer declares that symbol;
// - is a topic doc no `AGENTS.md` index points at.
// Only paths that start with a top-level source directory are resolved, so a relative `src/config` mention or a
// build artifact under `dist/` is left alone rather than guessed at.
// Usage: bun script/doc-refs.ts
import fs from "node:fs"
import path from "node:path"
import { Glob } from "bun"

const root = path.resolve(import.meta.dir, "..")
const sources = ["packages", "services", "script", "doc", "infra", ".github", ".opencode"]
const extensions = "ts|tsx|js|jsx|json|md|mdx|rs|sh|py|yml|yaml|css|sql"

const problems: string[] = []
const counts = { documents: 0, paths: 0, symbols: 0 }

const documents = [
  ...new Glob("doc/**/*.md", { cwd: root }).scanSync(),
  ...new Glob("**/AGENTS.md", { cwd: root }).scanSync(),
]
  .filter((file) => !file.includes("node_modules"))
  .toSorted()
  .map((file) => path.join(root, file))

const indexed = await Promise.all(
  documents.map(async (document) => {
    counts.documents++
    return { document, text: await Bun.file(document).text() }
  }),
)

indexed.forEach(checkDocument)
indexed
  .filter(({ document }) => /^doc[/\\][^/\\]+\.md$/.test(path.relative(root, document).replaceAll(path.sep, "/")))
  .forEach(({ document }) => checkIndexed(document))

problems.forEach((problem) => console.log(problem))
console.log(
  `doc-refs: ${counts.documents} documents, ${counts.paths} paths and ${counts.symbols} symbols resolve; ` +
    `${problems.length} problem(s)`,
)
process.exit(problems.length > 0 ? 1 : 0)

function checkDocument({ document, text }: { document: string; text: string }) {
  const label = relative(document)

  text.split("\n").forEach((line, index) => {
    const at = `${label}:${index + 1}`

    for (const anchor of line.matchAll(/[\w./@-]+\.(?:ts|tsx|js|jsx|json|rs|sh|py):\d+/g))
      problems.push(`${at}  \`${anchor[0]}\` cites a line number; name the symbol instead`)

    for (const candidate of paths(line)) {
      const [target, symbol] = candidate.split("#")

      if (!fs.existsSync(path.join(root, target))) {
        problems.push(`${at}  \`${candidate}\` is not a file in this repository`)
        continue
      }

      counts.paths++
      if (!symbol) continue

      const source = fs.readFileSync(path.join(root, target), "utf8")
      if (new RegExp(`\\b${symbol}\\b`).test(source)) void counts.symbols++
      else problems.push(`${at}  \`${target}\` no longer declares \`${symbol}\``)
    }
  })
}

/** Every indexed topic doc is reachable from an index; an orphan doc is a doc nobody opens. */
function checkIndexed(document: string) {
  const label = relative(document)
  const name = path.basename(document)
  const indexes = indexed.filter(({ document: host }) => host !== document && /AGENTS\.md$/.test(host))

  if (indexes.some(({ text }) => text.includes(label) || text.includes(name))) return

  problems.push(`${label}  no AGENTS.md indexes this topic doc`)
}

function paths(line: string) {
  const found: string[] = []

  for (const match of line.matchAll(/[\w.@-]+(?:\/[\w.@*-]+)+(?:\.(?:${extensions}))?(?:#[\w$]+)?/g)) {
    const token = match[0].replace(/\.+$/, "")
    const [head] = token.split("/")

    if (!sources.includes(head)) continue
    if (/[*<>]/.test(token)) continue
    if (token.includes("/dist/")) continue

    found.push(token)
  }

  return found
}

function relative(file: string) {
  return path.relative(root, file).replaceAll(path.sep, "/")
}
