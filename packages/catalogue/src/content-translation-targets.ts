import type { Transaction } from "@waitron/db";
import { AppError, contentLanguageCode, type ContentLanguages } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { batches } from "./batches.js";
import { contentLanguagesOr } from "./content-languages.js";
import { TRANSLATION_GAP_KINDS as KINDS } from "./content-translation-kinds.js";
import type {
  TranslationGapKind,
  TranslationGapReason,
} from "./content-translation-report-types.js";
import type { TranslationOwners, TranslationRef } from "./content-translation-types.js";
import {
  namedRows,
  LIVE_CANDIDATE,
  POSITION,
  blankIn,
  ABSENT,
  type NamedRow,
} from "./content-translation-candidates.js";
export { liveTranslationRows, blankTranslationSql } from "./content-translation-candidates.js";
import "./errors.js";

export interface TranslationTarget extends TranslationRef {
  name: string;
  parent?: { id: string; name: string };
  reason: TranslationGapReason;
  selectedText: string | null;
  defaultText: string | null;
  effectiveSelectedText: string | null;
  effectiveDefaultText: string | null;
  defaultRequired: boolean;
  eligible: boolean;
  unavailableReason: "missing" | "inactive" | "ownership" | "role" | null;
  owners: TranslationOwners | null;
  expected: string;
}
export interface TranslationTargetPage {
  language: string;
  config: ContentLanguages;
  required: string[];
  rows: TranslationTarget[];
  next: string | null;
  total: number;
}

export interface TranslationContext {
  fallbackLanguage: string;
  required: readonly string[];
}
export interface TranslationStructure {
  role: string | null;
  active: boolean;
  ownerActive: boolean;
  rootMatched: boolean;
  parentRole: string | null;
  childActive: boolean;
}
export type ResolvedTranslationTarget =
  | { state: "missing"; target: TranslationTarget }
  | {
      state: "present";
      target: TranslationTarget;
      config: ContentLanguages;
      names: Record<string, string> | null;
      inheritedNames: Record<string, string>;
      structure: TranslationStructure;
    };
export interface TranslationSettings {
  config: ContentLanguages;
  required: string[];
}
export interface TranslationResolution {
  language: string;
  config: ContentLanguages;
  required: string[];
  targets: ResolvedTranslationTarget[];
}
export type TranslationRow = NamedRow;
function invalid(): never {
  throw new AppError("content.translation_invalid", {});
}
function checkedRefs(refs: readonly TranslationRef[], limit: number): void {
  if (!Array.isArray(refs) || refs.length < 1 || refs.length > limit) invalid();
  const seen = new Set<string>();
  for (const ref of refs) {
    if (
      !ref ||
      !KINDS.includes(ref.kind) ||
      typeof ref.id !== "string" ||
      !ref.id.trim() ||
      seen.has(`${ref.kind}:${ref.id}`)
    )
      invalid();
    seen.add(`${ref.kind}:${ref.id}`);
  }
}
export async function readTranslationSettings(
  tx: Transaction,
  context: TranslationContext,
): Promise<TranslationSettings> {
  const saved = await tx.execute<{ default_language: string; languages: string }>(
    sql`select default_language, languages from content_languages where id = 1`,
  );
  const row = saved.rows[0];
  return {
    config: contentLanguagesOr(
      row
        ? {
            defaultLanguage: row.default_language,
            languages: JSON.parse(row.languages) as string[],
          }
        : undefined,
      context.fallbackLanguage,
    ),
    required: [...new Set(context.required.map(contentLanguageCode))].sort(),
  };
}
async function configuration(tx: Transaction, language: string, context: TranslationContext) {
  if (typeof language !== "string" || contentLanguageCode(language) !== language) invalid();
  const { config, required } = await readTranslationSettings(tx, context);
  if (!config.languages.includes(language)) throw new AppError("content.languages_invalid", {});
  return { language, config, required };
}
function ownersOf(row: NamedRow): TranslationOwners | null {
  if (
    (row.kind === "variant" && row.owner === null) ||
    (row.kind === "included_menu" && row.child_menu === null)
  )
    return null;
  switch (row.kind) {
    case "product":
      return { kind: row.kind, parentId: null };
    case "variant":
      return { kind: row.kind, parentId: row.owner! };
    case "option_label":
      return { kind: row.kind, listId: row.owner! };
    case "menu":
      return { kind: row.kind, menuId: row.owner!, rootId: row.id };
    case "section":
      return { kind: row.kind, menuId: row.owner! };
    case "included_menu":
      return {
        kind: row.kind,
        menuId: row.owner!,
        sectionId: row.container!,
        includedMenuId: row.child_menu!,
        includedRootId: row.child!,
      };
    default:
      return { kind: row.kind };
  }
}
function token(
  target: Omit<TranslationTarget, "expected">,
  config: ContentLanguages,
  required: string[],
  language: string,
  structure?: TranslationStructure,
  inheritedNames: Record<string, string> = {},
): string {
  return JSON.stringify({
    ref: { kind: target.kind, id: target.id },
    language,
    inheritedSelectedText: inheritedNames[language] ?? null,
    inheritedDefaultText: inheritedNames[config.defaultLanguage] ?? null,
    owners: target.owners,
    structure,
    selectedText: target.selectedText,
    defaultText: target.defaultText,
    effectiveSelectedText: target.effectiveSelectedText,
    effectiveDefaultText: target.effectiveDefaultText,
    config: { defaultLanguage: config.defaultLanguage, languages: [...config.languages].sort() },
    required,
  });
}
function resolved(
  row: NamedRow,
  language: string,
  config: ContentLanguages,
  required: string[],
): Extract<ResolvedTranslationTarget, { state: "present" }> {
  const names = row.names === null ? null : (JSON.parse(row.names) as Record<string, string>);
  const inheritedNames =
    row.inherited === null ? {} : (JSON.parse(row.inherited) as Record<string, string>);
  const effective = { ...inheritedNames, ...names };
  const selectedText = names?.[language] ?? null;
  const defaultText = names?.[config.defaultLanguage] ?? null;
  const structure: TranslationStructure = {
    role: row.role,
    active: !!row.active,
    ownerActive: !!row.owner_active,
    rootMatched: !!row.root_matched,
    parentRole: row.parent_role,
    childActive: !!row.child_active,
  };
  const wrongRole =
    (row.kind === "product" && row.role !== "product") ||
    (row.kind === "variant" && row.role !== "variant") ||
    (row.kind === "menu" && row.role !== "menu_root") ||
    (row.kind === "section" && row.role !== "section") ||
    (row.kind === "included_menu" &&
      (row.role !== "menu_root" || !["menu_root", "section"].includes(row.parent_role ?? "")));
  const unavailableReason = wrongRole
    ? "role"
    : !structure.rootMatched
      ? "ownership"
      : row.kind !== "product" &&
          row.kind !== "variant" &&
          (!structure.active || !structure.ownerActive || !structure.childActive)
        ? "inactive"
        : null;
  const effectiveSelectedText = effective[language] ?? null;
  const effectiveDefaultText = effective[config.defaultLanguage] ?? null;
  const target: Omit<TranslationTarget, "expected"> = {
    kind: row.kind,
    id: row.id,
    name: row.name ?? "",
    ...(row.owner && row.kind !== "product"
      ? { parent: { id: row.owner, name: row.owner_name ?? "" } }
      : {}),
    reason:
      row.kind !== "unit" &&
      row.kind !== "included_menu" &&
      (names === null || Object.keys(names).length === 0)
        ? "absent"
        : "partial",
    selectedText,
    defaultText,
    effectiveSelectedText,
    effectiveDefaultText,
    defaultRequired: !(effectiveDefaultText ?? "").trim(),
    eligible: unavailableReason === null,
    unavailableReason,
    owners: ownersOf(row),
  };
  return {
    state: "present",
    target: {
      ...target,
      expected: token(target, config, required, language, structure, inheritedNames),
    },
    config,
    names,
    inheritedNames,
    structure,
  };
}
function missing(
  ref: TranslationRef,
  config: ContentLanguages,
  required: string[],
  language: string,
): ResolvedTranslationTarget {
  const target: Omit<TranslationTarget, "expected"> = {
    ...ref,
    name: "",
    reason: "absent",
    owners: null,
    selectedText: null,
    defaultText: null,
    effectiveSelectedText: null,
    effectiveDefaultText: null,
    defaultRequired: false,
    eligible: false,
    unavailableReason: "missing",
  };
  return {
    state: "missing",
    target: { ...target, expected: token(target, config, required, language) },
  };
}
async function readTargets(
  tx: Transaction,
  refs: readonly TranslationRef[],
  state: Awaited<ReturnType<typeof configuration>>,
): Promise<ResolvedTranslationTarget[]> {
  const result = await tx.execute<NamedRow>(namedRows(refs));
  const rows = new Map(result.rows.map((row) => [`${row.kind}:${row.id}`, row]));
  return refs.map((ref) => {
    const row = rows.get(`${ref.kind}:${ref.id}`);
    return row
      ? resolved(row, state.language, state.config, state.required)
      : missing(ref, state.config, state.required, state.language);
  });
}
/** The rows `refs` name, keyed `kind:id`, read without the route's checks or its bound on `refs`. */
export async function readTranslationRows(
  tx: Transaction,
  refs: readonly TranslationRef[],
): Promise<Map<string, TranslationRow>> {
  const rows = new Map<string, TranslationRow>();
  for (const batch of batches(refs))
    for (const row of (await tx.execute<NamedRow>(namedRows(batch))).rows)
      rows.set(`${row.kind}:${row.id}`, row);
  return rows;
}
/** What {@link resolveTranslationTargets} answers for `row` in `language`, with no read. */
export function resolveTranslationRow(
  row: TranslationRow,
  language: string,
  settings: TranslationSettings,
): Extract<ResolvedTranslationTarget, { state: "present" }> {
  return resolved(row, language, settings.config, settings.required);
}
export async function resolveTranslationTargets(
  tx: Transaction,
  language: string,
  refs: readonly TranslationRef[],
  context: TranslationContext,
): Promise<TranslationResolution> {
  checkedRefs(refs, 100);
  const state = await configuration(tx, language, context);
  return { ...state, targets: await readTargets(tx, refs, state) };
}
export async function listTranslationTargets(
  tx: Transaction,
  language: string,
  query: { after?: string; targets?: TranslationRef[] },
  context: TranslationContext,
): Promise<TranslationTargetPage> {
  if (query.targets !== undefined && query.after !== undefined) invalid();
  if (query.targets !== undefined) {
    checkedRefs(query.targets, 50);
    const state = await configuration(tx, language, context);
    return {
      ...state,
      rows: (await readTargets(tx, query.targets, state)).map((entry) => entry.target),
      total: query.targets.length,
      next: null,
    };
  }
  let cursor: TranslationRef | undefined;
  if (query.after !== undefined) {
    try {
      cursor = JSON.parse(query.after) as TranslationRef;
    } catch {
      invalid();
    }
    checkedRefs([cursor!], 1);
  }
  const state = await configuration(tx, language, context);
  const path = `$."${language}"`;
  const projection = sql`with candidates as (${namedRows()}), gaps as (
    select kind, id, ${POSITION} as position
    from candidates where ${LIVE_CANDIDATE}
      and ${blankIn(sql`${path}`)}
  )`;
  const count = await tx.execute<{ total: number }>(
    sql`${projection} select count(*) as total from gaps`,
  );
  const after = cursor
    ? sql`where position > ${KINDS.indexOf(cursor.kind)} or (position = ${KINDS.indexOf(cursor.kind)} and id > ${cursor.id})`
    : sql``;
  const page = await tx.execute<{ kind: TranslationGapKind; id: string }>(
    sql`${projection} select kind, id from gaps ${after} order by position, id limit 50`,
  );
  const refs = page.rows;
  const rows = refs.length ? (await readTargets(tx, refs, state)).map((entry) => entry.target) : [];
  const last = refs.at(-1);
  // A full final page may yield an empty next page; the cursor still advances monotonically.
  return {
    ...state,
    rows,
    total: count.rows[0]!.total,
    next: refs.length === 50 && last ? JSON.stringify(last) : null,
  };
}

export async function listAbsentTranslationRefs(tx: Transaction): Promise<TranslationRef[]> {
  const result = await tx.execute<{ kind: TranslationGapKind; id: string }>(sql`
    with candidates as (${namedRows()})
    select kind, id from candidates
    where ${LIVE_CANDIDATE} and ${ABSENT}
    order by ${POSITION}, id`);
  return result.rows.map(({ kind, id }) => ({ kind, id }));
}

/**
 * In one read, the row of every ref {@link listTranslationTargets} lists under any of `config`'s
 * languages, and of every ref {@link listAbsentTranslationRefs} lists, in the dialog's order.
 */
export async function listTranslationGapRows(
  tx: Transaction,
  config: ContentLanguages,
): Promise<TranslationRow[]> {
  const blank = blankIn(sql`'$."' || language.value || '"'`);
  const result = await tx.execute<NamedRow>(sql`
    with candidates as (${namedRows()})
    select * from candidates
    where ${LIVE_CANDIDATE} and exists (
      select 1 from json_each(${JSON.stringify(config.languages)}) as language where ${blank})
    order by ${POSITION}, id`);
  return result.rows;
}

export function projectTranslationTarget(
  entry: Extract<ResolvedTranslationTarget, { state: "present" }>,
  names: Record<string, string>,
  inheritedNames: Record<string, string>,
  language: string,
  required: string[],
): Extract<ResolvedTranslationTarget, { state: "present" }> {
  const effective = { ...inheritedNames, ...names };
  const target = {
    ...entry.target,
    reason: "partial" as const,
    name: entry.target.name,
    selectedText: names[language] ?? null,
    defaultText: names[entry.config.defaultLanguage] ?? null,
    effectiveSelectedText: effective[language] ?? null,
    effectiveDefaultText: effective[entry.config.defaultLanguage] ?? null,
    defaultRequired: !(effective[entry.config.defaultLanguage] ?? "").trim(),
  };
  return {
    ...entry,
    names,
    inheritedNames,
    target: {
      ...target,
      expected: token(target, entry.config, required, language, entry.structure, inheritedNames),
    },
  };
}
