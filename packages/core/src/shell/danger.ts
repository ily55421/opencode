export * as ShellDanger from "./danger.js"

/**
 * What a shell command looks like to the permission layer before any user rule is consulted.
 *
 * `dangerous` is a recognised destructive shape. `unanalyzable` means the rule engine is being asked to approve text
 * whose target it cannot see — an expansion, a payload handed to another interpreter, or a command the scanner
 * refused to parse. Both escalate to a prompt over a broad allow rule; neither is a hard failure, because a human
 * can decide in one tap what a parser cannot.
 */
export type Risk = "safe" | "dangerous" | "unanalyzable"

/** Prefixes that hide the command they run rather than changing it. */
const WRAPPERS = new Set(["sudo", "doas", "exec", "nohup", "nice", "stdbuf", "time", "command", "busybox"])

/** `env VAR=x rm …` keeps skipping assignments until it reaches the real command. */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/** Interpreters that run their argument as a new command. */
const NESTED = new Set(["sh", "bash", "zsh", "dash", "ksh", "eval", "source", "."])

/** Commands whose whole purpose is writing to a raw device. */
const DEVICES = new Set(["dd", "mkfs", "shred", "wipefs"])

const POWEROFF = new Set(["shutdown", "reboot", "halt", "poweroff"])

/**
 * Commands whose effect depends on the operand the rules cannot read. An expansion in one of these hides what gets
 * destroyed or signalled, which is why it escalates; the same expansion in `echo` or `cat` does not.
 */
const CONSEQUENTIAL = new Set([
  "rm",
  "mv",
  "cp",
  "ln",
  "chmod",
  "chown",
  "chgrp",
  "dd",
  "mkfs",
  "shred",
  "wipefs",
  "find",
  "tar",
  "kill",
  "killall",
  "pkill",
  "xargs",
  "truncate",
  "tee",
])

const ROOTS = new Set(["/", "/*", "~", "~/", "$HOME", "$HOME/", "$HOME/*"])

/** Top-level filesystem directories. `/tmp/x` is ordinary work; `/tmp` and `/usr` are not. */
const SYSTEM = new Set([
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/lib",
  "/lib64",
  "/proc",
  "/root",
  "/sbin",
  "/sys",
  "/usr",
  "/var",
])

const RECURSION_DEPTH = 3

export function classify(command: string, depth = RECURSION_DEPTH): Risk {
  const text = command.trim()
  if (text === "") return "safe"

  // A fork bomb is unreadable as a token list on purpose; match the shape.
  if (/:\s*\(\s*\)\s*\{[^}]*\|[^}]*&[^}]*\}\s*;/.test(text)) return "dangerous"
  if (/(^|\|)\s*(xargs\s+)?(rm|shred|dd|mkfs)\b[^|;]*\/dev\/(sd|nvme|hd|disk|vd)/.test(text)) return "dangerous"
  if (/(curl|wget)\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/.test(text)) return "dangerous"
  if (/>>?\s*\/dev\/(sd|nvme|hd|disk|vd)/.test(text)) return "dangerous"

  const pipeline = text.split(/[|;&]{1,2}/).filter((part) => part.trim() !== "")

  for (const part of pipeline) {
    const risk = classifyWords(words(part), depth)
    if (risk !== "safe") return risk
  }

  return "safe"
}

function classifyWords(tokens: string[], depth: number): Risk {
  const head = unwrap(tokens)

  if (head === undefined) return tokens.length === 0 ? "safe" : "unanalyzable"

  const [name, ...rest] = head
  if (NESTED.has(name)) return nested(head, depth)

  // Shape first: `rm -rf $HOME` is recognisable as a target even though the token itself is an expansion, and
  // "dangerous" tells the user more than "unanalyzable" does.
  if (destructive(name) && head.some((token) => ROOTS.has(token) || SYSTEM.has(token))) return "dangerous"
  if (DEVICES.has(name) && head.some(device)) return "dangerous"
  if (name === "find" && head.includes("-delete") && targetsRoot(head)) return "dangerous"
  if (POWEROFF.has(name) && rest.some((token) => !token.startsWith("-"))) return "dangerous"
  if (name === "init" && ["0", "6"].includes(rest.find((token) => !token.startsWith("-")) ?? "")) return "dangerous"

  // Two different secrets hide in a `$`. `$(…)` or a backtick run arbitrary code no rule can see, whatever the head
  // command is. A bare expansion only matters when the command can change state, because that is when the rule engine
  // cannot see what gets touched — `echo "exit=$?"` at the end of a safe command is not a hidden target.
  if (head.some(substitution)) return "unanalyzable"
  if (CONSEQUENTIAL.has(name) && head.some(expansion)) return "unanalyzable"

  return "safe"
}

/** Drops `sudo`, `env X=1`, and similar wrappers so a rule cannot be dodged by prefixing one. */
function unwrap(tokens: string[]): string[] | undefined {
  let rest = tokens

  for (;;) {
    if (rest.length === 0) return undefined
    const name = base(rest[0])

    if (WRAPPERS.has(name)) {
      // A wrapper's own flags precede the program: `nice -n 5 rm …` still runs `rm`.
      rest = rest.slice(1)
      if (rest[0]?.startsWith("-")) {
        rest = rest.slice(1)
        if (rest[0] !== undefined && /^\d+$/.test(rest[0])) rest = rest.slice(1)
      }
      continue
    }
    if (name === "env") {
      const next = rest.slice(1)
      if (next[0] !== undefined && ASSIGNMENT.test(next[0])) {
        rest = next
        continue
      }
      if (next[0]?.startsWith("-")) {
        rest = next
        continue
      }
      return next
    }
    if (ASSIGNMENT.test(rest[0])) {
      rest = rest.slice(1)
      continue
    }
    return rest
  }
}

function nested(tokens: string[], depth: number): Risk {
  const [name, ...rest] = tokens

  if (name === "eval" || name === "source" || name === ".")
    return rest.some(dynamic) || depth <= 0 ? "unanalyzable" : classify(rest.join(" "), depth - 1)

  const flag = rest.findIndex((token) => /^-[a-z]*c[a-z]*$/i.test(token))
  if (flag < 0) return rest.some(dynamic) ? "unanalyzable" : "safe"
  if (depth <= 0) return "unanalyzable"

  // The payload of `sh -c` is a whole command the outer parse never saw; classify it as its own command.
  return classify(rest[flag + 1] ?? "", depth - 1)
}

/** `rm`, `chmod` and `chown` only escalate when they recurse; a single-file removal is ordinary work. */
function destructive(name: string | undefined) {
  if (name === "rm") return true
  return name === "chmod" || name === "chown" || name === "chgrp"
}

/** `find . -delete` is ordinary cleanup; `find / -delete` is not. */
const targetsRoot = (tokens: string[]) => tokens.includes("/") || ROOTS.has(tokens[1] ?? "")

const dynamic = (token: string) => token.includes("$") || token.includes("`")

/** Runs code the rule engine never sees, whatever it is embedded in. */
const substitution = (token: string) => token.includes("$(") || token.includes("`")

/** Names a value rather than a literal, so the target of a state-changing command is unknown. */
const expansion = (token: string) => token.includes("$")

const device = (token: string) => token.startsWith("/dev/") && token !== "/dev/null"

const base = (token: string) => token.split("/").pop() ?? token

/** Quoted words arrive as separate tokens from the parser; rejoin so `rm -rf "my dir"` keeps its operands aligned. */
function words(part: string) {
  const out: string[] = []
  let current = ""
  let quote: string | undefined

  for (const char of part) {
    if (quote) {
      if (char === quote) quote = undefined
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current !== "") out.push(current)
      current = ""
      continue
    }
    current += char
  }

  if (current !== "") out.push(current)
  return out
}
