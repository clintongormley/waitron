import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import {
  buildSuggestionJob,
  pruneSuggestions,
  readSuggestionGaps,
} from "./content-suggestion-collect.js";
import type { SuggestionRunState, SuggestionRunView } from "./content-suggestion-types.js";
import type { TranslationContext } from "./content-translation-targets.js";
import {
  contentSuggestionJobs as jobs,
  contentSuggestions,
  type SUGGESTION_FAILURES,
  type SUGGESTION_REFUSALS,
  type SuggestionJobRow,
} from "./schema/suggestions.js";
import "./errors.js";

export type SuggestionFailure = (typeof SUGGESTION_FAILURES)[number];
export type SuggestionRefusal = (typeof SUGGESTION_REFUSALS)[number];

const REFUSAL_CODES: Record<SuggestionRefusal, string> = {
  consent: "content.suggestion_consent_required",
  limit: "content.suggestion_limit_reached",
  job_running: "content.suggestion_job_running",
};
const FAILURE_CODES: Record<SuggestionFailure, string> = {
  provider: "content.suggestion_service_unavailable",
  consent: "content.suggestion_consent_required",
  limit: "content.suggestion_limit_reached",
  not_connected: "cloud.not_configured",
  rejected: "cloud.request_invalid",
};

/** A job that refuses a new run: still going, or ended with a Cloud job not yet released. */
const ACTIVE = or(
  inArray(jobs.state, ["submitting", "running"]),
  and(
    inArray(jobs.state, ["done", "partly_done", "failed"]),
    isNotNull(jobs.cloudJobId),
    eq(jobs.released, false),
  ),
);

export async function readActiveSuggestionJob(
  tx: Transaction,
): Promise<SuggestionJobRow | undefined> {
  const [job] = await tx.select().from(jobs).where(ACTIVE).orderBy(asc(jobs.position)).limit(1);
  return job;
}

export async function startSuggestionRun(
  tx: Transaction,
  context: TranslationContext,
  now: Date = new Date(),
): Promise<SuggestionRunView | null> {
  if (await readActiveSuggestionJob(tx)) throw new AppError("content.suggestion_job_running", {});
  const gaps = await readSuggestionGaps(tx, context);
  await pruneSuggestions(tx, context, gaps);
  const draft = await buildSuggestionJob(tx, context, new Set(), gaps);
  if (!draft) return null;
  await tx.delete(jobs);
  await tx.insert(jobs).values({
    runId: randomUUID(),
    position: 1,
    state: "submitting",
    body: draft.body,
    sent: draft.sent,
    runTotal: Object.keys(draft.sent).length + draft.remaining,
    createdAt: now.toISOString(),
  });
  return readSuggestionRun(tx);
}

export async function recordSuggestionJobSubmitted(
  tx: Transaction,
  jobId: string,
  reply: { jobId: string; total: number },
): Promise<void> {
  await tx
    .update(jobs)
    .set({ state: "running", cloudJobId: reply.jobId, total: reply.total, body: null })
    .where(and(eq(jobs.id, jobId), eq(jobs.state, "submitting")));
}

export async function recordSuggestionJobProgress(
  tx: Transaction,
  jobId: string,
  status: { done: number; failed: number },
): Promise<void> {
  await tx
    .update(jobs)
    .set({ done: status.done, failed: status.failed })
    .where(and(eq(jobs.id, jobId), eq(jobs.state, "running")));
}

export async function recordSuggestionJobRefused(
  tx: Transaction,
  jobId: string,
  refusal: SuggestionRefusal,
  fits: number | null,
  now: Date = new Date(),
): Promise<void> {
  await tx
    .update(jobs)
    .set({
      state: "refused",
      refusal,
      fits,
      released: true,
      body: null,
      finishedAt: now.toISOString(),
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.state, "submitting")));
}

function lostCounted(
  job: SuggestionJobRow,
): Pick<SuggestionJobRow, "failedRefs" | "failed" | "done"> {
  const collected = new Set(job.collectedRefs);
  const lost = Object.keys(job.sent).filter((key) => !collected.has(key));
  const failedRefs = [...new Set([...job.failedRefs, ...lost])].sort();
  return {
    failedRefs,
    failed: failedRefs.length,
    done: Object.keys(job.sent).length - failedRefs.length,
  };
}

export async function recordSuggestionJobEnded(
  tx: Transaction,
  jobId: string,
  state: "failed" | "expired",
  failure: SuggestionFailure | null,
  now: Date = new Date(),
): Promise<void> {
  const nothingToRelease =
    state === "expired" || failure === "not_connected" || failure === "rejected";
  const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
  // A job with no item accounted for yet keeps the counts of its last status reading.
  const counts = job && job.collectedRefs.length > 0 ? lostCounted(job) : {};
  await tx
    .update(jobs)
    .set({
      ...counts,
      state,
      failure,
      body: null,
      finishedAt: now.toISOString(),
      released: nothingToRelease ? true : sql<boolean>`${jobs.cloudJobId} is null`,
    })
    .where(and(eq(jobs.id, jobId), inArray(jobs.state, ["submitting", "running"])));
}

export async function recordSuggestionJobReleased(tx: Transaction, jobId: string): Promise<void> {
  await tx.update(jobs).set({ released: true }).where(eq(jobs.id, jobId));
}

function outcome(
  state: SuggestionRunState,
  last: SuggestionJobRow,
  run: readonly SuggestionJobRow[],
): { code: string | null; fits: number | null } {
  if (state === "refused" && last.refusal !== null)
    return { code: REFUSAL_CODES[last.refusal], fits: last.refusal === "limit" ? last.fits : null };
  if (state === "failed" && last.failure !== null)
    return { code: FAILURE_CODES[last.failure], fits: last.failure === "limit" ? 0 : null };
  if (state === "partly_done" && run.some((job) => job.failure === "limit"))
    return { code: FAILURE_CODES.limit, fits: 0 };
  if (state === "expired") return { code: "content.suggestion_expired", fits: null };
  return { code: null, fits: null };
}

export async function readSuggestionRun(tx: Transaction): Promise<SuggestionRunView | null> {
  const rows = await tx
    .select({ job: jobs, active: sql<number>`${ACTIVE}` })
    .from(jobs)
    .orderBy(asc(jobs.position));
  const run = rows.map((row) => row.job);
  const first = run[0];
  if (!first) return null;
  const last = run.at(-1)!;
  const active = rows.find((row) => row.active)?.job;
  const [counted] = await tx
    .select({ waiting: sql<number>`count(*)` })
    .from(contentSuggestions)
    .where(isNotNull(contentSuggestions.text));
  let state: SuggestionRunState;
  if (active?.state === "submitting") state = "sending";
  else if (active && active.state !== "failed") state = "running";
  else if (last.state === "refused" || last.state === "failed" || last.state === "expired")
    state = last.state;
  else
    state = run.some((job) => job.state === "partly_done" || job.failed > 0)
      ? "partly_done"
      : "done";
  const done = run.reduce((sum, job) => sum + job.done, 0);
  const failed = run.reduce((sum, job) => sum + job.failed, 0);
  return {
    state,
    total: first.runTotal,
    progress: done + failed,
    done,
    failed,
    ...outcome(state, last, run),
    waiting: Number(counted!.waiting),
    finishedAt: state === "sending" || state === "running" ? null : last.finishedAt,
    opened: first.openedAt !== null,
  };
}

export async function markSuggestionRunOpened(
  tx: Transaction,
  now: Date = new Date(),
): Promise<void> {
  if (await readActiveSuggestionJob(tx)) return;
  await tx
    .update(jobs)
    .set({ openedAt: now.toISOString() })
    .where(and(eq(jobs.position, 1), isNull(jobs.openedAt)));
}

export async function sentInRun(tx: Transaction, runId: string): Promise<Set<string>> {
  const rows = await tx.select({ sent: jobs.sent }).from(jobs).where(eq(jobs.runId, runId));
  return new Set(rows.flatMap((row) => Object.keys(row.sent)));
}
