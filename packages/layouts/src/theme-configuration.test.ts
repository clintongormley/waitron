import type { ThemeChoices } from "@waitron/ui-core/theme";
import { describe, expect, it } from "vitest";
import { validateThemeConfiguration } from "./theme-configuration.js";

const LEMON: ThemeChoices = {
  brandColor: "#f2d300",
  brandFix: {},
  background: "neutral",
  corners: "standard",
  handSet: { light: {}, dark: {} },
};

const DARK_GREEN: ThemeChoices = { ...LEMON, brandColor: "#1e5b3a", background: "tinted" };

type Row = Record<string, unknown>;

const row = (name: string, choices: ThemeChoices, inUse: 1 | null): Row => ({
  id: `id-${name}`,
  name,
  name_key: name.toLowerCase(),
  in_use: inUse,
  theme: JSON.stringify(choices),
  updated_at: "2026-10-21T10:00:00.000Z",
});

const valid = (): Row[] => [row("Green", DARK_GREEN, 1), row("Lemon", LEMON, null)];

function refusal(rows: Row[]): unknown {
  try {
    validateThemeConfiguration({ custom_themes: rows });
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("validateThemeConfiguration", () => {
  it("accepts two themes, one in use and one not", () => {
    expect(() => validateThemeConfiguration({ custom_themes: valid() })).not.toThrow();
  });

  it("accepts the lemon brand (#f2d300) left unfixed, which is only hard to read", () => {
    expect(() =>
      validateThemeConfiguration({ custom_themes: [row("Lemon", LEMON, 1)] }),
    ).not.toThrow();
  });

  it("accepts a copy with no custom themes", () => {
    expect(() => validateThemeConfiguration({})).not.toThrow();
  });

  it.each<[string, Partial<Row>]>([
    ["a name that is not a string", { name: 7, name_key: "7" }],
    ["an empty name", { name: "", name_key: "" }],
    ["a name of 61 characters", { name: "a".repeat(61), name_key: "a".repeat(61) }],
    ["the reserved name", { name: "WAITRON", name_key: "waitron" }],
    ["a name with surrounding spaces", { name: " Lemon ", name_key: "lemon" }],
  ])("refuses %s as custom_themes.name", (_label, change) => {
    expect(refusal([{ ...row("Lemon", LEMON, null), ...change }])).toMatchObject({
      code: "setup.request_invalid",
      params: { field: "custom_themes.name" },
    });
  });

  it.each<[string, Partial<Row>]>([
    ["a key that is not the name's", { name_key: "other" }],
    ["a key left in the name's case", { name_key: "Lemon" }],
    ["a missing key", { name_key: undefined }],
    ["an NFD key for an NFC name", { name: "Zoë", name_key: "zoë" }],
  ])("refuses %s as custom_themes.name_key", (_label, change) => {
    expect(refusal([{ ...row("Lemon", LEMON, null), ...change }])).toMatchObject({
      code: "setup.request_invalid",
      params: { field: "custom_themes.name_key" },
    });
  });

  it.each([0, 2, true, "1", undefined])("refuses in_use %j as custom_themes.in_use", (inUse) => {
    expect(refusal([{ ...row("Lemon", LEMON, null), in_use: inUse }])).toMatchObject({
      code: "setup.request_invalid",
      params: { field: "custom_themes.in_use" },
    });
  });

  it.each<[string, unknown]>([
    ["a theme that is not a string", LEMON],
    ["a theme that is not JSON", "{broken"],
    ["a theme document this release refuses", '{"tokens":{}}'],
    ["a theme whose brand colour is not hex", JSON.stringify({ ...LEMON, brandColor: "yellow" })],
  ])("refuses %s as custom_themes.theme", (_label, theme) => {
    expect(refusal([{ ...row("Lemon", LEMON, null), theme }])).toMatchObject({
      code: "setup.request_invalid",
      params: { field: "custom_themes.theme" },
    });
  });

  it("refuses two themes in use as custom_themes.in_use", () => {
    expect(refusal([row("Green", DARK_GREEN, 1), row("Lemon", LEMON, 1)])).toMatchObject({
      code: "setup.request_invalid",
      params: { field: "custom_themes.in_use" },
    });
  });

  it("refuses two themes whose names differ only by case as custom_themes.name_key", () => {
    expect(refusal([row("Lemon", LEMON, 1), row("LEMON", DARK_GREEN, null)])).toMatchObject({
      code: "setup.request_invalid",
      params: { field: "custom_themes.name_key" },
    });
  });

  it("checks a row's own fields before the checks across rows", () => {
    expect(
      refusal([row("Lemon", LEMON, 1), { ...row("Green", DARK_GREEN, 1), theme: "{broken" }]),
    ).toMatchObject({ params: { field: "custom_themes.theme" } });
  });
});
