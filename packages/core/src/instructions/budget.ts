export * as InstructionBudget from "./budget.js"

import { Key, type Rendered, type Scope } from "./index.js"
import { Token } from "../util/token.js"

/** Hard ceiling on one rendered instruction pool, however large the model's window is. */
const DEFAULT_BUDGET_TOKENS = 100_000
/** Share of the model's context window a pool may take; the smaller of the two wins. */
const DEFAULT_WINDOW_SHARE = 25

/** One budget per scope, spent independently: a project's AGENTS.md tree cannot push the shared catalog out. */
export type Pools = { readonly global: number; readonly project: number }

/**
 * The budgets for one model. An unknown window keeps the absolute ceiling rather than falling back to
 * "unbounded", which is how a model with no reported limit used to pull the whole instruction tree
 * into every request.
 */
export const forWindow = (context: number): Pools => {
  const pool = context <= 0
    ? DEFAULT_BUDGET_TOKENS
    : Math.min(DEFAULT_BUDGET_TOKENS, Math.floor((context * DEFAULT_WINDOW_SHARE) / 100))
  return { global: pool, project: pool }
}

export type Part = { readonly key: string; readonly text: string; readonly scope: Scope }

/** Largest whole-line prefix of `text` that still costs at most `room` tokens. */
function head(text: string, room: number) {
  const lines = text.split("\n")
  if (Token.estimateWide(lines[0] ?? "") > room) return ""
  let low = 1
  let high = lines.length
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (Token.estimateWide(lines.slice(0, middle).join("\n")) <= room) low = middle
    else high = middle - 1
  }
  return lines.slice(0, low).join("\n")
}

/**
 * Renders the baseline inside each scope's pool, cutting the least shared parts first. Every cut is
 * named in the text the model reads: a silent clip would leave the model believing it had the whole
 * instruction set, which is worse than a smaller set it knows is smaller. Pools are spent
 * independently, so a part spends against its own scope's remainder even when the other pool is full.
 */
export const fit = (parts: ReadonlyArray<Part>, pools: Pools) => {
  const kept: string[] = []
  const notes: string[] = []
  const remaining = { ...pools }
  for (const part of parts) {
    const size = Token.estimateWide(part.text)
    const room = remaining[part.scope]
    if (size <= room) {
      remaining[part.scope] = room - size
      kept.push(part.text)
      continue
    }
    const trimmed = head(part.text, Math.max(0, room))
    const tokens = Token.estimateWide(trimmed)
    remaining[part.scope] = room - tokens
    if (tokens === 0) {
      notes.push(`${part.key} dropped`)
      continue
    }
    kept.push(trimmed)
    notes.push(`${part.key} trimmed ${size - tokens} tokens`)
  }
  return kept.join("\n\n") + (notes.length === 0 ? "" : `\n\n[instructions budget: ${notes.join(", ")}]`)
}

/**
 * The rendered parts a request keeps under each scope's pool, with over-budget text trimmed: the
 * budgeted baseline as parts, so a caller that joins parts itself still spends the same pools. The
 * same disclosure rule as `fit` applies — cuts are named in a trailing part, never silent.
 */
export const fitParts = (parts: ReadonlyArray<Rendered>, pools: Pools): ReadonlyArray<Rendered> => {
  const remaining = { ...pools }
  const kept: Rendered[] = []
  const notes: string[] = []
  for (const part of parts) {
    const size = Token.estimateWide(part.text)
    const room = remaining[part.scope]
    if (size <= room) {
      remaining[part.scope] = room - size
      kept.push(part)
      continue
    }
    const trimmed = head(part.text, Math.max(0, room))
    const tokens = Token.estimateWide(trimmed)
    remaining[part.scope] = room - tokens
    if (tokens === 0) {
      notes.push(`${part.key} dropped`)
      continue
    }
    kept.push({ ...part, text: trimmed })
    notes.push(`${part.key} trimmed ${size - tokens} tokens`)
  }
  if (notes.length > 0)
    kept.push({
      key: Key.make("core/instructions-budget"),
      scope: "global",
      text: `[instructions budget: ${notes.join(", ")}]`,
    })
  return kept
}
