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

// CLI entry — wires in the real `docker`. Ignored for coverage because the tests exercise it in a CHILD
// process (`spawnSync`), which the v8 provider does not measure (the same reason `changed-scope.mjs`
// ignores its own entry block). Best-effort: it exits 0 whatever happens, so a bloat-clearing step can
// never fail a push.
/* v8 ignore start */
if (process.argv[1] && process.argv[1].endsWith("reap-testcontainers.mjs")) {
  const dockerExec = (args) =>
    execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const result = reap({ exec: dockerExec });
  const summary = result.dockerAvailable
    ? `reaped ${result.containersRemoved} stale waitron testcontainers container(s)`
    : "Docker unavailable — nothing reaped";
  console.error(`reap-testcontainers: ${summary}`);
  process.exit(0);
}
/* v8 ignore stop */
