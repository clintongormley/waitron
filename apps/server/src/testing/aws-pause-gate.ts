// The pieces of the Amazon S3 pause rehearsal (`aws-stream-pause.aws-rehearsal.test.ts`) that can
// be tested without a bucket: which hosts its gates let through, and how it reads the server's log
// and the gate's record.
import { setTimeout as delay } from "node:timers/promises";
import type { SeenConnect } from "./transport-gate.js";

const POLL_MS = 250;

interface Clock {
  now?(): number;
  sleep?(ms: number, signal?: AbortSignal): Promise<void>;
}

const realSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  delay(ms, undefined, signal === undefined ? {} : { signal });

/**
 * The only host the gates admit: the owned bucket's virtual-hosted name in its region. Both of
 * the rehearsal's clients address it there: Litestream 0.5.17 did in slice 8a's local experiment
 * (no AWS packet), and the S3 store sets `forcePathStyle` only when an endpoint is given
 * (`packages/stream/src/s3-client.ts`), which the rehearsal's bucket has not. The path-style name
 * `s3.<region>.amazonaws.com` is left out because it serves every bucket.
 */
export function ownedBucketHosts(bucket: string, region: string): string[] {
  return [`${bucket}.s3.${region}.amazonaws.com`.toLowerCase()];
}

export function allowOwnedBucket(
  bucket: string,
  region: string,
): (host: string, port: number) => boolean {
  const hosts = new Set(ownedBucketHosts(bucket, region));
  return (host, port) => port === 443 && hosts.has(host.toLowerCase());
}

export interface PauseCheckEvent {
  phase: "pause-check-denied";
  api: "ListObjectsV2";
  httpStatus?: number;
  errorName?: string;
  elapsedMs: number;
  outcome: "ok" | "failed";
}

/**
 * Waits for the supervisor's logged `stream.pause_check_failed` and records it. The supervisor
 * logs that event once per pause, so the first one decides: a 403 named `AccessDenied` passes,
 * anything else fails at once.
 */
export async function awaitDeniedPauseCheck(
  options: {
    streamEvents(): Promise<{ event: string; [field: string]: unknown }[]>;
    timeoutMs: number;
    record(event: PauseCheckEvent): void;
    signal?: AbortSignal;
  } & Clock,
): Promise<void> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? realSleep;
  const started = now();
  const base = { phase: "pause-check-denied", api: "ListObjectsV2" } as const;
  for (;;) {
    options.signal?.throwIfAborted();
    const refusal = (await options.streamEvents()).find(
      (line) => line.event === "stream.pause_check_failed",
    );
    const elapsedMs = now() - started;
    if (refusal !== undefined) {
      const status = typeof refusal.status === "number" ? refusal.status : undefined;
      const name = typeof refusal.errorName === "string" ? refusal.errorName : undefined;
      const outcome = status === 403 && name === "AccessDenied" ? "ok" : "failed";
      options.record({
        ...base,
        ...(status === undefined ? {} : { httpStatus: status }),
        ...(name === undefined ? {} : { errorName: name }),
        elapsedMs,
        outcome,
      });
      if (outcome === "ok") return;
      const what =
        status === undefined
          ? `errorCode ${String(refusal.errorCode)}`
          : `status ${status}, ${name ?? "no error name"}`;
      throw new Error(`the paused bucket check was refused, but not by the bucket rule: ${what}`);
    }
    if (elapsedMs >= options.timeoutMs) {
      options.record({ ...base, elapsedMs, outcome: "failed" });
      throw new Error(
        `no refused pause check was logged within ${options.timeoutMs} ms of the gate's release`,
      );
    }
    await sleep(POLL_MS, options.signal);
  }
}

/**
 * Resolves once the gate has seen a CONNECT arrive while holding, numbered after
 * `afterSequence`; rejects after `timeoutMs`.
 */
export async function watchHeldConnect(
  gate: { seen(): readonly SeenConnect[] },
  afterSequence: number,
  options: { timeoutMs: number; signal?: AbortSignal } & Clock,
): Promise<{ sequence: number; elapsedMs: number }> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? realSleep;
  const started = now();
  for (;;) {
    options.signal?.throwIfAborted();
    const hit = gate.seen().find((entry) => entry.sequence > afterSequence && entry.held);
    const elapsedMs = now() - started;
    if (hit !== undefined) return { sequence: hit.sequence, elapsedMs };
    if (elapsedMs >= options.timeoutMs) {
      throw new Error(
        `no CONNECT arrived at the gate while it held after sequence ${afterSequence} within ${options.timeoutMs} ms`,
      );
    }
    await sleep(POLL_MS, options.signal);
  }
}
