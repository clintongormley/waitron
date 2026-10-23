import "./errors.js";
import { AppError } from "@waitron/shared";
import { checkThemeName, readThemeDocument } from "@waitron/ui-core/theme";
import { printableLogoRasters } from "./receipt-store.js";
import { isPlainObject } from "./validate.js";

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

function checkTheme(value: unknown, carried: ReadonlySet<unknown>): void {
  if (!isPlainObject(value)) return refuse("theme");
  const { printedLogo, ...document } = value;
  const read = readThemeDocument(document);
  if (!read.ok) return refuse("theme");
  const logo = read.choices.logo;
  if (logo === null) {
    if (printedLogo !== undefined) refuse("theme");
    return;
  }
  if (!carried.has(logo.light)) refuse("theme");
  if (logo.dark !== undefined && !carried.has(logo.dark)) refuse("theme");
  if (!printableLogoRasters(printedLogo)) refuse("theme");
}

function checkRow(row: Readonly<Record<string, unknown>>, carried: ReadonlySet<unknown>): void {
  const name = typeof row.name === "string" ? checkThemeName(row.name) : null;
  if (name === null || !name.ok || name.name !== row.name) refuse("name");
  if (row.name_key !== name.key) refuse("name_key");
  if (row.in_use !== null && row.in_use !== 1) refuse("in_use");
  checkTheme(parsedTheme(row.theme), carried);
}

export function validateThemeConfiguration(tables: Tables): void {
  const rows = tables.custom_themes ?? [];
  const carried = new Set((tables.media_images ?? []).map((image) => image.filename));
  for (const row of rows) checkRow(row, carried);
  if (rows.filter((row) => row.in_use === 1).length > 1) refuse("in_use");
  if (new Set(rows.map((row) => row.name_key)).size !== rows.length) refuse("name_key");
}
