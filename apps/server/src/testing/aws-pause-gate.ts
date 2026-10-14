// The pieces of the Amazon S3 pause rehearsal (`aws-stream-pause.aws-rehearsal.test.ts`) that can
// be tested without a bucket: which hosts its gates let through, and how it reads the server's log
// and the gate's record.
import { setTimeout as delay } from "node:timers/promises";
import { TICK_MS } from "@waitron/stream";
import { AWS_REHEARSAL_LIMITS } from "./aws-rehearsal-limits.js";
import { STREAM_PAUSE_RESUME_WAIT_MS } from "./stream-pause-scenario.js";
import type { SeenConnect } from "./transport-gate.js";

const POLL_MS = 250;
/** The supervisor asks at most once per TICK_MS, so the server's log is read less often. */
const DENIED_CHECK_POLL_MS = 1_000;

/**
 * The AWS run's wait, while paused, for the server's pause check to be held at its gate. The
 * supervisor asks once the side file is folded back (`#pause`, packages/stream/src/supervisor.ts),
 * which the scenario waits for before the paused sales, so the check is normally held already.
 */
export const STREAM_PAUSE_AWS_HELD_CHECK_WAIT_MS = 5_000;

/** The AWS run's wait, while paused, for the supervisor to log its refused pause check. */
export const STREAM_PAUSE_AWS_DENIED_CHECK_WAIT_MS = AWS_REHEARSAL_LIMITS.denialControlMs;

/**
 * The AWS run's resume wait: after a refused check the supervisor asks again only after TICK_MS,
 * and the rule's removal may take up to the control budget to reach every AWS front end.
 */
export const STREAM_PAUSE_AWS_RESUME_WAIT_MS =
  TICK_MS + AWS_REHEARSAL_LIMITS.denialControlMs + STREAM_PAUSE_RESUME_WAIT_MS;

/**
 * What the AWS run plans to add: inside the pause, the wait for the held check, the listing
 * denial's two controls and the wait for the refused check; after it, the longer resume wait. This
 * is a budget, not an upper bound. A control's limit stops it STARTING a listing; a listing
 * already started can run on past it, the store making up to three attempts, each with a 30 s
 * silence limit (packages/stream/src/s3-client.ts). Also left out: the bucket policy's put and
 * delete calls, and in a failing run the AWS test's wait for the restarted Litestream to reach its
 * gate.
 */
export const STREAM_PAUSE_AWS_EXTRA_MS =
  STREAM_PAUSE_AWS_HELD_CHECK_WAIT_MS +
  2 * AWS_REHEARSAL_LIMITS.denialControlMs +
  STREAM_PAUSE_AWS_DENIED_CHECK_WAIT_MS +
  (STREAM_PAUSE_AWS_RESUME_WAIT_MS - STREAM_PAUSE_RESUME_WAIT_MS);

interface Clock {
  now?(): number;
  sleep?(ms: number, signal?: AbortSignal): Promise<void>;
}

const realSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  delay(ms, undefined, signal === undefined ? {} : { signal });

/**
 * The only host the gates admit: the owned bucket's virtual-hosted name in its region. Every
 * client the gates serve addresses it there: Litestream 0.5.17 did in a local experiment on
 * 2026-10-14 (no AWS packet), and the S3 store, which the server and the scenario both use, sets
 * `forcePathStyle` only when an endpoint is given (`packages/stream/src/s3-client.ts`), which the
 * rehearsal's bucket has not. The path-style name `s3.<region>.amazonaws.com` is left out because
 * it serves every bucket.
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
 * Waits for the supervisor's logged `stream.pause_check_failed` and records it. The supervisor logs
 * a refused check once per pause, and a check that hit its read deadline each time
 * (packages/stream/src/supervisor.ts); either way the first one decides: a 403 named
 * `AccessDenied` passes, anything else fails at once.
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
    await sleep(DENIED_CHECK_POLL_MS, options.signal);
  }
}

/**
 * Watches for the Litestream the supervisor starts after a kill to reach the held gate. Give
 * `childStarted` to the spawn seam; call `watch` just before the kill. Only a held CONNECT numbered
 * after the gate's last one when the first child after `watch` started counts, so one the killed
 * Litestream opens in the meantime does not. A failure names any CONNECT the gate refused.
 */
export function restartWatch(gate: {
  seen(): readonly SeenConnect[];
  refused(): readonly string[];
}): {
  childStarted(): void;
  watch(
    options: { timeoutMs: number; signal?: AbortSignal } & Clock,
  ): Promise<{ elapsedMs: number }>;
} {
  let watching = false;
  let replacementAfter: number | undefined;
  return {
    childStarted() {
      if (watching && replacementAfter === undefined) {
        replacementAfter = gate.seen().at(-1)?.sequence ?? 0;
      }
    },
    async watch(options) {
      watching = true;
      const now = options.now ?? Date.now;
      const sleep = options.sleep ?? realSleep;
      const started = now();
      for (;;) {
        options.signal?.throwIfAborted();
        const seen = gate.seen();
        const after = replacementAfter;
        const hit =
          after === undefined
            ? undefined
            : seen.find((entry) => entry.sequence > after && entry.held);
        const elapsedMs = now() - started;
        if (hit !== undefined) return { elapsedMs };
        if (elapsedMs >= options.timeoutMs) {
          const within = `within ${options.timeoutMs} ms of the watch's start`;
          const what =
            replacementAfter === undefined
              ? `no new Litestream started ${within}`
              : `a new Litestream started, but no CONNECT reached the held gate after it ${within}`;
          const refused = gate.refused();
          throw new Error(
            refused.length === 0
              ? what
              : `${what}; the gate refused a CONNECT to ${refused.join(", ")}`,
          );
        }
        await sleep(POLL_MS, options.signal);
      }
    },
  };
}

export interface GateRefusedEvent {
  phase: "gate-refused";
  /** Whose gate: each client has its own. */
  objectRole: string;
  count: number;
  outcome: "ok" | "failed";
}

/** One receipt event per gate: how many CONNECTs it refused. The hosts stay out of the receipt. */
export function gateRefusedEvents(
  gates: readonly (readonly [name: string, gate: { refused(): readonly string[] }])[],
): GateRefusedEvent[] {
  return gates.map(([name, gate]) => {
    const count = gate.refused().length;
    return {
      phase: "gate-refused",
      objectRole: name,
      count,
      outcome: count === 0 ? "ok" : "failed",
    };
  });
}
