import { describe, expect, test } from "bun:test"
import { estimate, estimateWide } from "./token.js"

describe("estimate", () => {
  test("charges four characters per token regardless of script", () => {
    expect(estimate("hello world")).toBe(3)
    expect(estimate("你好世界")).toBe(1)
    expect(estimate("")).toBe(0)
  })
})

describe("estimateWide", () => {
  test("charges one token per CJK glyph and four per token elsewhere", () => {
    expect(estimateWide("你好世界")).toBe(4)
    expect(estimateWide("hello world")).toBe(3)
    expect(estimateWide("")).toBe(0)
  })

  test("counts CJK punctuation as wide", () => {
    expect(estimateWide("你好，世界。")).toBe(6)
    expect(estimateWide("「引用」")).toBe(4)
    expect(estimateWide("《书名》")).toBe(4)
  })

  test("counts Hangul and Kana as wide", () => {
    expect(estimateWide("안녕하세요")).toBe(5)
    expect(estimateWide("こんにちは")).toBe(5)
  })

  test("keeps halfwidth forms narrow", () => {
    expect(estimateWide("ｱｲｳｴｵ")).toBe(estimate("ｱｲｳｴｵ"))
  })

  test("charges a surrogate pair once, not as two narrow characters", () => {
    expect(estimateWide("𠀀")).toBe(1)
    expect(estimateWide("🙂")).toBe(1)
  })

  test("matches the CJK-blind rule for text without wide characters", () => {
    for (const text of ["hello world", "const x = 1", "a", "", "abcd", "abcde", "   ", "x".repeat(4_001)])
      expect(estimateWide(text)).toBe(estimate(text))
  })

  test("never reads Chinese as shorter than the CJK-blind estimate", () => {
    const text = "这是一段用于比较两种估算口径的中文文本，包含标点符号。"

    expect(estimateWide(text)).toBeGreaterThan(estimate(text))
  })

  test("splits mixed text by script instead of by length", () => {
    const text = "ok 好的"

    expect(estimateWide(text)).toBe(estimate("ok ") + estimateWide("好的"))
  })
})
