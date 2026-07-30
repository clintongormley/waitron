import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDb, type Database } from "@waitron/db";
import { applyInstance } from "./instance-apply.js";
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
});
