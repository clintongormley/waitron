import { execFileSync } from "node:child_process";

// Reap STALE waitron Testcontainers resources.
//
// Why this exists: this repo runs its real-Postgres suites with `TESTCONTAINERS_RYUK_DISABLED=true`
// (mandatory locally — Ryuk hangs on this machine, CLAUDE.md §4), which disables Testcontainers' own
// reaper. A CLEAN vitest exit still self-reaps — `startSharedContainer`'s `globalTeardown` calls
// `container.stop()`, removing the container and its anonymous volume. But an INTERRUPTED run (Ctrl-C,
// a timeout SIGTERM, a crash) skips `globalTeardown` and leaves a running container + its volume behind,
// un-reaped. Over many interrupted runs these accumulate and bloat the Docker daemon, which slows
// container ops and adds host-side overhead — enough ambient load to tip the parallel `pnpm -r
// test:coverage` over its PGlite `beforeAll` timeout and the `freePort`→bind race (EADDRINUSE). This
// script is the compensating reaper (the pre-push hook's start, or the manual `pnpm reap`).
//
// SAFETY — two guards, because a running orphan and a running IN-USE container look identical:
//  1. LABEL. It removes only containers carrying `com.waitron.reapable` (stamped by
//     `startPostgresContainer`, packages/db), never the generic `org.testcontainers` label that every
//     testcontainers container in every project shares. So another repo's containers — and this repo's
//     compose dev DB, which is not a testcontainer at all — are out of scope.
//  2. AGE. Of those, it removes only ones older than STALE_CONTAINER_MS. A container younger than that
//     may belong to a watch-mode vitest running RIGHT NOW in another terminal (its container lives for
//     the whole process, which is necessarily younger than the threshold when freshly started), so it
//     survives. The residual edge — a single watch session running longer than the threshold on one
//     container — is accepted (it reaps a live container the dev then restarts), the price of having no
//     way to distinguish that from a genuine orphan of the same age.
// `rm -v` takes each removed container's anonymous data volume with it, so no blanket `volume prune`
// (which would reach other projects' dangling volumes) is needed. It never removes images.

/** A container older than this (ms) is treated as a stale orphan; younger ones are spared. 2 hours. */
export const STALE_CONTAINER_MS = 2 * 60 * 60 * 1000;

/**
 * Reap stale waitron Testcontainers containers and their anonymous volumes. A pure data-in/data-out
 * function over an injected `exec` (and clock), so it is testable without a real Docker daemon; the CLI
 * block below wires in the real `docker` and formats the one-line report from the returned result.
 *
 * @param {{ exec: (args: string[]) => string, now?: () => number }} deps
 *   `exec(args)` runs `docker <args>` and returns stdout (throwing on a non-zero exit / absent daemon).
 *   `now()` returns the current epoch-ms (defaults to the real clock); injected in tests for determinism.
 * @returns {{ dockerAvailable: boolean, containersRemoved: number }}
 */
export function reap({ exec, now = () => Date.now() }) {
  let ids;
  try {
    ids = exec(["ps", "-aq", "--filter", "label=com.waitron.reapable"])
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    // Docker not running / not installed: a best-effort reaper must not fail its caller (the push).
    return { dockerAvailable: false, containersRemoved: 0 };
  }

  // `docker inspect` with no ids is an error, so short-circuit when nothing carries the label.
  if (ids.length === 0) {
    return { dockerAvailable: true, containersRemoved: 0 };
  }

  // Age-check the candidates: keep only ones older than STALE_CONTAINER_MS. `docker inspect` reports
  // each container's ISO-8601 `.Created` (which has no embedded space, so a plain split is safe).
  let stale;
  try {
    const cutoff = now() - STALE_CONTAINER_MS;
    stale = exec(["inspect", "--format", "{{.Id}} {{.Created}}", ...ids])
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => line.split(" "))
      .filter(([, created]) => Date.parse(created) < cutoff) // NaN (unparseable) is never < cutoff → spared
      .map(([id]) => id);
  } catch {
    // Could not age-check (daemon hiccup, a container vanished mid-inspect): reap nothing rather than
    // risk removing a container that might be in use.
    return { dockerAvailable: true, containersRemoved: 0 };
  }

  // Guarded like the calls above (a container can vanish between `inspect` and `rm`, or `rm` can hit a
  // permission error) so the reaper stays best-effort and never throws — `containersRemoved` counts only
  // a `rm` that actually succeeded.
  let removed = 0;
  if (stale.length > 0) {
    try {
      exec(["rm", "-f", "-v", ...stale]); // -f: even if running; -v: their anonymous data volumes
      removed = stale.length;
    } catch {
      /* best-effort */
    }
  }

  return { dockerAvailable: true, containersRemoved: removed };
}

// Reap orphaned vitest WORKERS — the process-side leak the container reaper above cannot see.
//
// Why this exists: the test runs here are launched by tooling, and the only interrupt available is a
// hard stop (an Esc, a killed parent, a timeout signal). That can kill vitest's orchestrator while its
// tinypool workers are reparented to launchd (ppid 1), where they keep spinning at ~100% CPU
// indefinitely. `reap()` above only removes Docker containers, so nothing reaps these; this is the
// compensating process reaper, run first by `pnpm reap` (and the pre-push hook's start).
//
// SAFETY — two guards, mirroring the container reaper's label+age pair:
//  1. PPID. Only processes whose parent is 1 (launchd, on macOS). A LIVE run's workers are parented to
//     the orchestrator and the orchestrator to the shell — never 1 — so a running suite is untouched.
//  2. COMMAND. Only the tinypool worker's process TITLE `node (vitest N)` (and the bare `node (vitest)`
//     orchestrator), matched on the parenthesised `(vitest` marker — NOT `vitest` anywhere in the line.
//     A bare-word match killed a real orphan whose argv merely held a `vitest` log path; a title's
//     parens cannot occur in an ordinary path or flag.
// SIGKILL, not SIGTERM: the orphaned workers were observed not to exit on SIGTERM and to need `kill -9`,
// so a best-effort sweep of confirmed orphans signals once, hard.
/**
 * Kill orphaned vitest worker processes — the CPU-side counterpart to `reap()`'s container cleanup. A
 * pure data-in/data-out function over an injected `psExec` and `kill`, testable without touching a real
 * process; the CLI block below wires in the real `ps` and `process.kill`.
 *
 * @param {{ psExec: (args: string[]) => string, kill: (pid: number, signal: string) => void }} deps
 *   `psExec(args)` runs `ps <args>` and returns stdout (throwing when `ps` is absent). `kill(pid, sig)`
 *   signals a process. Both are required (like `reap`'s `exec`), so the real `process.kill` lives only
 *   in the v8-ignored CLI block, never in this measured function.
 * @returns {{ psAvailable: boolean, workersKilled: number }}
 */
export function sweepOrphanedVitestWorkers({ psExec, kill }) {
  let table;
  try {
    // `-o pid=,ppid=,command=` suppresses the header (the `=` empties each column label), so every line
    // is a row: right-padded pid, ppid, then the command (which may contain spaces) as the remainder.
    table = psExec(["-axo", "pid=,ppid=,command="]);
  } catch {
    // `ps` missing (returns non-zero / not found): a best-effort reaper must not fail its caller.
    return { psAvailable: false, workersKilled: 0 };
  }

  // `^\s*` absorbs the pid column's padding, so blank or partial lines simply fail to match and drop out
  // at the null filter — no separate trim/non-empty passes needed.
  const orphans = table
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((m) => m !== null && m[2] === "1" && /\(vitest[\s)]/.test(m[3]))
    .map((m) => Number(m[1]));

  let killed = 0;
  for (const pid of orphans) {
    try {
      kill(pid, "SIGKILL");
      killed += 1;
    } catch {
      // The worker exited between `ps` and `kill` (ESRCH), or we lack permission: best-effort, count only
      // the kills that landed.
    }
  }

  return { psAvailable: true, workersKilled: killed };
}

// CLI entry — wires in the real `docker`. Ignored for coverage because the tests exercise it in a CHILD
// process (`spawnSync`), which the v8 provider does not measure (the same reason `changed-scope.mjs`
// ignores its own entry block). Best-effort: it exits 0 whatever happens, so a bloat-clearing step can
// never fail a push.
/* v8 ignore start */
if (process.argv[1] && process.argv[1].endsWith("reap-testcontainers.mjs")) {
  const dockerExec = (args) =>
    execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const psExec = (args) =>
    execFileSync("ps", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  // Workers first — they are the ~100% CPU leak; the container sweep is disk pressure.
  const workers = sweepOrphanedVitestWorkers({
    psExec,
    kill: (pid, signal) => process.kill(pid, signal),
  });
  const result = reap({ exec: dockerExec });
  const workerPart = workers.psAvailable
    ? `killed ${workers.workersKilled} orphaned vitest worker(s)`
    : "ps unavailable — no worker sweep";
  const containerPart = result.dockerAvailable
    ? `reaped ${result.containersRemoved} stale waitron testcontainers container(s)`
    : "Docker unavailable — nothing reaped";
  console.error(`reap-testcontainers: ${workerPart}; ${containerPart}`);
  process.exit(0);
}
/* v8 ignore stop */
