import "./errors.js";
import { constraintTarget, customThemes, isUniqueViolation, nowIso, sameTarget } from "@waitron/db";
import type { ConstraintTarget, Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import { AppError, isUuid } from "@waitron/shared";
import type { MonoRaster, PaperWidth } from "@waitron/printing";
import { readThemeDocument, type ThemeChoices } from "@waitron/ui-core/theme";
import { asc, eq, sql } from "drizzle-orm";
import { printableLogoRasters, readLogoRaster, storedPictureMaxBytes } from "./receipt-store.js";
import { parseThemeChoices, parseThemeName } from "./theme-input.js";
import type { ReceiptLogoRasters } from "./types.js";

export interface StoredTheme {
  readonly id: string;
  readonly name: string;
  /** `null`: a stored document this release refuses. */
  readonly choices: ThemeChoices | null;
  readonly updatedAt: string;
}

export interface ThemeList {
  readonly themes: readonly StoredTheme[];
  readonly inUse: string | null;
}

export interface ThemeInUse {
  readonly id: string;
  readonly choices: ThemeChoices | null;
}

export interface PrintedThemeLogo {
  /** The theme in use's light image, as the library names it. */
  readonly name: string;
  /** Its stored dots for the paper; `null` when they cannot be printed on it. */
  readonly picture: MonoRaster | null;
}

// The `json` column's own reader runs JSON.parse and throws on a row that is not JSON.
// json_remove rewrites the text, dropping a trailing NUL that JSON.parse refuses, so it runs only
// on a row that holds dots.
const THEME_TEXT = sql<string | null>`case
  when not json_valid(${customThemes.theme}) then null
  when json_type(${customThemes.theme}, '$.printedLogo') is null then ${customThemes.theme}
  else json_remove(${customThemes.theme}, '$.printedLogo') end`;

const STORED_TEXT = sql<
  string | null
>`case when json_valid(${customThemes.theme}) then ${customThemes.theme} else null end`;

function storedPicture(paper: PaperWidth) {
  const value = sql`case when json_valid(${customThemes.theme}) then json_extract(${customThemes.theme}, ${`$.printedLogo."${paper}"`}) end`;
  return sql<
    string | null
  >`case when typeof(${value}) = 'text' and length(cast(${value} as blob)) <= ${storedPictureMaxBytes(paper)} then ${value} else null end`;
}

const NAME_KEY: ConstraintTarget = { table: "custom_themes", columns: ["name_key"] };

function choicesOf(text: string | null): ThemeChoices | null {
  if (text === null) return null;
  try {
    const result = readThemeDocument(JSON.parse(text));
    return result.ok ? result.choices : null;
  } catch {
    return null;
  }
}

function nameTakenOr(error: unknown): unknown {
  return isUniqueViolation(error) && sameTarget(constraintTarget(error), NAME_KEY)
    ? new AppError("theme.name_taken", { field: "name" })
    : error;
}

function authorize(tx: Transaction, managementSessionId: string) {
  return authorizeManager(tx, { managementSessionId, permission: "layout.configure" });
}

async function requireThemeRow<T>(id: string, read: () => Promise<T | undefined>): Promise<T> {
  if (isUuid(id)) {
    const row = await read();
    if (row !== undefined) return row;
  }
  throw new AppError("theme.not_found", {});
}

function requireTheme(tx: Transaction, id: string): Promise<{ name: string }> {
  return requireThemeRow(id, async () => {
    const [row] = await tx
      .select({ name: customThemes.name })
      .from(customThemes)
      .where(eq(customThemes.id, id));
    return row;
  });
}

/** The route always supplies dots with a logo, so the row never names a logo it cannot print. */
function documentFor(choices: ThemeChoices, printedLogo: unknown): object {
  if (choices.logo === null) return choices;
  if (!printableLogoRasters(printedLogo)) {
    throw new Error("a theme logo needs printable dots for both papers");
  }
  return { ...choices, printedLogo };
}

/** Clears before it sets: the unique index on `in_use` refuses a second row holding 1. */
async function switchInUse(tx: Transaction, id: string | null, updatedAt: string): Promise<void> {
  await tx.update(customThemes).set({ inUse: null, updatedAt }).where(eq(customThemes.inUse, 1));
  if (id !== null) {
    await tx.update(customThemes).set({ inUse: 1, updatedAt }).where(eq(customThemes.id, id));
  }
}

export async function listCustomThemes(tx: Transaction): Promise<ThemeList> {
  const rows = await tx
    .select({
      id: customThemes.id,
      name: customThemes.name,
      theme: THEME_TEXT,
      inUse: customThemes.inUse,
      updatedAt: customThemes.updatedAt,
    })
    .from(customThemes)
    .orderBy(asc(customThemes.nameKey));
  return {
    themes: rows.map((row) => ({
      id: row.id,
      name: row.name,
      choices: choicesOf(row.theme),
      updatedAt: row.updatedAt,
    })),
    inUse: rows.find((row) => row.inUse === 1)?.id ?? null,
  };
}

export async function readThemeInUse(tx: Transaction): Promise<ThemeInUse | null> {
  const [row] = await tx
    .select({ id: customThemes.id, theme: THEME_TEXT })
    .from(customThemes)
    .where(eq(customThemes.inUse, 1));
  return row === undefined ? null : { id: row.id, choices: choicesOf(row.theme) };
}

/** `null` when no theme is in use, it has no logo, or this release cannot read it. */
export async function readPrintedThemeLogo(
  tx: Transaction,
  paperWidth: PaperWidth,
): Promise<PrintedThemeLogo | null> {
  const [row] = await tx
    .select({ theme: THEME_TEXT, picture: storedPicture(paperWidth) })
    .from(customThemes)
    .where(eq(customThemes.inUse, 1));
  if (row === undefined) return null;
  const logo = choicesOf(row.theme)?.logo;
  if (logo === null || logo === undefined) return null;
  return { name: logo.light, picture: readLogoRaster(row.picture, paperWidth) };
}

export async function createCustomTheme(
  tx: Transaction,
  input: {
    managementSessionId: string;
    name: string;
    theme: unknown;
    inUse?: boolean;
    printedLogo?: ReceiptLogoRasters;
  },
): Promise<StoredTheme> {
  await authorize(tx, input.managementSessionId);
  const choices = parseThemeChoices(input.theme);
  const { name, key } = parseThemeName(input.name);
  const theme = documentFor(choices, input.printedLogo);
  const updatedAt = nowIso();
  let id: string;
  try {
    const [row] = await tx
      .insert(customThemes)
      .values({ name, nameKey: key, theme, updatedAt })
      .returning({ id: customThemes.id });
    id = row!.id;
  } catch (error) {
    throw nameTakenOr(error);
  }
  if (input.inUse === true) await switchInUse(tx, id, updatedAt);
  return { id, name, choices, updatedAt };
}

export async function saveCustomTheme(
  tx: Transaction,
  input: {
    managementSessionId: string;
    id: string;
    theme: unknown;
    printedLogo?: ReceiptLogoRasters;
  },
): Promise<StoredTheme> {
  await authorize(tx, input.managementSessionId);
  const { name } = await requireTheme(tx, input.id);
  const choices = parseThemeChoices(input.theme);
  const theme = documentFor(choices, input.printedLogo);
  const updatedAt = nowIso();
  await tx.update(customThemes).set({ theme, updatedAt }).where(eq(customThemes.id, input.id));
  return { id: input.id, name, choices, updatedAt };
}

function storedPrintedLogo(text: string | null, light: string): ReceiptLogoRasters | null {
  try {
    const stored: unknown = JSON.parse(text!);
    const { logo, printedLogo } = stored as {
      logo?: { light?: unknown } | null;
      printedLogo?: unknown;
    };
    return logo?.light === light && printableLogoRasters(printedLogo) ? printedLogo : null;
  } catch {
    return null;
  }
}

/**
 * Runs the checks `createCustomTheme` (`id: null`) or `saveCustomTheme` makes before writing, except
 * a taken name, and answers the stored dots that still fit the sent logo, so the caller draws them
 * only when they do not.
 */
export async function prepareThemeSave(
  tx: Transaction,
  input: { managementSessionId: string; id: string | null; name?: string; theme: unknown },
): Promise<{ choices: ThemeChoices; keptPrintedLogo: ReceiptLogoRasters | null }> {
  await authorize(tx, input.managementSessionId);
  const { id } = input;
  const stored =
    id === null
      ? null
      : await requireThemeRow(id, async () => {
          const [row] = await tx
            .select({ theme: STORED_TEXT })
            .from(customThemes)
            .where(eq(customThemes.id, id));
          return row;
        });
  const choices = parseThemeChoices(input.theme);
  if (stored === null) {
    parseThemeName(input.name ?? "");
    return { choices, keptPrintedLogo: null };
  }
  const keptPrintedLogo =
    choices.logo === null ? null : storedPrintedLogo(stored.theme, choices.logo.light);
  return { choices, keptPrintedLogo };
}

export async function renameCustomTheme(
  tx: Transaction,
  input: { managementSessionId: string; id: string; name: string },
): Promise<StoredTheme> {
  await authorize(tx, input.managementSessionId);
  await requireTheme(tx, input.id);
  const { name, key } = parseThemeName(input.name);
  const updatedAt = nowIso();
  let theme: string | null;
  try {
    const [row] = await tx
      .update(customThemes)
      .set({ name, nameKey: key, updatedAt })
      .where(eq(customThemes.id, input.id))
      .returning({ theme: THEME_TEXT });
    theme = row!.theme;
  } catch (error) {
    throw nameTakenOr(error);
  }
  return { id: input.id, name, choices: choicesOf(theme), updatedAt };
}

/** Deleting the theme in use puts Waitron's own theme in use. */
export async function deleteCustomTheme(
  tx: Transaction,
  input: { managementSessionId: string; id: string },
): Promise<{ inUse: string | null }> {
  await authorize(tx, input.managementSessionId);
  await requireTheme(tx, input.id);
  await tx.delete(customThemes).where(eq(customThemes.id, input.id));
  const [inUse] = await tx
    .select({ id: customThemes.id })
    .from(customThemes)
    .where(eq(customThemes.inUse, 1));
  return { inUse: inUse?.id ?? null };
}

/** `null` puts Waitron's own theme in use. */
export async function setThemeInUse(
  tx: Transaction,
  input: { managementSessionId: string; customThemeId: string | null },
): Promise<string | null> {
  await authorize(tx, input.managementSessionId);
  if (input.customThemeId !== null) await requireTheme(tx, input.customThemeId);
  await switchInUse(tx, input.customThemeId, nowIso());
  return input.customThemeId;
}
