export * as Token from "./token.js"

// The rules live in @opencode/util so the desktop client, which cannot depend on core, estimates with the same module.
// `estimateWide` is the rule the server budgets are read against; `estimate` stays for callers that need the
// script-blind count, and both agree on text without wide characters.
export { estimate, estimateWide } from "@opencode/util/token"
