import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { readTranslationSettings, type TranslationContext } from "./content-translation-targets.js";
import {
  TRANSLATION_NAME_BYTES,
  translationCellKey,
  type TranslationCellEdit,
  type TranslationCellRef,
  type TranslationCell,
  type TranslationItem,
  type TranslationField,
} from "./content-translation-types.js";
import { TRANSLATION_GAP_KINDS } from "./content-translation-kinds.js";
import { writeTranslationMaps } from "./content-translation-writes.js";
import { deleteSavedCellSuggestions } from "./content-suggestion-store.js";
import { canonicalTranslationLanguage, readTranslationCells } from "./content-translation-cells.js";
import { validateOptionalTranslations } from "./optional-translations.js";
import { namedRows, type NamedRow } from "./content-translation-candidates.js";
import {
  parseTranslationBaseline,
  projectTranslationBaselines,
  sameTranslationBaseline,
} from "./content-translation-baseline.js";
import "./errors.js";

function invalid(): never {
  throw new AppError("content.translation_batch_invalid", {});
}
function keys(value: unknown, required: readonly string[]): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === required.length &&
    required.every((key) => Object.hasOwn(value, key))
  );
}
function checkedCells(batch: { edits: TranslationCellEdit[] }): TranslationCellEdit[] {
  if (
    !keys(batch, ["edits"]) ||
    !Array.isArray(batch.edits) ||
    batch.edits.length < 1 ||
    batch.edits.length > 100
  )
    invalid();
  let serialized: string;
  try {
    serialized = JSON.stringify(batch);
  } catch {
    invalid();
  }
  if (Buffer.byteLength(serialized, "utf8") > 262144) invalid();
  const seen = new Set<string>();
  return batch.edits.map((value: unknown) => {
    if (
      !keys(value, ["kind", "id", "language", "field", "expected", "text"]) ||
      typeof value.kind !== "string" ||
      !TRANSLATION_GAP_KINDS.includes(value.kind as TranslationCellEdit["kind"]) ||
      typeof value.id !== "string" ||
      !value.id.trim() ||
      !canonicalTranslationLanguage(value.language) ||
      (value.field !== "name" && !(value.kind === "unit" && value.field === "abbreviation")) ||
      typeof value.expected !== "string" ||
      (value.text !== null &&
        (typeof value.text !== "string" ||
          !value.text.trim() ||
          Buffer.byteLength(value.text, "utf8") > TRANSLATION_NAME_BYTES))
    )
      invalid();
    const edit: TranslationCellEdit = {
      kind: value.kind as TranslationCellEdit["kind"],
      id: value.id,
      language: value.language,
      field: value.field,
      expected: value.expected,
      text: value.text === null ? null : (value.text as string).trim(),
    };
    const key = translationCellKey(edit);
    if (seen.has(key)) invalid();
    seen.add(key);
    return edit;
  });
}
function cellRef(cell: TranslationCellRef): TranslationCellRef {
  return { kind: cell.kind, id: cell.id, language: cell.language, field: cell.field };
}

export async function saveContentTranslations(
  tx: Transaction,
  batch: { edits: TranslationCellEdit[] },
  context: TranslationContext,
): Promise<{ saved: TranslationCell[] }> {
  const edits = checkedCells(batch);
  const bases = edits.map(parseTranslationBaseline);
  const settings = await readTranslationSettings(tx, context);
  const current = await readTranslationCells(tx, edits.map(cellRef), settings);
  for (const cell of current) {
    if (!cell.eligible) throw new AppError("content.translation_unavailable", cellRef(cell));
  }
  const currentBases = current.map((cell, i) =>
    parseTranslationBaseline({ ...edits[i]!, expected: cell.expected }),
  );
  const projected = projectTranslationBaselines(bases, edits);
  const oldMatches = bases.map((base, i) => sameTranslationBaseline(base, currentBases[i]!));
  const finalMatches = projected.map((base, i) => sameTranslationBaseline(base, currentBases[i]!));
  const allOld = oldMatches.every(Boolean);
  const allFinal = finalMatches.every(Boolean);
  if (!allOld && !allFinal) {
    const i = oldMatches.findIndex((matches, index) => !matches && !finalMatches[index]);
    throw new AppError(
      "content.translation_stale",
      cellRef(edits[i < 0 ? oldMatches.indexOf(false) : i]!),
    );
  }
  const refs = [
    ...new Map(
      edits.map((edit) => [JSON.stringify([edit.kind, edit.id]), { kind: edit.kind, id: edit.id }]),
    ).values(),
  ];
  const rows = await tx.execute<NamedRow>(namedRows(refs));
  const byItem = new Map(rows.rows.map((row) => [JSON.stringify([row.kind, row.id]), row]));
  const groups = new Map<
    string,
    { item: TranslationItem; maps: Partial<Record<TranslationField, Record<string, string>>> }
  >();
  for (const [i, edit] of edits.entries()) {
    const key = JSON.stringify([edit.kind, edit.id]);
    let group = groups.get(key);
    if (!group) {
      const row = byItem.get(key)!;
      group = {
        item: {
          kind: edit.kind,
          id: edit.id,
          name: row.name ?? "",
          owners: current[i]!.owners,
          cells: [],
        },
        maps: {},
      };
      groups.set(key, group);
    }
    group.item.cells.push(current[i]!);
    let names = group.maps[edit.field];
    if (!names) {
      const row = byItem.get(key)!;
      const stored = edit.field === "name" ? row.names : row.abbreviations;
      names = stored === null ? {} : (JSON.parse(stored) as Record<string, string>);
      group.maps[edit.field] = names;
    }
    if (edit.text === null) delete names[edit.language];
    else names[edit.language] = edit.text;
  }
  // Final replacements are validated together before any group is written.
  for (const { item, maps } of groups.values()) {
    for (const [field, names] of Object.entries(maps)) {
      try {
        validateOptionalTranslations(names);
      } catch (cause) {
        if (!(cause instanceof AppError)) throw cause;
        const cell = edits.find(
          (edit) => edit.kind === item.kind && edit.id === item.id && edit.field === field,
        )!;
        throw new AppError("content.translation_refused", {
          ...cellRef(cell),
          causeCode: cause.code,
          causeParams: cause.params,
        });
      }
    }
  }
  if (!allFinal)
    for (const { item, maps } of groups.values()) await writeTranslationMaps(tx, item, maps);
  await deleteSavedCellSuggestions(tx, edits);
  return {
    saved: allFinal ? current : await readTranslationCells(tx, edits.map(cellRef), settings),
  };
}
