import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { createPostgresDb, type Database } from "@waitron/db";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { quoteIdent } from "./identifiers.js";
import { applyInstance, withDatabase, type ApplyDeps } from "./instance-apply.js";
import type { InstanceAction } from "./instance-plan.js";
import { planInstance } from "./instance-plan.js";
import { readInstanceState } from "./instance-state.js";
import { sqlStateOf } from "./sql-state.js";
import { roleUrl, startBarePostgres, type RealPostgres } from "./testing/postgres.js";

const DATABASE = "waitron_instance_suite";

describe("applyInstance against a blank container", () => {
  let pg: RealPostgres;
  /** The container's own default superuser. Used ONLY to mint `admin` below, never as `ApplyDeps.admin`. */
  let superuser: Database;
  /**
   * A NON-SUPERUSER admin: exactly `login createdb createrole`, no `SUPERUSER`, no `BYPASSRLS` —
   * the privilege `docs/superpowers/specs/2026-07-29-provisioning-tool-design.md` §2 says this
   * command needs, and no more.
   *
   * Every test below runs `applyInstance` over THIS connection, and `adminUri` is what the
   * `migrate` action composes the migrator's URL from, so the five migration sets are applied by
   * this role too. That is the whole point: `apps/server/README.md`'s empty-database recipe is
   * about a dedicated non-superuser role bootstrapping a brand-new database, and a suite that
   * connected as the container's superuser would exercise a real but DIFFERENT shape — the exact
   * gap that README admitted about itself.
   */
  let admin: Database;
  let adminUri: string;

  /**
   * `ApplyDeps` for this container, over whichever connection is playing the admin.
   *
   * Five tests below built this same four-field shape by hand — two of them as a verbatim
   * duplicated helper — so adding a field to `ApplyDeps` meant five hand-edits, and four of them
   * silently still compiling if one were missed only in the fifth. Parameterised on `as` because
   * the whole point of three of those tests is running the SAME action as a DIFFERENT, under-
   * privileged admin (`grant_probe_admin`, `delegate_admin`, `probe_admin`) and watching it be
   * refused; everything else about the deps is identical.
   *
   * **`uri` must name the same role as `as`, and that is why it is a parameter at all.**
   * `ApplyDeps` carries the admin identity through TWO channels — the `Database` handle, and the
   * connection STRING that `migrate` reconnects from (`applyMigrations(withDatabase(deps.adminUri,
   * …))`, instance-apply.ts) — and nothing in the type stops them disagreeing. While this helper
   * hard-coded the outer `adminUri`, every `deps(someProbeRole)` silently ran the `migrate` action
   * as the fully-privileged `prov_admin`. That was invisible for as long as the under-privileged
   * tests passed a single hand-picked action and never `migrate`; the first test to hand one a full
   * plan (`a partially-privileged admin reads state but fails the migrate`) hit it, and its first
   * draft reported a spurious success for a reason unrelated to the role it believed it was
   * measuring. Passing `uri` is what keeps both channels one role.
   */
  function deps(as: Database, database: string = DATABASE, uri: string = adminUri): ApplyDeps {
    return {
      admin: as,
      database,
      adminUri: uri,
      migrationsRoot: null,
      // This suite OWNS every target connection it hands over, so `release` closes it — the
      // opposite end of the contract from `cli.ts`, which lends one `withState` closes.
      openTarget: async () => {
        const db = await createPostgresDb(withDatabase(uri, database));
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

  it("holds no superuser and no BYPASSRLS", async () => {
    // The negative control for every test below. Without it, a future change to
    // `startBarePostgres` or to `roleUrl` that silently connected as the superuser again would
    // leave the whole suite passing while proving nothing about the privilege level — which is the
    // one property `apps/server/README.md` now cites this file for.
    const rows = await admin.execute<{ rolsuper: boolean; rolbypassrls: boolean; me: string }>(
      sql`select current_user as me, rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    expect(rows.rows[0]?.me).toBe("prov_admin");
    expect(rows.rows[0]?.rolsuper).toBe(false);
    expect(rows.rows[0]?.rolbypassrls).toBe(false);
  });

  it("takes a blank cluster to a migrated, stamped, granted database — and then plans only the idempotent grants and a migrate", async () => {
    const applyDeps = deps(admin);
    const request = { database: DATABASE, environment: "preproduction" } as const;

    const before = await readInstanceState(admin, DATABASE, null);
    expect(before.databaseExists).toBe(false);
    await applyInstance(planInstance(before, request), applyDeps);

    const { db: target, release } = await applyDeps.openTarget();
    try {
      const after = await readInstanceState(admin, DATABASE, target);
      expect(after.databaseExists).toBe(true);
      expect(after.inside?.stamp).toBe("preproduction");
      expect(after.inside?.migratedSets).toEqual([
        "core",
        "identity",
        "workforce",
        "workforce-es",
        "payments",
        "scheduler",
        "credentials",
        "sync",
        "fiscal",
      ]);
      expect(Object.keys(after.roles).sort()).toEqual([
        "waitron_app",
        "waitron_migrator",
        "waitron_provisioner",
      ]);
      expect(after.roles.waitron_migrator?.createRole).toBe(true);
      expect(after.roles.waitron_app?.createRole).toBe(false);
      expect(after.roles.waitron_provisioner?.memberOf.sort()).toEqual([
        "app_user",
        "tenant_provisioner",
      ]);

      // The "granted" half of the test's own title, proven rather than implied by non-throwing
      // SQL: `RoleFacts` carries no grant field, so nothing above actually checks that
      // grant-database-create/grant-schema-create did anything. `has_database_privilege` answers
      // for database-level CREATE from any connection in the cluster; `has_schema_privilege` needs
      // the TARGET database, since `public` is per-database.
      const dbCreate = await admin.execute<{ can_create: boolean }>(
        sql`select has_database_privilege('waitron_migrator', ${DATABASE}, 'CREATE') as can_create`,
      );
      expect(dbCreate.rows[0]?.can_create).toBe(true);

      const schemaCreate = await target.execute<{ can_create: boolean }>(
        sql`select has_schema_privilege('waitron_migrator', 'public', 'CREATE') as can_create`,
      );
      expect(schemaCreate.rows[0]?.can_create).toBe(true);

      // `nspacl` rather than `has_schema_privilege(…, 'CREATE WITH GRANT OPTION')`, which would
      // also answer this: the ACL is read directly here for the same reason `verifyGrants` reads it
      // directly — `has_*` walks the RECURSIVE closure, so a grant reaching the role through a
      // group would satisfy it, and this test is about the grant `applyInstance` itself made. (An
      // earlier version of this comment claimed no `has_*` function can see WITH GRANT OPTION at
      // all. It is wrong: on `postgres:18-alpine`, `has_schema_privilege` returned `t` for a role
      // holding the option and `f` for one holding a bare `C`.) An ACL item's trailing `*` after a
      // privilege letter means that privilege was granted WITH GRANT OPTION; verified directly
      // against a real container: `grant create on schema public to probe_role with grant option`
      // produced the acl entry `probe_role=C*/pg_database_owner`, versus a bare `C` without it.
      const nsp = await target.execute<{ nspacl: string[] }>(
        sql`select nspacl::text[] as nspacl from pg_namespace where nspname = 'public'`,
      );
      const migratorAcl = nsp.rows[0]?.nspacl.find((entry) =>
        entry.startsWith("waitron_migrator="),
      );
      expect(migratorAcl).toMatch(/=C\*/);

      // The idempotency claim, made against reality rather than against the planner's own model:
      // a second plan from the state the first one produced carries no create and no stamp.
      // `migrate` is not part of that claim — instance-plan.ts now pushes it unconditionally, for
      // the same reason as the two grants below, so it is expected here too rather than absent.
      const second = planInstance(after, request);
      expect(second).not.toContainEqual(expect.objectContaining({ kind: "create-role" }));
      expect(second).not.toContainEqual(expect.objectContaining({ kind: "create-database" }));
      expect(second).toContainEqual({ kind: "migrate" });
      expect(second).not.toContainEqual(expect.objectContaining({ kind: "stamp" }));
      // Applying it again must also not throw. The grants are idempotent by construction, and
      // re-running `migrate` is too: `dialect.js:62` applies a migration only when the journal's
      // watermark is behind it, which it never is here.
      await applyInstance(second, applyDeps);
    } finally {
      await release();
    }
  });

  it("gives waitron_app membership of app_user", async () => {
    // Checks the membership EDGE least privilege depends on — not any ability. This does not prove
    // waitron_app can run a duty pass, nor that it is refused an INSERT on tenants; it proves the
    // membership shape those abilities are built on. Connecting as the role to prove an ability is
    // deliberately out of scope: what `app_user` may do to each table is pinned by
    // packages/fiscal-verifactu/src/privileges.expected.ts, and this suite proves the provisioning.
    const state = await readInstanceState(admin, DATABASE, null);
    expect(state.roles.waitron_app?.memberOf).toContain("app_user");
  });

  it("repairs a membership that drifted after provisioning", async () => {
    // Every membership the first test checked arrived via `CREATE ROLE ... IN ROLE`, because every
    // role was freshly created there — the SEPARATE `grant-membership` action (the repair path for
    // a role an operator created by hand, or whose membership was later revoked) is never exercised
    // by anything above: dropping that `case` from applyInstance's switch would leave every test up
    // to this point green. Proven end to end here instead: revoke a membership, confirm the planner
    // notices, apply, confirm it comes back.
    await admin.execute(sql.raw(`revoke tenant_provisioner from waitron_provisioner`));
    try {
      const drifted = await readInstanceState(admin, DATABASE, null);
      expect(drifted.roles.waitron_provisioner?.memberOf).not.toContain("tenant_provisioner");

      const request = { database: DATABASE, environment: "preproduction" } as const;
      const repair = planInstance(drifted, request);
      expect(repair).toContainEqual({
        kind: "grant-membership",
        role: "waitron_provisioner",
        memberOf: "tenant_provisioner",
      });

      await applyInstance(repair, deps(admin));

      const repaired = await readInstanceState(admin, DATABASE, null);
      expect(repaired.roles.waitron_provisioner?.memberOf).toContain("tenant_provisioner");
    } finally {
      // The repair under test is what normally puts this back, so a failure ANYWHERE above it
      // leaves the membership revoked for every test that follows. `GRANT` is idempotent, so this
      // is a no-op on the passing path. Originally left out on the grounds that this was the last
      // test in its `describe`; several have been appended since, and it is safe today only because
      // none of them reads `waitron_provisioner`'s memberships — which is a property of those
      // tests, not of this one. (Named rather than numbered: every in-file `:NN` this comment and
      // the one below carried was already pointing at an unrelated line by the time the file was
      // renamed.)
      await admin.execute(sql.raw(`grant tenant_provisioner to waitron_provisioner`));
    }
  });

  it("refuses when a GRANT succeeded and granted nothing", async () => {
    // The silent failure, end to end against a real cluster. A grantor holding SOME privilege on
    // the object but no grant option gets a WARNING rather than an error — the driver resolves — so
    // this is the one case `applyInstance` could not see by catching. (A grantor holding nothing at
    // all on the object does error, 42501; on a database that takes revoking PUBLIC's default
    // CONNECT first, so the warning case is the one an admin normally lands in.) Reproduced
    // directly on this image: as a non-owning admin, `grant create on database acl_db to r_app`
    // printed `WARNING: no privileges were granted for "acl_db"` and put no `r_app` entry in
    // `datacl`.
    //
    // `waitron_app` is the grantee because it holds no CREATE on this database and the plan never
    // gives it one — using `waitron_migrator` would pass for the wrong reason, since the suite's
    // first test already granted it and the check reads the END STATE rather than what this
    // statement did.
    const action = {
      kind: "grant-database-create",
      role: "waitron_app",
      database: DATABASE,
    } as const;
    await admin.execute(sql.raw(`drop role if exists grant_probe_admin`));
    await admin.execute(
      sql.raw(`create role grant_probe_admin login createdb createrole password 'g'`),
    );
    const probe = await createPostgresDb(
      roleUrl(withDatabase(pg.uri, DATABASE), "grant_probe_admin", "g"),
    );
    try {
      let thrown: unknown;
      try {
        await applyInstance([action], deps(probe));
      } catch (error) {
        thrown = error;
      }

      expect(isAppError(thrown)).toBe(true);
      if (!isAppError(thrown)) return;
      expect(thrown.code).toBe("provisioning.grant_ineffective");
      expect(thrown.params).toEqual({
        database: DATABASE,
        missing: [`grant create on database ${DATABASE} to waitron_app`],
      });

      // The negative control, and the deletion proof's other half: the SAME action, run by the
      // admin that owns the database, takes effect and passes the check. So the refusal above is
      // about who ran it, not about the action being malformed — and the check is not simply
      // failing everything.
      await applyInstance([action], deps(admin));
      const acl = await admin.execute<{ acl: string[] }>(
        sql`select coalesce(datacl::text[], '{}'::text[]) as acl
            from pg_database where datname = ${DATABASE}`,
      );
      expect(acl.rows[0]?.acl.some((entry) => entry.startsWith("waitron_app=C"))).toBe(true);
    } finally {
      await probe.close();
      // In a `finally` so the suite stays order-independent: the grant above is not part of any
      // plan, and a later test reading this database's ACL should not find it.
      await admin.execute(sql.raw(`revoke create on database ${DATABASE} from "waitron_app"`));
      await admin.execute(sql.raw(`drop role if exists grant_probe_admin`));
    }
  });

  it("accepts a grant that arrived from a SECOND grantor, not the database owner", async () => {
    // The false-negative `aclHas` shipped with, against a real cluster rather than a copied ACL
    // string. One grantee gets one ACL entry PER GRANTOR: give `waitron_app` CONNECT from the
    // owner and CREATE from a delegate, and `datacl` carries two `waitron_app=` entries. Checking
    // only the first reported the CREATE grant missing and refused a deployment that had it.
    //
    // The delegate route is not contrived — it is the `WITH GRANT OPTION` path `README.md`
    // documents for letting a non-owning admin issue these grants.
    const action = {
      kind: "grant-database-create",
      role: "waitron_app",
      database: DATABASE,
    } as const;

    await admin.execute(sql.raw(`drop role if exists delegate_admin`));
    await admin.execute(sql.raw(`create role delegate_admin login password 'd'`));
    await admin.execute(
      sql.raw(
        `grant create on database ${quoteIdent(DATABASE)} to delegate_admin with grant option`,
      ),
    );
    // CONNECT from the OWNER, so the owner's own entry for waitron_app exists and does not carry
    // CREATE. This is the entry that used to be found first and answered for the whole role.
    await admin.execute(
      sql.raw(`grant connect on database ${quoteIdent(DATABASE)} to "waitron_app"`),
    );
    const delegate = await createPostgresDb(
      roleUrl(withDatabase(pg.uri, DATABASE), "delegate_admin", "d"),
    );
    try {
      // CREATE from the DELEGATE, producing the second entry.
      await applyInstance([action], deps(delegate));

      const acl = await admin.execute<{ acl: string[] }>(
        sql`select coalesce(datacl::text[], '{}'::text[]) as acl
            from pg_database where datname = ${DATABASE}`,
      );
      const entries = (acl.rows[0]?.acl ?? []).filter((entry) => entry.startsWith("waitron_app="));
      // The premise of the whole test: TWO entries, and the CREATE one is not the only one.
      expect(entries.length).toBeGreaterThan(1);
      expect(entries.some((entry) => entry.includes("=c"))).toBe(true);
      expect(entries.some((entry) => /=[^/]*C/.test(entry))).toBe(true);
    } finally {
      await delegate.close();
      // In a `finally` so the suite stays order-independent — these grants belong to no plan.
      //
      // CASCADE, and the order, are both load-bearing. Stated as the experiments that were run,
      // because the general rule they suggest is one I did NOT isolate (see the last paragraph).
      //
      // Against a standalone `postgres:18-alpine`, with `datacl` reading
      // `{…,deleg=C*/owner_a,r_y=c/owner_a,r_y=C/deleg}`:
      //
      // - `revoke all on database acl_db from r_y`, run as the database OWNER, left `r_y=C/deleg`
      //   in place. Run again as the SUPERUSER, it still left `r_y=C/deleg` in place. So the
      //   revoke of `waitron_app` above does not clear the delegate's grant, and no amount of
      //   privilege on the revoking role changes that.
      // - `revoke create on database acl_db from deleg` without CASCADE errored:
      //   `ERROR: dependent privileges exist / HINT: Use CASCADE to revoke them too.`
      // - `drop role deleg` errored: `ERROR: role "deleg" cannot be dropped because some objects
      //   depend on it / DETAIL: privileges for database acl_db`.
      // - `revoke all on database acl_db from deleg cascade` then left `datacl` as
      //   `{=Tc/owner_a,owner_a=CTc/owner_a}` — the delegate's own entry AND the entry it had
      //   granted, both gone — and `drop role deleg` then succeeded.
      //
      // What is NOT established: that being a GRANTOR is what blocks the drop. `deleg` was
      // simultaneously a GRANTEE (`deleg=C*/owner_a`), and that entry on its own is enough to
      // block it. Reaching grantor-only state would need the non-cascade revoke that PostgreSQL
      // refuses above, so the two conditions could not be separated here. The remedy below is what
      // was verified; the cause is not.
      await admin.execute(
        sql.raw(`revoke all on database ${quoteIdent(DATABASE)} from "waitron_app"`),
      );
      await admin.execute(
        sql.raw(`revoke all on database ${quoteIdent(DATABASE)} from delegate_admin cascade`),
      );
      await admin.execute(sql.raw(`drop role if exists delegate_admin`));
    }
  });

  it("refuses a membership grant the admin holds no ADMIN OPTION for", async () => {
    // The receipt for the operator-facing gap `README.md`'s "When the admin did not create the
    // database" section documents — its wall 2 — run rather than reasoned about. An earlier version
    // of this line cited a heading called "When the admin cannot grant `app_user`", which that file
    // has never had; `errors.ts`'s `provisioning.state_unreadable` cites the real one correctly.
    //
    // `prov_admin` created `app_user`, and can therefore grant it. The narrow claim this test needs
    // is about ONE call, not about the file: the `applyInstance` in `takes a blank cluster to a
    // migrated, stamped, granted database` — the only one that runs a `migrate` action — was passed
    // `admin`, and this block's `beforeAll` binds `admin` and `adminUri` to `prov_admin`, not to
    // the container's superuser. `migrate` composes the migrator's URL from that same `adminUri`,
    // so the `CREATE ROLE app_user` inside the core migration set ran as `prov_admin`. Postgres
    // grants a role admin option on a role it creates (`instance-plan.ts`'s REQUIREMENTS comment
    // says the same about `waitron_migrator`), which is where `prov_admin`'s ability to grant
    // `app_user` comes from.
    //
    // Deliberately NOT claimed, because an earlier version of this comment claimed both and both
    // are false. (a) "Every `applyInstance` call in this file passes `admin`" — the
    // `grant_probe_admin`, `delegate_admin` and `probe_admin` calls each pass a purpose-built
    // under-privileged probe precisely so a refusal can be forced; none of them runs a `migrate`,
    // so none affects who owns `app_user`. (b) "The container's superuser is never
    // `ApplyDeps.admin`" — the second `describe` in this file, `applyInstance's create-role failure
    // handling`, binds its own `admin` to `pg.connect()`, which
    // `packages/db/src/testing/postgres.ts:52-54` documents as the container's superuser, and hands
    // it to `applyInstance`. That block is a separate bare container and has no bearing on this
    // one; the mistake was scoping a per-block fact to the whole file.
    //
    // A SECOND admin, holding exactly the attributes this tool's spec asks for — `login createdb
    // createrole`, no superuser, no BYPASSRLS — did not create `app_user`, holds no ADMIN OPTION on
    // it, and is refused. That admin is a completely ordinary thing for an operator to hand this
    // tool on the second or third run: the cluster is already migrated, so whoever migrated it is
    // not necessarily who is running `instance` now.
    const action = {
      kind: "grant-membership",
      role: "waitron_app",
      memberOf: "app_user",
    } as const;
    // The negative control, first: this EXACT action, run by an admin that DOES hold admin option,
    // succeeds. Without it, a 42501 below would be consistent with the action itself being
    // ill-formed — re-granting a membership `waitron_app` already holds — rather than with the
    // admin lacking a privilege. It is not: the difference between the two runs is only who runs
    // it.
    await applyInstance([action], deps(admin));

    await admin.execute(sql.raw(`drop role if exists probe_admin`));
    await admin.execute(sql.raw(`create role probe_admin login createdb createrole password 'p'`));
    const probe = await createPostgresDb(
      roleUrl(withDatabase(pg.uri, DATABASE), "probe_admin", "p"),
    );
    try {
      let thrown: unknown;
      try {
        await applyInstance([action], deps(probe));
      } catch (error) {
        thrown = error;
      }

      expect(isAppError(thrown)).toBe(true);
      if (!isAppError(thrown)) return;
      expect(thrown.code).toBe("provisioning.membership_grant_failed");
      // 42501 is `insufficient_privilege`. Pinned rather than merely asserting "some code": the
      // README tells an operator that THIS code means "grant your admin ADMIN OPTION", and a
      // different one would send them somewhere else.
      expect(thrown.params).toEqual({
        role: "waitron_app",
        memberOf: "app_user",
        sqlState: "42501",
      });
    } finally {
      await probe.close();
      // In a `finally` so the suite is order-independent rather than order-reliant: the tests
      // after this one read `pg_roles`, and a leftover `probe_admin` is a role they did not create.
      await admin.execute(sql.raw(`drop role if exists probe_admin`));
    }
  });

  it("repairs a set whose journal survived a rolled-back migration", async () => {
    // The defect the migrate gate left open, end to end. `migratedSets` is journal-TABLE existence,
    // and Drizzle creates that table at `drizzle-orm@0.45.2/pg-core/dialect.js:54-55` — OUTSIDE the
    // transaction it opens at `:60` for the set's migrations. So an `instance` killed inside a set
    // rolls the migrations back and leaves the journal behind: every journal present, one set
    // empty. The old planner read that as "done", planned no `migrate`, and let this command grant,
    // stamp and exit 0 against a deployment whose last set had never run.
    //
    // Built FORWARDS rather than by damaging a migrated database. Damaging one would need each
    // set's table list and would have to respect the foreign keys `packages/migrations/src/apply.ts`
    // records (core carries `tenants`, which every other set references), and none of that is under
    // test. The simpler-looking variant — pre-create all five journals against an empty database —
    // does NOT reproduce this defect: `deployment` is itself created by a migration, and
    // `stampDeployment` INSERTs into it after `readDeploymentEnvironment` returns null for an absent
    // table (`packages/db/src/deployment.ts:39-41`), so the old tool would have FAILED on the stamp
    // rather than exiting 0. A test built that way would pass while demonstrating the wrong thing.
    const database = "waitron_interrupted_suite";
    const sets = manifestSets();
    const last = sets[sets.length - 1];
    if (last === undefined) throw new Error("the manifest is empty");
    // The journal table below is derived from the manifest; the SCHEMA probe further down is not,
    // and cannot be — `MigrationSet` carries `name`, `table` and `from` (manifest.ts:9-14) and no
    // list of what each set creates, so there is nothing to derive `registros_facturacion` from.
    // This assertion is what keeps the hardcoded half honest: `registros_facturacion` is created by
    // `packages/fiscal-verifactu/drizzle/0000_esquema_fiscal.sql`, which is the `fiscal` set (now
    // last, since SP-3a: fiscal's capture triggers will call sync's `sync_capture()` SPI, so the
    // `sync` set must migrate first). Append a further set to the manifest and this fails here,
    // loudly, instead of silently probing a table that belongs to a set which was never the one
    // left empty.
    expect(last.name).toBe("fiscal");

    await admin.execute(sql.raw(`create database ${quoteIdent(database)}`));
    try {
      // Every set but the last, applied for real by the real migrator.
      await applyMigrations(
        withDatabase(adminUri, database),
        migrationOptionsFor(sets.slice(0, -1), null),
      );

      const target = await createPostgresDb(withDatabase(adminUri, database));
      try {
        // The last set's journal, by hand, in Drizzle's own shape (`dialect.js:48-51`) and with no
        // rows — which is exactly what the rolled-back transaction leaves behind.
        //
        // Schema-QUALIFIED, because both of the things this fixture has to line up with name
        // `public` explicitly and neither consults `search_path`: Drizzle creates the journal at
        // `<migrationsSchema>.<table>` with `migrationsSchema: "public"` fixed at
        // `packages/db/src/migrate.ts:42`, and `readInside` probes
        // `to_regclass('public.<table>')` (`instance-state.ts:131`). Unqualified, this statement
        // instead resolves through the session's `search_path` — `"$user", public` by default, so
        // it lands in `public` here only because no schema is named after the connecting role.
        // That is a default this fixture would otherwise be silently depending on.
        await target.execute(
          sql.raw(
            `create table public.${quoteIdent(last.table)} (
               id serial primary key, hash text not null, created_at bigint
             )`,
          ),
        );

        const state = await readInstanceState(admin, database, target);
        // The precondition, asserted rather than assumed: every journal reads as present, so the
        // OLD planner would have seen nothing to do here.
        expect(state.inside?.migratedSets).toEqual(sets.map((set) => set.name));
        // And the set really is empty — no table of its own yet.
        const before = await target.execute<{ present: boolean }>(
          sql`select to_regclass('public.registros_facturacion') is not null as present`,
        );
        expect(before.rows[0]?.present).toBe(false);

        const request = { database, environment: "preproduction" } as const;
        const actions = planInstance(state, request);
        expect(actions).toContainEqual({ kind: "migrate" });

        await applyInstance(actions, deps(admin, database));

        // Assert against the SCHEMA, not the journal: journal presence is the very signal being
        // shown to be insufficient, so re-reading it would prove nothing.
        const after = await target.execute<{ present: boolean }>(
          sql`select to_regclass('public.registros_facturacion') is not null as present`,
        );
        expect(after.rows[0]?.present).toBe(true);
      } finally {
        await target.close();
      }
    } finally {
      // In a `finally` so the suite stays order-independent. `admin` is connected to another
      // database in the same cluster, so it can drop this one.
      await admin.execute(sql.raw(`drop database if exists ${quoteIdent(database)} with (force)`));
    }
  });

  it("a partially-privileged admin reads state but fails the migrate", async () => {
    // The spec's open consequence (2026-07-30-provisioning-migrate-gate-design.md §4), reproduced
    // rather than reasoned about. `partial_admin` can reach the target database and read
    // `deployment`, but holds no CREATE on its `public` schema and does not own it — enough
    // privilege to get past `withState`'s state read, which is the shape the design doc could not
    // settle by reading alone.
    await admin.execute(sql.raw(`drop role if exists partial_admin`));
    await admin.execute(
      sql.raw(`create role partial_admin login createdb createrole password 'p'`),
    );
    await admin.execute(
      sql.raw(`grant connect on database ${quoteIdent(DATABASE)} to partial_admin`),
    );

    const owner = await createPostgresDb(withDatabase(adminUri, DATABASE));
    try {
      await owner.execute(sql.raw(`grant select on deployment to partial_admin`));
      // Deliberately NO `grant create on schema public to partial_admin`.
    } finally {
      await owner.close();
    }

    const probeUri = roleUrl(withDatabase(pg.uri, DATABASE), "partial_admin", "p");
    // ONE handle, passed as both of `readInstanceState`'s connections. Its `admin` argument reads
    // the cluster-global catalogs (`pg_database`, `pg_roles`) and its `target` argument reads
    // inside the database; a connection to `DATABASE` answers both, and both must be
    // `partial_admin` for the measurement to mean anything. Two handles from the identical URI —
    // same role, same database — would have been a second connect and auth handshake for nothing.
    // Elsewhere in this file the two genuinely differ, because `admin` is dialled at the cluster's
    // default database and `target` at a named one.
    const probe = await createPostgresDb(probeUri);
    try {
      const state = await readInstanceState(probe, DATABASE, probe);
      // The precondition this test is about: a FULLY-journalled re-run, the exact state that used
      // to make the old, gated planner emit no `migrate` and exit 0 (task 1-3's own tests already
      // pin that the new planner does not do that; this asserts the state this admin actually
      // reads is the state the spec's open question is about, not merely assumed to be).
      expect(state.databaseExists).toBe(true);
      expect(state.inside?.migratedSets).toEqual(manifestSets().map((set) => set.name));
      expect(state.inside?.stamp).toBe("preproduction");

      const request = { database: DATABASE, environment: "preproduction" } as const;
      const actions = planInstance(state, request);
      expect(actions).toContainEqual({ kind: "migrate" });

      // The THIRD argument is the point: `deps` defaults `adminUri` to the outer `prov_admin`
      // string, and `migrate` reconnects from it (`applyMigrations(withDatabase(deps.adminUri,
      // …))`, instance-apply.ts). Passing `probeUri` is what makes every action — including that
      // reconnect — run as `partial_admin` rather than as the fully privileged admin. Omitting it
      // is not a slow test but a wrong one, proven by mutation rather than asserted: replace this
      // with `deps(probe, DATABASE)` and the run fails at the `sqlStateOf` line below with
      // `expected null to be '42501'` — the migrate ran as `prov_admin` and nothing was thrown,
      // which is exactly what this test's first draft reported as a pass.
      let thrown: unknown;
      try {
        await applyInstance(actions, deps(probe, DATABASE, probeUri));
      } catch (error) {
        thrown = error;
      }

      // NOT wrapped as a `provisioning.*` `AppError`: `instance-apply.ts` wraps only `create-role`
      // and `grant-membership` in a `try`/`catch` — `create-database`, `grant-database-create`,
      // `grant-schema-create`, `migrate` and `stamp` are all uncaught — so the raw driver failure
      // and its SQLSTATE are what actually reaches a caller. Pre-existing and shared, not opened by
      // the branch that added this test: `instance-apply.ts` is byte-identical to `main`.
      // `bin.ts` prints
      // `unexpected failure (${error.name})`, and `error.name` — NOT `error.constructor.name` —
      // is `"Error"` for a `DrizzleQueryError`: `drizzle-orm@0.45.2/errors.js`'s
      // `DrizzleQueryError` extends `Error` directly and never sets `this.name` (only the
      // sibling `DrizzleError` class does, in its own constructor), so it inherits the
      // prototype's `"Error"`. Run through the built bundle against this exact scenario
      // (`pnpm --filter @waitron/provisioning build`, then `node dist/bin.js instance` with
      // `WAITRON_ADMIN_DATABASE_URL` pointed at `partial_admin`): exit code 1, stderr exactly
      // `unexpected failure (Error)` — not `(DrizzleQueryError)`, which an earlier version of
      // this comment claimed while labelling itself "traced rather than run" in the same breath.
      // Recorded as measured, not fixed: reclassifying it into a `provisioning.*` code is
      // outside this task's scope.
      expect(isAppError(thrown)).toBe(false);
      // Reached via Drizzle's own migrator issuing `CREATE SCHEMA IF NOT EXISTS "public"`
      // unconditionally at the start of `migrate` (`drizzle-orm@0.45.2/pg-core/dialect.js:54`),
      // before any journal table is read — the statement itself needs CREATE on the DATABASE,
      // which `partial_admin` was deliberately never granted. Cited as `dialect.js`, not
      // `dialect.ts`: the stack trace says `dialect.ts:85` via the package's shipped source map,
      // but the installed package has no `dialect.ts`, and `dialect.js:85` is an unrelated method.
      //
      // BOTH assertions, because either alone is too weak for the sentence above. `sqlStateOf` is
      // the same "walk `.cause`" helper `instance-apply.ts` uses to classify a driver failure, but
      // 42501 on its own would still pass if the refusal moved to a later statement or a later
      // action — which is precisely the narrower shape §4 of the design doc says it does not
      // speak to. The message pins WHICH statement.
      expect(sqlStateOf(thrown)).toBe("42501");
      expect((thrown as Error).message).toContain('CREATE SCHEMA IF NOT EXISTS "public"');
    } finally {
      await probe.close();
      // Both grants below were made BY `admin` (`prov_admin`, the database's real owner) — the
      // first over `admin`'s own connection (database-level, needs no particular database selected),
      // the second over a fresh connection to `DATABASE` itself, since a table-level REVOKE has to
      // run against the database the table lives in. Without both, `drop role` below fails 2BP01
      // ("role ... cannot be dropped because some objects depend on it") — reproduced once, before
      // this cleanup existed.
      await admin.execute(
        sql.raw(`revoke connect on database ${quoteIdent(DATABASE)} from partial_admin`),
      );
      const cleanupOwner = await createPostgresDb(withDatabase(adminUri, DATABASE));
      try {
        await cleanupOwner.execute(sql.raw(`revoke select on deployment from partial_admin`));
      } finally {
        await cleanupOwner.close();
      }
      await admin.execute(sql.raw(`drop role if exists partial_admin`));
    }
  });
});

describe("applyInstance's create-role failure handling", () => {
  // Its own bare container, deliberately not the one above: `action.role` is typed `InstanceRole`
  // — one of the three real role names, never an arbitrary probe string — so forcing a `CREATE
  // ROLE` failure without colliding with "role already exists" (the OTHER suite's container has
  // already created all three by the time its tests run) needs a cluster where none of them exist
  // yet.
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
    // `CREATE ROLE ... IN ROLE <target>` fails outright when <target> does not exist — the same
    // mechanism that broke on a blank cluster before `12af388`. Forcing it here, deliberately,
    // with a membership target that will never exist, is what lets this test force the failure
    // path on demand rather than waiting for one to happen by accident.
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
    // `sqlState` is the receipt for `sqlStateOf`'s `.cause` walk (instance-apply.ts): 42704 is
    // `undefined_object`, which is what a missing membership target raises, and it is reachable
    // here ONLY through that walk — Drizzle's own wrapper carries no `code` of its own. A hand-
    // built two-level error in `instance-apply.test.ts` asserts the same walk; this one asserts
    // that the REAL driver shape is the one it was built for.
    expect(thrown.params).toEqual({ role: "waitron_migrator", sqlState: "42704" });
    // The exact shape `src/errors.ts`'s doc comment says a future CLI prints:
    // `${error.code} ${JSON.stringify(error.params)}`.
    expect(`${thrown.code} ${JSON.stringify(thrown.params)}`).not.toContain(marker);
    // The raw driver/Drizzle error is not merely unprinted — it must not even be reachable via
    // `.cause`, which Node's default console formatting recurses into.
    expect((thrown as Error).cause).toBeUndefined();
  });
});
