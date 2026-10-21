import "./errors.js";
import { constraintTarget, customThemes, isUniqueViolation, nowIso, sameTarget } from "@waitron/db";
import type { ConstraintTarget, Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import { AppError, isUuid } from "@waitron/shared";
import { readThemeDocument, type ThemeChoices } from "@waitron/ui-core/theme";
import { asc, eq, sql } from "drizzle-orm";
import { parseThemeChoices, parseThemeName } from "./theme-input.js";

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

// The `json` column's own reader runs JSON.parse and throws on a row that is not JSON.
const THEME_TEXT = sql<
  string | null
>`case when json_valid(${customThemes.theme}) then ${customThemes.theme} else null end`;

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

function authorize(tx: Transaction, managementSessionId: string) {
  return authorizeManager(tx, { managementSessionId, permission: "layout.configure" });
}

async function requireTheme(tx: Transaction, id: string): Promise<{ name: string }> {
  if (isUuid(id)) {
    const [row] = await tx
      .select({ name: customThemes.name })
      .from(customThemes)
      .where(eq(customThemes.id, id));
    if (row !== undefined) return row;
  }
  throw new AppError("theme.not_found", {});
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

export async function createCustomTheme(
  tx: Transaction,
  input: { managementSessionId: string; name: string; theme: unknown; inUse?: boolean },
): Promise<StoredTheme> {
  await authorize(tx, input.managementSessionId);
  const choices = parseThemeChoices(input.theme);
  const { name, key } = parseThemeName(input.name);
  const updatedAt = nowIso();
  let id: string;
  try {
    const [row] = await tx
      .insert(customThemes)
      .values({ name, nameKey: key, theme: choices, updatedAt })
      .returning({ id: customThemes.id });
    id = row!.id;
  } catch (error) {
    if (isUniqueViolation(error) && sameTarget(constraintTarget(error), NAME_KEY)) {
      throw new AppError("theme.name_taken", { field: "name" });
    }
    throw error;
  }
  if (input.inUse === true) await switchInUse(tx, id, updatedAt);
  return { id, name, choices, updatedAt };
}

export async function saveCustomTheme(
  tx: Transaction,
  input: { managementSessionId: string; id: string; theme: unknown },
): Promise<StoredTheme> {
  await authorize(tx, input.managementSessionId);
  const { name } = await requireTheme(tx, input.id);
  const choices = parseThemeChoices(input.theme);
  const updatedAt = nowIso();
  await tx
    .update(customThemes)
    .set({ theme: choices, updatedAt })
    .where(eq(customThemes.id, input.id));
  return { id: input.id, name, choices, updatedAt };
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
