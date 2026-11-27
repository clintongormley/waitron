import type { MiddlewareHandler } from "hono";
import { codeOf } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { SAFE_METHODS } from "./read-only-gate.js";
import "./errors.js";

export const SHUTDOWN_PATH = "/api/box/shutdown";

export type ShutdownStatus =
  | { phase: "idle" | "checking" }
  | { phase: "ready"; checked?: false }
  | { phase: "paused"; errorCode: string }
  | { phase: "download"; name: string; bytes: number; delivered: boolean; errorCode?: string };

export type ShutdownArchive = {
  name: string;
  path: string;
  bytes: number;
  remove(): Promise<void>;
};

type ShutdownCheck = {
  archive?: ShutdownArchive;
  checkSpare?: (signal: AbortSignal) => Promise<void>;
};

export type ShutdownDecision = "retry" | "shut-down-anyway";

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
  check(signal: AbortSignal): Promise<void | ShutdownCheck>;
  save(): Promise<void>;
  clear(): Promise<void>;
  pauseDuties?(): { settled: Promise<void>; drainRefunds(): Promise<unknown>; resume(): void };
}) {
  const writers = new Set<Promise<void>>();
  type Attempt = {
    state: ShutdownStatus;
    controller: AbortController;
    settled: Promise<void>;
    duties?: ReturnType<NonNullable<typeof deps.pauseDuties>>;
    drained: boolean;
    checked: boolean;
    checkSpare?: ShutdownCheck["checkSpare"];
    spareCheckPending?: boolean;
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

  function run(current: Attempt, action: "check" | "confirm" | "unchecked"): void {
    current.state = { phase: "checking" };
    const { signal } = current.controller;
    current.settled = (async () => {
      try {
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
        if (action === "check" && !current.spareCheckPending) {
          current.checked = false;
          const result = await deps.check(signal);
          current.archive = result?.archive;
          current.checkSpare = result?.checkSpare;
          current.checked = true;
          if (current.archive !== undefined) {
            current.state = downloadState(current.archive, false);
            return;
          }
        }
        signal.throwIfAborted();
        if (action !== "unchecked" && current.checkSpare !== undefined) {
          current.spareCheckPending = true;
          await current.checkSpare(signal);
          current.spareCheckPending = false;
        }
        signal.throwIfAborted();
        current.saving = true;
        current.markMayExist = true;
        await deps.save();
        await current.archive?.remove();
        current.archive = undefined;
        current.state =
          current.checked && !current.spareCheckPending
            ? { phase: "ready" }
            : { phase: "ready", checked: false };
      } catch (error) {
        const errorCode = codeOf(error);
        current.state =
          current.archive && !current.spareCheckPending
            ? downloadState(current.archive, current.delivered, errorCode)
            : { phase: "paused", errorCode };
      } finally {
        current.saving = false;
      }
    })();
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
    checksSpare: () => attempt?.checkSpare !== undefined,
    start(): void {
      if (attempt !== undefined || closing) throw new AppError("box.shutdown_in_progress", {});
      const current: Attempt = {
        state: { phase: "checking" },
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
      if (closing || current?.state.phase !== "paused" || current.cancelling !== undefined)
        throw new AppError("box.shutdown_in_progress", {});
      run(current, decision === "retry" ? "check" : "unchecked");
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
    async close(): Promise<void> {
      closing = true;
      attempt?.controller.abort();
      await attempt?.settled;
      await attempt?.cancelling;
      await attempt?.transfer?.settled;
      await attempt?.archive?.remove();
    },
  };
}

export type AdminShutdown = ReturnType<typeof createAdminShutdown>;
