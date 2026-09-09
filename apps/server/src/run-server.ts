import { codeOf } from "@waitron/server-kit";
import { createLogger } from "./logger.js";
import "./errors.js";

export interface ShutdownDeps {
  on: (signal: NodeJS.Signals, handler: () => void) => void;
  write: (line: string, done: () => void) => void;
  exit: (code: number) => void;
  now: () => Date;
}

/* v8 ignore start -- the real process bindings; every test supplies its own `deps` instead */
const DEFAULT_DEPS: ShutdownDeps = {
  on: (signal, handler) => void process.once(signal, handler),
  write: (line, done) => void process.stdout.write(line, done),
  exit: (code) => process.exit(code),
  now: () => new Date(),
};
/* v8 ignore stop */

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
  let shuttingDown = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    deps.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      void server.close().then(
        () => deps.exit(0),
        (error: unknown) => {
          logShutdownFailure("error", "server.shutdown_failed", { errorCode: codeOf(error) });
        },
      );
    });
  }
}
