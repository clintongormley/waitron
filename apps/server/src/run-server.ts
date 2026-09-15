import { codeOf } from "@waitron/server-kit";
import { createLogger } from "./logger.js";
import { type Timer, unrefTimer } from "./unref-timer.js";
import "./errors.js";

export interface ShutdownDeps {
  on: (signal: NodeJS.Signals, handler: () => void) => void;
  write: (line: string, done: () => void) => void;
  exit: (code: number) => void;
  now: () => Date;
  /** Schedule the shutdown deadline; injected for tests, defaults to an unref'd setTimeout. */
  setTimer?: (ms: number, fn: () => void) => Timer;
}

/* v8 ignore start -- the real process bindings; every test supplies its own `deps` instead */
const DEFAULT_DEPS: ShutdownDeps = {
  on: (signal, handler) => void process.once(signal, handler),
  write: (line, done) => void process.stdout.write(line, done),
  exit: (code) => process.exit(code),
  now: () => new Date(),
  setTimer: unrefTimer,
};
/* v8 ignore stop */

/**
 * How long shutdown may take before the process is forced to exit anyway. A box's restart mechanism
 * is SIGTERM → shutdown → exit → Docker restarts it into trading mode, so a shutdown that never
 * finishes is a box that never comes back. Kept below Docker's default ~10s stop grace so the
 * deliberate exit wins the race against SIGKILL.
 */
export const SHUTDOWN_DEADLINE_MS = 8000;

/**
 * Stop the server once on the first SIGTERM/SIGINT, then exit — the routine `bin.ts` and
 * `node-entry.ts` share.
 *
 * The latch spans BOTH signal names, not just `once` per name: `once` alone still lets one SIGTERM
 * and one SIGINT start `close()` concurrently, and the loser's rejection races the winner for the
 * exit code an operator's supervisor actually reads.
 *
 * `exit` runs from the write's completion callback, never straight after it: on a pipe (Docker,
 * systemd) `process.stdout.write` is asynchronous and exiting immediately truncates the one line
 * explaining the failure. The deadline still exits if that write never completes. The log carries `codeOf`'s classification rather than the caught value —
 * a `pg` pool `end()` rejection can embed the connection string it was built from.
 *
 * A THIRD signal, of either name, is not caught by anything here: both `once` listeners have
 * already fired and removed themselves, so it falls through to Node's default action and kills the
 * process immediately, mid-shutdown, with the pool undrained. Accepted gap, not a covered case.
 */
export function installShutdownHandlers(
  server: { close(): Promise<void> },
  deps: ShutdownDeps = DEFAULT_DEPS,
): void {
  // Every path ends in exactly one exit, whichever of {clean close, failure-log write, deadline}
  // reaches it first; a timer's `cancel()` can arrive a tick too late, so the losers must be no-ops.
  let exited = false;
  const exitOnce = (code: number): void => {
    if (exited) return;
    exited = true;
    deps.exit(code);
  };
  let closeFailed = false;
  const logShutdownFailure = createLogger((line) => deps.write(line, () => exitOnce(1)), deps.now);
  // Fire-and-forget: a stalled stdout pipe must not be able to withhold the deadline's exit.
  const logShutdownTimeout = createLogger((line) => deps.write(line, () => {}), deps.now);
  let shuttingDown = false;
  const setTimer = deps.setTimer ?? unrefTimer;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    deps.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      // Left running after a rejection: it is the exit if the failure line's write never completes.
      const deadline = setTimer(SHUTDOWN_DEADLINE_MS, () => {
        if (exited) return;
        if (closeFailed) return exitOnce(1);
        logShutdownTimeout("warn", "server.shutdown_timeout", { deadlineMs: SHUTDOWN_DEADLINE_MS });
        exitOnce(0);
      });
      void server.close().then(
        () => {
          deadline.cancel();
          exitOnce(0);
        },
        (error: unknown) => {
          if (exited) return;
          closeFailed = true;
          logShutdownFailure("error", "server.shutdown_failed", { errorCode: codeOf(error) });
        },
      );
    });
  }
}
