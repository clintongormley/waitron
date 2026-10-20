import type { WaitronDefaults } from "./defaults.js";

export const THEME_COLOURS = [
  "bg",
  "surface",
  "surface-raised",
  "surface-lifted",
  "surface-sunken",
  "track",
  "border",
  "text",
  "text-muted",
  "primary",
  "primary-hover",
  "on-primary",
  "primary-disabled",
  "on-primary-disabled",
  "primary-text",
  "focus",
  "field-fill",
  "field-line",
  "field-label-focus",
  "field-value",
  "field-fill-disabled",
  "stepper-button",
] as const;

export type ThemeColour = (typeof THEME_COLOURS)[number];

export const colourToken = (key: string): string => `--wt-color-${key}`;

export const THEME_RADII = ["--wt-radius-sm", "--wt-radius-md", "--wt-radius-lg"] as const;

export const THEME_TOKENS: readonly string[] = [...THEME_COLOURS.map(colourToken), ...THEME_RADII];

export const BRAND_FAMILY: readonly ThemeColour[] = [
  "primary",
  "on-primary",
  "primary-hover",
  "primary-text",
  "focus",
  "field-label-focus",
  "primary-disabled",
  "on-primary-disabled",
  "surface-lifted",
  "stepper-button",
];

export type Corners = "square" | "standard" | "round";

const FIXED_CORNERS = {
  square: ["0px", "2px", "4px"],
  round: ["8px", "14px", "24px"],
} as const;

export function cornerRadii(corners: Corners, defaults: WaitronDefaults): Record<string, string> {
  return Object.fromEntries(
    THEME_RADII.map((radius, index) => [
      radius,
      corners === "standard" ? defaults.structure[radius]! : FIXED_CORNERS[corners][index]!,
    ]),
  );
}
