import { and, asc, eq, gt, sql, type SQL } from "drizzle-orm";
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
import {
  readSuggestionRun,
  recordSuggestionJobEnded,
  sentInRun,
} from "./content-suggestion-jobs.js";
import type {
  ContentSuggestionPage,
  ContentSuggestionQuery,
  ContentSuggestionView,
  SuggestionResult,
  SuggestionPage,
} from "./content-suggestion-types.js";
import {
  liveTranslationRows,
  readTranslationSettings,
  resolveTranslationRow,
  type TranslationContext,
} from "./content-translation-targets.js";
import {
  TRANSLATION_NAME_BYTES,
  type TranslationCellRef,
  type TranslationRef,
  type TranslationTarget,
  type TranslationCellEdit,
} from "./content-translation-types.js";
import {
  parseTranslationBaseline,
  sameTranslationBaseline,
  type TranslationBaseline,
} from "./content-translation-baseline.js";
import "./errors.js";
import { contentSuggestionJobs, contentSuggestions } from "./schema/suggestions.js";

import { TRANSLATION_GAP_KINDS } from "./content-translation-kinds.js";
import { invalidTranslationQuery, translationConfiguration } from "./content-translation-cells.js";

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

export type PageStored = "stored" | "complete" | "ended" | "stale";

function nameEvidence(target: TranslationTarget): string {
  return JSON.stringify({
    ...(JSON.parse(target.expected) as Record<string, unknown>),
    field: "name",
  });
}

/**
 * Stores one page of a job's results, only at the job's saved position. The last page also finishes
 * the job and, in the same transaction, inserts the run's next job, so a run never has a moment with
 * no active job between two of its jobs. A last page that leaves an item of the job unaccounted for,
 * or leaves a count of accounted items other than Cloud's total, ends the job failed instead, and
 * Cloud is not told the walk is complete.
 */
export async function storeSuggestionPage(
  tx: Transaction,
  jobId: string,
  page: SuggestionPage,
  context: TranslationContext,
  now: Date = new Date(),
): Promise<PageStored> {
  const [job] = await tx
    .select()
    .from(contentSuggestionJobs)
    .where(eq(contentSuggestionJobs.id, jobId));
  if (!job || job.state !== "running") return "stale";
  // Null until the first page is stored; the last page writes null back, but by then the job is no
  // longer running.
  if ((job.collectCursor ?? 0) !== page.cursor) return "stale";
  const settings = await readTranslationSettings(tx, context);
  const { languages } = settings.config;
  const collected = new Set(job.collectedRefs);
  const failed = new Set(
    page.failed.filter((key) => Object.hasOwn(job.sent, key) && !collected.has(key)),
  );
  const answered = new Map<string, { ref: TranslationRef; result: SuggestionResult }>();
  let dropped = 0;
  for (const result of page.results) {
    const ref = Object.hasOwn(job.sent, result.ref) ? parseSuggestionRef(result.ref) : null;
    if (!ref || collected.has(result.ref) || failed.has(result.ref) || answered.has(result.ref))
      dropped += 1;
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
      rows.set(language, { ...emptyRow(language), text: trimmed, expected: nameEvidence(target) });
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
      const target =
        language === null ? null : resolveTranslationRow(live!.row, language, settings).target;
      rows.set(language, {
        ...emptyRow(language),
        fix,
        expected: target?.effectiveSelectedText === fix.wrong ? nameEvidence(target) : null,
      });
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
  const collectedRefs = [...new Set([...job.collectedRefs, ...answered.keys(), ...failed])];
  const failedRefs = [...new Set([...job.failedRefs, ...failed])].sort();
  const accounted = new Set(collectedRefs);
  const complete =
    Object.keys(job.sent).every((key) => accounted.has(key)) && collectedRefs.length === job.total;
  const last = page.nextCursor === null;
  const limitReached = page.reason === "limit_reached";
  await tx
    .update(contentSuggestionJobs)
    .set({
      collectCursor: page.nextCursor,
      collectedRefs,
      failedRefs,
      dropped: job.dropped + dropped,
      ...(last && complete
        ? {
            state: page.state,
            ...(limitReached ? { failure: "limit" as const } : {}),
            finishedAt: now.toISOString(),
            failed: failedRefs.length,
            done: Object.keys(job.sent).length - failedRefs.length,
          }
        : {}),
    })
    .where(eq(contentSuggestionJobs.id, jobId));
  if (!last) return "stored";
  if (!complete) {
    await recordSuggestionJobEnded(tx, jobId, "failed", "rejected", now);
    return "ended";
  }
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
  return "complete";
}

const SUGGESTION_PAGE = 100;
function readToken(token: string): TranslationBaseline | null {
  try {
    const value = JSON.parse(token) as TranslationBaseline;
    return parseTranslationBaseline({
      ...value.ref,
      language: value.language,
      field: value.field,
      expected: token,
      text: null,
    } as TranslationCellEdit);
  } catch {
    return null;
  }
}

export function suggestionStale(stored: string, current: string): boolean {
  const before = readToken(stored);
  const after = readToken(current);
  if (
    !before ||
    !after ||
    before.field !== "name" ||
    after.field !== "name" ||
    !after.config.languages.includes(after.language)
  )
    return true;
  return !sameTranslationBaseline(
    {
      ...before,
      config: after.config,
      required: after.required,
      defaultText: after.defaultText,
      inheritedDefaultText: after.inheritedDefaultText,
      effectiveDefaultText: after.effectiveDefaultText,
    },
    after,
  );
}

export async function listContentSuggestions(
  tx: Transaction,
  query: ContentSuggestionQuery,
  context: TranslationContext,
): Promise<ContentSuggestionPage> {
  if (
    query === null ||
    typeof query !== "object" ||
    Array.isArray(query) ||
    Object.keys(query).some((key) => !["after", "configuration", "fixesOnly"].includes(key)) ||
    (Object.hasOwn(query, "after") &&
      (typeof query.after !== "string" ||
        !query.after.trim() ||
        query.configuration === undefined)) ||
    (Object.hasOwn(query, "configuration") &&
      (typeof query.configuration !== "string" || !query.configuration)) ||
    (Object.hasOwn(query, "fixesOnly") && query.fixesOnly !== true)
  )
    invalidTranslationQuery();
  const settings = await readTranslationSettings(tx, context);
  const { config, required } = settings;
  const configuration = translationConfiguration(settings);
  if (query.configuration !== undefined && query.configuration !== configuration)
    throw new AppError("content.translation_stale", { scope: "configuration" });
  const rows = await tx
    .select()
    .from(contentSuggestions)
    .where(query.after === undefined ? undefined : gt(contentSuggestions.id, query.after))
    .orderBy(asc(contentSuggestions.id))
    .limit(SUGGESTION_PAGE);
  const counts = await tx.execute<{ count: number }>(sql`
    select count(*) as count from content_suggestions s
    join (${liveTranslationRows(TRANSLATION_GAP_KINDS)}) live
      on live.kind = s.kind and live.id = s.item_id
    where s.fix_field is not null or s.placeholder = 1
  `);
  const keyOf = (row: (typeof rows)[number]) => suggestionRef({ kind: row.kind, id: row.itemId });
  const refs = new Map<string, TranslationRef>();
  for (const row of rows) refs.set(keyOf(row), { kind: row.kind, id: row.itemId });
  const live = await readLiveItems(tx, [...refs.values()], settings);
  const suggestions: ContentSuggestionView[] = [];
  for (const row of rows) {
    if (query.fixesOnly && row.fixField === null && !row.placeholder) continue;
    if (row.text !== null && !config.languages.includes(row.language!)) continue;
    const item = live.get(keyOf(row));
    if (!item) continue;
    const resolved = resolveTranslationRow(
      item.row,
      row.language ?? config.defaultLanguage,
      settings,
    ).target;
    const target = row.language === null ? null : resolved;
    const languageFix = row.fixField !== null && row.fixField !== "internal";
    suggestions.push({
      id: row.id,
      kind: row.kind,
      itemId: row.itemId,
      item: {
        name: resolved.name,
        ...(resolved.parent ? { parent: resolved.parent } : {}),
      },
      language: row.language,
      text: row.text,
      placeholder: row.placeholder,
      cell:
        row.language === null
          ? null
          : { kind: row.kind, id: row.itemId, language: row.language, field: "name" },
      expected:
        target?.eligible && config.languages.includes(row.language!) ? nameEvidence(target) : null,
      // The three fix columns are set together or not at all (content_suggestions_fix_ck).
      fix:
        row.fixField === null
          ? null
          : { field: row.fixField, wrong: row.fixWrong!, right: row.fixRight! },
      // A row with text has a language and `expected` (content_suggestions_text_language_ck,
      // content_suggestions_name_ck).
      stale:
        (row.text !== null || languageFix) &&
        (row.expected === null ||
          target === null ||
          (languageFix && target.effectiveSelectedText !== row.fixWrong) ||
          suggestionStale(row.expected, nameEvidence(target))),
    });
  }
  return {
    config,
    required,
    configuration,
    waitingFixes: counts.rows[0]!.count,
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

export async function deleteSavedCellSuggestions(
  tx: Transaction,
  cells: readonly TranslationCellRef[],
): Promise<void> {
  const names = cells.filter((cell) => cell.field === "name");
  if (!names.length) return;
  await tx
    .delete(contentSuggestions)
    .where(storedIn(names.map((cell) => [cell.kind, cell.id, cell.language] as const)));
}
