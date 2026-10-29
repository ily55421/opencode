# Records

Plans, implementation records and post-mortems. These are **historical**: they are the evidence for why the code is
shaped as it is, so they are not rewritten when the design moves on.

Write one when a decision has a real alternative behind it — the kind where a reader six months later looks at the
code, sees the shape, and asks "why not the obvious way?". Answer that question here, once, and let the topic doc carry
the current state.

## Naming

`doc/records/<yyyy-mm>-<slug>.md` — for example `2026-10-todo-completion-nudge.md`. The date is when the decision was
made, not when the file was last touched; the slug is what you would grep for.

## Shape

Situation, the options actually considered (including the one that was tempting), what was chosen, and what would prove
it wrong. Cite code by symbol, never by line number, and link the topic doc that now owns the behaviour.

## Overtaken

When a topic doc's behaviour moves past a record, add one line at the top of the record pointing at the doc that
supersedes it, and leave the rest of the text alone. Deleting a record erases the reason.
