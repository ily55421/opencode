import type { SessionMessageAssistant, TokenUsageInfo } from "@opencode/client/promise"
import { estimateWide } from "@opencode/util/token"

/** Output and reasoning tokens per second for a step whose provider stream has ended. */
export function stepTokensPerSecond(message: SessionMessageAssistant) {
  if (!message.tokens || message.time.streamed === undefined) return
  const output = message.tokens.output + message.tokens.reasoning
  const elapsed = message.time.streamed - message.time.created

  if (output <= 0 || elapsed <= 0) return

  return (output / elapsed) * 1_000
}

/**
 * Approximate tokens produced so far, while the provider stream is still open. Script-aware rather than the server's
 * CJK-blind four-characters-per-token rule, so a Chinese reply does not read as four times slower than an English one.
 */
export function estimateOutputTokens(content: SessionMessageAssistant["content"]) {
  let total = 0

  for (const part of content) {
    if (part.type !== "tool") {
      total += estimateWide(part.text)
      continue
    }

    total += estimateWide(part.state.status === "streaming" ? part.state.input : JSON.stringify(part.state.input))
  }

  return total
}

/** Prompt tokens the provider served from its cache, as a percentage of every prompt token the step billed. */
export function cacheHitRate(tokens: TokenUsageInfo) {
  const prompt = tokens.input + tokens.cache.read + tokens.cache.write

  return prompt > 0 ? (tokens.cache.read / prompt) * 100 : undefined
}

/** Every token a step counted toward the context window, as the Session Context panel reports it. */
export function contextSize(tokens: TokenUsageInfo) {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
}
