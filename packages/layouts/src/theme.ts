import { AppError } from "@waitron/shared";
import "./errors.js";
import type { ThemeOverride } from "./profile.js";

/**
 * The `--wt-*` tokens a theme override may set (design §9). An ALLOWLIST, fail-closed: a theme can only
 * touch chrome tokens, never an arbitrary CSS custom property, so it can never smuggle a property the
 * design system does not expose. Extend as the design system exposes more themeable tokens.
 */
export const THEMEABLE_TOKENS: readonly string[] = [
  "--wt-color-primary",
  "--wt-color-primary-text",
  "--wt-color-surface",
  "--wt-color-surface-text",
  "--wt-color-accent",
  "--wt-color-danger",
  "--wt-radius",
  "--wt-font-family",
];

/** Value cap (design §9). Carried in `too_long` as the cap, never the offending length (CLAUDE.md §1). */
export const MAX_THEME_VALUE_LENGTH = 64;

// A conservative charset for a token value: letters, digits, spaces and the punctuation that appears in
// colours, lengths, and font stacks (#, %, ., ,, (), -, /). Notably EXCLUDES ; { } : < > " ' \ so a
// value cannot break out of a `--token: value;` declaration into another rule (CSS-injection safe).
const SAFE_VALUE = /^[A-Za-z0-9 #%.,()\-/]+$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate an untrusted theme override (design §9). Returns it on success; throws `theme.invalid`.
 * Only allowlisted tokens, only safe bounded values — the un-allowlisted token name is never echoed.
 */
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
