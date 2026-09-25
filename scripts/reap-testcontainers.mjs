import { execFileSync } from "node:child_process";

// Reap STALE waitron Testcontainers resources.
//
// Containers here are started with `TESTCONTAINERS_RYUK_DISABLED=true` (mandatory locally — Ryuk hangs
// on this machine), which disables Testcontainers' own reaper, so an INTERRUPTED run leaves a container
// and its anonymous volume behind.
//
// WHAT IT CANNOT REACH: guard 1 below selects on a label each rig has to stamp for itself. `runPostgres`
// in `bench/pglite-throughput/src/bench.ts` starts a `postgres:18-alpine` with no `.withLabels` call, so
// an interrupted run of that rig leaves a container this script will never select.
//
// SAFETY — two guards, because a running orphan and a running IN-USE container look identical:
//  1. LABEL. It removes only containers carrying `com.waitron.reapable`, never the generic
//     `org.testcontainers` label that every testcontainers container in every project shares.
//  2. AGE. Of those, it removes only ones older than STALE_CONTAINER_MS. A container younger than that
//     may belong to a watch-mode vitest running RIGHT NOW in another terminal. The residual edge — a
//     single watch session running longer than the threshold on one container — is accepted, the price
//     of having no way to distinguish that from a genuine orphan of the same age.
// `rm -v` takes each removed container's anonymous data volume with it, so no blanket `volume prune`
// (which would reach other projects' dangling volumes) is needed. It never removes images.

/** A container older than this (ms) is treated as a stale orphan; younger ones are spared. 2 hours. */
export const STALE_CONTAINER_MS = 2 * 60 * 60 * 1000;

/**
 * @param {{ exec: (args: string[]) => string, now?: () => number }} deps
 *   `exec(args)` runs `docker <args>` and returns stdout (throwing on a non-zero exit / absent daemon).
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
    // Docker not running / not installed: a best-effort reaper must not fail its caller.
    return { dockerAvailable: false, containersRemoved: 0 };
  }

  // `docker inspect` with no ids is an error, so short-circuit when nothing carries the label.
  if (ids.length === 0) {
    return { dockerAvailable: true, containersRemoved: 0 };
  }

  // ISO-8601 `.Created` has no embedded space, so a plain split is safe.
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
  // permission error) so the reaper stays best-effort and never throws.
  let removed = 0;
  if (stale.length > 0) {
    try {
      exec(["rm", "-f", "-v", ...stale]);
      removed = stale.length;
    } catch {
      /* best-effort */
    }
  }

  return { dockerAvailable: true, containersRemoved: removed };
}

// Reap orphaned vitest WORKERS. A hard interrupt (an Esc, a killed parent, a timeout signal) can kill
// vitest's orchestrator while its workers are reparented to launchd (ppid 1), where they keep spinning
// at ~100% CPU indefinitely.
//
// SAFETY — two guards:
//  1. PPID. Only processes whose parent is 1 (launchd, on macOS). A LIVE run's workers are parented to
//     the orchestrator and the orchestrator to the shell — never 1 — so a running suite is untouched.
//  2. COMMAND. Two shapes, because the two vitest majors this repository has run look different in
//     `ps`, and NEITHER is a bare `vitest` match: a bare-word match killed a real orphan whose argv
//     merely held a `vitest` log path.
//     - Vitest 3 set a process TITLE: `node (vitest N)` for a tinypool worker, `node (vitest)` for the
//       orchestrator. Matched on the parenthesised `(vitest` marker, a sequence an ordinary path or
//       flag is vanishingly unlikely to contain.
//     - Vitest 4 sets no title, so a worker appears as its entrypoint path
//       `…/node_modules/vitest/dist/workers/<pool>.js` and the orchestrator as `…/vitest/vitest.mjs`,
//       which can be reached through `.bin/../vitest/` — hence only the trailing `/vitest/vitest.mjs`.
//       Each pattern matches that path ANYWHERE in the row, not only as its final token.
// SIGKILL, not SIGTERM: the orphaned workers were observed not to exit on SIGTERM.
/**
 * @param {string} command the command column of one `ps` row
 * @returns {boolean}
 */
function isVitestProcess(command) {
  return (
    /\(vitest[\s)]/.test(command) ||
    /node_modules\/vitest\/dist\/workers\//.test(command) ||
    /\/vitest\/vitest\.mjs(\s|$)/.test(command)
  );
}

/**
 * Is this `ps` command column one of the test binaries a checkout keeps in a `.bin` (Litestream and
 * `versitygw`)? The row's FIRST token must be a path ending
 * `<dir>/.bin/litestream` or `<dir>/.bin/versitygw`, or the same under `<dir>/bench/sqlite-failover/`,
 * where `<dir>` is a directory whose name starts `waitron` — the main checkout and every
 * `waitron-<branch>` worktree.
 *
 * @param {string} command the command column of one `ps` row
 * @returns {boolean}
 */
function isTestBinaryProcess(command) {
  return /^(?:\S*\/)?waitron[^/\s]*\/(?:bench\/sqlite-failover\/)?\.bin\/(?:litestream|versitygw)(?:\s|$)/.test(
    command,
  );
}

/**
 * Kills orphaned vitest processes (`isVitestProcess`) and the parentless test binaries
 * `isTestBinaryProcess` matches.
 *
 * @param {{ psExec: (args: string[]) => string, kill: (pid: number, signal: string) => void }} deps
 *   `kill` is required, so the real `process.kill` lives only in the v8-ignored CLI block.
 * @returns {{ psAvailable: boolean, workersKilled: number }}
 */
export function sweepOrphanedVitestWorkers({ psExec, kill }) {
  let table;
  try {
    // The `=` empties each column label, which suppresses the header.
    table = psExec(["-axo", "pid=,ppid=,command="]);
  } catch {
    // A best-effort reaper must not fail its caller.
    return { psAvailable: false, workersKilled: 0 };
  }

  // Blank or partial lines fail to match and drop out at the null filter.
  const orphans = table
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter(
      (m) => m !== null && m[2] === "1" && (isVitestProcess(m[3]) || isTestBinaryProcess(m[3])),
    )
    .map((m) => Number(m[1]));

  let killed = 0;
  for (const pid of orphans) {
    try {
      kill(pid, "SIGKILL");
      killed += 1;
    } catch {
      // The worker exited between `ps` and `kill` (ESRCH), or we lack permission.
    }
  }

  return { psAvailable: true, workersKilled: killed };
}

// Ignored for coverage because the tests exercise it in a CHILD process (`spawnSync`), which the v8
// provider does not measure. It exits 0 whatever happens.
/* v8 ignore start */
if (process.argv[1] && process.argv[1].endsWith("reap-testcontainers.mjs")) {
  const dockerExec = (args) =>
    execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const psExec = (args) =>
    execFileSync("ps", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const workers = sweepOrphanedVitestWorkers({
    psExec,
    kill: (pid, signal) => process.kill(pid, signal),
  });
  const result = reap({ exec: dockerExec });
  const workerPart = workers.psAvailable
    ? `killed ${workers.workersKilled} orphaned vitest worker(s) or test binaries`
    : "ps unavailable — no worker sweep";
  const containerPart = result.dockerAvailable
    ? `reaped ${result.containersRemoved} stale waitron testcontainers container(s)`
    : "Docker unavailable — nothing reaped";
  console.error(`reap-testcontainers: ${workerPart}; ${containerPart}`);
  process.exit(0);
}
/* v8 ignore stop */
