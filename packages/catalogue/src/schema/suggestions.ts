import { sql } from "drizzle-orm";
import { check, foreignKey, index, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  count,
  enumCheck,
  enumType,
  flag,
  id,
  json,
  label,
  labelList,
  newId,
  nowIso,
  table,
  tsString,
} from "@waitron/db";
import { TRANSLATION_GAP_KINDS } from "../content-translation-kinds.js";

export const SUGGESTION_JOB_STATES = [
  "submitting",
  "running",
  "done",
  "partly_done",
  "failed",
  "expired",
  "refused",
] as const;
export const SUGGESTION_REFUSALS = ["consent", "limit", "job_running"] as const;
// provider: Cloud's provider_unavailable; consent: consent_required; limit: limit_reached (contract's reasons).
export const SUGGESTION_FAILURES = [
  "provider",
  "not_connected",
  "rejected",
  "consent",
  "limit",
] as const;

const kind = enumType(TRANSLATION_GAP_KINDS);
const jobState = enumType(SUGGESTION_JOB_STATES);
const refusal = enumType(SUGGESTION_REFUSALS);
const failure = enumType(SUGGESTION_FAILURES);

export const contentSuggestionJobs = table(
  "content_suggestion_jobs",
  {
    // Also the submit's operation ID: Cloud answers a retried submit with the same job.
    id: id("id").primaryKey().$defaultFn(newId),
    runId: id("run_id").notNull(),
    position: count("position").notNull(),
    state: jobState("state").notNull(),
    refusal: refusal("refusal"),
    fits: count("fits"),
    failure: failure("failure"),
    cloudJobId: id("cloud_job_id"),
    body: label("body"),
    sent: json<Record<string, string[]>>("sent").notNull(),
    runTotal: count("run_total").notNull(),
    total: count("total").notNull().default(0),
    done: count("done").notNull().default(0),
    failed: count("failed").notNull().default(0),
    dropped: count("dropped").notNull().default(0),
    failedRefs: labelList("failed_refs")
      .notNull()
      .$defaultFn(() => []),
    released: flag("released").notNull().default(false),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    finishedAt: tsString("finished_at"),
    openedAt: tsString("opened_at"),
    collectCursor: count("collect_cursor"),
    // Refs answered or failed so far in this job, across every page stored.
    collectedRefs: labelList("collected_refs").notNull().default([]),
  },
  (t) => [
    unique("content_suggestion_jobs_run_position_key").on(t.runId, t.position),
    check("content_suggestion_jobs_state_ck", enumCheck(t.state)),
    check("content_suggestion_jobs_refusal_ck", enumCheck(t.refusal)),
    check("content_suggestion_jobs_failure_ck", enumCheck(t.failure)),
  ],
);

export const contentSuggestions = table(
  "content_suggestions",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    jobId: id("job_id"),
    kind: kind("kind").notNull(),
    // A row of the table `kind` names, so no foreign key can hold it. A suggestion for a deleted item
    // is never listed (listing resolves each against the live item) and the next run start prunes it.
    itemId: id("item_id").notNull(),
    // Null on the item's own row: a placeholder, or a spelling fix to the staff name.
    language: label("language"),
    text: label("text"),
    expected: label("expected"),
    fixField: label("fix_field"),
    fixWrong: label("fix_wrong"),
    fixRight: label("fix_right"),
    placeholder: flag("placeholder").notNull().default(false),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    foreignKey({
      columns: [t.jobId],
      foreignColumns: [contentSuggestionJobs.id],
      name: "content_suggestions_job_fk",
    }).onDelete("set null"),
    unique("content_suggestions_item_language_key").on(t.kind, t.itemId, t.language),
    // The key above treats each null language as distinct, so it cannot keep the item's own row single.
    uniqueIndex("content_suggestions_item_row_key")
      .on(t.kind, t.itemId)
      .where(sql`${t.language} is null`),
    index("content_suggestions_language_idx").on(t.language),
    index("content_suggestions_job_idx").on(t.jobId),
    check("content_suggestions_kind_ck", enumCheck(t.kind)),
    check("content_suggestions_name_ck", sql`${t.text} is null or ${t.expected} is not null`),
    check(
      "content_suggestions_fix_ck",
      sql`(${t.fixField} is null) = (${t.fixWrong} is null) and (${t.fixField} is null) = (${t.fixRight} is null)`,
    ),
    check(
      "content_suggestions_text_language_ck",
      sql`${t.text} is null or ${t.language} is not null`,
    ),
  ],
);

export type SuggestionJobRow = typeof contentSuggestionJobs.$inferSelect;
export type SuggestionRow = typeof contentSuggestions.$inferSelect;
