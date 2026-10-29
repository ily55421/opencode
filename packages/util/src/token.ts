const CHARS_PER_TOKEN = 4

/**
 * Four characters per token, blind to script. The server's compaction thresholds are calibrated against this, so it
 * reads Chinese text as roughly a quarter of its real length; see `estimateWide` for why both rules exist.
 */
export function estimate(input: string) {
  return Math.max(0, Math.round(input.length / CHARS_PER_TOKEN))
}

/**
 * One token per East Asian glyph, and the same four-characters-per-token rule as `estimate` everywhere else, which
 * matches real tokenizers at roughly 0.7-1 token per CJK character. The narrow half deliberately reproduces `estimate`
 * so switching a caller to this rule changes only text that contains wide characters: an English or code session
 * estimates exactly as before, and every threshold tuned against it keeps its meaning.
 */
export function estimateWide(input: string) {
  let wide = 0
  let narrow = 0

  // Iterating code points charges a surrogate pair (CJK extension B, emoji) once instead of as two narrow characters.
  for (const char of input) {
    if (isWide(char.codePointAt(0)!)) wide++
    else narrow++
  }

  return wide + Math.max(0, Math.round(narrow / CHARS_PER_TOKEN))
}

/** East Asian Width W and F ranges, plus emoji, which tokenizers charge like ideographs. Halfwidth forms stay narrow. */
function isWide(code: number) {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xa960 && code <= 0xa97f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff01 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1b000 && code <= 0x1b2ff) ||
    (code >= 0x1f000 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  )
}
