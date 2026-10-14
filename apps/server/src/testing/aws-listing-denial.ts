// AWS facts this relies on, quoted from AWS's IAM documentation (fetched 2026-10-14):
// - https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_condition_operators.html
//   "If the key that you specify in a policy condition is not present in the request context, the
//   values do not match and the condition is false." Whether S3 leaves `s3:prefix` out of a listing
//   with no prefix or sends it empty is not established; neither is denied. Absent, the condition is
//   false by that sentence; empty, `""` cannot match `<P>*` because `<P>` is never empty:
//   `ctx.bucketPolicy.put` refuses (`policy-refused`) any `<P>` not longer than an issued label
//   prefix, before a listing or the work runs.
// - https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html
//   "An explicit deny in either of these policies overrides the allow." So the rehearsal key's own
//   S3 allow does not outrank this bucket policy's Deny.
import { setTimeout as delay } from "node:timers/promises";
import { createS3ObjectStore } from "@waitron/stream";
import { hasCode, isAppError } from "@waitron/shared";
import { AWS_REHEARSAL_LIMITS } from "./aws-rehearsal-limits.js";
import type { AwsRehearsal } from "./aws-rehearsal.js";

export type ListAnswer = { ok: true } | { ok: false; status: number | null; errorName: string };

export interface ListingDenialDeps {
  list(prefix: string, signal: AbortSignal): Promise<ListAnswer>;
  now(): number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

/** Time between listings while waiting for the policy to take effect, and to stop taking effect. */
export const LISTING_DENIAL_POLL_MS = 2_000;

const SCENARIO = "listing-denial";

export function listingDenialPolicy(bucket: string, exactPrefix: string): string {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "WaitronRehearsalListingDenial",
        Effect: "Deny",
        Principal: "*",
        Action: "s3:ListBucket",
        Resource: `arn:aws:s3:::${bucket}`,
        Condition: { StringLike: { "s3:prefix": `${exactPrefix}*` } },
      },
    ],
  });
}

/** The label prefix `exactPrefix` lies under: `rehearsal-<runId>/<label>/`. */
function labelPrefixOf(ctx: AwsRehearsal, exactPrefix: string): string {
  const root = `rehearsal-${ctx.runId}/`;
  const end = exactPrefix.indexOf("/", root.length);
  return exactPrefix.startsWith(root) && end > root.length ? exactPrefix.slice(0, end + 1) : root;
}

/** Lists through the same store code the stream supervisor's pause check uses. */
function storeDeps(ctx: AwsRehearsal, exactPrefix: string): ListingDenialDeps {
  const labelPrefix = labelPrefixOf(ctx, exactPrefix);
  const store = createS3ObjectStore(ctx.bucketConfig(labelPrefix));
  return {
    async list(prefix, signal) {
      try {
        await store.list(prefix.slice(labelPrefix.length), { signal });
        return { ok: true };
      } catch (error) {
        if (isAppError(error) && hasCode(error, "backup.stream_request_failed")) {
          return { ok: false, status: error.params.status, errorName: error.params.name };
        }
        throw error;
      }
    },
    now: Date.now,
    sleep: (ms, signal) => delay(ms, undefined, { signal }),
  };
}

interface Polled {
  met: boolean;
  last: ListAnswer;
  attempts: number;
  elapsedMs: number;
}

const isForbidden = (answer: ListAnswer): boolean => !answer.ok && answer.status === 403;

/** Lists until `want` holds, starting no listing at or past the denial-control budget. */
async function pollUntil(
  ctx: AwsRehearsal,
  exactPrefix: string,
  deps: ListingDenialDeps,
  want: (answer: ListAnswer) => boolean,
  seen: { last?: ListAnswer } = {},
): Promise<Polled> {
  const budget = AWS_REHEARSAL_LIMITS.denialControlMs;
  const started = deps.now();
  let attempts = 0;
  for (;;) {
    if (ctx.signal.aborted) throw new Error("the listing denial was stopped with the rehearsal");
    const last = await deps.list(exactPrefix, ctx.signal);
    seen.last = last;
    attempts += 1;
    const elapsedMs = Math.max(0, deps.now() - started);
    if (want(last)) return { met: true, last, attempts, elapsedMs };
    if (elapsedMs + LISTING_DENIAL_POLL_MS >= budget)
      return { met: false, last, attempts, elapsedMs };
    await deps.sleep(LISTING_DENIAL_POLL_MS, ctx.signal);
  }
}

function record(ctx: AwsRehearsal, phase: string, polled: Polled): void {
  const { last } = polled;
  ctx.record({
    scenario: SCENARIO,
    phase,
    api: "ListObjectsV2",
    ...(last.ok ? {} : { httpStatus: last.status, errorName: last.errorName }),
    attempts: polled.attempts,
    elapsedMs: polled.elapsedMs,
    outcome: polled.met ? "ok" : "failed",
  });
}

const statusText = (answer: ListAnswer | undefined): string =>
  answer === undefined ? "nothing" : answer.ok ? "success" : String(answer.status);

/**
 * Denies listing `exactPrefix` on the rehearsal's bucket, proves the denial with a real 403, runs
 * `work`, then removes the policy and proves the same listing succeeds again. Throws when either
 * control fails: an unmeasured 403 is never stood in for.
 */
export async function withListingDenied(
  ctx: AwsRehearsal,
  exactPrefix: string,
  work: () => Promise<void>,
  deps: ListingDenialDeps = storeDeps(ctx, exactPrefix),
): Promise<void> {
  await ctx.bucketPolicy.put(listingDenialPolicy(ctx.bucket, exactPrefix));
  let failure: { error: unknown } | undefined;
  let lastDenied: ListAnswer | undefined;
  try {
    const negative = await pollUntil(ctx, exactPrefix, deps, isForbidden);
    lastDenied = negative.last;
    record(ctx, negative.met ? "deny-negative-control" : "deny-unmeasured", negative);
    if (!negative.met) {
      throw new Error(
        `the listing refusal is unmeasured: no 403 within ${AWS_REHEARSAL_LIMITS.denialControlMs} ms (last answer ${statusText(negative.last)})`,
      );
    }
    await work();
  } catch (error) {
    failure = { error };
  }
  const unresolved = await restore(ctx, exactPrefix, deps, lastDenied);
  if (failure === undefined) {
    if (unresolved !== undefined) throw unresolved;
    return;
  }
  // The first failure stays the one thrown, so a caller sees what went wrong in the work itself;
  // teardown removes the policy again whatever happened here.
  const { error } = failure;
  if (unresolved !== undefined && error instanceof Error && error.cause === undefined) {
    error.cause = unresolved;
  }
  throw error;
}

/** Removes the policy and runs the positive control; answers the error naming what is unresolved. */
async function restore(
  ctx: AwsRehearsal,
  exactPrefix: string,
  deps: ListingDenialDeps,
  lastDenied: ListAnswer | undefined,
): Promise<Error | undefined> {
  try {
    await ctx.bucketPolicy.remove();
  } catch (error) {
    const named = error instanceof Error ? error.message : "unknown";
    return new Error(
      `listing denial unresolved: removing the policy failed (${named}); the listing last answered ${statusText(lastDenied)}`,
    );
  }
  let positive: Polled;
  const seen: { last?: ListAnswer } = { last: lastDenied };
  try {
    positive = await pollUntil(ctx, exactPrefix, deps, (answer) => answer.ok, seen);
  } catch (error) {
    const named = error instanceof Error ? error.message : "unknown";
    return new Error(
      `listing denial unresolved: the policy was removed, but the positive control did not finish (${named}); the listing last answered ${statusText(seen.last)}`,
      { cause: error },
    );
  }
  record(ctx, "deny-positive-control", positive);
  return positive.met
    ? undefined
    : new Error(
        `listing denial unresolved: the policy was removed, but the listing still answered ${statusText(positive.last)} after ${AWS_REHEARSAL_LIMITS.denialControlMs} ms`,
      );
}
