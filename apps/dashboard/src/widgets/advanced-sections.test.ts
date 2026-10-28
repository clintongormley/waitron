import { describe, expect, it } from "vitest";
import {
  type ColourWarning,
  THEME_COLOURS,
  type ThemeWarning,
  type WarningField,
} from "@waitron/ui-core/theme";
import {
  ADVANCED_SECTIONS,
  COLOUR_SECTIONS,
  inSection,
  sectionHasError,
  sectionOfColour,
} from "./advanced-sections.js";

function colourWarning(field: WarningField): ColourWarning {
  const mode = field.startsWith("handSet.dark") ? "dark" : "light";
  return { field, mode, against: [], fix: null, blockedBy: [] };
}

const TEXT_WARNING: ThemeWarning = {
  field: "text.size.sm",
  mode: null,
  against: [],
  fix: 12,
  blockedBy: [],
};

function holding(warning: ThemeWarning): string[] {
  return ADVANCED_SECTIONS.filter((id) => inSection(id, warning));
}

describe("advanced sections", () => {
  it("holds each theme colour in exactly one section", () => {
    const flat = COLOUR_SECTIONS.flatMap((section) => section.keys);
    expect(flat.length).toBe(22);
    expect(new Set(flat).size).toBe(22);
    for (const key of THEME_COLOURS) expect(flat).toContain(key);
  });

  it("lists the sections and their colours in the design's order", () => {
    expect(ADVANCED_SECTIONS).toEqual(["surfaces", "text-colours", "buttons", "fields", "text"]);
    expect(COLOUR_SECTIONS.map((section) => [section.id, section.keys])).toEqual([
      [
        "surfaces",
        ["bg", "surface", "surface-raised", "surface-lifted", "surface-sunken", "track", "border"],
      ],
      ["text-colours", ["text", "text-muted", "primary-text"]],
      [
        "buttons",
        [
          "primary",
          "primary-hover",
          "on-primary",
          "primary-disabled",
          "on-primary-disabled",
          "stepper-button",
        ],
      ],
      [
        "fields",
        [
          "field-fill",
          "field-line",
          "field-label-focus",
          "field-value",
          "field-fill-disabled",
          "focus",
        ],
      ],
    ]);
  });

  it("finds the section holding a colour", () => {
    expect(sectionOfColour("primary-text")).toBe("text-colours");
    expect(sectionOfColour("focus")).toBe("fields");
    expect(sectionOfColour("stepper-button")).toBe("buttons");
    expect(sectionOfColour("bg")).toBe("surfaces");
  });

  it("places a warning in the section holding its field", () => {
    expect(holding(colourWarning("handSet.light.text"))).toEqual(["text-colours"]);
    expect(holding(colourWarning("handSet.dark.primary"))).toEqual(["buttons"]);
    expect(holding(colourWarning("handSet.light.primary-text"))).toEqual(["text-colours"]);
    expect(holding(TEXT_WARNING)).toEqual(["text"]);
    expect(holding(colourWarning("brandColor"))).toEqual([]);
  });

  it("says which section holds a field with an error message", () => {
    const withError = (
      errors: Parameters<typeof sectionHasError>[1],
      textErrors: Parameters<typeof sectionHasError>[2] = {},
    ) => ADVANCED_SECTIONS.filter((id) => sectionHasError(id, errors, textErrors));
    expect(withError({ "handSet.dark.field-line": "x" })).toEqual(["fields"]);
    expect(withError({ "handSet.dark.stepper-button": "x" })).toEqual(["buttons"]);
    expect(withError({ "handSet.light.bg": undefined })).toEqual([]);
    expect(withError({}, { "text.family": "x" })).toEqual(["text"]);
  });
});
