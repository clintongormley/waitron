import { sql } from "drizzle-orm";
import { afterAll, beforeAll, inject } from "vitest";
import { createPgliteDb, createPostgresDb, type Database } from "../client.js";
import { runMigrations, type MigrationOptions } from "../migrate.js";
import { assertSafeIdentifier, probeRoleStatement, type ProbeRole } from "./identifiers.js";
import { databaseUrl, roleUrl, type RealPostgres } from "./postgres.js";
import type { SharedContainerHandle } from "./shared-container.js";

/**
 * Suite lifecycle helpers: the hooks live HERE, not in the suites.
 *
 * `postgres.ts` says how to *start* a database; this module says who *owns* it. That split is why
 * this file is the only one under `testing/` that imports vitest — a suite gets an accessor, never
 * a handle it is responsible for closing, so the unguarded-teardown defect that
 * `guarded-teardowns.test.ts` polices cannot be written in the first place. The guard remains as a
 * backstop for the few suites that legitimately construct their own container
 * (`client.test.ts`, `migrate.test.ts` — see `postgres.ts` for why).
 *
 * Accessors throw rather than returning `undefined` when read before their hook has run. That is
 * the whole point: `undefined` is what turns a setup failure into
 * `Cannot read properties of undefined` two frames away from the real error.
 */

/** PGlite boots a WASM PostgreSQL and then runs migrations — well past vitest's 5s hook default. */
const DEFAULT_SETUP_TIMEOUT_MS = 60_000;

export interface PgliteSuiteOptions {
  /** Migration sets, applied in order. Cross-package ordering is the caller's to state. */
  migrations: MigrationOptions[];
  /** Extra setup once migrated — installing a fake backend, seeding a fixture. */
  setup?: (db: Database) => Promise<void>;
  /** Override when a suite's own setup is slower than the default. */
  timeoutMs?: number;
}

export interface PgliteSuite {
  /** The migrated database. Throws if read before `beforeAll` has run. */
  readonly db: Database;
}

/** Registers `beforeAll`/`afterAll` for one PGlite database shared by the calling suite. */
export function usePgliteDb(options: PgliteSuiteOptions): PgliteSuite {
  let db: Database | undefined;

  // Assigned the instant it exists, BEFORE migrations or setup can throw. Assigning at the end of
  // the hook instead leaves `db` undefined when a later step fails, so `afterAll` closes nothing and
  // the WASM cluster leaks — a silent leak in place of the noisy TypeError this whole helper exists
  // to prevent, which is strictly worse. `runMigrations` failing is not hypothetical: it is what a
  // bad migration in a feature branch does.
  beforeAll(async () => {
    db = await createPgliteDb();
    for (const migrations of options.migrations) await runMigrations(db, migrations);
    if (options.setup !== undefined) await options.setup(db);
  }, options.timeoutMs ?? DEFAULT_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    const started = db;
    db = undefined;
    if (started !== undefined) await started.close();
  });

  return {
    get db(): Database {
      if (db === undefined) throw new Error("usePgliteDb: database not started");
      return db;
    },
  };
}

export interface RealPostgresSuiteOptions {
  /** The package's own migrated-container starter — each package migrates a different set. */
  start: () => Promise<RealPostgres>;
  /**
   * A non-superuser LOGIN role created once the container is up, for suites that probe RLS. The
   * container's default user is a superuser and bypasses `FORCE ROW LEVEL SECURITY`, so a policy
   * test needs one of these; `inRole` carries the grants.
   */
  probeRole?: ProbeRole;
  /** Extra setup once the container is up — doubles that wrap the admin connection, extra roles. */
  setup?: (context: { admin: Database; pg: RealPostgres }) => Promise<void>;
  /**
   * Deliberately **no default**, unlike {@link usePgliteDb}. Passing a timeout to `beforeAll`
   * OVERRIDES the package's `hookTimeout`, so a default here would silently narrow every container
   * suite that relies on its vitest config — `packages/payments` and `packages/fiscal-verifactu`
   * both set 180_000, and a 60s default would have cut that to a third on a cold image pull. Two
   * independent migrations hit this. Verified rather than reasoned: a scratch suite under a
   * `hookTimeout: 180_000` config with `beforeAll(fn, 50)` failed after 54ms, not 180s.
   */
  timeoutMs?: number;
}

// `ProbeRole`, `probeRoleStatement` and `assertSafeIdentifier` now live in the vitest-FREE
// `./identifiers.js` so `shared-container.ts` can use them without dragging `vitest` into a
// globalSetup's import graph (see that file's header). Imported above for this module's own use and
// re-exported here so existing importers — which reached them through this module — are unaffected.
export { assertSafeIdentifier, probeRoleStatement, type ProbeRole };

export interface RealPostgresSuite {
  /** The running container. Throws if read before `beforeAll` has run. */
  readonly pg: RealPostgres;
  /** A superuser connection, for seeding. Throws if read before `beforeAll` has run. */
  readonly admin: Database;
}

/** Registers `beforeAll`/`afterAll` for one real-PostgreSQL container plus an admin connection. */
export function useRealPostgres(options: RealPostgresSuiteOptions): RealPostgresSuite {
  let pg: RealPostgres | undefined;
  let admin: Database | undefined;

  // Each handle is assigned the instant it exists, so a later failure still leaves it closable. A
  // container that outlives a failed `connect()` or a throwing `setup` is a leaked Docker container,
  // and with `TESTCONTAINERS_RYUK_DISABLED=true` — required locally, see CLAUDE.md §4 — nothing
  // reaps it. Assigning both at the end of the hook, as this first did, made that the default.
  beforeAll(async () => {
    pg = await options.start();
    admin = await pg.connect();
    if (options.probeRole !== undefined) {
      await admin.execute(sql.raw(probeRoleStatement(options.probeRole)));
    }
    if (options.setup !== undefined) await options.setup({ admin, pg });
  }, options.timeoutMs);

  // Ordered: the connection is closed before the container it lives in is stopped. Each is guarded
  // independently, so a failure to open the connection still stops the container.
  afterAll(async () => {
    const connection = admin;
    const started = pg;
    admin = undefined;
    pg = undefined;
    if (connection !== undefined) await connection.close();
    if (started !== undefined) await started.stop();
  });

  return {
    get pg(): RealPostgres {
      if (pg === undefined) throw new Error("useRealPostgres: container not started");
      return pg;
    },
    get admin(): Database {
      if (admin === undefined) throw new Error("useRealPostgres: container not started");
      return admin;
    },
  };
}

/**
 * Monotonic within a worker PROCESS, so two suites in the same file get distinct clone names.
 *
 * It resets to 0 per test FILE — vitest's default `isolate: true` gives each file a fresh module
 * context — which is why `process.pid` is in the name too: across concurrent forks the pid differs,
 * and within one fork files run serially and each clone is DROPped in its own `afterAll` before the
 * next file reuses a counter value, so `clone_<pid>_<n>` does not collide in practice. Chosen over
 * `Math.random`/`Date.now` (allowed in test code, but non-deterministic) so a clone that ever leaks
 * into `pg_database` is traceable to the run that made it.
 */
let cloneCounter = 0;

/**
 * Resolves the shared handle from the `getHandle` seam, defaulting to vitest's cross-worker
 * `inject("sharedPg")` — the value a package's globalSetup passed to `provide("sharedPg", …)`.
 *
 * Separate from {@link useTemplateDb}'s hook, the same way `postgres.ts` keeps its `start` seam, so
 * both arms are provable without standing up a globalSetup: a test points `getHandle` at a handle
 * from its own {@link startSharedContainer}, and the production `inject` path is exercised here
 * directly.
 */
export function resolveSharedHandle(
  getHandle: (() => SharedContainerHandle) | undefined,
): SharedContainerHandle {
  return (getHandle ?? (() => inject("sharedPg")))();
}

/**
 * The template DATABASE name to clone for `name`, or a throw naming what IS available. Extracted so
 * the not-found path is provable without a container — the alternative is a suite whose `beforeAll`
 * throws, which reports as a failing suite rather than a passing assertion.
 */
export function pickTemplate(handle: SharedContainerHandle, name: string): string {
  const template = handle.templates[name];
  if (template === undefined) {
    throw new Error(
      `useTemplateDb: no template named ${JSON.stringify(name)}; startSharedContainer provided ` +
        JSON.stringify(Object.keys(handle.templates)),
    );
  }
  return template;
}

/**
 * Creates `clone_<…>` from `template` on the container's admin connection and wraps it as a
 * `RealPostgres` pointed at the CLONE. `stop()` DROPs the clone (never the shared container) with
 * `WITH (FORCE)`, so a suite that leaves a `connectAs` connection open still tears down — verified
 * against a real container in `lifecycle.test.ts`: the force-drop terminates the lingering backend
 * and the DROP succeeds. `CREATE DATABASE … TEMPLATE` needs no connection to the template, which
 * `startSharedContainer` guarantees by closing every migrator before it returns.
 */
async function cloneTemplate(
  adminUri: string,
  template: string,
  cloneName: string,
): Promise<RealPostgres> {
  const admin = await createPostgresDb(adminUri);
  try {
    await admin.execute(sql.raw(`create database ${cloneName} template ${template}`));
  } finally {
    await admin.close();
  }
  const cloneUri = databaseUrl(adminUri, cloneName);
  return {
    uri: cloneUri,
    connect: () => createPostgresDb(cloneUri),
    connectAs: (role, password) => createPostgresDb(roleUrl(cloneUri, role, password)),
    // DROP DATABASE cannot run while connected to its target, so the dropper connects to the admin
    // URI's own database instead; WITH (FORCE) terminates any connection a suite forgot to close.
    stop: async () => {
      const dropper = await createPostgresDb(adminUri);
      try {
        await dropper.execute(sql.raw(`drop database if exists ${cloneName} with (force)`));
      } finally {
        await dropper.close();
      }
    },
  };
}

export interface TemplateDbSuiteOptions {
  /** Which named template — a key of the shared handle's `templates` — to clone for this suite. */
  template: string;
  /** Extra setup once the clone is up — doubles that wrap the admin connection, seeding a fixture. */
  setup?: (context: { admin: Database; pg: RealPostgres }) => Promise<void>;
  /**
   * Deliberately no default, exactly as {@link RealPostgresSuiteOptions.timeoutMs}: passing a
   * timeout to `beforeAll` OVERRIDES the package's `hookTimeout`, so a default here would silently
   * narrow every suite that relies on its vitest config.
   */
  timeoutMs?: number;
  /**
   * Seam: where the shared handle comes from. Defaults to vitest `inject("sharedPg")`; a test
   * points it at a handle from its own {@link startSharedContainer} so the helper needs no
   * globalSetup to exercise end to end.
   */
  getHandle?: () => SharedContainerHandle;
}

/**
 * The shared-container analogue of {@link useRealPostgres}: instead of booting and migrating a
 * container per file, it CLONES a pre-migrated template database from the shared container (~26ms)
 * and hands back the SAME `{ pg, admin }` shape, so a suite converts by swapping the constructor
 * and nothing else — `pg.connect`/`connectAs`/`uri` and the `admin` seeding connection are
 * unchanged, and `pg.stop()` drops the clone rather than stopping the container.
 *
 * There is deliberately no `probeRole` option, unlike `useRealPostgres`: a shared container is one
 * cluster, so a role created per file would collide on the second file. Cluster roles are created
 * ONCE, idempotently, in {@link startSharedContainer}'s `roles`; a suite reaches one with
 * `pg.connectAs(name, password)`.
 */
export function useTemplateDb(options: TemplateDbSuiteOptions): RealPostgresSuite {
  let pg: RealPostgres | undefined;
  let admin: Database | undefined;

  // Same discipline as useRealPostgres: each handle is assigned the instant it exists, so a later
  // throw (a failing clone, a throwing setup) still leaves it closable in afterAll rather than
  // leaking a clone DATABASE that nothing drops.
  beforeAll(async () => {
    const handle = resolveSharedHandle(options.getHandle);
    const template = assertSafeIdentifier("template", pickTemplate(handle, options.template));
    const cloneName = assertSafeIdentifier(
      "clone name",
      `clone_${process.pid}_${(cloneCounter += 1)}`,
    );
    pg = await cloneTemplate(handle.uri, template, cloneName);
    admin = await pg.connect();
    if (options.setup !== undefined) await options.setup({ admin, pg });
  }, options.timeoutMs);

  // Ordered and independently guarded, exactly as useRealPostgres: the admin connection is closed
  // before the clone it lives in is dropped. pg.stop() here DROPs the clone, not the container.
  afterAll(async () => {
    const connection = admin;
    const started = pg;
    admin = undefined;
    pg = undefined;
    if (connection !== undefined) await connection.close();
    if (started !== undefined) await started.stop();
  });

  return {
    get pg(): RealPostgres {
      if (pg === undefined) throw new Error("useTemplateDb: clone not started");
      return pg;
    },
    get admin(): Database {
      if (admin === undefined) throw new Error("useTemplateDb: clone not started");
      return admin;
    },
  };
}
