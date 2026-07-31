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
  it("plans the idempotent grants and a migrate — no create, no stamp", () => {
    // Spec §4: running any command twice is safe. What must NOT survive a second run is anything
    // that writes something NEW — a role, a stamp. `migrate` is not in that category: it is
    // re-issued on every run for the same reason the two grants are, because the migrator is
    // journal-tracked and re-running it cannot be wrong, while a check on whether it needs running
    // can be. See instance-plan.ts's comment on the `migrate` push.
    const actions = planInstance(provisioned(), REQUEST, () => "pw");
    expect(actions).toEqual([
      { kind: "migrate" },
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
    // Corrected beyond the brief: `migrate` is now unconditional (this task's own change — see
    // instance-plan.ts's comment on the `migrate` push), so it leads every plan including this one,
    // not only the ones with a gap in `state.inside.migratedSets`. The brief's expectation of a bare
    // membership grant also omits the two migrator grants (grant-database-create,
    // grant-schema-create) that the implementation always re-issues regardless of what else changed
    // in the plan — see the "re-issued, not diffed" comment on REQUIREMENTS in instance-plan.ts.
    // Order confirmed empirically by running this suite: `migrate` comes first; then
    // `grant-membership` for waitron_provisioner, from the create-role/grant-membership loop over
    // INSTANCE_ROLES; then the migrator's two grants, from the separate, unconditional grants loop
    // that runs after it. (This fixture's `state.inside` is already stamped for REQUEST's
    // environment, so `stamp` does not appear here — the check that would emit it never fires.)
    expect(planInstance(state, REQUEST, () => "pw")).toEqual([
      { kind: "migrate" },
      { kind: "grant-membership", role: "waitron_provisioner", memberOf: "tenant_provisioner" },
      { kind: "grant-database-create", role: "waitron_migrator", database: "waitron" },
      { kind: "grant-schema-create", role: "waitron_migrator", withGrantOption: true },
    ]);
  });

  it("plans the same migrate whatever the journals say", () => {
    // The property this replaces a gate with. `migratedSets` is journal-TABLE existence, not "the
    // set finished": Drizzle creates the journal table at
    // `drizzle-orm@0.45.2/pg-core/dialect.js:54-55` and only opens the transaction its migrations
    // run in at `:60`, so a run interrupted inside a set leaves the journal behind and the set
    // empty. Gating on journal presence read that leftover as "done" and planned no `migrate` —
    // so the one command that could repair it granted, stamped and exited 0 against a deployment
    // whose last set never ran.
    //
    // Asserting the two plans are IDENTICAL is the point, rather than asserting `migrate` appears
    // in each: it rules out a partial fix that emits migrate for one journal shape and not another.
    const everySet = planInstance(provisioned(), REQUEST, () => "pw");
    const partial = provisioned();
    partial.inside = { migratedSets: ["core"], stamp: "preproduction" };

    expect(everySet).toContainEqual({ kind: "migrate" });
    expect(planInstance(partial, REQUEST, () => "pw")).toEqual(everySet);
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
