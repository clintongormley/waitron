import { setTimeout as delay } from "node:timers/promises";
import { withTransaction, type Database, type Transaction } from "@waitron/db";
import { hasCode, isAppError, type ErrorCode } from "@waitron/shared";
import {
  readActiveSuggestionJob,
  recordSuggestionJobEnded,
  recordSuggestionJobProgress,
  recordSuggestionJobRefused,
  recordSuggestionJobReleased,
  recordSuggestionJobSubmitted,
  storeSuggestionPage,
  type SuggestionJobRow,
  type SuggestionPage,
  type TranslationContext,
} from "@waitron/catalogue";
import type { CloudConnection } from "./cloud-client.js";
import type { CloudReason } from "./cloud-translation.js";
import "@waitron/catalogue/src/errors.js";
import "./errors.js";

export type RunnerStep = "idle" | "wait" | "again";

export const JOB_LIFETIME_MS = 24 * 60 * 60 * 1000;

const POLL_MS = 5000;
const IDLE_MS = 60000;
const FIRST_BACKOFF_MS = 5000;
const LAST_BACKOFF_MS = 60000;

const FAILURE: Record<CloudReason, "provider" | "consent" | "limit"> = {
  provider_unavailable: "provider",
  provider_failed: "provider",
  consent_required: "consent",
  limit_reached: "limit",
};

export interface ContentSuggestionRunnerDeps {
  db: Database;
  connection: Pick<CloudConnection, "translation" | "translationService">;
  context: TranslationContext;
  isPrimary: () => boolean;
  now?: () => Date;
}

function is(error: unknown, code: ErrorCode): boolean {
  return isAppError(error) && error.code === code;
}

function submitRefusal(
  error: unknown,
): { refusal: "consent" | "limit" | "job_running"; fits: number | null } | null {
  if (!isAppError(error)) return null;
  if (hasCode(error, "content.suggestion_limit_reached"))
    return { refusal: "limit", fits: error.params.fits };
  if (error.code === "content.suggestion_consent_required")
    return { refusal: "consent", fits: null };
  if (error.code === "content.suggestion_job_running")
    return { refusal: "job_running", fits: null };
  return null;
}

export function createContentSuggestionRunner(deps: ContentSuggestionRunnerDeps) {
  const now = deps.now ?? (() => new Date());
  const { translation } = deps.connection;
  const record = (fn: (tx: Transaction) => Promise<void>) => withTransaction(deps.db, fn);
  let woken = false;
  let interruptIdle: AbortController | undefined;

  /** Ends an open job; a finished one only needs its release recorded. */
  async function close(
    job: SuggestionJobRow,
    state: "failed" | "expired",
    failure: "not_connected" | "rejected" | null,
  ): Promise<RunnerStep> {
    const at = now();
    await record((tx) =>
      job.state === "submitting" || job.state === "running"
        ? recordSuggestionJobEnded(tx, job.id, state, failure, at)
        : recordSuggestionJobReleased(tx, job.id),
    );
    return "again";
  }

  async function submit(
    job: SuggestionJobRow,
    body: string,
    signal?: AbortSignal,
  ): Promise<RunnerStep> {
    try {
      // The job's id is the operation ID, so a retry is the same job to Cloud.
      const reply = await translation.submit(job.id, body, signal);
      await record((tx) => recordSuggestionJobSubmitted(tx, job.id, reply));
      return "again";
    } catch (error) {
      const refused = submitRefusal(error);
      if (refused) {
        const at = now();
        await record((tx) =>
          recordSuggestionJobRefused(tx, job.id, refused.refusal, refused.fits, at),
        );
        return "again";
      }
      if (is(error, "cloud.request_invalid")) return close(job, "failed", "rejected");
      throw error;
    }
  }

  async function poll(
    job: SuggestionJobRow,
    cloudJobId: string,
    signal?: AbortSignal,
  ): Promise<RunnerStep> {
    try {
      const status = await translation.status(cloudJobId, signal);
      if (status.state === "queued" || status.state === "running") {
        await record((tx) => recordSuggestionJobProgress(tx, job.id, status));
        return "wait";
      }
      if (status.state === "done" || status.state === "partly_done") {
        const collected = await translation.collect(cloudJobId, signal);
        // Collect's reply carries no reason; the status that finished the job does.
        const page: SuggestionPage = { ...collected, cursor: 0, nextCursor: null };
        const results: SuggestionPage =
          status.reason === "limit_reached" || status.reason === "provider_failed"
            ? { ...page, reason: status.reason }
            : page;
        const at = now();
        await record(async (tx) => {
          await storeSuggestionPage(tx, job.id, results, deps.context, at);
        });
        return "again";
      }
      if (status.state === "failed") {
        const failure = FAILURE[status.reason!];
        const at = now();
        await record((tx) => recordSuggestionJobEnded(tx, job.id, "failed", failure, at));
        return "again";
      }
      return await close(job, "expired", null);
    } catch (error) {
      if (is(error, "content.suggestion_expired")) return close(job, "expired", null);
      if (is(error, "cloud.request_invalid")) return close(job, "failed", "rejected");
      throw error;
    }
  }

  async function release(
    job: SuggestionJobRow,
    cloudJobId: string,
    signal?: AbortSignal,
  ): Promise<RunnerStep> {
    try {
      await translation.release(cloudJobId, signal);
    } catch (error) {
      if (!is(error, "content.suggestion_expired")) throw error;
    }
    await record((tx) => recordSuggestionJobReleased(tx, job.id));
    return "again";
  }

  async function step(signal?: AbortSignal): Promise<RunnerStep> {
    if (!deps.isPrimary()) return "idle";
    const job = await withTransaction(deps.db, (tx) => readActiveSuggestionJob(tx));
    if (!job) return "idle";
    // A refusal that keeps coming back would otherwise hold the run open, refusing every new one.
    if (now().getTime() - Date.parse(job.createdAt) >= JOB_LIFETIME_MS)
      return close(job, "expired", null);
    if ((await deps.connection.translationService()) !== "on")
      return close(job, "failed", "not_connected");
    if (job.state === "submitting")
      return job.body === null ? close(job, "failed", "rejected") : submit(job, job.body, signal);
    if (job.cloudJobId === null) return close(job, "failed", "rejected");
    return job.state === "running"
      ? poll(job, job.cloudJobId, signal)
      : release(job, job.cloudJobId, signal);
  }

  async function run(
    signal: AbortSignal,
    options: {
      sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
      onError?: (error: unknown) => void;
    } = {},
  ): Promise<void> {
    const sleep =
      options.sleep ?? ((ms: number, s: AbortSignal) => delay(ms, undefined, { signal: s }));
    let backoff = FIRST_BACKOFF_MS;
    const pause = async (ms: number, wakeable: boolean) => {
      const interrupt = new AbortController();
      if (wakeable) interruptIdle = interrupt;
      try {
        await sleep(ms, wakeable ? AbortSignal.any([signal, interrupt.signal]) : signal);
      } catch (error) {
        if (!signal.aborted && !interrupt.signal.aborted) throw error;
      } finally {
        if (wakeable) interruptIdle = undefined;
      }
    };
    while (!signal.aborted) {
      woken = false;
      let next: RunnerStep;
      try {
        next = await step(signal);
        backoff = FIRST_BACKOFF_MS;
      } catch (error) {
        if (signal.aborted) return;
        options.onError?.(error);
        await pause(backoff, false);
        backoff = Math.min(backoff * 2, LAST_BACKOFF_MS);
        continue;
      }
      if (next === "wait") await pause(POLL_MS, false);
      else if (next === "idle" && !woken) await pause(IDLE_MS, true);
    }
  }

  return {
    step,
    run,
    wake(): void {
      woken = true;
      interruptIdle?.abort();
    },
  };
}
