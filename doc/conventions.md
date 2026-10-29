# Documentation conventions

This directory is for people **changing** the code. `packages/web/src/content/docs/` is for people **using** it.
When the same fact needs both audiences, write it in the product docs and let a topic doc here point at it.

## What goes where

| Kind of writing | Home | Lives on as |
| --- | --- | --- |
| Hard rules, commands, the map of the repo | `AGENTS.md` (and a nested `AGENTS.md`) | index only |
| How a mechanism works, why it was built that way, what was rejected | `doc/<topic>.md` | living document |
| A plan, an implementation record, a post-mortem | `doc/records/<slug>.md` | historical record |
| End-user behaviour and settings | `packages/web/src/content/docs/` | living document |
| API surface | doc comments on the declaration, plus `CHANGELOG.md` for user-visible changes | the code |

Living documents are rewritten when behaviour changes. Historical records are **never** rewritten to match a later
design — they are the evidence for why the design is what it is. When a record is overtaken, add one line at its top
pointing at the topic doc that now owns the subject, and leave the rest alone.

## Doc sync is part of the definition of done

A change to behaviour or to a contract is unfinished until the doc that owns that subject says so, in the same
change. No "update the docs later" follow-ups, and no doc-only commit standing in for the code change.

When code and doc disagree, the code wins, and whoever noticed fixes the doc. If you touch code whose doc you suspect
is stale, resolve it as part of that change instead of repeating the guess.

## Record the decision, not just the feature

Every topic doc has a `Decisions` section. Write **why**, including options you rejected and the failure that
motivated the rule. A doc that only says "X is implemented" loses the one thing a later reader cannot re-derive: why
changing X would reintroduce a bug someone already paid for.

Concretely, a `Decisions` entry answers three questions: what is true now, what breaks if it stops being true, and
what we tried or considered instead.

## Reference code by symbol, never by line

Cite `packages/core/src/session/runner/llm.ts` `runSteps`, or the event name `session.tool.success`, or the config
key `compaction.keep.tokens`. Do not append a colon and a line number to a file path — it is wrong the first time
anyone inserts a statement above it, and a stale anchor is worse than none because it reads as verified.

`bun script/doc-refs.ts` enforces this: it fails on anchors that append a line number to a file path, on paths that no
longer exist, and on `file#Symbol` references whose symbol is gone. Run it through `bun run lint`. Fix a real
breakage by updating the reference; do not silence it by deleting the sentence that carried the knowledge.

## Change map

The self-check at the end of a change: every landing point below that you touched has its row's document updated in
the same diff.

| You changed | Update |
| --- | --- |
| A session event, its aggregate, or a projector | `doc/session-loop.md`, plus `CHANGELOG.md` if it is consumer-visible |
| The step/drain loop, continuation or nudge rules | `doc/session-loop.md` |
| Inbox admission, delivery modes, interruption | `doc/session-loop.md` |
| Tool definitions, side-effect classification, permission gating | `doc/session-loop.md`, and the tool's own doc comment |
| Token estimation, compaction budgets or triggers, tool-output clipping | `doc/context-economics.md` |
| A model-visible prompt or notice token the UI echoes verbatim | the topic doc that owns the mechanism, spelling the token out literally |
| The HTTP contract (`protocol`, server handlers) | run `bun run generate` from `packages/client`; note it in `CHANGELOG.md` |
| Provider or protocol wire behaviour | `packages/ai/AGENTS.md`, plus a record if a tradeoff was made |
| Config keys and defaults | `packages/core/src/config/**` doc comments and the product doc page |
| End-user behaviour or settings | `packages/web/src/content/docs/` |
| A cross-cutting rule for everyone working in this repo | `AGENTS.md`, as one index line — not a new section |
| How change knowledge itself is organized | `doc/conventions.md` |

## Contract tokens stay literal

An event name, a config key, a notice token, or a model-visible sentence is a contract once any consumer — UI,
projector, test, doc, or prompt — repeats it verbatim. Rename it in one place and the others fail silently rather
than at compile time.

So: pick the token once, write it into the owning topic doc, and grep that doc's spelling when you change a consumer.
Where a token is genuinely shared between the loop and the UI, keep the constant in code and let the doc record its
value and its meaning.

## Index discipline

`AGENTS.md` stays an index: commands, the map, a handful of hard rules. New conventions belong in the topic doc that
owns them; at most one line lands in the index. If a section of `AGENTS.md` is growing paragraphs, it is a `doc/`
file that has not been created yet.

Nested `AGENTS.md` files work the same way for their subtree — read the one nearest your edit before deciding where a
note belongs.
