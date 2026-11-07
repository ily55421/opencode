import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/**
 * Windows grants symlink creation only with Developer Mode or an elevated shell; every other
 * platform grants it unconditionally. Probe once per run so tests that need a symlink skip with
 * the reason on a machine that cannot make one, instead of dying with EPERM mid-suite.
 */
export const canSymlink = (() => {
  if (process.platform !== "win32") return true
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "symlink-probe-"))
  try {
    const target = path.join(dir, "target.txt")
    fs.writeFileSync(target, "")
    fs.symlinkSync(target, path.join(dir, "link"))
    return true
  } catch {
    return false
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})()

export const SYMLINK_SKIP_REASON =
  "this Windows user cannot create symlinks (Developer Mode off); the coverage runs on CI and Developer-Mode machines"
