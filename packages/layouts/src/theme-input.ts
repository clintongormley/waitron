import "./errors.js";
import { AppError } from "@waitron/shared";
import { checkThemeName, readThemeDocument, type ThemeChoices } from "@waitron/ui-core/theme";

export function parseThemeChoices(input: unknown): ThemeChoices {
  const result = readThemeDocument(input);
  if (!result.ok)
    throw new AppError("theme.invalid", { field: result.field, reason: result.reason });
  return result.choices;
}

export function parseThemeName(input: string): { name: string; key: string } {
  const result = checkThemeName(input);
  if (!result.ok) throw new AppError("theme.invalid", { field: "name", reason: result.reason });
  return { name: result.name, key: result.key };
}
