// Real PostgreSQL: proves `instance` migrates AS the migrator so waitron_migrator owns every table,
// the SET-ROLE refusal a non-creating admin hits, ownership refusals, and the ownership boundary
// that makes the target connection carry the role option.
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { isAppError } from "@waitron/shared";
import { createPostgresDb, readDeploymentEnvironment, type Database } from "@waitron/db";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { runCli, type CliDeps } from "./cli.js";
import { quoteIdent, withRole } from "./identifiers.js";
import { applyInstance, withDatabase, type ApplyDeps } from "./instance-apply.js";
import type { InstanceAction } from "./instance-plan.js";
import { planInstance } from "./instance-plan.js";
import { readInstanceState } from "./instance-state.js";
import { readTenantIdentities } from "./tenant-guard.js";
import { applyVenue } from "./venue-apply.js";
import { sqlStateOf } from "./sql-state.js";
import { roleUrl, startBarePostgres, type RealPostgres } from "./testing/postgres.js";

const DATABASE = "waitron_instance_suite";

describe("applyInstance against a blank container", () => {
  let pg: RealPostgres;
  /** The container's own default superuser. Used ONLY to mint `admin` below, never as `ApplyDeps.admin`. */
  let superuser: Database;
  /**
   * A NON-SUPERUSER admin: exactly `login createdb createrole`, no `SUPERUSER` —
   * the privilege `docs/superpowers/specs/2026-07-29-provisioning-tool-design.md` §2 says this
   * command needs, and no more. The whole blank-cluster flow runs as this role.
   */
  let admin: Database;
  let adminUri: string;

  /**
   * `ApplyDeps` for this container.
   *
   * `openTarget` opens the target AS the migrator (`withRole`) — the post-migrate role work
   * (grant-membership, waitron_app's create-role) and the stamp all run as the table owner, which is
   * the only role holding ADMIN OPTION on app_user and the only one that can write the migrator-owned
   * schema. `uri` names the admin whose credentials `migrate` reconnects from, and must be one that
   * can `SET ROLE` to the migrator.
   */
  function deps(as: Database, database: string = DATABASE, uri: string = adminUri): ApplyDeps {
    return {
      admin: as,
      database,
      adminUri: uri,
      migrationsRoot: null,
      openTarget: async () => {
        const db = await createPostgresDb(
          withRole(withDatabase(uri, database), "waitron_migrator"),
        );
        return { db, release: () => db.close() };
      },
    };
  }

  beforeAll(async () => {
    pg = await startBarePostgres();
    superuser = await pg.connect();
    await superuser.execute(
      sql.raw(`create role prov_admin login createdb createrole password 'prov'`),
    );
    adminUri = roleUrl(pg.uri, "prov_admin", "prov");
    admin = await createPostgresDb(adminUri);
  });

  afterAll(async () => {
    if (admin !== undefined) await admin.close();
    if (superuser !== undefined) await superuser.close();
    if (pg !== undefined) await pg.stop();
  });

  it("is not a superuser", async () => {
    const rows = await admin.execute<{ rolsuper: boolean; me: string }>(
      sql`select current_user as me, rolsuper from pg_roles where rolname = current_user`,
    );
    expect(rows.rows[0]?.me).toBe("prov_admin");
    expect(rows.rows[0]?.rolsuper).toBe(false);
  });

  it("takes a blank cluster to a migrated, stamped, migrator-owned database — and then plans only a migrate", async () => {
    const applyDeps = deps(admin);
    const request = { database: DATABASE, environment: "preproduction" } as const;

    const before = await readInstanceState(admin, DATABASE, null);
    expect(before.databaseExists).toBe(false);
    expect(before.databaseOwner).toBeNull();
    await applyInstance(planInstance(before, request), applyDeps);

    const { db: target, release } = await applyDeps.openTarget();
    try {
      const after = await readInstanceState(admin, DATABASE, target);
      expect(after.databaseExists).toBe(true);
      expect(after.inside?.stamp).toBe("preproduction");
      expect(after.inside?.migratedSets).toEqual([
        "core",
        "catalogue",
        "venue-service",
        "identity",
        "workforce",
        "workforce-es",
        "payments",
        "scheduler",
        "credentials",
        "fiscal-verifactu",
        "fiscal-none",
        "bookings",
      ]);
      expect(Object.keys(after.roles).sort()).toEqual(["waitron_app", "waitron_migrator"]);
      expect(after.roles.waitron_migrator?.createRole).toBe(true);
      expect(after.roles.waitron_app?.createRole).toBe(false);
      expect(after.roles.waitron_app?.memberOf).toEqual(["app_user"]);

      // The whole point of the swap: the migrator owns the database AND every table in it — which is
      // what `CREATE PUBLICATION … FOR TABLE` requires. Read the owner of the database and of every
      // public table back, not implied by non-throwing SQL.
      expect(after.databaseOwner).toBe("waitron_migrator");
      const dbOwner = await admin.execute<{ owner: string }>(
        sql`select pg_get_userbyid(datdba) as owner from pg_database where datname = ${DATABASE}`,
      );
      expect(dbOwner.rows[0]?.owner).toBe("waitron_migrator");

      const tables = await target.execute<{ tablename: string; tableowner: string }>(
        sql`select tablename, tableowner from pg_tables where schemaname = 'public'`,
      );
      expect(tables.rows.length).toBeGreaterThan(0);
      const notMigrator = tables.rows.filter((r) => r.tableowner !== "waitron_migrator");
      expect(notMigrator).toEqual([]);

      // The idempotency claim against reality: a second plan carries only a migrate — no create, no
      // stamp — and re-applying it does not throw.
      const second = planInstance(after, request);
      expect(second).toEqual([{ kind: "migrate" }]);
      await applyInstance(second, applyDeps);
    } finally {
      await release();
    }
  });

  it("gives waitron_app membership of app_user", async () => {
    const state = await readInstanceState(admin, DATABASE, null);
    expect(state.roles.waitron_app?.memberOf).toContain("app_user");
  });

  it("repairs a membership that drifted after provisioning", async () => {
    // The SEPARATE `grant-membership` action (the repair path) is never exercised by the create path,
    // because every membership there arrives via `CREATE ROLE … IN ROLE`. Proven end to end here:
    // revoke a membership, confirm the planner notices, apply (the grant runs AS the migrator on the
    // target, the only role holding ADMIN OPTION on app_user), confirm it comes back. The revoke and
    // restore run AS the migrator too — the migration created app_user as the migrator, so prov_admin
    // holds no ADMIN OPTION on it.
    const asMigrator = await createPostgresDb(
      withRole(withDatabase(adminUri, DATABASE), "waitron_migrator"),
    );
    try {
      await asMigrator.execute(sql.raw(`revoke app_user from waitron_app`));
      const drifted = await readInstanceState(admin, DATABASE, null);
      expect(drifted.roles.waitron_app?.memberOf).not.toContain("app_user");

      const request = { database: DATABASE, environment: "preproduction" } as const;
      const repair = planInstance(drifted, request);
      expect(repair).toContainEqual({
        kind: "grant-membership",
        role: "waitron_app",
        memberOf: "app_user",
      });

      await applyInstance(repair, deps(admin));

      const repaired = await readInstanceState(admin, DATABASE, null);
      expect(repaired.roles.waitron_app?.memberOf).toContain("app_user");
    } finally {
      await asMigrator.execute(sql.raw(`grant app_user to waitron_app`));
      await asMigrator.close();
    }
  });

  it("refuses an admin that cannot SET ROLE to the migrator, and works once granted SET", async () => {
    // I1, end to end through `runCli` (not `planInstance` — the SET-ROLE gap surfaces at the target
    // CONNECT, before any plan is built). A second `login createdb createrole` admin that did not
    // create the migrator holds no SET-membership on it, so `status` cannot open the target AS the
    // migrator and is refused `provisioning.role_unusable { missing: ["SET ROLE"] }` — not a bare
    // `state_unreadable`. Once the creating admin grants it SET, a re-apply migrates as the migrator.
    await admin.execute(sql.raw(`drop role if exists other_admin`));
    await admin.execute(sql.raw(`create role other_admin login createdb createrole password 'o'`));
    const otherUri = roleUrl(pg.uri, "other_admin", "o");
    try {
      const before = realCliDeps({ WAITRON_ADMIN_DATABASE_URL: otherUri });
      expect(await runCli(["status", "--database", DATABASE], before.deps)).toBe(1);
      const printed = before.lines.join("\n");
      expect(printed).toContain("provisioning.role_unusable");
      expect(printed).toContain('"missing":["SET ROLE"]');
      expect(printed).toContain('"role":"waitron_migrator"');

      // The creating admin grants SET-membership. `WITH SET TRUE` is what `createrole_self_grant`
      // gave prov_admin implicitly; here it is explicit.
      await admin.execute(sql.raw(`grant waitron_migrator to other_admin with set true`));

      const after = realCliDeps({ WAITRON_ADMIN_DATABASE_URL: otherUri });
      expect(
        await runCli(
          ["instance", "--database", DATABASE, "--environment", "preproduction", "--yes"],
          after.deps,
        ),
      ).toBe(0);
    } finally {
      await admin.execute(sql.raw(`revoke waitron_migrator from other_admin`));
      await admin.execute(sql.raw(`drop role if exists other_admin`));
    }
  });

  it("refuses a database owned by someone other than the migrator", async () => {
    // Ownership is fixed at CREATE (owner decision 2026-09-07): a database owned by an admin cannot
    // be adopted for replication. Read its real owner back and refuse.
    const foreign = "waitron_foreign_suite";
    await admin.execute(sql.raw(`create database ${quoteIdent(foreign)}`));
    try {
      const state = await readInstanceState(admin, foreign, null);
      expect(state.databaseExists).toBe(true);
      expect(state.databaseOwner).toBe("prov_admin");

      let thrown: unknown;
      try {
        planInstance(state, { database: foreign, environment: "preproduction" });
      } catch (error) {
        thrown = error;
      }
      expect(isAppError(thrown)).toBe(true);
      if (!isAppError(thrown)) return;
      expect(thrown.code).toBe("provisioning.database_not_owned");
      expect(thrown.params).toEqual({ database: foreign, owner: "prov_admin" });
    } finally {
      await admin.execute(sql.raw(`drop database if exists ${quoteIdent(foreign)} with (force)`));
    }
  });

  it("lets the migrator, but not a plain admin, write the migrator-owned schema (C5)", async () => {
    // The boundary that makes `withState`/`withVenueState` open the target AS the migrator. On the
    // migrator-owned `public`, a plain admin connection cannot CREATE TABLE (`applyVenue` would 42501
    // on its first write); the role-option connection can, and what it creates is migrator-owned.
    const plain = await createPostgresDb(withDatabase(adminUri, DATABASE));
    try {
      let thrown: unknown;
      try {
        await plain.execute(sql.raw(`create table probe_c5 (x int)`));
      } catch (error) {
        thrown = error;
      }
      expect(sqlStateOf(thrown)).toBe("42501");
    } finally {
      await plain.close();
    }

    const asMigrator = await createPostgresDb(
      withRole(withDatabase(adminUri, DATABASE), "waitron_migrator"),
    );
    try {
      await asMigrator.execute(sql.raw(`create table probe_c5 (x int)`));
      const owner = await asMigrator.execute<{ owner: string }>(
        sql`select pg_get_userbyid(relowner) as owner from pg_class where oid = 'public.probe_c5'::regclass`,
      );
      expect(owner.rows[0]?.owner).toBe("waitron_migrator");
      await asMigrator.execute(sql.raw(`drop table probe_c5`));
    } finally {
      await asMigrator.close();
    }
  });

  it("repairs a set whose journal survived a rolled-back migration", async () => {
    // The migrate gate left this open, end to end. `migratedSets` is journal-TABLE existence — Drizzle
    // creates that table at `drizzle-orm@0.45.2/pg-core/dialect.js:54-55`, OUTSIDE the transaction it
    // opens at `:60` — so an `instance` killed inside a set leaves the journal behind and the set
    // empty. Built forwards, AS the migrator throughout so the shape matches a real provision: create
    // the database owned by the migrator, migrate every set BEFORE fiscal-verifactu as the migrator,
    // then hand-create every set from it onward with an empty journal.
    const database = "waitron_interrupted_suite";
    const sets = manifestSets();
    const fiscalIdx = sets.findIndex((set) => set.name === "fiscal-verifactu");
    expect(sets.slice(fiscalIdx).map((set) => set.name)).toEqual([
      "fiscal-verifactu",
      "fiscal-none",
      "bookings",
    ]);
    const emptyJournalSets = sets.slice(fiscalIdx);
    const migratorUri = withRole(withDatabase(adminUri, database), "waitron_migrator");

    await admin.execute(sql.raw(`create database ${quoteIdent(database)} owner waitron_migrator`));
    try {
      // Every set before fiscal-verifactu, applied AS the migrator so those tables are migrator-owned.
      await applyMigrations(migratorUri, migrationOptionsFor(sets.slice(0, fiscalIdx), null));

      const target = await createPostgresDb(migratorUri);
      try {
        // Both remaining sets' journals, by hand, in Drizzle's own shape and with no rows — what a
        // rolled-back transaction leaves behind. Schema-qualified `public`, which both the journal
        // writer and `readInside`'s `to_regclass` name explicitly.
        for (const set of emptyJournalSets) {
          await target.execute(
            sql.raw(
              `create table public.${quoteIdent(set.table)} (
                 id serial primary key, hash text not null, created_at bigint
               )`,
            ),
          );
        }

        const state = await readInstanceState(admin, database, target);
        expect(state.inside?.migratedSets).toEqual(sets.map((set) => set.name));
        expect(state.databaseOwner).toBe("waitron_migrator");
        const beforeProbe = await target.execute<{ present: boolean }>(
          sql`select to_regclass('public.registros_facturacion') is not null as present`,
        );
        expect(beforeProbe.rows[0]?.present).toBe(false);

        const request = { database, environment: "preproduction" } as const;
        const actions = planInstance(state, request);
        expect(actions).toContainEqual({ kind: "migrate" });

        await applyInstance(actions, deps(admin, database));

        // Against the SCHEMA, not the journal: journal presence is the signal shown to be insufficient.
        const afterProbe = await target.execute<{ present: boolean }>(
          sql`select to_regclass('public.registros_facturacion') is not null as present`,
        );
        expect(afterProbe.rows[0]?.present).toBe(true);
      } finally {
        await target.close();
      }
    } finally {
      // Drop AS the migrator, which owns this database — prov_admin does not.
      const dropper = await createPostgresDb(withRole(adminUri, "waitron_migrator"));
      try {
        await dropper.execute(
          sql.raw(`drop database if exists ${quoteIdent(database)} with (force)`),
        );
      } finally {
        await dropper.close();
      }
    }
  });

  /** A real `CliDeps` over this container, capturing everything the CLI prints. `--yes` and the empty
   * secrets are never reached in these tests (the admin URI comes from the env). */
  function realCliDeps(env: Record<string, string | undefined>): {
    deps: CliDeps;
    lines: string[];
  } {
    const lines: string[] = [];
    const deps: CliDeps = {
      io: {
        stdout: (line) => void lines.push(line),
        stderr: (line) => void lines.push(line),
        prompt: async () => "y",
        promptSecret: async () => "",
        clearScreen: () => {},
      },
      env,
      connect: (uri) => createPostgresDb(uri),
      migrationsRoot: null,
      readState: readInstanceState,
      apply: applyInstance,
      applyVenue,
      modules: ALL_MODULES,
      readEnvironment: readDeploymentEnvironment,
      readTenants: readTenantIdentities,
    };
    return { deps, lines };
  }
});

describe("applyInstance's create-role failure handling", () => {
  // Its own bare container: `action.role` is `InstanceRole`, so forcing a `CREATE ROLE` failure
  // without colliding with "role already exists" needs a cluster where neither role exists yet.
  let pg: RealPostgres;
  let admin: Database;

  beforeAll(async () => {
    pg = await startBarePostgres();
    admin = await pg.connect();
  });

  afterAll(async () => {
    if (admin !== undefined) await admin.close();
    if (pg !== undefined) await pg.stop();
  });

  it("never lets the generated password reach a thrown error", async () => {
    // `CREATE ROLE … IN ROLE <target>` fails outright when <target> does not exist. The migrator's
    // create-role runs in the createrole_self_grant transaction; the failure there still carries a
    // SQLSTATE via Drizzle's `.cause`, and neither the wrapper nor Postgres's own message — both of
    // which quote the statement, password and all — may reach the thrown error.
    const deps = {
      admin,
      database: DATABASE,
      adminUri: pg.uri,
      migrationsRoot: null,
      openTarget: async () => {
        const db = await createPostgresDb(withDatabase(pg.uri, DATABASE));
        return { db, release: () => db.close() };
      },
    };
    const marker = "unmistakable-generated-password-marker";
    const actions: InstanceAction[] = [
      {
        kind: "create-role",
        role: "waitron_migrator",
        password: marker,
        createRole: false,
        memberOf: ["role_that_does_not_exist"],
      },
    ];

    let thrown: unknown;
    try {
      await applyInstance(actions, deps);
    } catch (error) {
      thrown = error;
    }

    expect(isAppError(thrown)).toBe(true);
    if (!isAppError(thrown)) return;
    expect(thrown.code).toBe("provisioning.role_creation_failed");
    // 42704 is `undefined_object`, reachable ONLY through the `.cause` walk — Drizzle's own wrapper
    // carries no `code`.
    expect(thrown.params).toEqual({ role: "waitron_migrator", sqlState: "42704" });
    expect(`${thrown.code} ${JSON.stringify(thrown.params)}`).not.toContain(marker);
    expect((thrown as Error).cause).toBeUndefined();
  });
});
