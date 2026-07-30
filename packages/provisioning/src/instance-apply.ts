import { sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { stampDeployment, type Database } from "@waitron/db";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { quoteIdent } from "./identifiers.js";
import { sqlStateOf } from "./sql-state.js";
import { describeAction, type InstanceAction } from "./instance-plan.js";
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
            await deps.admin.execute(
              sql.raw(`grant ${quoteIdent(action.memberOf)} to ${quoteIdent(action.role)}`),
            );
          } catch (error) {
            // Caught for DIAGNOSABILITY, not for secrecy — unlike `create-role` above, this
            // statement embeds nothing sensitive. Without it the driver's own error escaped
            // `applyInstance` raw, and the likeliest one is not a bug in this tool: an admin
            // holding `login createdb createrole` that did NOT itself create `app_user` holds no
            // ADMIN OPTION on it, and PostgreSQL refuses with `permission denied to grant role
            // "app_user"`. Verified against a real `postgres:18-alpine` container, not reasoned
            // about — see `instance-apply.rls.test.ts`'s "refuses a membership grant the admin
            // holds no ADMIN OPTION for", which pins the 42501 this branch reports. The remedy is
            // in `packages/provisioning/README.md`.
            throw new AppError("provisioning.membership_grant_failed", {
              role: action.role,
              memberOf: action.memberOf,
              sqlState: sqlStateOf(error),
            });
          }
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
          await target.db.execute(
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
          await stampDeployment(target.db, action.environment);
          break;
      }
    }

    // Every statement above "succeeded". That is not the same as every privilege being present —
    // see `verifyGrants`.
    target = await verifyGrants(actions, deps, target);
  } finally {
    // Exactly once, and only if something above acquired one. Whether that CLOSES the handle is
    // the provider's decision — see `TargetConnection`.
    await target?.release();
  }
}

/**
 * Reads the ACLs back and refuses if a grant did not actually take.
 *
 * **Why this exists.** An object-privilege `GRANT` that grants nothing is not always an error. When
 * the grantor holds SOME privilege on the object but no grant option, PostgreSQL answers with a
 * WARNING: the command tag is still `GRANT`, and the driver resolves. Reproduced on
 * `postgres:18-alpine` (PostgreSQL 18.4) — a non-owning `login createdb createrole` admin ran
 * `grant create on database acl_db to r_app` and got
 * `WARNING: no privileges were granted for "acl_db"` followed by the tag `GRANT`, with no `r_app`
 * entry in `datacl` afterwards. That is the ordinary shape here rather than an exotic one: `PUBLIC`
 * holds `CONNECT` on every database by default, so an admin is in the warning case unless someone
 * has revoked it (with `revoke all on database acl_db from public` first, the same statement
 * instead raised `ERROR: 42501: permission denied for database acl_db`). Two quieter variants exist
 * — a partly-grantable list warns `not all privileges were granted` while still landing the
 * grantable part, and `GRANT ALL PRIVILEGES` in that same situation emits no diagnostic at all.
 * Without this check, `instance` reports success and leaves a deployment whose migrator cannot
 * migrate at the next boot.
 *
 * **Why it reads the ACL DIRECTLY rather than calling `has_database_privilege`.** The objection
 * `instance-plan.ts` records against reading grants back is specifically about FALSE POSITIVES via
 * the recursive closure: `has_*_privilege` answers for everything the role can reach, so a role
 * holding CREATE only through a group reads as satisfied when the direct grant is absent —
 * measured on the same image, `has_database_privilege('r_direct','acl_db2','CREATE')` was `t` while
 * `aclexplode(datacl)` held zero entries naming `r_direct`. An ACL entry has no closure to walk:
 * `pg_database.datacl` and `pg_namespace.nspacl` list the grants that were literally made, and
 * nothing else. That is the whole reason, and it is a claim about the CLOSURE, not about the grant
 * option — `has_database_privilege(…, 'CREATE WITH GRANT OPTION')`, `has_table_privilege`,
 * `has_schema_privilege` and `pg_has_role(…, 'MEMBER WITH ADMIN OPTION')` all report the option
 * correctly, and an earlier version of this comment wrongly said they could not.
 *
 * **The membership check is belt-and-braces, and the object checks are not.** A role-membership
 * `GRANT` without ADMIN OPTION genuinely ERRORS (42501, pinned in `instance-apply.rls.test.ts`), so
 * `grant-membership` already fails loudly. Only the object-privilege grants have the silent path.
 * The membership is verified anyway because a revoke racing this run would otherwise pass unnoticed,
 * but it is not the reason this function exists.
 *
 * Returns the target connection so the caller releases anything this function acquired — that is
 * what keeps `applyInstance`'s single `release()` matched to its single `openTarget()`. Today the
 * returned handle is always the one it was GIVEN, never a fresh acquisition, and the previous
 * version of this sentence claimed otherwise ("this may be the first thing to need one, on a plan
 * whose only actions are database-level grants"). It cannot be: database-level verification reads
 * `pg_database` over `deps.admin`, and the only branch that wants a target is guarded by
 * `schemaGrants.length > 0`, which implies the main loop's own `grant-schema-create` case already
 * acquired one. The `??=` below is therefore unreachable today and is kept only because TypeScript
 * cannot see that invariant — not because a caller is expected to hit it.
 */
async function verifyGrants(
  actions: readonly InstanceAction[],
  deps: ApplyDeps,
  open: TargetConnection | null,
): Promise<TargetConnection | null> {
  let target = open;
  const missing: string[] = [];

  const databaseGrants = actions.filter((action) => action.kind === "grant-database-create");
  if (databaseGrants.length > 0) {
    // `coalesce`: `datacl` is NULL on a database nobody has granted anything on, which is a
    // perfectly ordinary state and not an error to read.
    const rows = await deps.admin.execute<{ acl: string[] }>(
      sql`select coalesce(datacl::text[], '{}'::text[]) as acl
          from pg_database where datname = ${deps.database}`,
    );
    const acl = rows.rows[0]?.acl ?? [];
    for (const action of databaseGrants) {
      if (!aclHas(acl, action.role, "C", false)) {
        missing.push(describeAction(action));
      }
    }
  }

  const schemaGrants = actions.filter((action) => action.kind === "grant-schema-create");
  if (schemaGrants.length > 0) {
    target ??= await deps.openTarget();
    const rows = await target.db.execute<{ acl: string[] }>(
      sql`select coalesce(nspacl::text[], '{}'::text[]) as acl
          from pg_namespace where nspname = 'public'`,
    );
    const acl = rows.rows[0]?.acl ?? [];
    for (const action of schemaGrants) {
      if (!aclHas(acl, action.role, "C", action.withGrantOption)) {
        missing.push(describeAction(action));
      }
    }
  }

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
  return target;
}

/**
 * Whether an ACL array carries `privilege` for `role`, directly.
 *
 * An ACL item is `<grantee>=<privileges>/<grantor>` — e.g. `r_mig=C/owner_a`, and with WITH GRANT
 * OPTION the privileges read `C*` instead of `C` (grantor `pg_database_owner` for `public`). Both
 * were read off a real container. A `*` immediately after a privilege letter is that option;
 * `instance-apply.rls.test.ts` already pins the same encoding for `nspacl`.
 *
 * A grantee of PUBLIC has an EMPTY left-hand side (`=Tc/owner_a`), so matching on `${role}=` cannot
 * collide with it. Role names here are `^[a-z][a-z0-9_]{0,62}$` (identifiers.ts), which PostgreSQL
 * never quotes in an ACL, so no unquoting pass is needed.
 *
 * EVERY matching entry is examined, not the first. One grantee gets one entry PER GRANTOR, and this
 * function returned a false NEGATIVE while it used `find`: read off a real container, `owner_a`
 * granting CONNECT to `r_y` and then `r_mig` granting CREATE produced
 * `{…,r_y=c/owner_a,r_y=C/r_mig}`, and inspecting only `r_y=c/owner_a` reported CREATE missing
 * while `has_database_privilege('r_y','acl_db','CREATE')` was `t`. That is a spurious refusal of a
 * working deployment — worse than the silent gap this check exists to close, by this function's own
 * justification. A second grantor arises exactly where `README.md` says it does: WITH GRANT OPTION
 * delegation, the same path that lets a non-owning admin issue these grants at all.
 */
function aclHas(acl: readonly string[], role: string, privilege: string, grantOption: boolean) {
  return acl
    .filter((item) => item.startsWith(`${role}=`))
    .some((entry) => {
      const granted = entry.slice(role.length + 1).split("/")[0] ?? "";
      const at = granted.indexOf(privilege);
      if (at === -1) return false;
      return !grantOption || granted[at + 1] === "*";
    });
}

/**
 * The same connection string, pointed at a different database on the same cluster.
 *
 * Exported because `cli.ts` needs the identical transformation to open the TARGET connection
 * `readInstanceState` reads through, and a second copy of four lines that decide which database a
 * migration runs against is not four lines worth saving. Every other component of the URI —
 * credentials, host, port, query parameters such as `sslmode` — is carried through untouched.
 *
 * **`uri` must be one `new URL` can parse**, and `cli.ts`'s `resolveAdminUri` is what guarantees
 * that for every caller here: `pg` accepts forms `new URL` rejects — a Unix-socket directory path
 * such as `/var/run/postgresql` is one it genuinely CONNECTS with — and this function threw a bare
 * `TypeError` at them. The refusal lives at the one place the string enters the tool rather than
 * here, so no caller has to remember it and `applyInstance` cannot fail half-way through a plan for
 * a reason the plan summary could have caught.
 */
export function withDatabase(uri: string, database: string): string {
  const u = new URL(uri);
  u.pathname = `/${database}`;
  return u.toString();
}
