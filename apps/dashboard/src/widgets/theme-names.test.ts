import { afterEach, describe, expect, it } from "vitest";
import { THEME_NAME_MAX_LENGTH, checkThemeName } from "@waitron/ui-core/theme";
import { codeMessage } from "../i18n/codes.js";
import { es } from "../i18n/strings.js";
import { setLocale } from "../i18n/t.js";
import { copyName, nameCheckText, nameRefusalText } from "./theme-names.js";

afterEach(() => setLocale("en-GB"));

const codePoints = (text: string): number => [...text.normalize("NFC")].length;

describe.each([
  { locale: "en-GB", suffix: " (copy)" },
  { locale: "es-ES", suffix: es["appearance.copy_name"].replace("{name}", "") },
] as const)("copyName in $locale", ({ locale, suffix }) => {
  it("adds the copy words to a short name", () => {
    setLocale(locale);
    expect(copyName("Bar Lucía")).toBe(`Bar Lucía${suffix}`);
    expect(copyName("Waitron")).toBe(`Waitron${suffix}`);
    expect(checkThemeName(copyName("Waitron")).ok).toBe(true);
  });

  it("shortens a long name so the whole fits the limit", () => {
    setLocale(locale);
    const copy = copyName("x".repeat(THEME_NAME_MAX_LENGTH));
    expect(codePoints(copy)).toBe(THEME_NAME_MAX_LENGTH);
    expect(copy.endsWith(suffix)).toBe(true);
    expect(checkThemeName(copy).ok).toBe(true);
  });

  it("counts a decomposed accent once", () => {
    setLocale(locale);
    const copy = copyName("é".repeat(THEME_NAME_MAX_LENGTH));
    expect(codePoints(copy)).toBe(THEME_NAME_MAX_LENGTH);
    expect(copy).toBe(`${"é".repeat(THEME_NAME_MAX_LENGTH - suffix.length)}${suffix}`);
    expect(checkThemeName(copy).ok).toBe(true);
  });

  it("does not keep a space at the cut", () => {
    setLocale(locale);
    const kept = THEME_NAME_MAX_LENGTH - suffix.length - 1;
    const copy = copyName(`${"a".repeat(kept)} ${"b".repeat(10)}`);
    expect(copy).toBe(`${"a".repeat(kept)}${suffix}`);
  });
});

it("words each name check's refusal", () => {
  expect(nameCheckText(checkThemeName("Lemon"))).toBe("");
  expect(nameCheckText({ ok: false, reason: "empty" })).toBe("Enter a name.");
  expect(nameCheckText({ ok: false, reason: "too_long" })).toBe("Use 60 characters or fewer.");
  expect(nameCheckText({ ok: false, reason: "reserved" })).toBe(
    '"Waitron" is the built-in theme\'s name. Pick another.',
  );
});

it("words a server's refusal of a name and nothing else", () => {
  expect(nameRefusalText("theme.name_taken", undefined)).toBe(codeMessage("theme.name_taken"));
  expect(codeMessage("theme.name_taken")).toBe("A theme with this name already exists.");
  const name = (reason: string) => ({ field: "name", reason });
  expect(nameRefusalText("theme.invalid", name("reserved"))).toBe(
    '"Waitron" is the built-in theme\'s name. Pick another.',
  );
  expect(nameRefusalText("theme.invalid", name("empty"))).toBe("Enter a name.");
  expect(nameRefusalText("theme.invalid", name("too_long"))).toBe("Use 60 characters or fewer.");
  expect(nameRefusalText("theme.invalid", name("contrast"))).toBe("");
  expect(nameRefusalText("theme.invalid", { field: "brandColor", reason: "too_long" })).toBe("");
  expect(nameRefusalText("theme.invalid", { reason: "too_long" })).toBe("");
  expect(nameRefusalText("theme.invalid", undefined)).toBe("");
  expect(nameRefusalText("theme.not_found", undefined)).toBe("");
});

it("words the refusals in Spanish", () => {
  setLocale("es-ES");
  expect(nameRefusalText("theme.name_taken", undefined)).toBe(
    codeMessage("theme.name_taken", "es"),
  );
  expect(codeMessage("theme.name_taken", "es")).not.toBe(codeMessage("theme.name_taken", "en"));
  expect(nameCheckText({ ok: false, reason: "reserved" })).toBe(es["appearance.name_reserved"]);
});
