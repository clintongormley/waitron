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
 * explaining the failure. The log carries `codeOf`'s classification rather than the caught value —
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
  const logShutdownFailure = createLogger((line) => deps.write(line, () => deps.exit(1)), deps.now);
  // The deadline's log is fire-and-forget (no exit in its write callback): the whole point of the
  // deadline is a guaranteed exit, so a stalled stdout pipe must not be able to withhold it. The
  // exit is called directly below instead.
  const logShutdownTimeout = createLogger((line) => deps.write(line, () => {}), deps.now);
  let shuttingDown = false;
  // `deadline.cancel()` can arrive a tick too late for an already-fired timer, so the deadline and a
  // resolving/rejecting close() can both run. This latch makes the FIRST of {clean, reject, deadline}
  // own the exit and the losers no-ops. (`shuttingDown` above already prevents a second close().)
  let finished = false;
  const finish = (act: () => void): void => {
    if (finished) return;
    finished = true;
    act();
  };
  const setTimer = deps.setTimer ?? unrefTimer;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    deps.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      const deadline = setTimer(SHUTDOWN_DEADLINE_MS, () =>
        finish(() => {
          logShutdownTimeout("warn", "server.shutdown_timeout", {
            deadlineMs: SHUTDOWN_DEADLINE_MS,
          });
          deps.exit(0);
        }),
      );
      void server.close().then(
        () => {
          deadline.cancel();
          finish(() => deps.exit(0));
        },
        (error: unknown) => {
          deadline.cancel();
          finish(() =>
            logShutdownFailure("error", "server.shutdown_failed", { errorCode: codeOf(error) }),
          );
        },
      );
    });
  }
}
