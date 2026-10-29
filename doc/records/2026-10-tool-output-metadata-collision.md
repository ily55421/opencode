# The tool-output bound was silently disabled by a metadata name collision

Current behaviour is in `doc/context-economics.md`. This record keeps how the clipper came to be skipped, because the
failure is invisible from either side of the boundary.

## Symptom

A real session against a real model asked for `grep` with `limit: 2000` over a file whose lines are ~200 characters. The
durable tool result in `session_message` was 427 881 characters with `truncated: false` and no clip marker — the size
bound never applied. `read` behaved the same way above `MAX_BYTES`. Nothing failed, nothing logged, and unit tests that
called `truncate` directly stayed green, because they never passed the metadata the real tools attach.

## Mechanism

`ToolOutput.truncate` opened with an idempotence guard:

> return the result unchanged when `result.metadata?.truncated !== undefined`

That key was already taken. `grep` sets `metadata: { matches, truncated }` to report **match-cap** truncation, and
`read` sets `metadata: { truncated }` to report **page-boundary** truncation. Both define it as their own signal and
both set it on every result, so the guard read "a tool mentioned truncation" as "the size bound has already been
handled" and returned early. The clipper therefore ran only for tools that say nothing about truncation at all.

A single boolean key in a shared, untyped metadata record, interpreted as a claim by two different owners.

## Why it survived

- The guard looks correct read alone: a flag named `truncated` set on a result that is about to be marked truncated.
- The two writers are in different packages from the reader, and nothing types the metadata record — it is
  `Record(String, Json)` on the tool result, so no compiler could see the overlap.
- Tests called the service with hand-built results that omitted `metadata`, which is the one shape where the clipper
  runs. The real chain was the only place the collision existed.

## Fix

Record the service's own decision under `metadata.toolOutput` (`{ truncated, outputPath }`) and gate idempotence on that
key. Nothing outside `tool-output.ts` read the old flat keys, so no consumer moved. A tool's `truncated` is left alone as
the tool's own statement, and a result is still clipped only once because the service checks the key it wrote.

## What would prove this wrong

If some client or plugin is found reading `metadata.truncated` to mean "the size bound was applied", the two meanings
still overlap and the flag needs splitting on that side too. If bounded results turn out to lose information users
needed — a `read` page that the clipper now cuts where the tool intended the full page — the answer is to raise
`tool_output.max_bytes` per project rather than to restore the skip.
