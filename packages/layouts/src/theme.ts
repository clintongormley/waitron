import { AppError } from "@waitron/shared";
import "./errors.js";
import type { ThemeOverride } from "./canvas.js";

/**
 * An allowlist, so a theme can never set an arbitrary CSS custom property. Each name must be
 * declared in `packages/ui-core/src/tokens/{colors,structure}.css`, which `theme-registry.test.ts`
 * checks.
 */
export const THEMEABLE_TOKENS: readonly string[] = [
  "--wt-color-primary",
  "--wt-color-on-primary",
  "--wt-color-surface",
  "--wt-color-text",
  "--wt-color-danger",
  "--wt-radius-md",
  "--wt-font-family",
];

export const MAX_THEME_VALUE_LENGTH = 64;

// Excludes ; { } : < > " ' \ so a value cannot break out of its `--token: value;` declaration.
const SAFE_VALUE = /^[A-Za-z0-9 #%.,()\-/]+$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function validateThemeOverride(input: unknown): ThemeOverride {
  if (!isPlainObject(input)) throw new AppError("theme.invalid", { reason: "not_object" });
  if (!isPlainObject(input.tokens)) throw new AppError("theme.invalid", { reason: "bad_tokens" });
  const tokens: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.tokens)) {
    if (!THEMEABLE_TOKENS.includes(name)) {
      throw new AppError("theme.invalid", { reason: "unknown_token" });
    }
    if (typeof value !== "string" || !SAFE_VALUE.test(value)) {
      throw new AppError("theme.invalid", { reason: "bad_value", token: name });
    }
    if (value.length > MAX_THEME_VALUE_LENGTH) {
      throw new AppError("theme.invalid", {
        reason: "too_long",
        token: name,
        maxLength: MAX_THEME_VALUE_LENGTH,
      });
    }
    tokens[name] = value;
  }
  return { tokens };
}
