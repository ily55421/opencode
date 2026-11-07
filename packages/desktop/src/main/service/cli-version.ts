export function parseCliVersion(output: string) {
  const marker = output.lastIndexOf(" v")
  const version = marker === -1 ? output : output.slice(marker + 2)

  if (!version) throw new Error("V2 CLI did not provide a version")

  return version
}

export function serviceVersion(input: {
  readonly channel: "local" | "dev" | "beta" | "prod"
  readonly isolated?: boolean
  readonly mode: "initial" | "reconnect"
  readonly version: string
}) {
  if (input.mode === "reconnect") return undefined

  if (input.channel === "beta" && !input.isolated) return undefined

  return input.version
}

// Retrying on timeout can also replace a server stuck in a migration longer than 120 s, which is accepted.
export function shouldRetryEnsure(version: string | undefined, message: string) {
  if (version !== undefined) return false

  return (
    message === "Background service failed to start" ||
    message === "Timed out waiting for the background service to start"
  )
}

/** Whether the background service is running the CLI build this app resolved, or a different one. */
export type VersionCheck =
  | { readonly status: "match"; readonly version: string }
  | { readonly status: "mismatch"; readonly expected: string; readonly running: string }
  | { readonly status: "unknown"; readonly expected: string | undefined }

/**
 * The one place that compares the CLI build the app resolved against the build the background
 * service reports. Both `initial` and `reconnect` connections run it: a reconnect adopts whatever
 * service is already listening, and without this check a service left over from a previous app
 * version would answer with old behavior while the log only ever noted the two versions side by side.
 */
export function checkVersion(expected: string | undefined, running: string | undefined): VersionCheck {
  if (running === undefined || expected === undefined) return { status: "unknown", expected }
  return expected === running
    ? { status: "match", version: expected }
    : { status: "mismatch", expected, running }
}

export function stageName(version: string, arch = process.arch) {
  return `${version}-${arch}`.replace(/[^a-zA-Z0-9._-]/g, "-")
}

export function keptStages(bundledVersion: string, runningVersion?: string, arch = process.arch) {
  const stages = [stageName(bundledVersion, arch)]

  if (runningVersion && runningVersion !== bundledVersion) stages.push(stageName(runningVersion, arch))

  return stages
}
