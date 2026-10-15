import { and, asc, eq, gt, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { batches } from "./batches.js";
import {
  blankName,
  buildSuggestionJob,
  effectiveNames,
  parseSuggestionRef,
  readLiveItems,
  readSuggestionGaps,
  suggestionRef,
} from "./content-suggestion-collect.js";
import { readSuggestionRun, sentInRun } from "./content-suggestion-jobs.js";
import type {
  ContentSuggestionPage,
  ContentSuggestionView,
  SuggestionResult,
  SuggestionResults,
} from "./content-suggestion-types.js";
import {
  readTranslationSettings,
  resolveTranslationRow,
  type TranslationContext,
} from "./content-translation-targets.js";
import {
  TRANSLATION_NAME_BYTES,
  type TranslationEdit,
  type TranslationRef,
} from "./content-translation-types.js";
import "./errors.js";
import { contentSuggestionJobs, contentSuggestions } from "./schema/suggestions.js";

type Fix = SuggestionResult["corrections"][number];
interface PlannedRow {
  language: string | null;
  text: string | null;
  expected: string | null;
  placeholder: boolean;
  fix: Fix | null;
}

/** The stored rows whose (kind, item, language) is one of `keys`; a null language matches nothing. */
function storedIn(keys: readonly (readonly [string, string, string | null])[]): SQL {
  const { kind, itemId, language } = contentSuggestions;
  return sql`(${kind}, ${itemId}, ${language}) in (select json_extract(value, '$[0]'),
      json_extract(value, '$[1]'), json_extract(value, '$[2]') from json_each(${JSON.stringify(keys)}))`;
}

/** The stored rows `batch` replaces: an item's row in a language, or its own row. */
function replacedBy(batch: readonly { ref: TranslationRef; row: PlannedRow }[]): SQL {
  const own = JSON.stringify(
    batch.filter(({ row }) => row.language === null).map(({ ref }) => [ref.kind, ref.id]),
  );
  const { kind, itemId, language } = contentSuggestions;
  return sql`${storedIn(
    batch
      .filter(({ row }) => row.language !== null)
      .map(({ ref, row }) => [ref.kind, ref.id, row.language] as const),
  )}
    or (${language} is null and (${kind}, ${itemId}) in (select json_extract(value, '$[0]'),
      json_extract(value, '$[1]') from json_each(${own})))`;
}

function emptyRow(language: string | null): PlannedRow {
  return { language, text: null, expected: null, placeholder: false, fix: null };
}

function validFix(fix: Fix, missing: readonly string[], languages: readonly string[]): boolean {
  return (
    (fix.field === "internal" || (languages.includes(fix.field) && !missing.includes(fix.field))) &&
    fix.wrong.trim() !== "" &&
    fix.right.trim() !== "" &&
    fix.wrong !== fix.right
  );
}

/**
 * Stores a finished job's results as suggestions and, in the same transaction, inserts the run's
 * next job, so a run never has a moment with no active job between two of its jobs.
 */
export async function storeSuggestionResults(
  tx: Transaction,
  jobId: string,
  results: SuggestionResults,
  context: TranslationContext,
  now: Date = new Date(),
): Promise<void> {
  const [job] = await tx
    .select()
    .from(contentSuggestionJobs)
    .where(eq(contentSuggestionJobs.id, jobId));
  if (!job || job.state !== "running") return;
  const settings = await readTranslationSettings(tx, context);
  const { languages } = settings.config;
  const failed = new Set(results.failed.filter((key) => Object.hasOwn(job.sent, key)));
  const answered = new Map<string, { ref: TranslationRef; result: SuggestionResult }>();
  let dropped = 0;
  for (const result of results.results) {
    const ref = Object.hasOwn(job.sent, result.ref) ? parseSuggestionRef(result.ref) : null;
    if (!ref || failed.has(result.ref) || answered.has(result.ref)) dropped += 1;
    else answered.set(result.ref, { ref, result });
  }
  const current = await readLiveItems(
    tx,
    [...answered.values()].map(({ ref }) => ref),
    settings,
  );
  const planned = new Map<string, { ref: TranslationRef; rows: Map<string | null, PlannedRow> }>();
  for (const [key, { ref, result }] of answered) {
    const missing = job.sent[key]!;
    const live = current.get(key);
    const entry = live?.entry;
    const rows = new Map<string | null, PlannedRow>();
    let usable = result.placeholder;
    for (const [language, name] of Object.entries(result.names)) {
      const trimmed = name.trim();
      if (
        !missing.includes(language) ||
        !trimmed ||
        Buffer.byteLength(trimmed, "utf8") > TRANSLATION_NAME_BYTES
      ) {
        dropped += 1;
        continue;
      }
      usable = true;
      if (!live || !languages.includes(language)) {
        dropped += 1;
        continue;
      }
      const target = resolveTranslationRow(live.row, language, settings).target;
      if (!blankName(target.effectiveSelectedText)) {
        dropped += 1;
        continue;
      }
      rows.set(language, { ...emptyRow(language), text: trimmed, expected: target.expected });
    }
    const effective: Record<string, string> = entry ? effectiveNames(entry) : {};
    for (const fix of result.corrections) {
      if (!validFix(fix, missing, languages)) {
        dropped += 1;
        continue;
      }
      usable = true;
      const language = fix.field === "internal" ? null : fix.field;
      const entered = language === null || !blankName(effective[language]);
      if (!entry || !entered || rows.has(language)) {
        dropped += 1;
        continue;
      }
      rows.set(language, { ...emptyRow(language), fix });
    }
    if (result.placeholder) {
      if (entry) rows.set(null, { ...(rows.get(null) ?? emptyRow(null)), placeholder: true });
      else dropped += 1;
    }
    if (usable) planned.set(key, { ref, rows });
    else failed.add(key);
  }
  const storing = [...planned.values()].flatMap(({ ref, rows }) =>
    [...rows.values()].map((row) => ({ ref, row })),
  );
  for (const batch of batches(storing)) {
    await tx.delete(contentSuggestions).where(replacedBy(batch));
    await tx.insert(contentSuggestions).values(
      batch.map(({ ref, row }) => ({
        jobId,
        kind: ref.kind,
        itemId: ref.id,
        language: row.language,
        text: row.text,
        expected: row.expected,
        placeholder: row.placeholder,
        fixField: row.fix?.field ?? null,
        fixWrong: row.fix?.wrong ?? null,
        fixRight: row.fix?.right ?? null,
        createdAt: now.toISOString(),
      })),
    );
  }
  for (const key of Object.keys(job.sent)) if (!answered.has(key)) failed.add(key);
  const failedRefs = [...failed].sort();
  const limitReached = results.reason === "limit_reached";
  await tx
    .update(contentSuggestionJobs)
    .set({
      state: results.state,
      ...(limitReached ? { failure: "limit" as const } : {}),
      finishedAt: now.toISOString(),
      failedRefs,
      failed: failedRefs.length,
      dropped,
      done: Object.keys(job.sent).length - failedRefs.length,
    })
    .where(eq(contentSuggestionJobs.id, jobId));
  const sent = await sentInRun(tx, job.runId);
  // The month's spending cap stopped this job, so Cloud would refuse the next one; a next job with
  // no item would be refused too (see buildSuggestionJob).
  const built = limitReached
    ? null
    : await buildSuggestionJob(tx, context, sent, await readSuggestionGaps(tx, context, settings));
  const next = built && built.included > 0 ? built : null;
  const runTotal = sent.size + (next ? Object.keys(next.sent).length + next.remaining : 0);
  if (next)
    await tx.insert(contentSuggestionJobs).values({
      runId: job.runId,
      position: job.position + 1,
      state: "submitting",
      body: next.body,
      sent: next.sent,
      runTotal,
      createdAt: now.toISOString(),
    });
  await tx
    .update(contentSuggestionJobs)
    .set({ runTotal })
    .where(and(eq(contentSuggestionJobs.runId, job.runId), eq(contentSuggestionJobs.position, 1)));
}

const SUGGESTION_PAGE = 100;
const COMPARED = [
  "ref",
  "language",
  "owners",
  "selectedText",
  "effectiveSelectedText",
  "inheritedSelectedText",
] as const;

function readToken(token: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(token);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function suggestionStale(stored: string, current: string): boolean {
  const before = readToken(stored);
  const after = readToken(current);
  if (!before || !after) return true;
  return COMPARED.some((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

export async function listContentSuggestions(
  tx: Transaction,
  language: string,
  query: { after?: string },
  context: TranslationContext,
): Promise<ContentSuggestionPage> {
  const settings = await readTranslationSettings(tx, context);
  const { config } = settings;
  if (!config.languages.includes(language)) throw new AppError("content.languages_invalid", {});
  const shown = or(
    inArray(contentSuggestions.language, [...new Set([language, config.defaultLanguage])]),
    isNull(contentSuggestions.language),
    isNull(contentSuggestions.text),
  );
  const rows = await tx
    .select()
    .from(contentSuggestions)
    .where(query.after === undefined ? shown : and(shown, gt(contentSuggestions.id, query.after)))
    .orderBy(asc(contentSuggestions.id))
    .limit(SUGGESTION_PAGE);
  const keyOf = (row: (typeof rows)[number]) => suggestionRef({ kind: row.kind, id: row.itemId });
  const refs = new Map<string, TranslationRef>();
  for (const row of rows) refs.set(keyOf(row), { kind: row.kind, id: row.itemId });
  const live = await readLiveItems(tx, [...refs.values()], settings);
  const suggestions: ContentSuggestionView[] = [];
  for (const row of rows) {
    const item = live.get(keyOf(row));
    if (!item) continue;
    suggestions.push({
      id: row.id,
      kind: row.kind,
      itemId: row.itemId,
      language: row.language,
      text: row.text,
      placeholder: row.placeholder,
      // The three fix columns are set together or not at all (content_suggestions_fix_ck).
      fix:
        row.fixField === null
          ? null
          : { field: row.fixField, wrong: row.fixWrong!, right: row.fixRight! },
      // A row with text has a language and `expected` (content_suggestions_text_language_ck,
      // content_suggestions_name_ck).
      stale:
        row.text !== null &&
        suggestionStale(
          row.expected!,
          resolveTranslationRow(item.row, row.language!, settings).target.expected,
        ),
    });
  }
  return {
    language,
    run: await readSuggestionRun(tx),
    suggestions,
    next: rows.length === SUGGESTION_PAGE ? rows.at(-1)!.id : null,
  };
}

export async function discardContentSuggestion(tx: Transaction, id: string): Promise<void> {
  const deleted = await tx
    .delete(contentSuggestions)
    .where(eq(contentSuggestions.id, id))
    .returning({ id: contentSuggestions.id });
  if (deleted.length === 0)
    throw new AppError("content.suggestion_not_found", { suggestionId: id });
}

export async function deleteSavedSuggestions(
  tx: Transaction,
  language: string,
  defaultLanguage: string,
  edits: readonly Pick<TranslationEdit, "kind" | "id" | "defaultText">[],
): Promise<void> {
  await tx
    .delete(contentSuggestions)
    .where(
      storedIn(
        edits.flatMap((edit) =>
          (edit.defaultText === undefined ? [language] : [language, defaultLanguage]).map(
            (saved) => [edit.kind, edit.id, saved] as const,
          ),
        ),
      ),
    );
}
