import { execFileSync } from "node:child_process";
import { beforeAll, afterAll, describe } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import { createPgliteDb, createPostgresDb, type Database } from "../client.js";
import { runMigrations } from "../migrate.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { POSTGRES_IMAGE } from "./postgres.js";

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
   * tablespaces) are fresh too. The postgres target's `create()` makes a
   * fresh DATABASE per test, but inside ONE shared container/cluster for the
   * whole suite — cluster-global objects are therefore SHARED across every
   * test that runs against this target, not reset. A migration that does
   * `CREATE ROLE app_user` succeeds on the first test and then fails with
   * `role "app_user" already exists` on the second test's migration — on
   * postgres only, since PGlite cannot reproduce a shared cluster. Migrations
   * that create cluster-global objects MUST therefore do so idempotently
   * (e.g. `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN null; END $$;`
   * or an equivalent `IF NOT EXISTS` guard), never assume a clean cluster.
   *
   * This is the ONLY way a test in this package should obtain a database.
   * There is deliberately no `target.db` property and no `target.db()`
   * accessor — a test that builds its own PGlite instance runs one target
   * while appearing to run both.
   */
  create(): Promise<Database>;
  /** Stops whatever setup() started. */
  teardown(): Promise<void>;
}

// Memoized: every file that imports this module computes POSTGRES_COVERED at
// module scope (client.test.ts, migrate.test.ts, describeEachTarget itself),
// which without caching means several `docker info` child-process spawns —
// each with a 10s timeout — per test run for a fact that cannot change
// mid-run.
let cachedDockerAvailable: boolean | undefined;

export function dockerAvailable(): boolean {
  if (cachedDockerAvailable !== undefined) return cachedDockerAvailable;
  try {
    execFileSync("docker", ["info"], { stdio: "ignore", timeout: 10_000 });
    cachedDockerAvailable = true;
  } catch {
    // Stryker disable next-line all: unreachable on any machine that has
    // Docker, which includes every CI runner and every contributor's laptop
    // this package requires — the same reasoning the ignore comment below
    // documents for coverage.
    /* v8 ignore start */
    cachedDockerAvailable = false;
  }
  /* v8 ignore stop */
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
  let container: StartedPostgreSqlContainer | undefined;
  let created = 0;
  return {
    name: "postgres",
    setup: async () => {
      container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
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
      if (container === undefined) throw new Error("postgres target used before setup()");
      // A fresh DATABASE per test rather than a fresh container: container
      // start is measured in seconds, database creation in milliseconds. This
      // is NOT the same isolation PGlite gets, though — see Target.create's
      // doc comment: cluster-global objects (roles, tablespaces) are shared
      // across every test that runs against this one container, not reset.
      created += 1;
      const name = `waitron_test_${created}`;
      const admin = await createPostgresDb(container.getConnectionUri());
      await admin.execute(sql.raw(`create database ${name}`));
      await admin.close();
      const url = new URL(container.getConnectionUri());
      url.pathname = `/${name}`;
      return migrated(await createPostgresDb(url.toString()));
    },
    teardown: async () => {
      await container?.stop();
      container = undefined;
    },
  };
}

export interface TargetEnvironment {
  dockerAvailable: boolean;
  requireDocker: boolean;
}

/**
 * Which targets this run covers.
 *
 * Pure, and separate from describeEachTarget, precisely so the skip decision
 * is testable without controlling the machine's Docker daemon.
 *
 * A silent skip here is the most dangerous failure mode in the package. The
 * postgres target is the ONLY thing that can observe the two behaviours spec
 * §10 records PGlite being unable to reproduce — lock contention, where
 * `FOR UPDATE` parses and runs but never blocks on a single shared backend,
 * and RLS enforcement against a non-superuser role. If it disappears from the
 * run, the suite still reports green while the properties it exists to prove
 * are no longer being checked. That is worse than a red build: it is a green
 * build that means nothing, which is the exact shape of the seven vacuous
 * tests plan 1 shipped.
 *
 * So: loud on a developer machine, fatal in CI.
 */
export function resolveTargets(env: TargetEnvironment): Target[] {
  if (env.dockerAvailable) return [pgliteTarget, postgresTarget()];
  if (env.requireDocker) {
    throw new Error(
      "REQUIRE_DOCKER is set but Docker is not available. The real-Postgres target is the " +
        "only one that can observe lock contention and non-superuser RLS; skipping it here " +
        "would report a green run that proves neither.",
    );
  }
  console.warn(
    "\n" +
      "!".repeat(78) +
      "\n! DOCKER NOT AVAILABLE — the real-Postgres target is SKIPPED.\n" +
      "! Lock contention and non-superuser RLS are NOT covered by this run.\n" +
      "! PGlite serialises onto one backend, so FOR UPDATE never blocks there.\n" +
      "! This run cannot be used as evidence for either property.\n" +
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
