import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, inject } from "vitest";
import { createPgliteDb, createPostgresDb, type Database } from "../client.js";
import { runMigrations, type MigrationOptions } from "../migrate.js";
import { assertSafeIdentifier, probeRoleStatement, type ProbeRole } from "./identifiers.js";
import { databaseUrl, roleUrl, type RealPostgres } from "./postgres.js";
import type { SharedContainerHandle } from "./shared-container.js";

/**
 * Suite lifecycle helpers: the hooks live HERE, not in the suites.
 *
 * `postgres.ts` starts databases; these helpers own their setup and cleanup hooks. A caller gets
 * an accessor without taking responsibility for closing the handle. `guarded-teardowns.test.ts`
 * also checks suites that construct their own resources (`client.test.ts`, `migrate.test.ts`).
 *
 * Accessors throw rather than returning `undefined` when read before their hook has run. That is
 * the whole point: `undefined` is what turns a setup failure into
 * `Cannot read properties of undefined` two frames away from the real error.
 */

/** Setup budget for booting PGlite and applying its migration sets. */
const DEFAULT_SETUP_TIMEOUT_MS = 60_000;

export interface PgliteSuiteOptions {
  /** Migration sets, applied in order. Cross-package ordering is the caller's to state. */
  migrations: MigrationOptions[];
  /** Extra setup once migrated — installing a fake backend, seeding a fixture. */
  setup?: (db: Database) => Promise<void>;
  /** Override when a suite's own setup is slower than the default. */
  timeoutMs?: number;
  /**
   * Empty every data table after each test so the suite is order-independent even though no query
   * filters by tenant. Default `true`.
   *
   * Set `false` for a suite that seeds shared rows ONCE — in `setup` or its own `beforeAll` — and
   * reads them across several `it`s; a per-test reset would wipe that fixture out from under the
   * second test. Schema (including tables `setup` creates, e.g. a fake backend's) always survives;
   * only DATA is cleared. The reset leaves the append-only tables' `ENABLE ALWAYS` triggers exactly
   * as it found them (see {@link buildResetPlan}).
   */
  resetPerTest?: boolean;
}

export interface PgliteSuite {
  /** The migrated database. Throws if read before `beforeAll` has run. */
  readonly db: Database;
}

/**
 * Empties every data table between tests. TRUNCATE fires only TRUNCATE-level triggers, not the
 * row-level `reject_mutation` immutability triggers — but the append-only tables ALSO carry a
 * `BEFORE TRUNCATE` trigger that is `ENABLE ALWAYS` (`0001_db_baseline_sql.sql`), which fires even
 * under `session_replication_role = replica` and blocks the TRUNCATE. So each such trigger is
 * disabled around the TRUNCATE and restored to its EXACT prior `tgenabled` — an ALWAYS trigger
 * downgraded to a plain ENABLE would silently weaken the append-only guarantee (CLAUDE.md §5).
 *
 * Captured once (schema is stable after migration) so each reset is three cheap statements.
 * Table and trigger names come from the catalog and are quoted by Postgres's own `format('%I')` /
 * `quote_ident`, the escape a utility statement needs since it cannot bind an identifier
 * (CLAUDE.md §3). The `__drizzle_migrations*` journal tables are left alone — the migration state
 * must outlive the data (every set names its own, `__drizzle_migrations_<set>` in `public`, all
 * caught by the trailing wildcard).
 *
 * Target-agnostic: {@link buildResetPlan}/{@link applyReset} take a `Database`, so the same plan
 * drives the PGlite helper (on its superuser `db`) and the real-Postgres helpers (on the clone's
 * admin/superuser connection — `app_user` can neither TRUNCATE nor ALTER TRIGGER). The catalog
 * queries and identifier quoting are identical on both engines.
 */
interface ResetPlan {
  truncate: string | undefined;
  disable: string[];
  restore: string[];
}

async function buildResetPlan(db: Database): Promise<ResetPlan> {
  const tables = await db.execute<{ ident: string }>(sql`
    select format('%I.%I', schemaname, tablename) as ident
    from pg_tables
    where schemaname not in ('pg_catalog', 'information_schema')
      and tablename not like '\\_\\_drizzle\\_migrations%'`);
  const idents = tables.rows.map((row) => row.ident);
  const truncate =
    idents.length === 0 ? undefined : `truncate ${idents.join(", ")} restart identity cascade`;

  // `tgtype & 32` is TRIGGER_TYPE_TRUNCATE; `tgisinternal` excludes FK constraint triggers.
  const triggers = await db.execute<{ tbl: string; name: string; tgenabled: string }>(sql`
    select format('%I.%I', n.nspname, c.relname) as tbl,
           quote_ident(t.tgname) as name,
           t.tgenabled::text as tgenabled
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal and (t.tgtype & 32) = 32`);
  // No `?? "enable"` fallback: an unrecognised tgenabled must throw, never silently restore an
  // append-only trigger as a plain ENABLE (CLAUDE.md §5). 'O','D','R','A' are the only values
  // Postgres records; a future one is a bug to surface, not to paper over.
  const enableForm: Record<string, string> = {
    A: "enable always",
    R: "enable replica",
    D: "disable",
    O: "enable",
  };
  const disable: string[] = [];
  const restore: string[] = [];
  for (const { tbl, name, tgenabled } of triggers.rows) {
    const form = enableForm[tgenabled];
    if (form === undefined) throw new Error(`unexpected tgenabled: ${tgenabled} on ${tbl}.${name}`);
    disable.push(`alter table ${tbl} disable trigger ${name}`);
    restore.push(`alter table ${tbl} ${form} trigger ${name}`);
  }
  return { truncate, disable, restore };
}

async function applyReset(db: Database, plan: ResetPlan): Promise<void> {
  if (plan.truncate === undefined) return;
  try {
    // The disable loop is INSIDE the try so a throw partway through it still reaches the finally
    // that restores every trigger — a trigger left disabled would let the next test mutate an
    // append-only table.
    for (const statement of plan.disable) await db.execute(sql.raw(statement));
    await db.execute(sql.raw(plan.truncate));
  } finally {
    for (const statement of plan.restore) await db.execute(sql.raw(statement));
  }
}

/** Registers `beforeAll`/`afterAll` (and, unless opted out, a per-test data reset) for one PGlite
 * database shared by the calling suite. */
export function usePgliteDb(options: PgliteSuiteOptions): PgliteSuite {
  let db: Database | undefined;
  let resetPlan: ResetPlan | undefined;
  const resetPerTest = options.resetPerTest ?? true;

  // Assigned the instant it exists, BEFORE migrations or setup can throw. Assigning at the end of
  // the hook instead leaves `db` undefined when a later step fails, so `afterAll` closes nothing and
  // the WASM cluster leaks — a silent leak in place of the noisy TypeError this whole helper exists
  // to prevent, which is strictly worse. `runMigrations` failing is not hypothetical: it is what a
  // bad migration in a feature branch does.
  beforeAll(async () => {
    db = await createPgliteDb();
    for (const migrations of options.migrations) await runMigrations(db, migrations);
    if (options.setup !== undefined) await options.setup(db);
    // After setup so a fake backend's tables are in the truncate set; the plan records only names
    // and trigger state, so setup's own seeded rows (present now) do not affect it.
    if (resetPerTest) resetPlan = await buildResetPlan(db);
  }, options.timeoutMs ?? DEFAULT_SETUP_TIMEOUT_MS);

  afterEach(async () => {
    if (resetPerTest && db !== undefined && resetPlan !== undefined)
      await applyReset(db, resetPlan);
  });

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
   * A non-superuser LOGIN role created once the container is up for privilege tests. The default
   * superuser connection bypasses privilege checks; `inRole` supplies the role memberships.
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
  /**
   * Empty every data table after each test, exactly as {@link PgliteSuiteOptions.resetPerTest} —
   * so a real-PG container suite is order-independent even though no query filters by tenant. Default
   * `true`. The reset runs on the `admin` (superuser) connection, the only one that may TRUNCATE and
   * toggle the append-only `ENABLE ALWAYS` triggers.
   *
   * Set `false` for a suite that seeds shared rows ONCE — in `setup` or its own `beforeAll` — and
   * reads them across several `it`s; a per-test reset would wipe that fixture. Only DATA is cleared;
   * schema and the append-only triggers survive exactly as found (see {@link buildResetPlan}).
   */
  resetPerTest?: boolean;
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
  let resetPlan: ResetPlan | undefined;
  const resetPerTest = options.resetPerTest ?? true;

  // Assign each handle as soon as it exists so teardown can close it after a later setup failure.
  // TESTCONTAINERS_RYUK_DISABLED=true disables automatic Ryuk cleanup.
  beforeAll(async () => {
    pg = await options.start();
    admin = await pg.connect();
    if (options.probeRole !== undefined) {
      await admin.execute(sql.raw(probeRoleStatement(options.probeRole)));
    }
    if (options.setup !== undefined) await options.setup({ admin, pg });
    // After setup so any tables it creates are in the truncate set; built on the admin connection,
    // the only one privileged to TRUNCATE and toggle the append-only triggers. See usePgliteDb.
    if (resetPerTest) resetPlan = await buildResetPlan(admin);
  }, options.timeoutMs);

  afterEach(async () => {
    if (resetPerTest && admin !== undefined && resetPlan !== undefined)
      await applyReset(admin, resetPlan);
  });

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
 * A fresh clone database name — the ONE place `clone_<pid>_<n>` is minted, shared by
 * {@link useTemplateDb} and `harness.ts`'s `describeEachTarget`. The name is NOT unique over the
 * process's whole life (see the reset below); what it guarantees is that no two clones LIVE at the
 * same moment share a name. A counter per module (the first shape) would each start at 0 and hand out
 * `clone_<pid>_1` from both the moment one file used both helpers, with two live clones colliding; a
 * single exported generator draws both helpers from ONE counter, closing that.
 *
 * Monotonic within a worker PROCESS, but it resets to 0 per test FILE — vitest's default
 * `isolate: true` gives each file a fresh module context — so a name DOES recur across files (the pid
 * is stable within a process). That does not collide because within one fork files run serially and
 * each clone is DROPped in its own `afterAll`/`teardown` before the next file reuses a counter value,
 * and across concurrent forks the pid differs. `process.pid` is in the name for that cross-fork
 * distinctness and, chosen over `Math.random`/`Date.now` (allowed in test code, but non-deterministic),
 * so a clone that ever leaks into `pg_database` is traceable to the run that made it.
 */
let cloneCounter = 0;
export function nextCloneName(): string {
  return assertSafeIdentifier("clone name", `clone_${process.pid}_${(cloneCounter += 1)}`);
}

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
  getHandle: (() => SharedContainerHandle | undefined) | undefined,
): SharedContainerHandle {
  // `inject("sharedPg")` is `undefined` when the package's vitest config never wired a `globalSetup`
  // that `provide`s it — the likely misconfiguration when a suite is converted to useTemplateDb but
  // its config is not. Throw the actionable cause here rather than let it surface three frames deep
  // in `cloneTemplate` as `Cannot read properties of undefined (reading 'templates')`.
  const handle = (getHandle ?? (() => inject("sharedPg")))();
  if (handle === undefined) {
    throw new Error(
      "useTemplateDb: no shared container in scope. Wire the package's vitest `globalSetup` to a " +
        'file that calls `startSharedContainer` and `provide("sharedPg", handle)`.',
    );
  }
  return handle;
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
 * `WITH (FORCE)`. The path `lifecycle.test.ts` exercises closes every connection first — the suite's
 * `afterAll` closes `admin` before `stop()` — so what is PROVEN is only that the drop of a
 * connection-free clone succeeds; the `WITH (FORCE)` backstop, which would terminate a connection a
 * suite forgot to close, is not separately exercised (it is the same parity the old
 * `container.stop()` gave, which also force-killed survivors untested). `CREATE DATABASE … TEMPLATE`
 * needs no connection to the template, which `startSharedContainer` guarantees by closing every
 * migrator before it returns.
 *
 * Exported because {@link useTemplateDb} is not the only shared-container consumer: `harness.ts`'s
 * `describeEachTarget` clones a fresh database PER TEST from the same `core` template, tracks the
 * returned handles, and `stop()`s each in its suite teardown — the fresh-DB-per-test contract that
 * a single `useTemplateDb` (one clone per FILE) cannot express.
 */
export async function cloneTemplate(
  adminUri: string,
  template: string,
  cloneName: string,
): Promise<RealPostgres> {
  // Validate HERE, at the choke point, not in each caller. Both names reach a `CREATE DATABASE` /
  // `DROP DATABASE` utility statement, which takes no placeholder, and `cloneTemplate` is exported
  // with more than one caller (useTemplateDb, describeEachTarget) — "the callers only pass safe
  // values" is a property of the callers, not the code (CLAUDE.md §3). Done before any connection
  // opens, so an unsafe name throws without touching the server.
  assertSafeIdentifier("template", template);
  assertSafeIdentifier("clone name", cloneName);
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
  /**
   * Empty every data table after each test, exactly as {@link RealPostgresSuiteOptions.resetPerTest}
   * — order-independence without a tenant filter on any read, run on the clone's `admin` connection. Default
   * `true`. Set `false` for a suite that seeds shared rows once and reads them across tests.
   */
  resetPerTest?: boolean;
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
  let resetPlan: ResetPlan | undefined;
  const resetPerTest = options.resetPerTest ?? true;

  // Same discipline as useRealPostgres: each handle is assigned the instant it exists, so a later
  // throw (a failing clone, a throwing setup) still leaves it closable in afterAll rather than
  // leaking a clone DATABASE that nothing drops.
  beforeAll(async () => {
    const handle = resolveSharedHandle(options.getHandle);
    // `cloneTemplate` validates both the template name and the clone name at its choke point, so no
    // wrap is needed here.
    pg = await cloneTemplate(handle.uri, pickTemplate(handle, options.template), nextCloneName());
    admin = await pg.connect();
    if (options.setup !== undefined) await options.setup({ admin, pg });
    // On the admin connection, after setup — same reset the PGlite helper runs. See usePgliteDb.
    if (resetPerTest) resetPlan = await buildResetPlan(admin);
  }, options.timeoutMs);

  afterEach(async () => {
    if (resetPerTest && admin !== undefined && resetPlan !== undefined)
      await applyReset(admin, resetPlan);
  });

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
