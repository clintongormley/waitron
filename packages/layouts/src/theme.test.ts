import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { THEMEABLE_TOKENS, validateThemeOverride } from "./theme.js";

function reason(fn: () => unknown): string {
  try {
    fn();
    throw new Error("did not throw");
  } catch (e) {
    if (e instanceof AppError) return String(e.params.reason);
    throw e;
  }
}

describe("validateThemeOverride", () => {
  it("accepts allowlisted tokens with safe values", () => {
    const token = THEMEABLE_TOKENS[0];
    const t = validateThemeOverride({ tokens: { [token]: "#1a2b3c" } });
    expect(t.tokens[token]).toBe("#1a2b3c");
  });
  it("rejects a non-object", () => {
    expect(reason(() => validateThemeOverride(null))).toBe("not_object");
  });
  it("rejects a missing tokens map", () => {
    expect(reason(() => validateThemeOverride({}))).toBe("bad_tokens");
  });
  it("rejects an un-allowlisted token", () => {
    expect(reason(() => validateThemeOverride({ tokens: { "--evil": "red" } }))).toBe(
      "unknown_token",
    );
  });
  it("rejects a value with unsafe characters (CSS injection)", () => {
    const token = THEMEABLE_TOKENS[0];
    expect(
      reason(() => validateThemeOverride({ tokens: { [token]: "red; } body{display:none}" } })),
    ).toBe("bad_value");
  });
  it("rejects an over-long value", () => {
    const token = THEMEABLE_TOKENS[0];
    expect(reason(() => validateThemeOverride({ tokens: { [token]: "a".repeat(65) } }))).toBe(
      "too_long",
    );
  });
});
