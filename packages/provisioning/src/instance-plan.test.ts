import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { planInstance } from "./instance-plan.js";
import type { InstanceState, RoleFacts } from "./instance-state.js";

const HEALTHY: RoleFacts = {
  canLogin: true,
  createRole: false,
  superuser: false,
  bypassRls: false,
  memberOf: ["app_user"],
};

function blank(): InstanceState {
  return { database: "waitron", databaseExists: false, roles: {}, inside: null };
}

function provisioned(): InstanceState {
  return {
    database: "waitron",
    databaseExists: true,
    roles: {
      waitron_migrator: { ...HEALTHY, createRole: true },
      waitron_app: HEALTHY,
      waitron_provisioner: { ...HEALTHY, memberOf: ["app_user", "tenant_provisioner"] },
    },
    inside: {
      migratedSets: ["core", "fiscal", "payments", "scheduler", "credentials"],
      stamp: "preproduction",
    },
  };
}

const REQUEST = { database: "waitron", environment: "preproduction" } as const;

describe("planInstance against a blank cluster", () => {
  it("creates the database before anything that lives in it", () => {
    const actions = planInstance(blank(), REQUEST, () => "pw");
    const kinds = actions.map((a) => a.kind);
    expect(kinds[0]).toBe("create-database");
    // Ordering is the whole contract of a plan: a grant on a database that does not exist fails,
    // and the stamp needs the `deployment` table that only migrating creates.
    expect(kinds.indexOf("migrate")).toBeLessThan(kinds.indexOf("stamp"));
    expect(kinds.indexOf("create-database")).toBeLessThan(kinds.indexOf("migrate"));
  });

  it("gives the migrator CREATEROLE and a grantable CREATE ON SCHEMA", () => {
    const actions = planInstance(blank(), REQUEST, () => "pw");
    expect(actions).toContainEqual({
      kind: "create-role",
      role: "waitron_migrator",
      password: "pw",
      createRole: true,
      memberOf: ["app_user"],
    });
    // WITH GRANT OPTION: the empty-database migrations temporarily re-grant CREATE ON SCHEMA
    // public to each support role they create, then revoke it. A grant this role cannot pass on
    // fails partway through that dance — apps/server/README.md's own finding.
    expect(actions).toContainEqual({
      kind: "grant-schema-create",
      role: "waitron_migrator",
      withGrantOption: true,
    });
  });

  it("makes the provisioner a member of tenant_provisioner and app_user, and nothing else", () => {
    const actions = planInstance(blank(), REQUEST, () => "pw");
    expect(actions).toContainEqual({
      kind: "create-role",
      role: "waitron_provisioner",
      password: "pw",
      createRole: false,
      memberOf: ["app_user", "tenant_provisioner"],
    });
  });

  it("gives waitron_app app_user membership and no CREATE grant at all", () => {
    const actions = planInstance(blank(), REQUEST, () => "pw");
    expect(actions).toContainEqual({
      kind: "create-role",
      role: "waitron_app",
      password: "pw",
      createRole: false,
      memberOf: ["app_user"],
    });
    // Least privilege, spec §10 of the server design: the duty role runs queries, never DDL.
    expect(actions).not.toContainEqual(
      expect.objectContaining({ kind: "grant-schema-create", role: "waitron_app" }),
    );
  });
});

describe("planInstance against a provisioned deployment", () => {
  it("plans only the idempotent grants — no create, no migrate, no stamp", () => {
    // Spec §4: running any command twice is safe. The grants remain, deliberately: they are
    // re-issued rather than diffed (see REQUIREMENTS' comment in instance-plan.ts), because
    // information_schema.role_table_grants cannot see database- or schema-level CREATE at all.
    // What must NOT survive a second run is anything that writes something new.
    const actions = planInstance(provisioned(), REQUEST, () => "pw");
    expect(actions).toEqual([
      { kind: "grant-database-create", role: "waitron_migrator", database: "waitron" },
      { kind: "grant-schema-create", role: "waitron_migrator", withGrantOption: true },
    ]);
  });

  it("never re-plans a role that exists, so its password is never rotated", () => {
    const state = provisioned();
    const actions = planInstance(state, REQUEST, () => "pw");
    expect(actions).not.toContainEqual(expect.objectContaining({ kind: "create-role" }));
  });

  it("still plans a missing membership on an existing role", () => {
    const state = provisioned();
    state.roles.waitron_provisioner = { ...HEALTHY, memberOf: ["app_user"] };
    // Corrected from the brief: the brief's expectation of a bare membership grant omits the two
    // migrator grants (grant-database-create, grant-schema-create) that the implementation always
    // re-issues regardless of what else changed in the plan — see the "re-issued, not diffed"
    // comment on REQUIREMENTS in instance-plan.ts. Order confirmed empirically by running this
    // suite (see task-5-report.md): the two migrator grants are emitted before the membership
    // grant, because the implementation's grant loop runs before the migrate/stamp tail but after
    // the create-role/grant-membership loop — the membership grant for waitron_provisioner is
    // produced by the earlier loop, then the migrator's two grants by the later one.
    expect(planInstance(state, REQUEST, () => "pw")).toEqual([
      { kind: "grant-membership", role: "waitron_provisioner", of: "tenant_provisioner" },
      { kind: "grant-database-create", role: "waitron_migrator", database: "waitron" },
      { kind: "grant-schema-create", role: "waitron_migrator", withGrantOption: true },
    ]);
  });

  it("plans a migrate when any set's journal is missing", () => {
    const state = provisioned();
    state.inside = { migratedSets: ["core"], stamp: "preproduction" };
    // Corrected from the brief: same omission as above — the two migrator grants are always
    // re-issued, so a plan against a provisioned-but-partially-migrated deployment is never just
    // `[{ kind: "migrate" }]`. Order confirmed empirically (see task-5-report.md): the grants loop
    // runs before the migrate/stamp tail, so they precede "migrate" here.
    expect(planInstance(state, REQUEST, () => "pw")).toEqual([
      { kind: "grant-database-create", role: "waitron_migrator", database: "waitron" },
      { kind: "grant-schema-create", role: "waitron_migrator", withGrantOption: true },
      { kind: "migrate" },
    ]);
  });
});

describe("planInstance refusals", () => {
  it("refuses a stamp that disagrees", () => {
    const state = provisioned();
    let thrown: unknown;
    try {
      planInstance(state, { database: "waitron", environment: "production" }, () => "pw");
    } catch (error) {
      thrown = error;
    }
    expect(isAppError(thrown)).toBe(true);
    if (!isAppError(thrown)) return;
    // The same code stampDeployment throws for the same condition — not a near-synonym. Raised
    // HERE so the refusal happens before anything is written, rather than after the database and
    // three roles already exist.
    expect(thrown.code).toBe("deployment.already_stamped");
    expect(thrown.params).toEqual({ stamped: "preproduction", requested: "production" });
  });

  it("refuses a role carrying SUPERUSER", () => {
    const state = provisioned();
    state.roles.waitron_app = { ...HEALTHY, superuser: true };
    let thrown: unknown;
    try {
      planInstance(state, REQUEST, () => "pw");
    } catch (error) {
      thrown = error;
    }
    expect(isAppError(thrown)).toBe(true);
    if (!isAppError(thrown)) return;
    expect(thrown.code).toBe("provisioning.role_over_privileged");
    expect(thrown.params).toEqual({ role: "waitron_app", superuser: true, bypassRls: false });
  });

  it("refuses a role that cannot log in, naming what it is missing", () => {
    const state = provisioned();
    state.roles.waitron_migrator = { ...HEALTHY, canLogin: false, createRole: false };
    let thrown: unknown;
    try {
      planInstance(state, REQUEST, () => "pw");
    } catch (error) {
      thrown = error;
    }
    expect(isAppError(thrown)).toBe(true);
    if (!isAppError(thrown)) return;
    expect(thrown.code).toBe("provisioning.role_unusable");
    expect(thrown.params).toEqual({ role: "waitron_migrator", missing: ["LOGIN", "CREATEROLE"] });
  });
});
