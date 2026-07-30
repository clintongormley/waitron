import { sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { stampDeployment, type Database } from "@waitron/db";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { quoteIdent } from "./identifiers.js";
import type { InstanceAction } from "./instance-plan.js";
import "./errors.js";

export interface ApplyDeps {
  /** The admin connection: CREATEDB and CREATEROLE, connected to any database in the cluster. */
  admin: Database;
  /** The TARGET database's name. Carried here rather than read off a `create-database` action,
   * which is absent on every run after the first. */
  database: string;
  /** The admin connection STRING, used to compose the migrator's — `applyMigrations` opens its own
   * connection because its advisory lock is session-scoped and a pool would take it on one backend
   * and release it on another. */
  adminUri: string;
  /** `null` means "running from source"; otherwise the folder `copy-migrations.mjs` produced. */
  migrationsRoot: string | null;
  /** Opens a connection to the TARGET database. Called lazily, after `create-database` has run —
   * on a first provision there is nothing to connect to until then. */
  openTarget(): Promise<Database>;
}

/**
 * Executes one plan, in order.
 *
 * NOT one transaction, and it cannot be: PostgreSQL refuses `CREATE DATABASE` inside a transaction
 * block. Verified directly, on the same `postgres:18-alpine` image this package's tests run
 * against: `BEGIN; CREATE DATABASE probe_db; COMMIT;` over `psql` raised
 * `ERROR: CREATE DATABASE cannot run inside a transaction block`. `applyMigrations` separately opens
 * transactions of its own via Drizzle's migrator, which could not run inside a transaction this
 * function held open either. A partial application is therefore possible — which is exactly why the
 * planner is idempotent and the CLI re-reads state on every run rather than tracking progress in a
 * file (spec §3: no configuration file, as input or as state).
 */
export async function applyInstance(
  actions: readonly InstanceAction[],
  deps: ApplyDeps,
): Promise<void> {
  let target: Database | null = null;
  try {
    for (const action of actions) {
      switch (action.kind) {
        case "create-database":
          await deps.admin.execute(sql.raw(`create database ${quoteIdent(action.database)}`));
          break;
        case "create-role": {
          const attributes = ["login", ...(action.createRole ? ["createrole"] : [])].join(" ");
          const memberships =
            action.memberOf.length > 0
              ? ` in role ${action.memberOf.map(quoteIdent).join(", ")}`
              : "";
          // The password is a generated `[A-Za-z0-9_-]{32}` (identifiers.ts) — no quote, no
          // backslash — which is what makes this literal safe without an escape pass. There is no
          // operator-supplied password path anywhere in this package, deliberately.
          try {
            await deps.admin.execute(
              sql.raw(
                `create role ${quoteIdent(action.role)} ${attributes} password '${action.password}'${memberships}`,
              ),
            );
          } catch {
            // The statement above embeds the generated password in its literal text, and BOTH
            // Drizzle's own wrapped failure (`Failed query: create role ... password '<generated>'
            // ...`) and Postgres's own error message quote that statement back verbatim — verified
            // directly: the RED transcript for this exact catch, before it existed, was
            // `Failed query: create role "waitron_migrator" ... password 'wM52o1bF...' in role
            // "app_user"`, caused by `error: role "app_user" does not exist`. A caller that logs or
            // prints a caught error verbatim (this package's own `errors.ts` doc comment names the
            // shape a future CLI uses: `${error.code} ${JSON.stringify(error.params)}`) would put a
            // credential into a terminal or a log file.
            //
            // The original error is deliberately NOT attached as `cause`: Node's default console
            // formatting recurses into `.cause`, which would leak the same text one level down.
            // `role` is the only detail worth keeping — it identifies WHICH create-role action
            // failed without saying why, the same trade `packages/credentials/src/cipher.ts`'s
            // `open()` makes when it discards a raw crypto error for an analogous reason.
            throw new AppError("provisioning.role_creation_failed", { role: action.role });
          }
          break;
        }
        case "grant-membership":
          await deps.admin.execute(
            sql.raw(`grant ${quoteIdent(action.of)} to ${quoteIdent(action.role)}`),
          );
          break;
        case "grant-database-create":
          await deps.admin.execute(
            sql.raw(
              `grant create on database ${quoteIdent(action.database)} to ${quoteIdent(action.role)}`,
            ),
          );
          break;
        case "grant-schema-create": {
          // Schema-level grants are inside the target database, not the admin's own — `public`
          // is per-database. This is the first action that needs the target connection, and on a
          // first provision it is also the first moment one can exist.
          target ??= await deps.openTarget();
          const option = action.withGrantOption ? " with grant option" : "";
          await target.execute(
            sql.raw(`grant create on schema public to ${quoteIdent(action.role)}${option}`),
          );
          break;
        }
        case "migrate":
          // Over the ADMIN string against the target database, not the migrator role's: on a
          // first provision `waitron_migrator` was created seconds ago and this tool holds its
          // password only in memory — composing a URL from it here would be the one place a
          // generated password travels somewhere it need not.
          //
          // `ApplyDeps.admin`'s own contract is CREATEDB + CREATEROLE (this file's doc comment;
          // spec table, "an admin connection with CREATEDB and CREATEROLE"), not superuser — and on
          // a first provision `admin` is also the very connection that just ran `create-database`
          // above, which makes it that database's OWNER. Verified directly against a throwaway
          // `postgres:18-alpine` container: a role created with only `login createdb createrole`,
          // with no further grant, created a database as itself and then created a table in that
          // database's `public` schema without error — ownership of the database is enough,
          // independent of any grant this file issues. That is what lets the migrations below
          // (CREATE TABLE, CREATE ROLE for `app_user`/`tenant_provisioner`, etc.) run directly over
          // this connection. A re-run against a database `admin` did NOT create is a narrower case
          // this comment does not cover.
          //
          // The database name comes from `deps`, NOT from a `create-database` action in the list:
          // on a re-run that action is absent (the database already exists) while `migrate` can
          // still be present, so deriving it from the actions would fail exactly when the tool is
          // being used idempotently.
          await applyMigrations(
            withDatabase(deps.adminUri, deps.database),
            migrationOptionsFor(manifestSets(), deps.migrationsRoot),
          );
          break;
        case "stamp":
          target ??= await deps.openTarget();
          // `stampDeployment`, not a raw INSERT: it refuses a DIFFERENT value rather than
          // overwriting it, which is the second of two independent guards against a host meeting
          // the wrong database (the planner's is the first).
          await stampDeployment(target, action.environment);
          break;
      }
    }
  } finally {
    await target?.close();
  }
}

function withDatabase(uri: string, database: string): string {
  const u = new URL(uri);
  u.pathname = `/${database}`;
  return u.toString();
}
