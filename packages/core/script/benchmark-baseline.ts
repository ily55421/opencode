export * as BenchmarkBaseline from "./benchmark-baseline.js"

import fs from "node:fs"
import path from "node:path"

/**
 * The rolling baseline for the benchmark suite. Each script pins its measured numbers here
 * (`--rebaseline`) after an intentional change — an upstream sync, a new machine, a deliberate
 * trade — and every later run compares against the last pinned numbers instead of re-litigating
 * the pre-branch tree. Invariants (determinism, billing exactness) stay exact and never depend on
 * this file; only latencies and throughputs do.
 *
 * Machine noise dominates sub-10 µs calls and Windows filesystems swing widely, so every entry
 * carries its own ratio band: a run passes while it stays inside `baseline * (1 ± tolerance)`.
 * A number outside the band means the tree regressed OR the machine changed — both are worth a
 * look before re-pinning.
 */

const FILE = path.join(import.meta.dir, "benchmark-baselines.json")

type Entry = {
  value: number
  tolerance: number
  unit: string
  updated: string
  commit: string
}

type Baselines = Record<string, Entry>

function stamp() {
  let commit = "unknown"
  try {
    commit = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"]).stdout.toString().trim() || commit
  } catch {
    // Outside a git checkout the pin still lands; it just loses the commit anchor.
  }
  return { updated: new Date().toISOString().slice(0, 10), commit }
}

export function load(): Baselines {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8")) as Baselines
  } catch {
    return {}
  }
}

export type Check = {
  key: string
  value: number
  unit: string
  baseline?: number
  tolerance: number
  status: "pass" | "fail" | "new"
}

/** Within-band comparison against the last pinned number for this machine. */
export function check(key: string, value: number, unit: string, tolerance = 2): Check {
  const baseline = load()[key]
  if (baseline === undefined) return { key, value, unit, tolerance, status: "new" }
  const inBand =
    value <= baseline.value * (1 + baseline.tolerance) && value >= baseline.value * (1 - baseline.tolerance)
  return { key, value, unit, baseline: baseline.value, tolerance: baseline.tolerance, status: inBand ? "pass" : "fail" }
}

/** Pin today's measured numbers as the baseline the next runs compare against. */
export function pin(entries: Record<string, { value: number; unit: string; tolerance: number }>) {
  const baselines = load()
  const meta = stamp()
  for (const [key, entry] of Object.entries(entries)) baselines[key] = { ...entry, ...meta }
  fs.writeFileSync(FILE, `${JSON.stringify(baselines, null, 2)}\n`)
  return baselines
}

export function report(checks: ReadonlyArray<Check>) {
  for (const check of checks) {
    const baseline =
      check.baseline === undefined
        ? "new — pin with --rebaseline"
        : `${check.baseline.toFixed(1)} ${check.unit} ±${Math.round(check.tolerance * 100)}%`
    console.log(
      `   baseline ${check.key.padEnd(30)} ${check.value.toFixed(1)} ${check.unit.padEnd(7)} vs ${baseline}  ${check.status.toUpperCase()}`,
    )
  }
  return checks.every((check) => check.status !== "fail")
}

export const rebaselineRequested = process.argv.includes("--rebaseline")
