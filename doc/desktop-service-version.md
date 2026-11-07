# Desktop service version contract

How the desktop app knows which CLI build its background service is running, and what happens when
the two disagree.

## The two versions

- **Expected** — `DesktopCli.Service.resolve` stages (or reuses) the bundled CLI and returns its
  version, parsed from `--version` output by `parseCliVersion`. This is the build the app was
  shipped with and the one the current window's code assumes.
- **Running** — the background service writes a registered-service file on startup; `adopt` reads
  the `version` field back from it. This is what is actually answering requests.

## When the check runs

`BackgroundService.adopt` runs `checkVersion` on **every** connection — `initial` and `reconnect`
alike. A reconnect adopts whatever service is already listening, so it is exactly where a stale
build survives an app update and keeps answering with old behavior; skipping the check there was
the defect this contract closed.

## What happens on a mismatch

`checkVersion` (in `packages/desktop/src/main/service/cli-version.ts` — the single source for this
comparison) classifies the pair, and `adopt`:

- **mismatch** — logs a `logWarning` naming expected and running, so the stale-CLI trap (an install
  that left a previous build staged and running) is visible in the logs instead of a side-by-side
  logInfo nobody reads. Requests continue against the running service; a restart of the app picks
  the freshly staged build per AGENTS.md "Local Release Builds".
- **match / unknown** — the ready logInfo records both versions; `unknown` covers a service file
  without a readable version (old service, hand-edited channel file).
- `keptStages` keeps the running version's stage directory on disk either way, so downgrading or
  re-staging never deletes the binary the running service still executes.

## Decisions

- **Warn, don't block.** Refusing the connection on a mismatch would brick the app whenever the
  update pipeline stages a new CLI before the old service has drained; the visible warning keeps
  the operator in control. A hard protocol break already has its own guard
  (`shouldRetryEnsure`'s incompatible-health-protocol message).
- **Compare resolved against reported, not app against CLI.** The desktop app version and the CLI
  version drift independently (the CLI stages under its own version); the meaningful equality is
  between the CLI the app resolved and the CLI that answered.
