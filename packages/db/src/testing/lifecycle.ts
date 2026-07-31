import { sql } from "drizzle-orm";
import { afterAll, beforeAll } from "vitest";
import { createPgliteDb, type Database } from "../client.js";
import { runMigrations, type MigrationOptions } from "../migrate.js";
import type { RealPostgres } from "./postgres.js";

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

export interface ProbeRole {
  name: string;
  password: string;
  inRole?: string;
}

/** Conservative, and deliberately narrower than SQL allows: what a test fixture actually uses. */
const SAFE_TOKEN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The `create role` a probing suite needs. Extracted so both branches are testable without a
 * container — the alternative is a Docker-gated test for one string.
 *
 * **Validates rather than escapes**, unlike `packages/provisioning/src/identifiers.ts`, which quotes
 * because it handles generated passwords and operator-supplied names. Here every value is a literal
 * in a test fixture, so a token that needs escaping is a mistake worth failing on rather than
 * accommodating. That package's `quoteIdent`/`quoteLiteral` are not reused because `@waitron/db`
 * cannot depend on `@waitron/provisioning` — the dependency runs the other way — and copying them
 * would make a fourth divergent copy of a helper this repo has already had trouble keeping in sync.
 *
 * The point is the same one that file makes: these fields are typed plain `string` on an exported
 * interface, so "callers only pass safe values" was a property of the callers, not of the code.
 */
export function probeRoleStatement(probe: ProbeRole): string {
  for (const [field, value] of [
    ["name", probe.name],
    ["password", probe.password],
    ["inRole", probe.inRole],
  ] as const) {
    if (value !== undefined && !SAFE_TOKEN.test(value)) {
      throw new Error(`probeRoleStatement: unsafe ${field} ${JSON.stringify(value)}`);
    }
  }
  const inRole = probe.inRole === undefined ? "" : ` in role ${probe.inRole}`;
  return `create role ${probe.name} login password '${probe.password}'${inRole}`;
}

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
