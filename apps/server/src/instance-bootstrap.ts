import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { createPostgresDb, type Database } from "@waitron/db";
import {
  INSTANCE_MIGRATOR_ROLE,
  applyInstance,
  planInstance,
  readInstanceState,
  withDatabase,
  withRole,
  type InstanceAction,
} from "@waitron/provisioning";
import { formatEnvFile, parseEnvFile } from "./env-file.js";
import { writeFileAtomic } from "./fs-atomic.js";
import type { Logger } from "./logger.js";
import "./errors.js";

export interface InstanceUrls {
  databaseUrl: string;
  migrationsDatabaseUrl: string;
}

/**
 * The actions the ENTRYPOINT owns.
 *
 * `stamp` is the WIZARD's: `stampDeployment` is permanent and one-way, so a default stamp here
 * would leave a box that can never be provisioned as production (CLAUDE.md §5).
 *
 * `migrate` is not in the set but is not unconditionally dropped either — see `ensureInstance`.
 */
const OWNED: ReadonlySet<InstanceAction["kind"]> = new Set<InstanceAction["kind"]>([
  "create-database",
  "create-role",
  "grant-membership",
]);

/** The role the core migration mints (`packages/db/drizzle/0001_db_baseline_sql.sql`), and the one
 * every later action in the plan depends on. Its absence is what "this cluster is virgin" means
 * here — narrower and more checkable than journal presence, whose ambiguity `instance-plan.ts`
 * records as having caused a real bug. */
const APP_USER = "app_user";

/** Compose `<base>` with a different user, password and database — the two login URLs are the
 *  bootstrap URL's host/port with the generated credentials substituted. */
function urlFor(bootstrapUrl: string, user: string, password: string, database: string): string {
  const url = new URL(bootstrapUrl);
  // Assigned RAW: the URL setters percent-encode already, so encoding here would double-encode and
  // `passwordFrom` would read a still-encoded password back and re-encode it. A generated password
  // is base64url (`[A-Za-z0-9_-]`), which the setters leave byte-identical, so the round trip is
  // the identity.
  url.username = user;
  url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}

async function roleExists(admin: Database, role: string): Promise<boolean> {
  const rows = await admin.execute<{ present: boolean }>(
    sql`select exists (select 1 from pg_roles where rolname = ${role}) as present`,
  );
  return rows.rows[0]?.present === true;
}

/** A password is recoverable only from the `create-role` action that generated it, or from a
 * previous run's `instance.env`. A role that already exists carries a password this process never
 * saw, and returning a guess would hand the server a URL that cannot authenticate. */
function unrecoverable(variable: string): AppError {
  return new AppError("server.config_invalid", {
    variable,
    reason: "instance_password_unrecoverable",
  });
}

function passwordFrom(savedUrl: string | undefined, variable: string): string {
  if (savedUrl === undefined || savedUrl === "") throw unrecoverable(variable);
  return new URL(savedUrl).password;
}

/** A previous run's credentials, or nothing on the first start — an absent, unreadable or malformed
 * file is the same case as "no previous run", and every value it should carry is checked at use. */
async function readSaved(envPath: string): Promise<Record<string, string>> {
  try {
    return parseEnvFile(await readFile(envPath, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Bring the cluster to the shape a Waitron node needs — the database owned by `waitron_migrator` and
 * the two login roles — and persist the generated credentials.
 *
 * Safe to re-run on every container start: `planInstance` emits only what is missing, so a
 * wiped-and-rejoined box (roles are cluster-global, the database was dropped) plans exactly one
 * `create-database`.
 */
export async function ensureInstance(opts: {
  bootstrapUrl: string;
  database: string;
  stateDir: string;
  log: Logger;
  /** Where the migration sets live. `null` means "running from source"; inside the server bundle
   * every set resolves to a folder that does not exist, so a caller running from `dist/` passes the
   * folder `scripts/copy-migrations.mjs` produced — the same value `boot.ts` takes from
   * `WAITRON_MIGRATIONS_DIR`. Only the virgin-cluster migrate below reads it, which is the FIRST
   * boot of a real box, so REQUIRED rather than defaulted: `null` is precisely the value that fails
   * there, and a required field makes `tsc` catch a forgetful caller instead of the box. */
  migrationsRoot: string | null;
}): Promise<InstanceUrls> {
  const envPath = join(opts.stateDir, "instance.env");
  const saved = await readSaved(envPath);

  // The target is reached AS THE MIGRATOR: without the role option `applyInstance`'s `create-role`
  // and `grant-membership` would run as the admin, which is not the grantor holding ADMIN OPTION on
  // `app_user`. `withDatabase(uri, database)` returns a connection STRING, not a scope.
  const targetUri = withRole(
    withDatabase(opts.bootstrapUrl, opts.database),
    INSTANCE_MIGRATOR_ROLE,
  );

  const admin = await createPostgresDb(opts.bootstrapUrl);
  let target: Database | null = null;
  try {
    // TWO-PHASE, as `cli.ts`'s `withState` does it: `readInstanceState`'s `target` is a connection
    // to the target database, and on a first provision there is none to open. This is also the ONE
    // place a target connection is opened — `applyInstance` borrows it and the `finally` below
    // closes it, so ownership is stated once.
    const probe = await readInstanceState(admin, opts.database, null);
    if (probe.databaseExists) target = await createPostgresDb(targetUri);
    const state = target === null ? probe : await readInstanceState(admin, opts.database, target);

    // Read from the database, never guessed: `planInstance` REFUSES up front when the existing
    // stamp disagrees with the requested environment, so a wrong value here fails every future boot
    // of an already-stamped box, not just the first. `WAITRON_ENV` is deliberately not consulted —
    // the database's own stamp is the authority (CLAUDE.md §5).
    const environment = state.inside?.stamp ?? "preproduction";

    // `migrate` survives the filter ONLY on a cluster with no `app_user`, and both extremes are
    // broken. Dropping it always bricks a VIRGIN box: `planInstance` emits `migrate` before the
    // `grant-membership waitron_migrator → app_user` and the `create-role waitron_app … IN ROLE
    // app_user` that need the role the core migration mints, so they fail `role "app_user" does not
    // exist`. Applying it always is wrong too: `applyInstance`'s migrate runs the FULL manifest, so
    // it would migrate modules the operator disabled — which `boot.ts`'s trading branch, filtering
    // on the enabled set, deliberately does not.
    const appUserExists = await roleExists(admin, APP_USER);
    const actions = planInstance(state, { database: opts.database, environment }).filter(
      (action) => OWNED.has(action.kind) || (action.kind === "migrate" && !appUserExists),
    );

    if (actions.length > 0) {
      opts.log("info", "instance.bootstrap_applying", { actions: actions.length });
      await applyInstance(actions, {
        admin,
        database: opts.database,
        adminUri: opts.bootstrapUrl,
        migrationsRoot: opts.migrationsRoot,
        openTarget: async () => {
          target ??= await createPostgresDb(targetUri);
          return { db: target, release: async () => {} };
        },
      });
    }

    // Passwords are recoverable only off the actions that generated them — the CLI prints them for
    // the same reason. A role that already existed keeps whatever `instance.env` holds.
    const created = new Map(
      actions.filter((a) => a.kind === "create-role").map((a) => [a.role, a.password] as const),
    );
    const appPassword =
      created.get("waitron_app") ?? passwordFrom(saved.DATABASE_URL, "DATABASE_URL");
    const migratorPassword =
      created.get(INSTANCE_MIGRATOR_ROLE) ??
      passwordFrom(saved.WAITRON_MIGRATIONS_DATABASE_URL, "WAITRON_MIGRATIONS_DATABASE_URL");

    const urls: InstanceUrls = {
      databaseUrl: urlFor(opts.bootstrapUrl, "waitron_app", appPassword, opts.database),
      migrationsDatabaseUrl: urlFor(
        opts.bootstrapUrl,
        INSTANCE_MIGRATOR_ROLE,
        migratorPassword,
        opts.database,
      ),
    };
    await writeFileAtomic(
      envPath,
      formatEnvFile({
        DATABASE_URL: urls.databaseUrl,
        WAITRON_MIGRATIONS_DATABASE_URL: urls.migrationsDatabaseUrl,
      }),
      0o600,
    );
    return urls;
  } finally {
    // Nested so a failure closing the target cannot skip closing the admin connection: both are
    // pools, and leaking either keeps the process alive.
    try {
      await target?.close();
    } finally {
      await admin.close();
    }
  }
}
