import { subscribeToChanges } from "@waitron/db";
import type { ResourceChange } from "@waitron/shared";
import { codeOf } from "@waitron/server-kit";
import { JOB_CATALOGUE, type JobName } from "./job-catalogue.js";
import { closeAll } from "./close-all.js";
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
export interface ServiceDefinition {
  readonly name: JobName;
  applies(): boolean;
  start(): Promise<void>;
  suspend(): Promise<void>;
  stop(): Promise<void>;
  describe(): { running: boolean; reason: string | null };
}
export const SERVICE_STOP_ORDER: readonly JobName[] = ["stream"];

export type JobState = "waiting" | "running" | "not_applicable" | "stopped";
export interface JobView {
  kind: "job" | "service";
  detail: string | null;
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
  addService(service: ServiceDefinition): Promise<void>;
  stopServices(): Promise<void>;
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
  serviceCheckMs?: number;
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
  function makeView(
    kind: JobView["kind"],
    judged: boolean,
    ownFailureAlert: string | null = null,
  ): JobView {
    return {
      kind,
      state: "waiting",
      detail: null,
      judged: judged,
      lastTurnAt: null,
      lastRunAt: null,
      lastOkAt: null,
      consecutiveFailures: 0,
      failingSince: null,
      throwsSinceClean: 0,
      throwingSince: null,
      lastErrorCode: null,
      nextDueAt: null,
      ownFailureAlert: ownFailureAlert,
    } as JobView;
  }
  const services = new Map<
    JobName,
    {
      definition: ServiceDefinition;
      active: boolean;
      pending: Promise<void>;
      view: JobView;
    }
  >();
  type Service = typeof services extends Map<JobName, infer T> ? T : never;
  const serviceController = new AbortController();
  let servicesStopping: Promise<void> | undefined;
  let serviceLoop: Promise<void> | undefined;

  function checkService(service: Service): Promise<void> {
    service.pending = service.pending.then(async () => {
      if (servicesStopping) return;
      const { definition: def, view } = service;
      const at = deps.now().toISOString();
      view.lastTurnAt = at;
      try {
        if (def.applies()) {
          if (!service.active && !steppedDown) {
            await def.start();
            service.active = true;
          }
        } else if (service.active) {
          await def.suspend();
          service.active = false;
        }
        view.consecutiveFailures = 0;
        view.failingSince = null;
        view.lastErrorCode = null;
        view.lastOkAt = at;
      } catch (error) {
        view.consecutiveFailures++;
        view.failingSince ??= at;
        view.throwsSinceClean++;
        view.throwingSince ??= at;
        view.lastErrorCode = codeOf(error);
        deps.log("error", "job.failed", { job: def.name, errorCode: view.lastErrorCode });
      }
    });
    return service.pending;
  }
  async function recheckServices(): Promise<void> {
    while (!serviceController.signal.aborted) {
      await delay(deps.serviceCheckMs ?? 60_000, serviceController.signal);
      if (!serviceController.signal.aborted)
        await Promise.all([...services.values()].map(checkService));
    }
  }
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
    async addService(definition) {
      if (stopping || servicesStopping) throw Error("The job runner has stopped");
      if (jobs.has(definition.name) || services.has(definition.name))
        throw Error("The service is already registered");
      if (
        JOB_CATALOGUE[definition.name].kind !== "service" ||
        !SERVICE_STOP_ORDER.includes(definition.name)
      )
        throw Error("The service has no stop order");
      const service = {
        definition,
        active: false,
        pending: Promise.resolve(),
        view: makeView("service", false),
      };
      services.set(definition.name, service);
      serviceLoop ??= recheckServices();
      await checkService(service);
    },
    stopServices() {
      if (!servicesStopping) {
        serviceController.abort();
        servicesStopping = (async () => {
          await serviceLoop;
          await closeAll(
            SERVICE_STOP_ORDER.filter((name) => services.has(name)).map((name) => async () => {
              const service = services.get(name)!;
              await service.pending;
              try {
                await service.definition.stop();
              } finally {
                service.view.state = "stopped";
              }
            }),
          );
        })();
      }
      return servicesStopping;
    },
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
        view: makeView(entry.kind, "failsHealth" in entry, definition.ownFailureAlert ?? null),
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
      for (const service of services.values()) void checkService(service);
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
        stopping = closeAll([...jobs.values()].map((job) => () => job.loop));
      }
      return stopping;
    },
    views() {
      return Object.fromEntries([
        ...[...jobs].map(([name, job]) => [name, { ...job.view }]),
        ...[...services].map(([name, service]) => {
          const described = service.definition.describe();
          return [
            name,
            {
              ...service.view,
              state:
                service.view.state === "stopped"
                  ? "stopped"
                  : !service.active
                    ? "not_applicable"
                    : described.running
                      ? "running"
                      : "waiting",
              detail: described.reason,
            },
          ];
        }),
      ]);
    },
  };
}
