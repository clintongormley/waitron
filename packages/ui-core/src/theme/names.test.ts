import { describe, expect, it } from "vitest";
import {
  BUILT_IN_THEME_NAME,
  checkThemeName,
  THEME_NAME_MAX_LENGTH,
  themeNameKey,
} from "./names.js";

describe("themeNameKey", () => {
  it("composes, trims and lower-cases", () => {
    expect(themeNameKey("  Zoë Studio ")).toBe(themeNameKey("zoë studio"));
    expect(themeNameKey("  Zoë Studio ")).toBe("zoë studio");
  });

  it("composes again after lower-casing, so a capital and its small letter share a key", () => {
    expect(themeNameKey("T̈")).toBe("ẗ");
    expect(themeNameKey("T̈")).toBe(themeNameKey("ẗ"));
  });
});

describe("checkThemeName", () => {
  it("names its limits", () => {
    expect(THEME_NAME_MAX_LENGTH).toBe(60);
    expect(BUILT_IN_THEME_NAME).toBe("Waitron");
  });

  it("keeps the trimmed name as typed beside its key", () => {
    expect(checkThemeName("  Bar  ")).toEqual({ ok: true, name: "Bar", key: "bar" });
  });

  it("keeps the typed accent form in the name and composes it in the key", () => {
    expect(checkThemeName(" Zoë ")).toEqual({
      ok: true,
      name: "Zoë",
      key: "zoë",
    });
  });

  it.each(["", "   ", "\t\n"])("refuses an empty name (%j)", (name) => {
    expect(checkThemeName(name)).toEqual({ ok: false, reason: "empty" });
  });

  it("counts up to 60 characters, an emoji or a composed accent counting once", () => {
    expect(checkThemeName("a".repeat(60)).ok).toBe(true);
    expect(checkThemeName("a".repeat(61))).toEqual({ ok: false, reason: "too_long" });
    expect(checkThemeName(` ${"a".repeat(60)} `).ok).toBe(true);
    expect(checkThemeName("🍋".repeat(60)).ok).toBe(true);
    expect(checkThemeName("🍋".repeat(61))).toEqual({ ok: false, reason: "too_long" });
    expect(checkThemeName("a".repeat(59) + "é").ok).toBe(true);
  });

  it.each(["Waitron", "WAITRON", " waitron "])("refuses the built-in name (%j)", (name) => {
    expect(checkThemeName(name)).toEqual({ ok: false, reason: "reserved" });
  });

  it("accepts a name that holds the built-in name inside it", () => {
    expect(checkThemeName("Waitron 2")).toEqual({ ok: true, name: "Waitron 2", key: "waitron 2" });
  });
});
