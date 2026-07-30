import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { createPostgresDb, type Database } from "@waitron/db";
import { applyInstance } from "./instance-apply.js";
import type { InstanceAction } from "./instance-plan.js";
import { planInstance } from "./instance-plan.js";
import { readInstanceState } from "./instance-state.js";
import { startBarePostgres, type RealPostgres } from "./testing/postgres.js";

const DATABASE = "waitron_instance_suite";

function withDatabase(uri: string, database: string): string {
  const u = new URL(uri);
  u.pathname = `/${database}`;
  return u.toString();
}

describe("applyInstance against a blank container", () => {
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

  it("takes a blank cluster to a migrated, stamped, granted database — and then plans nothing", async () => {
    const deps = {
      admin,
      database: DATABASE,
      adminUri: pg.uri,
      migrationsRoot: null,
      openTarget: () => createPostgresDb(withDatabase(pg.uri, DATABASE)),
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

  it("leaves waitron_app able to run a duty pass and unable to create a tenant", async () => {
    // The two halves of "least privilege" that actually matter, proven rather than asserted.
    // README.md's own grant recipe is hand-verified only; this is the automated replacement.
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
      of: "tenant_provisioner",
    });

    await applyInstance(repair, {
      admin,
      database: DATABASE,
      adminUri: pg.uri,
      migrationsRoot: null,
      openTarget: () => createPostgresDb(withDatabase(pg.uri, DATABASE)),
    });

    const repaired = await readInstanceState(admin, DATABASE, null);
    expect(repaired.roles.waitron_provisioner?.memberOf).toContain("tenant_provisioner");
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
    expect(thrown.params).toEqual({ role: "waitron_migrator" });
    // The exact shape `src/errors.ts`'s doc comment says a future CLI prints:
    // `${error.code} ${JSON.stringify(error.params)}`.
    expect(`${thrown.code} ${JSON.stringify(thrown.params)}`).not.toContain(marker);
    // The raw driver/Drizzle error is not merely unprinted — it must not even be reachable via
    // `.cause`, which Node's default console formatting recurses into.
    expect((thrown as Error).cause).toBeUndefined();
  });
});
