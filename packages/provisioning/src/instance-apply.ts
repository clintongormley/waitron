import { sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { stampDeployment, type Database } from "@waitron/db";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { quoteIdent, quoteLiteral, withRole } from "./identifiers.js";
import { sqlStateOf } from "./sql-state.js";
import { describeAction, type InstanceAction } from "./instance-plan.js";
import { INSTANCE_MIGRATOR_ROLE } from "./instance-state.js";
import "./errors.js";

/**
 * A connection to the TARGET database, together with the one call that gives it back.
 *
 * `release` exists so that OWNERSHIP is the provider's to state rather than this file's to assume.
 * `applyInstance` used to `close()` whatever `openTarget` returned, which forced `cli.ts` to dial a
 * SECOND connection to a database it already had open — `withState` opens one to read the
 * deployment's state on every re-run, and `createPostgresDb` does a real connect-and-release up
 * front, so that was a genuine TCP connect and auth handshake per run, not a cheap object. The
 * alternative, sharing the handle and letting both close it, is worse: `pg` errors on a pool closed
 * twice.
 *
 * The contract is exactly: `applyInstance` calls `release()` once, if and only if it called
 * `openTarget()`. A provider that OWNS the handle closes it there (the container suites do); a
 * provider that is LENDING one it closes elsewhere makes `release` a no-op (`cli.ts` does, because
 * `withState`'s `finally` is the single place its connections die).
 */
export interface TargetConnection {
  db: Database;
  release(): Promise<void>;
}

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
  /** Obtains a connection to the TARGET database. Called lazily and AT MOST ONCE, after
   * `create-database` has run — on a first provision there is nothing to connect to until then.
   * It need not be a new connection: see `TargetConnection` for who closes it. */
  openTarget(): Promise<TargetConnection>;
}

/**
 * Executes one plan, in order.
 *
 * NOT one transaction, and it cannot be: PostgreSQL refuses `CREATE DATABASE` inside a transaction
 * block. Verified directly, on the same `postgres:18-alpine` image this package's tests run
 * against: `BEGIN; CREATE DATABASE probe_db; COMMIT;` over `psql` raised
 * `ERROR: CREATE DATABASE cannot run inside a transaction block`. A partial application is
 * therefore possible — which is exactly why the planner is idempotent and the CLI re-reads state
 * on every run rather than tracking progress in a file (spec §3: no configuration file, as input or
 * as state).
 */
export async function applyInstance(
  actions: readonly InstanceAction[],
  deps: ApplyDeps,
): Promise<void> {
  let target: TargetConnection | null = null;
  try {
    for (const action of actions) {
      switch (action.kind) {
        case "create-database":
          // `OWNER waitron_migrator`: the migrator owns the database and therefore every table the
          // migration creates in it (it runs AS the migrator, below), which is what native logical
          // replication's `CREATE PUBLICATION … FOR TABLE` requires. `CREATE DATABASE` is a utility
          // statement that will not bind, so the owner is quoted, not parameterised.
          await deps.admin.execute(
            sql.raw(
              `create database ${quoteIdent(action.database)} owner ${quoteIdent(action.owner)}`,
            ),
          );
          break;
        case "create-role": {
          const attributes = ["login", ...(action.createRole ? ["createrole"] : [])].join(" ");
          const memberships =
            action.memberOf.length > 0
              ? ` in role ${action.memberOf.map(quoteIdent).join(", ")}`
              : "";
          // The password goes through `quoteLiteral`, not straight into `'…'`. For every password
          // this tool generates that changes nothing — base64url is `[A-Za-z0-9_-]{32}`
          // (identifiers.ts), no quote and no backslash, so the emitted SQL is byte-identical to
          // what it was. It is there because `applyInstance` and `InstanceAction` are EXPORTED
          // (`index.ts`) and `password` is typed `string`: the old safety was a property of one
          // caller rather than of the code, and this package's own `instance-apply.pg.test.ts`
          // already passes a hand-written password down this path. `CREATE ROLE` is a utility
          // statement and takes no bind parameters, so building the literal is the only option and
          // escaping it is the whole defence.
          const createRoleSql = `create role ${quoteIdent(action.role)} ${attributes} password ${quoteLiteral(action.password)}${memberships}`;
          try {
            if (action.role === INSTANCE_MIGRATOR_ROLE) {
              // The migrator is created by the ADMIN, in ONE transaction with
              // `createrole_self_grant = 'set'` — the GUC is session-scoped, and a pooled,
              // un-transacted `SET` lands on a different backend than the `CREATE ROLE`, so the admin
              // would get no SET-membership on the role it just made and could not later migrate AS
              // it (C3/probe A). `CREATE ROLE` is legal inside a transaction block (unlike `CREATE
              // DATABASE`), so the two share one.
              await deps.admin.transaction(async (tx) => {
                await tx.execute(sql.raw(`set local createrole_self_grant = 'set'`));
                await tx.execute(sql.raw(createRoleSql));
              });
            } else {
              // Every OTHER role is created BY the migrator, inside its own database (the target
              // connection carries `options=-c role=waitron_migrator`), so the new role is
              // migrator-created and the migrator holds ADMIN OPTION on its `IN ROLE` memberships.
              target ??= await deps.openTarget();
              await target.db.execute(sql.raw(createRoleSql));
            }
          } catch (error) {
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
            // The same trade `packages/credentials/src/cipher.ts`'s `open()` makes when it
            // discards a raw crypto error for an analogous reason.
            //
            // `role` alone was ALL that survived until now, and that cost the operator the one
            // thing they needed next: 42710 ("already exists"), 42704 ("the membership target does
            // not exist") and 42501 ("this admin may not") want three different responses and read
            // identically without the code. `sqlStateOf` is what makes keeping it safe — see its
            // own comment for why five characters of `[0-9A-Z]` cannot be the password this catch
            // exists to withhold.
            throw new AppError("provisioning.role_creation_failed", {
              role: action.role,
              sqlState: sqlStateOf(error),
            });
          }
          break;
        }
        case "grant-membership":
          try {
            // Run AS the migrator on the TARGET connection: the migrator created app_user (the
            // migration ran as it) and is the only role holding ADMIN OPTION on it, so it is the
            // grantor. Caught for DIAGNOSABILITY — this statement embeds nothing sensitive — so a
            // grantor without ADMIN OPTION (42501) surfaces as a code rather than a raw driver error.
            target ??= await deps.openTarget();
            await target.db.execute(
              sql.raw(`grant ${quoteIdent(action.memberOf)} to ${quoteIdent(action.role)}`),
            );
          } catch (error) {
            throw new AppError("provisioning.membership_grant_failed", {
              role: action.role,
              memberOf: action.memberOf,
              sqlState: sqlStateOf(error),
            });
          }
          break;
        case "migrate":
          // Migrate AS the migrator, via the session role option on the admin's own connection
          // string (`withRole`) — the admin's credentials, the migrator's identity — so every table
          // the migration creates is owned by `waitron_migrator`, which native logical replication
          // requires. No migrator PASSWORD is used (a re-run has none): probe A confirmed the admin
          // that created the migrator with `createrole_self_grant = 'set'` can `SET ROLE` to it.
          //
          // The database name comes from `deps`, NOT from a `create-database` action in the list: on
          // a re-run that action is absent while `migrate` is present, so deriving it from the
          // actions would fail exactly when the tool is used idempotently.
          await applyMigrations(
            withRole(withDatabase(deps.adminUri, deps.database), INSTANCE_MIGRATOR_ROLE),
            migrationOptionsFor(manifestSets(), deps.migrationsRoot),
          );
          break;
        case "stamp":
          target ??= await deps.openTarget();
          // `stampDeployment`, not a raw INSERT: it refuses a DIFFERENT value rather than
          // overwriting it, which is the second of two independent guards against a host meeting
          // the wrong database (the planner's is the first).
          await stampDeployment(target.db, action.environment);
          break;
      }
    }

    // Every statement above "succeeded". That is not the same as the migrator actually owning the
    // database, nor a membership actually landing — see `verifyGrants`.
    await verifyGrants(actions, deps);
  } finally {
    // Exactly once, and only if something above acquired one. Whether that CLOSES the handle is
    // the provider's decision — see `TargetConnection`.
    await target?.release();
  }
}

/**
 * Confirms, after a plan runs, that the migrator OWNS the database and that every membership grant
 * actually landed.
 *
 * **The ownership check is the whole point of the swap.** Native logical replication needs
 * `waitron_migrator` to own every published table; this tool arranges that by creating the database
 * `OWNER waitron_migrator` and migrating AS the migrator. Read `pg_database.datdba` back rather than
 * trusting those statements ran: a database that ends up owned by anyone else is exactly the failure
 * this catches (`provisioning.database_not_owned`). Ownership is a FACT — `datdba`, one row, no
 * closure to walk — unlike a `has_*` privilege, so the recursive-closure false positive
 * `instance-plan.ts` records against reading grants back does not apply. Keyed on the plan carrying
 * `migrate`, which every real plan does (a create-database is always followed by one) — so a
 * synthetic grant-only plan reads nothing, and the database, which may not be readable until it is
 * migrated, is not probed before it exists.
 *
 * **The membership check is belt-and-braces.** A role-membership `GRANT` without ADMIN OPTION
 * genuinely ERRORS (42501, pinned in `instance-apply.pg.test.ts`), so `grant-membership` already
 * fails loudly in the main loop; this catches a revoke racing the run. `provisioning.grant_ineffective`
 * names each absent membership in the plan-summary words (`describeAction`), the same code and the
 * same class of value it always carried.
 *
 * Reads everything over `deps.admin` — `pg_database` and `pg_auth_members` are cluster-global — so it
 * opens no target and the release contract stays `applyInstance`'s single `openTarget`/`release`.
 */
async function verifyGrants(actions: readonly InstanceAction[], deps: ApplyDeps): Promise<void> {
  if (actions.some((action) => action.kind === "migrate")) {
    const rows = await deps.admin.execute<{ owner: string | null }>(
      sql`select pg_get_userbyid(datdba) as owner from pg_database where datname = ${deps.database}`,
    );
    const owner = rows.rows[0]?.owner ?? null;
    if (owner !== INSTANCE_MIGRATOR_ROLE) {
      throw new AppError("provisioning.database_not_owned", { database: deps.database, owner });
    }
  }

  const missing: string[] = [];
  for (const action of actions) {
    if (action.kind !== "grant-membership") continue;
    const rows = await deps.admin.execute<{ present: boolean }>(
      sql`select exists (
            select 1 from pg_auth_members m
            join pg_roles member on member.oid = m.member
            join pg_roles granted on granted.oid = m.roleid
            where member.rolname = ${action.role} and granted.rolname = ${action.memberOf}
          ) as present`,
    );
    if (rows.rows[0]?.present !== true) {
      missing.push(describeAction(action));
    }
  }

  if (missing.length > 0) {
    throw new AppError("provisioning.grant_ineffective", { database: deps.database, missing });
  }
}

/**
 * The same connection string, pointed at a different database on the same cluster.
 *
 * Exported because `cli.ts` needs the identical transformation to open the TARGET connection
 * `readInstanceState` reads through, and a second copy of four lines that decide which database a
 * migration runs against is not four lines worth saving. Every other component of the URI —
 * credentials, host, port, query parameters such as `sslmode` — is carried through untouched.
 *
 * **`uri` must be one `new URL` can parse**, and a bare `TypeError` is what a caller gets otherwise:
 * `pg` accepts forms `new URL` rejects — a Unix-socket directory path such as `/var/run/postgresql`
 * is one it genuinely CONNECTS with. Each caller guards its own entry point rather than this
 * function doing it, so `applyInstance` cannot fail half-way through a plan for a reason the plan
 * summary could have caught. `cli.ts`'s `resolveAdminUri` is that guard for the CLI;
 * `apps/server`'s `ensureInstance` is a second caller, whose bootstrap URL is the entrypoint's to
 * validate before it gets here.
 */
export function withDatabase(uri: string, database: string): string {
  const u = new URL(uri);
  u.pathname = `/${database}`;
  return u.toString();
}
