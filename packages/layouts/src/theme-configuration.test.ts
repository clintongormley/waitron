import type { ThemeChoices } from "@waitron/ui-core/theme";
import { describe, expect, it } from "vitest";
import { validateThemeConfiguration } from "./theme-configuration.js";
import type { ReceiptLogoRasters } from "./types.js";

const LEMON: ThemeChoices = {
  brandColor: "#f2d300",
  brandFix: {},
  background: "neutral",
  corners: "standard",
  logo: null,
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

function refusal(rows: Row[], images: Row[] = []): unknown {
  try {
    validateThemeConfiguration({ custom_themes: rows, media_images: images });
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
    ["a theme that is a JSON array", "[]"],
    ["a theme that is JSON null", "null"],
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

  describe("a theme's logo and its printed dots", () => {
    const PRINTABLE: ReceiptLogoRasters = {
      "58mm": { widthDots: 8, heightDots: 1, data: "/w==" },
      "80mm": { widthDots: 8, heightDots: 1, data: "/w==" },
    };
    const L = `${"a".repeat(64)}.webp`;
    const D = `${"c".repeat(64)}.webp`;
    const images = [{ filename: L }, { filename: D }];
    const { logo: _, ...noLogo } = LEMON;
    void _;
    const themed = (document: unknown): Row => ({
      ...row("Lemon", LEMON, null),
      theme: JSON.stringify(document),
    });
    const WITH_LOGO = { ...LEMON, logo: { light: L, dark: D }, printedLogo: PRINTABLE };

    it("accepts a logo whose two pictures are carried, with printable dots", () => {
      expect(refusal([themed(WITH_LOGO)], images)).toBeUndefined();
    });

    it("accepts a logo with only a light picture, carried in the copy", () => {
      const lightOnly = { ...LEMON, logo: { light: L }, printedLogo: PRINTABLE };
      expect(refusal([themed(lightOnly)], [{ filename: L }])).toBeUndefined();
    });

    it("accepts no logo with no media_images table at all", () => {
      expect(() =>
        validateThemeConfiguration({ custom_themes: [themed({ ...LEMON, logo: null })] }),
      ).not.toThrow();
    });

    it("accepts a document copied before logos, with no logo key and no dots", () => {
      expect(refusal([themed(noLogo)])).toBeUndefined();
    });

    it.each<[string, unknown, Row[]]>([
      ["a light picture not carried", WITH_LOGO, [{ filename: D }]],
      ["a dark picture not carried", WITH_LOGO, [{ filename: L }]],
      ["a logo with no printed dots", { ...LEMON, logo: { light: L } }, images],
      [
        "printed dots that cannot be printed",
        {
          ...WITH_LOGO,
          printedLogo: { ...PRINTABLE, "80mm": { ...PRINTABLE["80mm"], data: "x" } },
        },
        images,
      ],
      ["printed dots beside no logo", { ...LEMON, logo: null, printedLogo: PRINTABLE }, images],
      [
        "printed dots in a document with no logo key",
        { ...noLogo, printedLogo: PRINTABLE },
        images,
      ],
    ])("refuses %s as custom_themes.theme", (_label, document, carried) => {
      expect(refusal([themed(document)], carried)).toMatchObject({
        code: "setup.request_invalid",
        params: { field: "custom_themes.theme" },
      });
    });
  });
});
