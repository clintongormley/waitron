import { startServer } from "./boot.js";
import { codeOf } from "./error-code.js";
import { createLogger } from "./logger.js";
import "./errors.js";

const server = await startServer(process.env);

/**
 * The shutdown path's own logger, built here rather than handed out by `startServer`: it is needed
 * only if `close()` rejects, and it must own its sink's write completion (below) in a way the
 * host's general-purpose logger does not.
 *
 * Structured, and carrying `codeOf`'s classification rather than the caught value — same rule
 * `pass.ts` and `loop.ts` apply to every value they catch, for the same reason. The likeliest
 * rejection here comes from `db.close()`, a `pg` pool `end()`, whose driver messages can embed the
 * connection string the pool was built from; `String(error)` on this path used to put exactly that
 * on stderr.
 *
 * `process.exit` is called from the write's completion callback, never straight after it: on a pipe
 * (Docker, systemd) `process.stdout.write` is asynchronous, and exiting immediately can truncate or
 * drop the one line explaining why the shutdown failed. `boot.ts`'s bind-failure path is built the
 * same way for the same reason.
 */
const logShutdownFailure = createLogger(
  (line) => process.stdout.write(line, () => process.exit(1)),
  () => new Date(),
);

// A shared latch across BOTH signals, not just `once` per signal name: `once` alone stops a
// repeated SIGTERM from starting a second shutdown, but SIGTERM and SIGINT are two DIFFERENT
// signal names, so a `once`-only guard still lets one of each start `server.close()` concurrently.
// `close()`'s second, losing call rejects (its own `server.close()` finds the listener already
// gone) after the WINNING call already tore everything down — no leak, but the loser's rejection
// would print a spurious "Server is not running" and race the winner's `process.exit(0)` for the
// final exit code, which is the one thing an operator's supervisor actually reads. The latch makes
// the second signal a no-op instead, same as `once` already makes a repeated identical signal.
//
// A THIRD signal, of either kind, is deliberately not caught by anything here: both `once`
// listeners have already fired and removed themselves, so it falls through to Node's default
// action and kills the process immediately — mid-shutdown, pool undrained. That is arguably the
// right escalation for an operator who sends a third Ctrl-C because the first two appeared to do
// nothing, but it is a real gap, not a covered case, and is recorded here rather than left
// implicit.
let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  // once: a second SIGTERM while the first shutdown is in flight must not start a second one.
  process.once(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    void server.close().then(
      () => process.exit(0),
      (error: unknown) => {
        logShutdownFailure("error", "server.shutdown_failed", { errorCode: codeOf(error) });
      },
    );
  });
}
