import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { createPostgresDb, type Database } from "@waitron/db";
import { applyInstance } from "./instance-apply.js";
import type { InstanceAction } from "./instance-plan.js";
import { planInstance } from "./instance-plan.js";
import { readInstanceState } from "./instance-state.js";
import { roleUrl, startBarePostgres, type RealPostgres } from "./testing/postgres.js";

const DATABASE = "waitron_instance_suite";

function withDatabase(uri: string, database: string): string {
  const u = new URL(uri);
  u.pathname = `/${database}`;
  return u.toString();
}

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

  it("takes a blank cluster to a migrated, stamped, granted database — and then plans nothing", async () => {
    const deps = {
      admin,
      database: DATABASE,
      adminUri,
      migrationsRoot: null,
      openTarget: () => createPostgresDb(withDatabase(adminUri, DATABASE)),
    };
    const request = { database: DATABASE, environment: "preproduction" } as const;

    const before = await readInstanceState(admin, DATABASE, null);
    expect(before.databaseExists).toBe(false);
    await applyInstance(planInstance(before, request), deps);

    const target = await deps.openTarget();
    try {
      const after = await readInstanceState(admin, DATABASE, target);
      expect(after.databaseExists).toBe(true);
      expect(after.inside?.stamp).toBe("preproduction");
      expect(after.inside?.migratedSets).toEqual([
        "core",
        "fiscal",
        "payments",
        "scheduler",
        "credentials",
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

      // Neither `has_*_privilege` function can see WITH GRANT OPTION — only `pg_namespace.nspacl`
      // can. An ACL item's trailing `*` after a privilege letter means that privilege was granted
      // WITH GRANT OPTION; verified directly against a real container: `grant create on schema
      // public to probe_role with grant option` produced the acl entry
      // `probe_role=C*/pg_database_owner`, versus a bare `C` (no `*`) without it.
      const nsp = await target.execute<{ nspacl: string[] }>(
        sql`select nspacl::text[] as nspacl from pg_namespace where nspname = 'public'`,
      );
      const migratorAcl = nsp.rows[0]?.nspacl.find((entry) =>
        entry.startsWith("waitron_migrator="),
      );
      expect(migratorAcl).toMatch(/=C\*/);

      // The idempotency claim, made against reality rather than against the planner's own model:
      // a second plan from the state the first one produced carries no create and no migrate.
      const second = planInstance(after, request);
      expect(second).not.toContainEqual(expect.objectContaining({ kind: "create-role" }));
      expect(second).not.toContainEqual(expect.objectContaining({ kind: "create-database" }));
      expect(second).not.toContainEqual({ kind: "migrate" });
      expect(second).not.toContainEqual(expect.objectContaining({ kind: "stamp" }));
      // Applying it again must also not throw — the grants are the only thing left, and they are
      // idempotent by construction.
      await applyInstance(second, deps);
    } finally {
      await target.close();
    }
  });

  it("gives waitron_app membership of app_user, and not tenant_provisioner", async () => {
    // Checks the two membership EDGES least privilege depends on — not any ability. This does not
    // prove waitron_app can run a duty pass, nor that it is refused an INSERT on tenants; it proves
    // the membership shape those abilities are built on. Actually connecting as the role to prove
    // the ability itself is deliberately out of scope here: `packages/db`'s
    // `provisioner-role.rls.test.ts` already proves the grant behaviour with known passwords, and
    // this suite proves the provisioning, not the policy.
    const state = await readInstanceState(admin, DATABASE, null);
    expect(state.roles.waitron_app?.memberOf).toContain("app_user");
    expect(state.roles.waitron_app?.memberOf).not.toContain("tenant_provisioner");
  });

  it("repairs a membership that drifted after provisioning", async () => {
    // Every membership the first test checked arrived via `CREATE ROLE ... IN ROLE`, because every
    // role was freshly created there — the SEPARATE `grant-membership` action (the repair path for
    // a role an operator created by hand, or whose membership was later revoked) is never exercised
    // by anything above: dropping that `case` from applyInstance's switch would leave every test up
    // to this point green. Proven end to end here instead: revoke a membership, confirm the planner
    // notices, apply, confirm it comes back.
    await admin.execute(sql.raw(`revoke tenant_provisioner from waitron_provisioner`));
    const drifted = await readInstanceState(admin, DATABASE, null);
    expect(drifted.roles.waitron_provisioner?.memberOf).not.toContain("tenant_provisioner");

    const request = { database: DATABASE, environment: "preproduction" } as const;
    const repair = planInstance(drifted, request);
    expect(repair).toContainEqual({
      kind: "grant-membership",
      role: "waitron_provisioner",
      memberOf: "tenant_provisioner",
    });

    await applyInstance(repair, {
      admin,
      database: DATABASE,
      adminUri,
      migrationsRoot: null,
      openTarget: () => createPostgresDb(withDatabase(adminUri, DATABASE)),
    });

    const repaired = await readInstanceState(admin, DATABASE, null);
    expect(repaired.roles.waitron_provisioner?.memberOf).toContain("tenant_provisioner");
  });

  it("refuses when a GRANT succeeded and granted nothing", async () => {
    // The silent failure, end to end against a real cluster. PostgreSQL answers a GRANT from a role
    // holding no grant option with a WARNING, not an error — the driver reports success — so this
    // is the one case `applyInstance` could not see by catching. Reproduced directly on this image:
    // as a non-owning admin, `grant create on database acl_db to r_app` printed
    // `WARNING: no privileges were granted for "acl_db"` and left `datacl` unchanged.
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
    const depsFor = (as: Database) => ({
      admin: as,
      database: DATABASE,
      adminUri,
      migrationsRoot: null,
      openTarget: () => createPostgresDb(withDatabase(adminUri, DATABASE)),
    });

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
        await applyInstance([action], depsFor(probe));
      } catch (error) {
        thrown = error;
      }

      expect(isAppError(thrown)).toBe(true);
      if (!isAppError(thrown)) return;
      expect(thrown.code).toBe("provisioning.grant_ineffective");
      expect(thrown.params).toEqual({
        database: DATABASE,
        missing: [`create on database ${DATABASE} to waitron_app`],
      });

      // The negative control, and the deletion proof's other half: the SAME action, run by the
      // admin that owns the database, takes effect and passes the check. So the refusal above is
      // about who ran it, not about the action being malformed — and the check is not simply
      // failing everything.
      await applyInstance([action], depsFor(admin));
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

  it("refuses a membership grant the admin holds no ADMIN OPTION for", async () => {
    // The receipt for the operator-facing gap `README.md`'s "When the admin cannot grant
    // `app_user`" section documents, run rather than reasoned about.
    //
    // The container's own superuser created `app_user` (by running the migrations through
    // `applyInstance` above) and can therefore grant it. A SECOND admin, holding exactly the
    // attributes this tool's spec asks for — `login createdb createrole`, no superuser, no
    // BYPASSRLS — did not create it, holds no ADMIN OPTION on it, and is refused. That admin is a
    // completely ordinary thing for an operator to hand this tool on the second or third run: the
    // cluster is already migrated, so whoever migrated it is not necessarily who is running
    // `instance` now.
    const action = {
      kind: "grant-membership",
      role: "waitron_app",
      memberOf: "app_user",
    } as const;
    const depsFor = (as: Database) => ({
      admin: as,
      database: DATABASE,
      adminUri,
      migrationsRoot: null,
      openTarget: () => createPostgresDb(withDatabase(adminUri, DATABASE)),
    });

    // The negative control, first: this EXACT action, run by an admin that DOES hold admin option,
    // succeeds. Without it, a 42501 below would be consistent with the action itself being
    // ill-formed — re-granting a membership `waitron_app` already holds — rather than with the
    // admin lacking a privilege. It is not: the difference between the two runs is only who runs
    // it.
    await applyInstance([action], depsFor(admin));

    await admin.execute(sql.raw(`drop role if exists probe_admin`));
    await admin.execute(sql.raw(`create role probe_admin login createdb createrole password 'p'`));
    const probe = await createPostgresDb(
      roleUrl(withDatabase(pg.uri, DATABASE), "probe_admin", "p"),
    );
    try {
      let thrown: unknown;
      try {
        await applyInstance([action], depsFor(probe));
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
      openTarget: () => createPostgresDb(withDatabase(pg.uri, DATABASE)),
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
