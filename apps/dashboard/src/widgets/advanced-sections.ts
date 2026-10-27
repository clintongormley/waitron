import { isTextWarning, type ThemeColour, type ThemeWarning } from "@waitron/ui-core/theme";
import type { HandField, TextField } from "./look-draft.js";

export type ColourSectionId = "surfaces" | "text-colours" | "buttons" | "fields";
export type AdvancedSectionId = ColourSectionId | "text";

export interface ColourSection {
  readonly id: ColourSectionId;
  readonly keys: readonly ThemeColour[];
}

export const COLOUR_SECTIONS: readonly ColourSection[] = [
  {
    id: "surfaces",
    keys: [
      "bg",
      "surface",
      "surface-raised",
      "surface-lifted",
      "surface-sunken",
      "track",
      "border",
    ],
  },
  { id: "text-colours", keys: ["text", "text-muted", "primary-text"] },
  {
    id: "buttons",
    keys: [
      "primary",
      "primary-hover",
      "on-primary",
      "primary-disabled",
      "on-primary-disabled",
      "stepper-button",
    ],
  },
  {
    id: "fields",
    keys: [
      "field-fill",
      "field-line",
      "field-label-focus",
      "field-value",
      "field-fill-disabled",
      "focus",
    ],
  },
];

export const ADVANCED_SECTIONS: readonly AdvancedSectionId[] = [
  ...COLOUR_SECTIONS.map((section) => section.id),
  "text",
];

const SECTION_OF = new Map<ThemeColour, ColourSectionId>(
  COLOUR_SECTIONS.flatMap((section) => section.keys.map((key) => [key, section.id] as const)),
);

export function sectionOfColour(key: ThemeColour): ColourSectionId {
  return SECTION_OF.get(key)!;
}

function colourOf(field: HandField): ThemeColour {
  return field.split(".")[2] as ThemeColour;
}

export function inSection(id: AdvancedSectionId, warning: ThemeWarning): boolean {
  if (isTextWarning(warning)) return id === "text";
  if (warning.field === "brandColor") return false;
  return sectionOfColour(colourOf(warning.field)) === id;
}

export function sectionHasError(
  id: AdvancedSectionId,
  errors: Readonly<Partial<Record<HandField, string>>>,
  textErrors: Readonly<Partial<Record<TextField, string>>>,
): boolean {
  if (id === "text") return Object.values(textErrors).some(Boolean);
  return (Object.entries(errors) as [HandField, string | undefined][]).some(
    ([field, message]) => Boolean(message) && sectionOfColour(colourOf(field)) === id,
  );
}
