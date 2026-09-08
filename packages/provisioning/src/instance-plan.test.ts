import { describe, expect, it, vi } from "vitest";
import { isAppError } from "@waitron/shared";
import { assertUsable, REQUIREMENTS, planInstance } from "./instance-plan.js";
import { INSTANCE_ROLES, type InstanceState, type RoleFacts } from "./instance-state.js";

const HEALTHY: RoleFacts = {
  canLogin: true,
  createRole: false,
  superuser: false,
  memberOf: ["app_user"],
  // The admin that created these roles holds SET-membership on them; the planner only checks it for
  // the migrator (a re-run migrates AS the migrator over the admin's credentials).
  adminCanSetRole: true,
};

function blank(): InstanceState {
  return {
    database: "waitron",
    databaseExists: false,
    databaseOwner: null,
    roles: {},
    inside: null,
  };
}

function provisioned(): InstanceState {
  return {
    database: "waitron",
    databaseExists: true,
    databaseOwner: "waitron_migrator",
    roles: {
      waitron_migrator: { ...HEALTHY, createRole: true },
      waitron_app: HEALTHY,
    },
    inside: {
      migratedSets: ["core", "fiscal-verifactu", "payments", "scheduler", "credentials"],
      stamp: "preproduction",
    },
  };
}

const REQUEST = { database: "waitron", environment: "preproduction" } as const;

describe("planInstance against a blank cluster", () => {
  it("orders the migrator, the database, the migrate, then the memberships and the app login", () => {
    const actions = planInstance(blank(), REQUEST, () => "pw");
    // The whole invariant of the swap: the migrator is created FIRST and the database is created
    // OWNED BY it, so migrate — which runs AS the migrator — leaves every table migrator-owned. The
    // migrator gets its app_user membership by a SEPARATE grant after migrate (it was created before
    // app_user existed), and waitron_app is created last, as the migrator, `IN ROLE app_user`.
    expect(actions.map((a) => a.kind)).toEqual([
      "create-role",
      "create-database",
      "migrate",
      "grant-membership",
      "create-role",
      "stamp",
    ]);
  });

  it("creates the migrator first with CREATEROLE and no membership yet", () => {
    const actions = planInstance(blank(), REQUEST, () => "pw");
    // `memberOf: []`, not `["app_user"]`: the migrator is created BEFORE the migration exists to
    // create app_user, so it cannot be `IN ROLE app_user` at creation — the membership is granted
    // after migrate.
    expect(actions[0]).toEqual({
      kind: "create-role",
      role: "waitron_migrator",
      password: "pw",
      createRole: true,
      memberOf: [],
    });
  });

  it("creates the database owned by the migrator", () => {
    const actions = planInstance(blank(), REQUEST, () => "pw");
    expect(actions).toContainEqual({
      kind: "create-database",
      database: "waitron",
      owner: "waitron_migrator",
    });
  });

  it("grants the migrator app_user membership after migrate", () => {
    const actions = planInstance(blank(), REQUEST, () => "pw");
    const grant = actions.findIndex((a) => a.kind === "grant-membership");
    expect(actions[grant]).toEqual({
      kind: "grant-membership",
      role: "waitron_migrator",
      memberOf: "app_user",
    });
    expect(grant).toBeGreaterThan(actions.findIndex((a) => a.kind === "migrate"));
  });

  it("creates waitron_app last, a member of app_user, with no CREATEROLE", () => {
    const actions = planInstance(blank(), REQUEST, () => "pw");
    expect(actions).toContainEqual({
      kind: "create-role",
      role: "waitron_app",
      password: "pw",
      createRole: false,
      memberOf: ["app_user"],
    });
    // Least privilege, spec §10 of the server design: the duty role runs queries, never DDL — and
    // there is no schema grant to give it, because the migrator owns the schema outright.
    expect(actions).not.toContainEqual(
      expect.objectContaining({ kind: "create-role", role: "waitron_app", createRole: true }),
    );
  });

  it("plans no CREATE grants — the owner holds them implicitly", () => {
    const kinds = planInstance(blank(), REQUEST, () => "pw").map((a) => a.kind);
    // PG15+ `public` is owned by `pg_database_owner` (= the migrator), so it holds CREATE without a
    // grant; database-level CREATE comes with ownership too. The old grant-database-create /
    // grant-schema-create actions are gone.
    expect(kinds).not.toContain("grant-database-create");
    expect(kinds).not.toContain("grant-schema-create");
  });
});

describe("planInstance against a provisioned deployment", () => {
  it("plans exactly a migrate — no create, no grant, no stamp", () => {
    // Spec §4: running any command twice is safe. What must NOT survive a second run is anything
    // that writes something NEW — a role, a stamp, a grant. `migrate` is the exception, re-issued on
    // every run because the migrator is journal-tracked and re-running it cannot be wrong while a
    // check on whether it needs running can be (instance-plan.ts's comment on the migrate push).
    const actions = planInstance(provisioned(), REQUEST, () => "pw");
    expect(actions).toEqual([{ kind: "migrate" }]);
  });

  it("never re-plans a role that exists, so its password is never rotated", () => {
    const actions = planInstance(provisioned(), REQUEST, () => "pw");
    expect(actions).not.toContainEqual(expect.objectContaining({ kind: "create-role" }));
  });

  it("still plans a missing membership on an existing app role", () => {
    const state = provisioned();
    state.roles.waitron_app = { ...HEALTHY, memberOf: [] };
    expect(planInstance(state, REQUEST, () => "pw")).toEqual([
      { kind: "migrate" },
      { kind: "grant-membership", role: "waitron_app", memberOf: "app_user" },
    ]);
  });

  it("re-grants the migrator's app_user membership if it drifted", () => {
    const state = provisioned();
    state.roles.waitron_migrator = { ...HEALTHY, createRole: true, memberOf: [] };
    expect(planInstance(state, REQUEST, () => "pw")).toEqual([
      { kind: "migrate" },
      { kind: "grant-membership", role: "waitron_migrator", memberOf: "app_user" },
    ]);
  });

  it("plans the same migrate whatever the journals say", () => {
    // `migratedSets` is journal-TABLE existence, not "the set finished": Drizzle creates the journal
    // table at `drizzle-orm@0.45.2/pg-core/dialect.js:54-55` and only opens the transaction its
    // migrations run in at `:60`, so an interrupted set leaves the journal behind and the set empty.
    // Gating on journal presence read that leftover as "done" and planned no `migrate`.
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
    expect(thrown.code).toBe("deployment.already_stamped");
    expect(thrown.params).toEqual({ stamped: "preproduction", requested: "production" });
  });

  it("refuses a database owned by someone other than the migrator", () => {
    // Ownership is fixed at CREATE (owner decision 2026-09-07): a database owned by an admin cannot
    // be made migrator-owned by granting, so it is refused rather than adopted. The developer drops
    // it and re-runs.
    const state = provisioned();
    state.databaseOwner = "prov_admin";
    let thrown: unknown;
    try {
      planInstance(state, REQUEST, () => "pw");
    } catch (error) {
      thrown = error;
    }
    expect(isAppError(thrown)).toBe(true);
    if (!isAppError(thrown)) return;
    expect(thrown.code).toBe("provisioning.database_not_owned");
    expect(thrown.params).toEqual({ database: "waitron", owner: "prov_admin" });
  });

  it("refuses a migrator the admin cannot SET ROLE to", () => {
    // A second admin — one that did not create the migrator with `createrole_self_grant = 'set'` —
    // holds no SET-membership on it, so it cannot migrate AS the migrator. Named as the missing
    // capability rather than left to fail cryptically at the migrate.
    const state = provisioned();
    state.roles.waitron_migrator = { ...HEALTHY, createRole: true, adminCanSetRole: false };
    let thrown: unknown;
    try {
      planInstance(state, REQUEST, () => "pw");
    } catch (error) {
      thrown = error;
    }
    expect(isAppError(thrown)).toBe(true);
    if (!isAppError(thrown)) return;
    expect(thrown.code).toBe("provisioning.role_unusable");
    expect(thrown.params).toEqual({ role: "waitron_migrator", missing: ["SET ROLE"] });
  });

  it("does NOT check SET ROLE for waitron_app", () => {
    // `adminCanSetRole` reads `false` for `waitron_app` on a tool-provisioned database (the migrator
    // created it; nobody SET ROLEs to it), and that is fine — nothing ever SET ROLEs to the app role.
    const state = provisioned();
    state.roles.waitron_app = { ...HEALTHY, adminCanSetRole: false };
    expect(() => planInstance(state, REQUEST, () => "pw")).not.toThrow();
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
    expect(thrown.params).toEqual({ role: "waitron_app", superuser: true });
  });

  it("refuses a migrator that cannot log in, naming what it is missing", () => {
    const state = provisioned();
    state.roles.waitron_migrator = {
      ...HEALTHY,
      canLogin: false,
      createRole: false,
    };
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
  // The only way "an existing role's password is never changed" holds is if `password()` is called
  // exactly once per role CREATED and never for a role already present — a spy on the call count is
  // the one thing that catches a version calling it unconditionally that still happens to produce the
  // right `InstanceAction[]`.
  it("calls password() once per role created, and not at all against a provisioned deployment", () => {
    const password = vi.fn(() => "pw");

    const fresh = planInstance(blank(), REQUEST, password);
    const created = fresh.filter((a) => a.kind === "create-role");
    expect(created).toHaveLength(2);
    expect(password).toHaveBeenCalledTimes(2);

    password.mockClear();
    planInstance(provisioned(), REQUEST, password);
    expect(password).not.toHaveBeenCalled();
  });
});

describe("deployment login contract", () => {
  it("accepts an ordinary app role and refuses the same role with SUPERUSER", () => {
    expect(() => assertUsable("waitron_app", HEALTHY)).not.toThrow();
    expect(() => assertUsable("waitron_app", { ...HEALTHY, superuser: true })).toThrow(
      /role_over_privileged/,
    );
  });

  it("plans exactly two logins: the migrator and the app", () => {
    expect(INSTANCE_ROLES).toEqual(["waitron_migrator", "waitron_app"]);
    expect(REQUIREMENTS.waitron_app.memberOf).toEqual(["app_user"]);
    expect(REQUIREMENTS.waitron_migrator.ownsDatabase).toBe(true);
    expect(REQUIREMENTS.waitron_app.ownsDatabase).toBe(false);
  });
});
