export * as Token from "./token.js"

// The rules live in @opencode/util so the desktop client, which cannot depend on core, estimates with the same module.
export { estimate } from "@opencode/util/token"
