import { describe, expect, it, vi } from "vitest";
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
    // Pins the ordering bug 12af388 fixed, in the pure planner itself rather than only in the
    // container suite that found it: `app_user`/`tenant_provisioner` are created BY migrate, and
    // every `create-role` action below bakes a membership in one of them straight into `CREATE
    // ROLE ... IN ROLE`, so a create-role emitted before migrate runs fails on a real blank
    // cluster. `indexOf("create-role")` returns the FIRST of the three — exactly the one this
    // ordering matters for.
    expect(kinds.indexOf("migrate")).toBeLessThan(kinds.indexOf("create-role"));
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
    // suite: `grant-membership` for waitron_provisioner is emitted FIRST — it comes from the
    // create-role/grant-membership loop over INSTANCE_ROLES — and the migrator's two grants come
    // SECOND, from the separate, unconditional grants loop that runs after it. (This fixture's
    // `state.inside` is already fully migrated and stamped, so neither `migrate` nor `stamp`
    // appears here at all — the loop that would emit them never fires.)
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
    // `[{ kind: "migrate" }]`.
    //
    // Order corrected a second time, from this task's own first version (task-5-report.md), which
    // had the grants loop run before the migrate/stamp tail and asserted that order here. Task 6's
    // end-to-end suite (instance-apply.rls.test.ts) ran this plan against a real, blank container
    // and hit a real Postgres error: `create role "waitron_migrator" ... in role "app_user"` failed
    // with `role "app_user" does not exist` (SQLSTATE 42704) — `app_user` is created by the "core"
    // migration set, not by this tool, so on a blank cluster it does not exist until migrate has
    // run. `planInstance` now emits migrate immediately after `create-database`, before any LOGIN
    // role, which is why it leads here too.
    expect(planInstance(state, REQUEST, () => "pw")).toEqual([
      { kind: "migrate" },
      { kind: "grant-database-create", role: "waitron_migrator", database: "waitron" },
      { kind: "grant-schema-create", role: "waitron_migrator", withGrantOption: true },
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

describe("planInstance's injected password()", () => {
  // Global Constraints: "An existing role's password is never changed." The only way this holds is
  // if `password()` is called exactly once per role CREATED and never for a role already present —
  // a spy on the call count is the one thing that can catch a version that calls it unconditionally
  // (e.g. once per INSTANCE_ROLE regardless of whether `create-role` is even emitted) and still
  // happens to produce the right `InstanceAction[]`, because the actions built from an unused call
  // look identical to actions built from none.
  it("calls password() once per role created, and not at all against a provisioned deployment", () => {
    const password = vi.fn(() => "pw");

    const fresh = planInstance(blank(), REQUEST, password);
    const created = fresh.filter((a) => a.kind === "create-role");
    expect(created).toHaveLength(3);
    expect(password).toHaveBeenCalledTimes(3);

    password.mockClear();
    planInstance(provisioned(), REQUEST, password);
    expect(password).not.toHaveBeenCalled();
  });
});
