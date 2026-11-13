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

let shutdownUnderWay = false;
let handlersInstalled = false;
let restartRequested = false;

/** What the shutdown handlers stop. */
export interface ShutdownTarget {
  close(): Promise<void>;
  /** Runs before `close` only when {@link restartProcess} asked for the shutdown, never for a
   *  signal from outside. A rejection is not logged here, and the close goes ahead anyway. */
  beforeRestart?: () => Promise<void>;
}

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
 * explaining the failure. The log carries `codeOf`'s classification rather than the caught value,
 * which could carry a secret.
 *
 * A repeat of a signal name already received is not caught: its `once` listener has removed itself,
 * so it takes Node's default action and kills the process mid-shutdown
 * (`run-server.signals.test.ts`). Accepted gap for a person's signals; {@link restartProcess} stops
 * sending its own.
 */
export function installShutdownHandlers(
  server: ShutdownTarget,
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
  const onSignal = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    shutdownUnderWay = true;
    // Left running after a rejection: it is the exit if the failure line's write never completes.
    const deadline = setTimer(SHUTDOWN_DEADLINE_MS, () => {
      if (exited) return;
      if (closeFailed) return exitOnce(1);
      logShutdownTimeout("warn", "server.shutdown_timeout", { deadlineMs: SHUTDOWN_DEADLINE_MS });
      exitOnce(0);
    });
    const closing =
      restartRequested && server.beforeRestart !== undefined
        ? server
            .beforeRestart()
            .catch(() => {})
            .then(() => server.close())
        : server.close();
    void closing.then(
      () => {
        if (exited) return;
        createLogger(
          (line) =>
            deps.write(line, () => {
              deadline.cancel();
              exitOnce(0);
            }),
          deps.now,
        )("info", "server.shutdown_complete");
      },
      (error: unknown) => {
        if (exited) return;
        closeFailed = true;
        logShutdownFailure("error", "server.shutdown_failed", { errorCode: codeOf(error) });
      },
    );
  };
  for (const signal of ["SIGTERM", "SIGINT"] as const) deps.on(signal, onSignal);
  const askedBeforeAnyHandler = restartRequested && !handlersInstalled;
  handlersInstalled = true;
  if (askedBeforeAnyHandler) onSignal();
}

/**
 * A second SIGTERM would interrupt the closers already draining. An ask made before
 * {@link installShutdownHandlers} has run is kept and acted on there: on the box Node is process 1,
 * which ignores a SIGTERM it has no handler for, so a signal sent then would be lost.
 */
export function restartProcess(): void {
  if (shutdownUnderWay) return;
  restartRequested = true;
  if (handlersInstalled) process.kill(process.pid, "SIGTERM");
}
