#!/usr/bin/env bun
// Reports and advances the upstream merge cursor recorded in upstream-sync.json.
// Run it before planning a sync so the comparison starts from the last merged commit rather than
// from re-discovering the fork base. Usage: bun script/upstream-sync.ts [--record]
//
// The `upstream` remote is normally a local mirror clone, so its fetch refspec points at that
// clone's own remote-tracking ref (refs/remotes/origin/dev), not its checked-out branch, which
// lags behind whenever the mirror has fetched but not merged.

import { $ } from "bun"
import path from "node:path"

type Cursor = {
  remote: string
  branch: string
  cursor: string
  cursorSubject: string
  cursorDate: string
  versionBase: string
  syncCommit: string
  syncedAt: string
}

const root = path.resolve(import.meta.dir, "..")
const cursorFile = path.join(root, "upstream-sync.json")

const git = (...args: string[]) => $`git ${args}`.cwd(root).text().then((text) => text.trim())
const gitOk = (...args: string[]) =>
  $`git ${args}`
    .cwd(root)
    .nothrow()
    .text()
    .then((text) => text.trim())
const short = (rev: string) => rev.slice(0, 10)

const cursor = (await Bun.file(cursorFile).json()) as Cursor
const tip = `refs/remotes/${cursor.remote}/${cursor.branch}`

await git("fetch", cursor.remote)

const head = await git("rev-parse", "HEAD")
const latest = await git("rev-parse", tip)

// The cursor is hand-editable and the mirror can force-update it away, so resolve it before any range uses it.
const known = (await gitOk("rev-parse", "--verify", "--quiet", `${cursor.cursor}^{commit}`)) !== ""
if (!known)
  console.error(
    `Cursor ${short(cursor.cursor)} is not in this repository. Restore it from upstream-sync.json's history, ` +
      `or set it to a commit both the fork and ${tip} can see, then rerun.`,
  )

const pending = await count(`${head}..${tip}`)
const since = known ? await count(`${cursor.cursor}..${tip}`) : 0

console.log(`cursor   ${short(cursor.cursor)}  ${cursor.cursorDate}  version base ${cursor.versionBase}`)
console.log(`upstream ${short(latest)}  ${await git("log", "-1", "--format=%s", tip)}`)
console.log(`since    ${since} commit(s) since the cursor`)
console.log(`pending  ${pending} commit(s) not in this branch`)

if (pending > 0) console.log((await list(`${head}..${tip}`, latest)).join("\n"))

const shared = known ? await conflictSurface(cursor.cursor, latest, head) : []

console.log(`\nshared with fork-owned files: ${shared.length}`)
if (shared.length > 0) console.log(shared.map((file) => `  ${file}`).join("\n"))

if (!process.argv.includes("--record"))
  console.log("\nnot recorded; rerun with --record after the merge lands.")
else await record(latest, tip, head, cursor)

async function count(range: string) {
  return Number(await git("rev-list", "--count", range))
}

async function list(range: string, latest: string) {
  const rows = await git("log", "--reverse", "--format=%h %an  %s", range)
  const lines = rows.split("\n").filter(Boolean)
  // Cap the listing so a long drift stays readable; the newest commits are the ones a mirror lags on.
  if (lines.length <= 25) return lines.map((line) => `  ${line}`)
  return [
    `  ... ${lines.length - 25} older commit(s) omitted`,
    ...lines.slice(lines.length - 25).map((line) => `  ${line}`),
    `  (listing capped at 25 of ${lines.length} up to ${short(latest)})`,
  ]
}

/** Upstream files that also carry fork changes, which is where a merge needs a human decision. */
async function conflictSurface(from: string, to: string, head: string) {
  const base = await git("merge-base", to, head)
  const upstream = new Set(await files(from, to))
  return (await files(base, head)).filter((file) => upstream.has(file))
}

async function files(from: string, to: string) {
  if (from === to) return []
  return (await git("diff", "--name-only", `${from}..${to}`)).split("\n").filter(Boolean)
}

async function record(latest: string, tip: string, head: string, previous: Cursor) {
  const versionBase = (JSON.parse(await git("show", `${tip}:package.json`)) as { version: string }).version

  await Bun.write(
    cursorFile,
    `${JSON.stringify(
      {
        remote: previous.remote,
        branch: previous.branch,
        cursor: latest,
        cursorSubject: await git("log", "-1", "--format=%s", tip),
        cursorDate: await git("log", "-1", "--format=%cI", tip),
        versionBase,
        syncCommit: head,
        syncedAt: new Date().toISOString().slice(0, 10),
      } satisfies Cursor,
      null,
      2,
    )}\n`,
  )
  console.log(`\nrecorded cursor ${short(latest)} with version base ${versionBase}`)
}
