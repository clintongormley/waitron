import type { MiddlewareHandler } from "hono";
import { codeOf } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { SAFE_METHODS } from "./read-only-gate.js";
import "./errors.js";

export const SHUTDOWN_PATH = "/api/box/shutdown";

export type ShutdownStatus =
  { phase: "idle" | "checking" | "ready" } | { phase: "paused"; errorCode: string };

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
  check(signal: AbortSignal): Promise<void>;
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
    saving: boolean;
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

  return {
    middleware,
    status: (): ShutdownStatus => attempt?.state ?? { phase: "idle" },
    start(): void {
      if (attempt !== undefined || closing) throw new AppError("box.shutdown_in_progress", {});
      const current: Attempt = {
        state: { phase: "checking" },
        controller: new AbortController(),
        settled: Promise.resolve(),
        saving: false,
      };
      attempt = current;
      const { signal } = current.controller;
      current.settled = (async () => {
        try {
          await waitForShutdownDrain(Promise.all(writers), signal);
          signal.throwIfAborted();
          current.duties = deps.pauseDuties?.();
          if (current.duties !== undefined) {
            await waitForShutdownDrain(current.duties.settled, signal);
            signal.throwIfAborted();
            await current.duties.drainRefunds();
          }
          signal.throwIfAborted();
          await deps.check(signal);
          signal.throwIfAborted();
          current.saving = true;
          await deps.save();
          current.state = { phase: "ready" };
        } catch (error) {
          current.state = { phase: "paused", errorCode: codeOf(error) };
        }
      })();
    },
    async cancel(): Promise<void> {
      const current = attempt;
      if (current === undefined) return;
      if (current.cancelling !== undefined) return current.cancelling;
      if (current.saving && current.state.phase !== "paused")
        throw new AppError("box.shutdown_in_progress", {});
      current.controller.abort();
      current.cancelling = (async () => {
        await current.settled;
        if (closing) return;
        if (current.saving) await deps.clear();
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
    },
  };
}

export type AdminShutdown = ReturnType<typeof createAdminShutdown>;
