import type { Transaction } from "@waitron/db";
import { AppError, contentLanguageCode } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { namedRows, type NamedRow } from "./content-translation-candidates.js";
import { TRANSLATION_GAP_KINDS } from "./content-translation-kinds.js";
import {
  readTranslationSettings,
  resolveTranslationRow,
  type TranslationContext,
  type TranslationSettings,
} from "./content-translation-targets.js";
import {
  translationCellKey,
  type TranslationCell,
  type TranslationCellRef,
  type TranslationCellPage,
} from "./content-translation-types.js";
import "./errors.js";

export function invalidTranslationQuery(): never {
  throw new AppError("content.translation_invalid", {});
}
export function canonicalTranslationLanguage(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return contentLanguageCode(value) === value;
  } catch {
    return false;
  }
}
export function translationConfiguration(settings: TranslationSettings): string {
  return JSON.stringify({
    defaultLanguage: settings.config.defaultLanguage,
    languages: [...settings.config.languages].sort(),
    required: [...settings.required].sort(),
  });
}
function checkCells(cells: readonly TranslationCellRef[]): void {
  if (!Array.isArray(cells) || cells.length < 1 || cells.length > 100) invalidTranslationQuery();
  const seen = new Set<string>();
  for (const cell of cells) {
    if (
      cell === null ||
      typeof cell !== "object" ||
      Object.keys(cell).length !== 4 ||
      Object.keys(cell).some((key) => !["kind", "id", "language", "field"].includes(key)) ||
      !TRANSLATION_GAP_KINDS.includes(cell.kind) ||
      typeof cell.id !== "string" ||
      !cell.id.trim() ||
      !canonicalTranslationLanguage(cell.language) ||
      (cell.field !== "name" && !(cell.kind === "unit" && cell.field === "abbreviation"))
    )
      invalidTranslationQuery();
    const key = translationCellKey(cell);
    if (seen.has(key)) invalidTranslationQuery();
    seen.add(key);
  }
}

type CellRow = Omit<NamedRow, "names" | "abbreviations" | "inherited"> & {
  language: string;
  field: TranslationCellRef["field"];
  selected_text: string | null;
  default_text: string | null;
  inherited_text: string | null;
  inherited_default: string | null;
  staff_text: string;
};
function selectedMap(
  language: string,
  text: string | null,
  fallback: string,
  defaultText: string | null,
): string {
  return JSON.stringify({
    ...(text === null ? {} : { [language]: text }),
    ...(defaultText === null ? {} : { [fallback]: defaultText }),
  });
}
function cellOf(row: CellRow, settings: TranslationSettings): TranslationCell {
  const target = resolveTranslationRow(
    {
      ...row,
      names: selectedMap(
        row.language,
        row.selected_text,
        settings.config.defaultLanguage,
        row.default_text,
      ),
      inherited: selectedMap(
        row.language,
        row.inherited_text,
        settings.config.defaultLanguage,
        row.inherited_default,
      ),
      abbreviations: null,
    },
    row.language,
    settings,
  ).target;
  const disabled = !settings.config.languages.includes(row.language);
  return {
    kind: row.kind,
    id: row.id,
    language: row.language,
    field: row.field,
    owners: target.owners,
    text: target.selectedText,
    inheritedText: row.inherited_text,
    effectiveText: target.effectiveSelectedText,
    defaultText: target.defaultText,
    inheritedDefaultText: row.inherited_default,
    effectiveDefaultText: target.effectiveDefaultText,
    staffText: row.staff_text,
    expected: JSON.stringify({
      ...(JSON.parse(target.expected) as Record<string, unknown>),
      field: row.field,
    }),
    eligible: target.eligible && !disabled,
    unavailableReason: disabled ? "language_disabled" : target.unavailableReason,
  };
}
function missingCell(cell: TranslationCellRef, settings: TranslationSettings): TranslationCell {
  const texts = {
    text: null,
    inheritedText: null,
    effectiveText: null,
    defaultText: null,
    inheritedDefaultText: null,
    effectiveDefaultText: null,
  };
  return {
    ...cell,
    ...texts,
    owners: null,
    staffText: null,
    eligible: false,
    unavailableReason: "missing",
    expected: JSON.stringify({
      ref: { kind: cell.kind, id: cell.id },
      language: cell.language,
      field: cell.field,
      owners: null,
      selectedText: null,
      defaultText: null,
      inheritedSelectedText: null,
      inheritedDefaultText: null,
      effectiveSelectedText: null,
      effectiveDefaultText: null,
      config: {
        defaultLanguage: settings.config.defaultLanguage,
        languages: [...settings.config.languages].sort(),
      },
      required: settings.required,
    }),
  };
}

export async function readTranslationCells(
  tx: Transaction,
  cells: readonly TranslationCellRef[],
  settings: TranslationSettings,
): Promise<TranslationCell[]> {
  if (!cells.length) return [];
  const requested = JSON.stringify(cells);
  const path = sql`'$."' || r.language || '"'`;
  const defaultPath = `$."${settings.config.defaultLanguage}"`;
  const names = sql`case when r.field = 'abbreviation' then c.abbreviations else c.names end`;
  const result = await tx.execute<CellRow>(sql`
    with candidates as (${namedRows(cells)}), requested as (
      select json_extract(value, '$.kind') as kind, json_extract(value, '$.id') as id,
        json_extract(value, '$.language') as language, json_extract(value, '$.field') as field
      from json_each(${requested})
    )
    select c.kind, c.id, c.name, c.owner, c.owner_name, c.container, c.child, c.child_menu,
      c.role, c.active, c.owner_active, c.root_matched, c.parent_role, c.child_active,
      r.language, r.field,
      json_extract(${names}, ${path}) as selected_text,
      json_extract(${names}, ${defaultPath}) as default_text,
      json_extract(c.inherited, ${path}) as inherited_text,
      json_extract(c.inherited, ${defaultPath}) as inherited_default,
      case when r.field = 'abbreviation' then u.staff_abbreviation else c.name end as staff_text
    from requested r join candidates c on c.kind = r.kind and c.id = r.id
      left join units u on c.kind = 'unit' and u.id = c.id
  `);
  const byKey = new Map(result.rows.map((row) => [translationCellKey(row), cellOf(row, settings)]));
  return cells.map((cell) => byKey.get(translationCellKey(cell)) ?? missingCell(cell, settings));
}

export async function resolveTranslationCells(
  tx: Transaction,
  cells: readonly TranslationCellRef[],
  context: TranslationContext,
): Promise<TranslationCellPage> {
  checkCells(cells);
  const settings = await readTranslationSettings(tx, context);
  return {
    ...settings,
    configuration: translationConfiguration(settings),
    cells: await readTranslationCells(tx, cells, settings),
  };
}
