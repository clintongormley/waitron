import { subscribeToChanges } from "@waitron/db";
import type { ResourceChange } from "@waitron/shared";
import { codeOf } from "@waitron/server-kit";
import { JOB_CATALOGUE, type JobName } from "./job-catalogue.js";
import { createLoopWaker } from "./loop-wake.js";
import { realSleep, sleepMsFor } from "./loop.js";
import type { Logger } from "./logger.js";

export interface JobContext {
  readonly now: Date;
  readonly signal: AbortSignal;
}
export interface JobPassResult {
  nextDueAt: Date | null;
  degraded?: boolean;
  finished?: true;
}
export interface JobDefinition {
  readonly name: JobName;
  applies(): boolean;
  pass(ctx: JobContext): Promise<JobPassResult>;
  readonly wakeOn?: readonly string[];
  readonly minSleepMs: number;
  readonly maxSleepMs: number;
  readonly backoff: { readonly firstMs: number; readonly maxMs: number };
  readonly firstPassAfterMs?: number;
  readonly ownFailureAlert?: string;
  onStop?(): Promise<void>;
}
export type JobState = "waiting" | "running" | "not_applicable" | "stopped";
export interface JobView {
  kind: "job" | "service";
  state: JobState;
  judged: boolean;
  lastTurnAt: string | null;
  lastRunAt: string | null;
  lastOkAt: string | null;
  consecutiveFailures: number;
  failingSince: string | null;
  throwsSinceClean: number;
  throwingSince: string | null;
  lastErrorCode: string | null;
  nextDueAt: string | null;
  ownFailureAlert: string | null;
}
export type PublicJobView = Omit<JobView, "lastErrorCode" | "ownFailureAlert">;
export interface JobRunner {
  add(job: JobDefinition): void;
  wake(name: JobName): void;
  roleChanged(): void;
  signalStepdown(): void;
  stopJobs(): Promise<void>;
  views(): Readonly<Record<string, JobView>>;
}
export const LONGEST_TIMER_MS = 2_147_483_647;

export function createJobRunner(deps: {
  now: () => Date;
  log: Logger;
  delay?: (ms: number, signal: AbortSignal) => Promise<void>;
  monotonicMs?: () => number;
  subscribe?: (fn: (change: ResourceChange) => void) => () => void;
}): JobRunner {
  const delay = deps.delay ?? realSleep;
  const jobs = new Map<
    JobName,
    {
      definition: JobDefinition;
      controller: AbortController;
      role: AbortController;
      waker: ReturnType<typeof createLoopWaker>;
      view: JobView;
      loop: Promise<void>;
    }
  >();
  let stopping: Promise<void> | undefined;
  let steppedDown = false;
  const unsubscribe = (deps.subscribe ?? subscribeToChanges)((change) => {
    for (const [name, job] of jobs) {
      if (!change.resources.some((resource) => job.definition.wakeOn?.includes(resource.type)))
        continue;
      queueMicrotask(() => {
        try {
          job.waker.wake();
        } catch (error) {
          deps.log("error", "job.wake_failed", { job: name, errorCode: codeOf(error) });
        }
      });
    }
  });

  async function run(job: typeof jobs extends Map<JobName, infer T> ? T : never): Promise<void> {
    const { definition: def, controller, waker, view } = job;
    let throws = 0;
    async function sleep(ms: number, wakeable: boolean): Promise<void> {
      const role = job.role;
      const signal = AbortSignal.any([controller.signal, role.signal]);
      try {
        if (ms === 0 && wakeable) await waker.sleep(0, signal);
        while (ms > 0 && !signal.aborted) {
          const piece = Math.min(ms, LONGEST_TIMER_MS);
          if (wakeable) {
            // A wake must end the entire sleep, including all remaining timer pieces.
            const clock = deps.monotonicMs ?? (() => performance.now());
            const before = clock();
            await waker.sleep(piece, signal);
            if (clock() - before < piece) break;
          } else await delay(piece, signal);
          ms -= piece;
        }
      } finally {
        if (role.signal.aborted) job.role = new AbortController();
      }
    }
    try {
      if (def.firstPassAfterMs) await sleep(def.firstPassAfterMs, true);
      while (!controller.signal.aborted) {
        const now = deps.now();
        const at = now.toISOString();
        view.lastTurnAt = at;
        let wait = def.maxSleepMs;
        let wakeable = true;
        try {
          if (!def.applies()) view.state = "not_applicable";
          else {
            view.state = "running";
            const result = await def.pass({ now, signal: controller.signal });
            view.lastRunAt = at;
            throws = 0;
            view.nextDueAt = result.nextDueAt?.toISOString() ?? null;
            if (result.degraded) {
              view.consecutiveFailures++;
              view.failingSince ??= at;
            } else {
              view.lastOkAt = at;
              view.consecutiveFailures = 0;
              view.failingSince = null;
              view.lastErrorCode = null;
              view.throwsSinceClean = 0;
              view.throwingSince = null;
            }
            if (result.finished) break;
            view.state = "waiting";
            wait = sleepMsFor(result.nextDueAt, deps.now(), def.minSleepMs, def.maxSleepMs);
          }
        } catch (error) {
          view.consecutiveFailures++;
          view.failingSince ??= at;
          view.throwsSinceClean++;
          view.throwingSince ??= at;
          view.lastErrorCode = codeOf(error);
          view.state = "waiting";
          deps.log("error", "job.failed", {
            job: def.name,
            errorCode: view.lastErrorCode,
            consecutiveFailures: view.consecutiveFailures,
          });
          throws++;
          wait = Math.min(def.backoff.maxMs, def.backoff.firstMs * 2 ** (throws - 1));
          wakeable = false;
        }
        if (!controller.signal.aborted) await sleep(wait, wakeable);
      }
    } finally {
      view.state = "stopped";
      await def.onStop?.();
    }
  }

  return {
    add(definition) {
      if (stopping) throw Error("The job runner has stopped");
      if (jobs.has(definition.name)) throw Error("The job is already registered");
      const entry = JOB_CATALOGUE[definition.name];
      if (entry.kind !== "job") throw Error("Services cannot be registered as jobs");
      const controller = new AbortController();
      if (steppedDown && "stop" in entry.stepdown) controller.abort();
      const job = {
        definition,
        controller,
        role: new AbortController(),
        waker: createLoopWaker({
          minTickMs: definition.minSleepMs,
          delay,
          monotonicMs: deps.monotonicMs,
        }),
        view: {
          kind: entry.kind,
          state: "waiting",
          judged: "failsHealth" in entry,
          lastTurnAt: null,
          lastRunAt: null,
          lastOkAt: null,
          consecutiveFailures: 0,
          failingSince: null,
          throwsSinceClean: 0,
          throwingSince: null,
          lastErrorCode: null,
          nextDueAt: null,
          ownFailureAlert: definition.ownFailureAlert ?? null,
        } as JobView,
        loop: Promise.resolve(),
      };
      jobs.set(definition.name, job);
      job.loop = run(job);
      // Stepdown may end a loop before close awaits its failure.
      void job.loop.catch(() => {});
    },
    wake(name) {
      jobs.get(name)?.waker.wake();
    },
    roleChanged() {
      for (const job of jobs.values()) job.role.abort();
    },
    signalStepdown() {
      steppedDown = true;
      for (const [name, job] of jobs)
        if ("stop" in JOB_CATALOGUE[name].stepdown) job.controller.abort();
    },
    stopJobs() {
      if (!stopping) {
        unsubscribe();
        for (const job of jobs.values()) job.controller.abort();
        stopping = Promise.all([...jobs.values()].map((job) => job.loop)).then(() => {});
      }
      return stopping;
    },
    views() {
      return Object.fromEntries([...jobs].map(([name, job]) => [name, { ...job.view }]));
    },
  };
}
