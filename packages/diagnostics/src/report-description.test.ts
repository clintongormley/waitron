import { describe, expect, it } from "vitest";
import * as diagnostics from "./index.js";

describe("download report description", () => {
  it.each([
    ["", true],
    ["The page stopped responding.\nI tried again.\tStill stuck.", true],
    ["a".repeat(2000), true],
    ["a".repeat(2001), false],
    ["😀".repeat(2000), true],
    ["😀".repeat(2001), false],
  ])("validates code-point boundaries and ordinary whitespace %#", (description, valid) => {
    expect(diagnostics.reportDescriptionValid?.(description)).toBe(valid);
  });
  it.each(
    Array.from({ length: 160 }, (_, code) => code).filter(
      (code) => (code < 32 && code !== 9 && code !== 10) || code >= 127,
    ),
  )("refuses control character %i", (code) => {
    expect(
      diagnostics.reportDescriptionValid?.("before" + String.fromCharCode(code) + "after"),
    ).toBe(false);
  });
});
