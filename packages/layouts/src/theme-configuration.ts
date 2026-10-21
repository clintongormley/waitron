import "./errors.js";
import { AppError } from "@waitron/shared";
import { checkThemeName, readThemeDocument } from "@waitron/ui-core/theme";

type Tables = Readonly<Record<string, readonly Record<string, unknown>[]>>;

const refuse: (column: string) => never = (column) => {
  throw new AppError("setup.request_invalid", { field: `custom_themes.${column}` });
};

function parsedTheme(text: unknown): unknown {
  if (typeof text !== "string") return refuse("theme");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return refuse("theme");
  }
}

function checkRow(row: Readonly<Record<string, unknown>>): void {
  const name = typeof row.name === "string" ? checkThemeName(row.name) : null;
  if (name === null || !name.ok || name.name !== row.name) refuse("name");
  if (row.name_key !== name.key) refuse("name_key");
  if (row.in_use !== null && row.in_use !== 1) refuse("in_use");
  if (!readThemeDocument(parsedTheme(row.theme)).ok) refuse("theme");
}

export function validateThemeConfiguration(tables: Tables): void {
  const rows = tables.custom_themes ?? [];
  for (const row of rows) checkRow(row);
  if (rows.filter((row) => row.in_use === 1).length > 1) refuse("in_use");
  if (new Set(rows.map((row) => row.name_key)).size !== rows.length) refuse("name_key");
}
