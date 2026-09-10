import { execFileSync } from "node:child_process";
import { beforeAll, afterAll, describe, inject } from "vitest";
import { createPgliteDb, type Database } from "../client.js";
import { runMigrations } from "../migrate.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { cloneTemplate, nextCloneName, pickTemplate, resolveSharedHandle } from "./lifecycle.js";
import type { RealPostgres } from "./postgres.js";
import type { SharedContainerHandle } from "./shared-container.js";

export interface Target {
  readonly name: "pglite" | "postgres";
  /** Starts whatever backs this target. Called once per suite. */
  setup(): Promise<void>;
  /**
   * A fresh, MIGRATED database. Called once per test, from the test's own
   * `beforeEach`.
   *
   * Fresh per test rather than shared per suite, and migrated here rather than
   * by each caller, because both alternatives have bitten this repo. A shared
   * handle makes a suite order-dependent: a test that inserts a row changes
   * what the next test sees, and the failure surfaces as "passes alone, fails
   * in the file". Leaving migrations to the caller means every suite repeats
   * the same two lines and a suite that forgets them tests an empty schema.
   *
   * This isolation is NOT identical across targets, despite each call
   * returning a database no other test has touched. PGlite's `create()` boots
   * a fresh WASM cluster every time, so cluster-global objects (roles,
   * tablespaces) are fresh too. The postgres target's `create()` clones a
   * fresh DATABASE per test from the `core` template, but inside the ONE
   * shared container/cluster the vitest globalSetup boots for the whole
   * PACKAGE run — cluster-global objects are therefore SHARED across every
   * test in the package that runs against postgres, not reset (even more
   * widely than before, when the container was per-suite). A migration that
   * does `CREATE ROLE app_user` succeeds on the first test and then fails
   * with `role "app_user" already exists` on the second test's migration — on
   * postgres only, since PGlite cannot reproduce a shared cluster. Migrations
   * that create cluster-global objects MUST therefore do so idempotently
   * (e.g. `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN null; END $$;`
   * or an equivalent `IF NOT EXISTS` guard), never assume a clean cluster.
   * (The template is migrated once, in the globalSetup, so a test never runs
   * migrations against postgres itself — but the idempotency rule still holds
   * for whatever the globalSetup's template migrator runs.)
   *
   * A suite using this dual-target harness obtains its database through this method.
   * There is deliberately no `target.db` property and no `target.db()`
   * accessor — a test that builds its own PGlite instance runs one target
   * while appearing to run both.
   */
  create(): Promise<Database>;
  /** Stops whatever setup() started. */
  teardown(): Promise<void>;
}

// Cache the fallback probe within each isolated test file.
let cachedDockerAvailable: boolean | undefined;

export interface DockerProbeOptions {
  /** How many times to probe before concluding the daemon is absent. */
  attempts: number;
  /** Milliseconds to wait between a failed probe and the next one. */
  delayMs: number;
  /** Blocking sleep between attempts; injectable so tests don't wait in real time. */
  sleep: (ms: number) => void;
}

// A CI runner has Docker installed but its daemon can still be a second or two from accepting
// connections when this gate's CLI probe first runs. A one-shot `docker info` then caches "absent"
// for the rest of that test file, and every consumer of the gate misreads Docker as gone — with
// three different symptoms: a caller that hard-requires two real containers throws "cannot degrade
// to a hermetic run" (the sync two-node replication fixture — the failure that motivated this); the
// `resolveTargets` dual-target suites throw at collection under REQUIRE_DOCKER; and the
// `describe.runIf(dockerAvailable())` suites silently skip. Retrying a not-ready daemon across a few
// probes avoids all three. Genuine absence — a missing `docker` binary (ENOENT) — never resolves on
// retry, so it fails fast; a daemon that never comes up still fails after the bounded wait, so
// REQUIRE_DOCKER stays loud.
const DOCKER_PROBE_ATTEMPTS = 6;
// Sleeps run only BETWEEN failed probes: up to 5 × 1s = ~5s. Each probe also carries `docker info`'s
// own 10s timeout, so a HANGING daemon (rare) can exceed that; a not-ready daemon errors fast, so the
// ~5s figure holds for the case this retry exists for.
const DOCKER_PROBE_DELAY_MS = 1_000;

/** Blocking sleep — `dockerAvailable` is synchronous and runs once at suite setup, so a short thread
 * block is acceptable and simpler than making the whole probe async. The retry LOGIC is covered by
 * `probeDockerCli`'s injected sleep; this one-line stdlib primitive is not worth a wall-clock test. */
function sleepSync(ms: number): void {
  /* v8 ignore next -- trivial Atomics.wait sleep, no logic to cover (matches the file's other thin-line ignore) */
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Probe for a working Docker daemon, retrying a not-yet-ready daemon up to `attempts` times with a
 * `delayMs` wait between tries. `run` performs one probe and throws on failure; a thrown ENOENT
 * (the `docker` binary is missing) is treated as genuine absence and returns immediately without
 * retrying. Returns true on the first successful probe, false once the attempts are exhausted.
 */
export function probeDockerCli(run: () => void, options: DockerProbeOptions): boolean {
  for (let attempt = 0; attempt < options.attempts; attempt++) {
    try {
      run();
      return true;
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return false;
      if (attempt < options.attempts - 1) options.sleep(options.delayMs);
    }
  }
  return false;
}

export function dockerAvailable(): boolean {
  // Global setup has already started and migrated this container. A redundant CLI
  // probe can fail independently; actual database/boot failures still fail the suites.
  if (inject("sharedPg") !== undefined) return true;
  if (cachedDockerAvailable !== undefined) return cachedDockerAvailable;
  cachedDockerAvailable = probeDockerCli(
    () => execFileSync("docker", ["info"], { stdio: "ignore", timeout: 10_000 }),
    { attempts: DOCKER_PROBE_ATTEMPTS, delayMs: DOCKER_PROBE_DELAY_MS, sleep: sleepSync },
  );
  return cachedDockerAvailable;
}

/** Migrations run as OWNER, here. The application role never runs them. */
async function migrated(db: Database): Promise<Database> {
  await runMigrations(db, CORE_MIGRATIONS);
  return db;
}

const pgliteTarget: Target = {
  name: "pglite",
  setup: async () => {},
  create: async () => migrated(await createPgliteDb()),
  teardown: async () => {},
};

function postgresTarget(): Target {
  let handle: SharedContainerHandle | undefined;
  let template: string | undefined;
  // Every clone this target hands out, dropped in teardown() — the same lifecycle the per-suite
  // container gave (its stop() removed all the databases created against it), now that the container
  // is shared across the whole package run and no longer disposable per suite.
  const clones: RealPostgres[] = [];
  return {
    name: "postgres",
    setup: async () => {
      // The shared container the package globalSetup booted and `provide`d; `resolveTargets` only
      // reaches this target's setup when Docker is present, and the globalSetup would have died
      // otherwise, so the handle is always here.
      handle = resolveSharedHandle(undefined);
      template = pickTemplate(handle, "core");
    },
    create: async () => {
      // Guards an ordering invariant describeEachTarget itself enforces
      // (beforeAll(setup) always completes before any test's create() runs),
      // not a case a test in this package can trigger through the public
      // Target API — Target.create()'s own doc comment is explicit that
      // building a target by hand, the only way to violate this, is exactly
      // what a test must never do. Left in for a clear message if a future
      // caller outside this package's tests ever does construct one by hand.
      // Stryker disable next-line all
      /* v8 ignore next */
      if (!handle || !template) throw new Error("postgres target used before setup()");
      // A ~26ms `CREATE DATABASE … TEMPLATE` clone of the pre-migrated `core` template, in place of
      // the old `create database` + per-test CORE migration (~387ms). NOT the same isolation PGlite
      // gets — see Target.create's doc comment: cluster-global objects (roles, tablespaces) are shared
      // across every test in the whole package run against this one container, not reset.
      const clone = await cloneTemplate(handle.uri, template, nextCloneName());
      clones.push(clone);
      return clone.connect();
    },
    teardown: async () => {
      // Drop every clone this target made (never the shared container). The consumer's own afterEach
      // has already closed each `create()`d connection; stop() opens its own dropper and DROPs the
      // clone database WITH (FORCE) regardless. allSettled, not a serial await loop: one clone whose
      // drop rejects must not skip the rest (that would leak the others until globalTeardown), so
      // every drop runs, `clones` is cleared either way, and the first failure is rethrown so a broken
      // teardown still surfaces rather than passing silently.
      const dropped = await Promise.allSettled(clones.map((clone) => clone.stop()));
      clones.length = 0;
      const failed = dropped.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      // Defensive: a `drop database if exists … with (force)` failing is not reachable through the
      // public Target API (the same footing as the `used before setup()` guard above), so tests do
      // not trigger it — but if one ever does, surface it rather than swallow it.
      /* v8 ignore next */
      if (failed.length > 0) throw failed[0].reason;
    },
  };
}

export interface TargetEnvironment {
  dockerAvailable: boolean;
  requireDocker: boolean;
}

/**
 * Selects targets from the supplied environment, independently of the machine's Docker daemon.
 * A skipped real-Postgres target leaves lock contention unchecked: PGlite serialises queries
 * onto one backend. The required-Docker branch throws; the optional branch warns. Package-level
 * global setup separately requires Docker before the test files run.
 */
export function resolveTargets(env: TargetEnvironment): Target[] {
  if (env.dockerAvailable) return [pgliteTarget, postgresTarget()];
  if (env.requireDocker) {
    throw new Error(
      "REQUIRE_DOCKER is set but Docker is not available. The real-Postgres target is required " +
        "for lock contention; skipping it would leave concurrency unchecked.",
    );
  }
  console.warn(
    "\n" +
      "!".repeat(78) +
      "\n! DOCKER NOT AVAILABLE — the real-Postgres target is SKIPPED.\n" +
      "! Lock contention is NOT covered by this run.\n" +
      "! PGlite serialises onto one backend, so FOR UPDATE never blocks there.\n" +
      "! This run cannot be used as evidence for database concurrency.\n" +
      "!".repeat(78) +
      "\n",
  );
  return [pgliteTarget];
}

/**
 * The dual-target seam. A suite written once runs against PGlite and, when
 * Docker is present, against real PostgreSQL.
 *
 * Every target is always registered with `describe`, and inclusion is
 * decided per-target with `describe.runIf` rather than by shrinking the
 * array a single `describe.each` iterates. Filtering the array first (the
 * previous approach) omits the postgres suite from the run entirely when
 * Docker is absent — `resolveTargets`'s console banner is the only sign it
 * happened, and Vitest's own reporter shows no skipped count, which is easy
 * to miss in a long CI log. `describe.runIf(false)` still registers the
 * suite and marks it skipped, so both the banner and Vitest's skip count
 * agree — the same pattern `client.test.ts`/`migrate.test.ts` use for their
 * own postgres blocks.
 */
export function describeEachTarget(name: string, fn: (target: Target) => void): void {
  const included = resolveTargets({
    dockerAvailable: dockerAvailable(),
    requireDocker: process.env.REQUIRE_DOCKER === "1",
  });
  const includedNames = new Set(included.map((target) => target.name));
  const allTargets: Target[] = [pgliteTarget, postgresTarget()];
  for (const target of allTargets) {
    describe.runIf(includedNames.has(target.name))(`${name} [${target.name}]`, () => {
      beforeAll(() => target.setup());
      afterAll(() => target.teardown());
      fn(target);
    });
  }
}
