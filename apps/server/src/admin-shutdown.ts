import type { MiddlewareHandler } from "hono";
import { codeOf } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import type { BoxHostClient, PersonActor } from "./box-host-client.js";
import { SAFE_METHODS } from "./read-only-gate.js";
import "./errors.js";

export const SHUTDOWN_PATH = "/api/box/shutdown";

export type ShutdownMode = { paired?: true; downloadOnly?: true; directBucket?: true };

export type ShutdownStatus =
  | { phase: "idle" | "checking" | "stalled" }
  | { phase: "ready"; checked?: false; powerOff?: "requesting" | "requested" | "unconfirmed" }
  | { phase: "paused"; errorCode: string }
  | { phase: "download"; name: string; bytes: number; delivered: boolean; errorCode?: string };

export type ShutdownView = ShutdownStatus & ShutdownMode & { failedDestination?: string };

export type ShutdownArchive = {
  name: string;
  path: string;
  bytes: number;
  remove(): Promise<void>;
};

type ShutdownCheck = {
  archive?: ShutdownArchive;
  checkReplica?: (signal: AbortSignal) => Promise<void>;
};

export type ShutdownDecision = "retry" | "keep-waiting" | "shut-down-anyway";

type ShutdownRun = {
  controller: AbortController;
  waiting?: { promise: Promise<void>; resume(): void; uploads: number };
};

export async function waitForShutdownDrain(
  drain: Promise<unknown> | undefined,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  if (drain === undefined) return;
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    await Promise.race([drain, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export function createAdminShutdown(deps: {
  check(
    signal: AbortSignal,
    context: {
      attemptSignal: AbortSignal;
      waitForUpload(uploadSignal: AbortSignal): Promise<void>;
      reportFailedDestination(location: string): void;
    },
  ): Promise<void | ShutdownCheck>;
  save(): Promise<void>;
  clear(): Promise<void>;
  powerOff?: BoxHostClient["powerOff"];
  pauseDuties?(): { settled: Promise<void>; drainRefunds(): Promise<unknown>; resume(): void };
}) {
  const writers = new Set<Promise<void>>();
  type Attempt = {
    state: ShutdownStatus;
    failedDestination?: string;
    mode: ShutdownMode;
    actor?: PersonActor;
    controller: AbortController;
    settled: Promise<void>;
    run?: ShutdownRun;
    duties?: ReturnType<NonNullable<typeof deps.pauseDuties>>;
    drained: boolean;
    checked: boolean;
    checkReplica?: ShutdownCheck["checkReplica"];
    replicaCheckPending?: boolean;
    saving: boolean;
    markMayExist: boolean;
    archive?: ShutdownArchive;
    delivered: boolean;
    transfer?: { abort: () => void; settled: Promise<void> };
    cancelling?: Promise<void>;
  };
  let attempt: Attempt | undefined;
  let closing = false;

  const middleware: MiddlewareHandler = async (c, next) => {
    if (SAFE_METHODS.has(c.req.method) || c.req.path === SHUTDOWN_PATH) return next();
    if (attempt !== undefined) {
      if (c.req.method === "POST" && c.req.path === "/management-api/session") return next();
      const error = new AppError("box.shutdown_in_progress", {});
      c.set("refusalCode", error.code);
      return c.json({ error: { code: error.code, params: error.params } }, 503);
    }
    let done!: () => void;
    const finished = new Promise<void>((resolve) => (done = resolve));
    writers.add(finished);
    try {
      await next();
    } finally {
      writers.delete(finished);
      done();
    }
  };

  function downloadState(
    archive: ShutdownArchive,
    delivered: boolean,
    errorCode?: string,
  ): ShutdownStatus {
    return { phase: "download", name: archive.name, bytes: archive.bytes, delivered, errorCode };
  }

  async function requestPowerOff(
    current: Attempt,
    ready: Extract<ShutdownStatus, { phase: "ready" }>,
  ) {
    if (closing || current.actor === undefined || deps.powerOff === undefined) return;
    current.state = { ...ready, powerOff: "requesting" };
    try {
      const answer = await deps.powerOff(current.actor);
      if (answer.available) {
        current.state = { ...ready, powerOff: "requested" };
        return;
      }
      const manual =
        (answer.reason === "missing" && answer.detail === "ENOENT") ||
        (answer.reason === "refused" && answer.refusal === "unknown_request");
      current.state = manual ? ready : { ...ready, powerOff: "unconfirmed" };
    } catch {
      current.state = { ...ready, powerOff: "unconfirmed" };
    }
  }

  function run(
    current: Attempt,
    action: "check" | "confirm" | "unchecked",
    after?: Promise<void>,
  ): void {
    current.state = { phase: "checking" };
    const active: ShutdownRun = { controller: new AbortController() };
    current.run = active;
    const attemptSignal = current.controller.signal;
    const signal = AbortSignal.any([attemptSignal, active.controller.signal]);
    let failedDestination: string | undefined;
    async function waitForUpload(uploadSignal: AbortSignal): Promise<void> {
      const waitingSignal = AbortSignal.any([signal, uploadSignal]);
      waitingSignal.throwIfAborted();
      if (active.waiting === undefined) {
        let resume!: () => void;
        const promise = new Promise<void>((resolve) => (resume = resolve));
        active.waiting = { promise, resume, uploads: 0 };
      }
      const waiting = active.waiting;
      waiting.uploads += 1;
      current.state = { phase: "stalled" };
      try {
        await waitForShutdownDrain(waiting.promise, waitingSignal);
      } finally {
        waiting.uploads -= 1;
        if (waiting.uploads === 0 && active.waiting === waiting && current.run === active) {
          active.waiting = undefined;
          current.state = { phase: "checking" };
        }
      }
    }
    current.settled = (async () => {
      try {
        if (after !== undefined) await after;
        if (!current.drained) {
          await waitForShutdownDrain(Promise.all(writers), signal);
          current.duties ??= deps.pauseDuties?.();
          if (current.duties !== undefined) {
            await waitForShutdownDrain(current.duties.settled, signal);
            signal.throwIfAborted();
            await current.duties.drainRefunds();
          }
          current.drained = true;
        }
        signal.throwIfAborted();
        if (action === "check" && !current.replicaCheckPending) {
          current.checked = false;
          const result = await deps.check(signal, {
            attemptSignal,
            waitForUpload,
            reportFailedDestination: (location) => (failedDestination = location),
          });
          current.archive = result?.archive;
          current.checkReplica = result?.checkReplica;
          current.checked = true;
          if (current.archive !== undefined) {
            current.state = downloadState(current.archive, false);
            return;
          }
        }
        signal.throwIfAborted();
        if (action !== "unchecked" && current.checkReplica !== undefined) {
          current.replicaCheckPending = true;
          await current.checkReplica(signal);
          current.replicaCheckPending = false;
          current.checkReplica = undefined;
        }
        signal.throwIfAborted();
        current.saving = true;
        current.markMayExist = true;
        await deps.save();
        await current.archive?.remove();
        current.archive = undefined;
        current.state =
          current.checked && !current.replicaCheckPending
            ? { phase: "ready" }
            : { phase: "ready", checked: false };
        // The host can signal the server to stop before it replies.
        void requestPowerOff(current, current.state);
      } catch (error) {
        if (current.run !== active) return;
        const errorCode = codeOf(error);
        current.failedDestination = failedDestination;
        current.state =
          current.archive && !current.replicaCheckPending
            ? downloadState(current.archive, current.delivered, errorCode)
            : { phase: "paused", errorCode };
      } finally {
        active.controller.abort();
        if (current.run === active) {
          current.run = undefined;
          current.saving = false;
        }
      }
    })();
  }

  function beginClose(): void {
    closing = true;
  }

  function pendingDownload(name: string) {
    const current = attempt;
    const archive = current?.archive;
    if (
      closing ||
      current?.state.phase !== "download" ||
      archive?.name !== name ||
      current.controller.signal.aborted
    )
      throw new AppError("box.shutdown_in_progress", {});
    return { current, archive };
  }

  return {
    middleware,
    status: (): ShutdownStatus => attempt?.state ?? { phase: "idle" },
    view: (): ShutdownView =>
      attempt === undefined
        ? { phase: "idle" }
        : {
            ...attempt.state,
            ...attempt.mode,
            ...(attempt.state.phase === "paused" && attempt.failedDestination !== undefined
              ? { failedDestination: attempt.failedDestination }
              : undefined),
          },
    start(actor?: PersonActor, mode: ShutdownMode = {}): void {
      if (attempt !== undefined || closing) throw new AppError("box.shutdown_in_progress", {});
      const current: Attempt = {
        state: { phase: "checking" },
        mode,
        actor,
        controller: new AbortController(),
        settled: Promise.resolve(),
        drained: false,
        checked: false,
        saving: false,
        markMayExist: false,
        delivered: false,
      };
      attempt = current;
      run(current, "check");
    },
    resolvePaused(decision: ShutdownDecision): void {
      const current = attempt;
      if (closing || current === undefined || current.cancelling !== undefined)
        throw new AppError("box.shutdown_in_progress", {});
      const phase = current.state.phase;
      if (phase === "paused" && decision === "retry") return run(current, "check");
      if (phase === "paused" && decision === "shut-down-anyway") return run(current, "unchecked");
      const active = current.run;
      if (phase === "stalled" && active?.waiting !== undefined) {
        if (decision === "keep-waiting") {
          current.state = { phase: "checking" };
          active.waiting.resume();
          active.waiting = undefined;
          return;
        }
        if (decision === "shut-down-anyway") {
          active.controller.abort();
          return run(current, "unchecked", current.settled);
        }
      }
      throw new AppError("box.shutdown_in_progress", {});
    },
    async beginDownload(name: string) {
      const { current, archive } = pendingDownload(name);
      const previous = current.transfer;
      if (previous !== undefined) {
        previous.abort();
        await previous.settled;
        if (pendingDownload(name).current !== current || current.transfer !== undefined)
          throw new AppError("box.shutdown_in_progress", {});
      }
      const controller = new AbortController();
      const signal = AbortSignal.any([current.controller.signal, controller.signal]);
      let settle!: () => void;
      const settled = new Promise<void>((resolve) => (settle = resolve));
      const transfer = { abort: () => controller.abort(), settled };
      current.transfer = transfer;
      return {
        name: archive.name,
        path: archive.path,
        bytes: archive.bytes,
        signal,
        finish(complete: boolean) {
          if (current.transfer !== transfer) return;
          current.transfer = undefined;
          if (complete && !signal.aborted) {
            current.delivered = true;
            current.state = downloadState(archive, true);
          }
          settle();
        },
      };
    },
    confirmDownload(name: string): void {
      const { current } = pendingDownload(name);
      if (!current.delivered || current.transfer !== undefined)
        throw new AppError("box.shutdown_in_progress", {});
      run(current, "confirm");
    },
    async cancel(): Promise<void> {
      const current = attempt;
      if (current === undefined) return;
      if (current.cancelling !== undefined) return current.cancelling;
      if (current.saving || current.state.phase === "ready")
        throw new AppError("box.shutdown_in_progress", {});
      current.controller.abort();
      current.cancelling = (async () => {
        await current.settled;
        await current.transfer?.settled;
        if (closing) return;
        await current.archive?.remove();
        current.archive = undefined;
        if (current.markMayExist) await deps.clear();
        if (closing) return;
        current.duties?.resume();
        attempt = undefined;
      })().finally(() => {
        current.cancelling = undefined;
      });
      return current.cancelling;
    },
    beginClose,
    async close(): Promise<void> {
      beginClose();
      attempt?.controller.abort();
      await attempt?.settled;
      await attempt?.cancelling;
      await attempt?.transfer?.settled;
      await attempt?.archive?.remove();
    },
  };
}

export type AdminShutdown = ReturnType<typeof createAdminShutdown>;
