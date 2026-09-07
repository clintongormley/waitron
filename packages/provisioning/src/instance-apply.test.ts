import { describe, expect, it, vi } from "vitest";
import { isAppError } from "@waitron/shared";
import type { Database } from "@waitron/db";
import { applyMigrations } from "@waitron/migrations";
import { applyInstance, withDatabase, type TargetConnection } from "./instance-apply.js";
import { describeAction, type InstanceAction } from "./instance-plan.js";
import { withRole } from "./identifiers.js";

// The migrate action reconnects AS the migrator through `applyMigrations`, which opens a real
// connection. Mocked so the migrate branch is reachable without a container and the connection
// STRING it is handed can be asserted — the only test in this file whose plan includes `migrate`.
vi.mock("@waitron/migrations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/migrations")>();
  return { ...actual, applyMigrations: vi.fn(async () => {}) };
});

/** The SQL text of a `sql.raw` query — its whole text lands in a single `StringChunk`. Tolerant of a
 * parameterised `sql` template too, whose `Param` chunks carry no `value`. */
function textOf(query: { queryChunks: { value?: string[] }[] }): string {
  return query.queryChunks.map((chunk) => chunk.value?.join("") ?? "").join("");
}

/**
 * The light target, deliberately (CLAUDE.md §4). What these tests exercise is how `applyInstance`
 * ROUTES and CLASSIFIES statements — which connection each runs on, which `code` a failure rethrows,
 * and what it keeps of the original. None of that needs privileges or concurrency: a fake whose
 * `execute`/`transaction` throws or records reaches the branch directly. The real-shape receipts —
 * a genuine Drizzle failure carrying its SQLSTATE, the migrator actually owning every table — live in
 * `instance-apply.pg.test.ts`.
 */
function throwingDb(error: unknown): Database {
  const tx = {
    execute: () => {
      throw error;
    },
  };
  return {
    execute: () => {
      throw error;
    },
    transaction: (cb: (tx: unknown) => Promise<unknown>) => cb(tx),
    close: async () => {},
  } as unknown as Database;
}

function depsThrowing(error: unknown) {
  const db = throwingDb(error);
  return {
    admin: db,
    database: "waitron_probe",
    adminUri: "postgres://admin@localhost:5432/postgres",
    migrationsRoot: null,
    openTarget: (): Promise<TargetConnection> => Promise.resolve({ db, release: async () => {} }),
  };
}

async function thrownBy(actions: InstanceAction[], error: unknown): Promise<unknown> {
  try {
    await applyInstance(actions, depsThrowing(error));
  } catch (caught) {
    return caught;
  }
  return undefined;
}

// The migrator, whose create-role runs over the admin in the createrole_self_grant transaction.
const CREATE_ROLE: InstanceAction[] = [
  {
    kind: "create-role",
    role: "waitron_migrator",
    password: "unmistakable-generated-password-marker",
    createRole: true,
    memberOf: [],
  },
];

// A membership grant runs AS the migrator on the target handle.
const GRANT_MEMBERSHIP: InstanceAction[] = [
  { kind: "grant-membership", role: "waitron_app", memberOf: "app_user" },
];

describe("applyInstance's create-role failure", () => {
  it("carries the SQLSTATE the driver reported", async () => {
    const thrown = await thrownBy(CREATE_ROLE, Object.assign(new Error("boom"), { code: "42710" }));
    expect(isAppError(thrown)).toBe(true);
    if (!isAppError(thrown)) return;
    expect(thrown.code).toBe("provisioning.role_creation_failed");
    expect(thrown.params).toEqual({ role: "waitron_migrator", sqlState: "42710" });
  });

  it("finds a SQLSTATE that the driver's wrapper buried under .cause", async () => {
    const buried = Object.assign(new Error("Failed query: create role ..."), {
      cause: Object.assign(new Error('role "app_user" does not exist'), { code: "42704" }),
    });
    const thrown = await thrownBy(CREATE_ROLE, buried);
    expect(isAppError(thrown)).toBe(true);
    if (!isAppError(thrown)) return;
    expect(thrown.params).toEqual({ role: "waitron_migrator", sqlState: "42704" });
  });

  it("reports null rather than inventing one when there is no SQLSTATE", async () => {
    const thrown = await thrownBy(CREATE_ROLE, new Error("the pool is closed"));
    expect(isAppError(thrown)).toBe(true);
    if (!isAppError(thrown)) return;
    expect(thrown.params).toEqual({ role: "waitron_migrator", sqlState: null });
  });

  it("refuses a `code` that is not SQLSTATE-shaped", async () => {
    const thrown = await thrownBy(
      CREATE_ROLE,
      Object.assign(new Error("no such file"), { code: "ENOENT" }),
    );
    expect(isAppError(thrown)).toBe(true);
    if (!isAppError(thrown)) return;
    expect(thrown.params).toEqual({ role: "waitron_migrator", sqlState: null });
  });

  it("still never lets the generated password reach the thrown error", async () => {
    const leaky = Object.assign(
      new Error(
        'Failed query: create role "waitron_migrator" login createrole password ' +
          "'unmistakable-generated-password-marker'",
      ),
      { code: "42704" },
    );
    const thrown = await thrownBy(CREATE_ROLE, leaky);
    expect(isAppError(thrown)).toBe(true);
    if (!isAppError(thrown)) return;
    expect(`${thrown.code} ${JSON.stringify(thrown.params)}`).not.toContain(
      "unmistakable-generated-password-marker",
    );
    expect((thrown as Error).cause).toBeUndefined();
  });

  it("gives up on a cause chain longer than the bound rather than following it forever", async () => {
    let deepest: unknown = Object.assign(new Error("bottom"), { code: "42501" });
    for (let i = 0; i < 10; i += 1)
      deepest = Object.assign(new Error(`wrap ${i}`), { cause: deepest });

    const thrown = await thrownBy(CREATE_ROLE, deepest);
    expect(isAppError(thrown)).toBe(true);
    if (!isAppError(thrown)) return;
    expect(thrown.params).toEqual({ role: "waitron_migrator", sqlState: null });
  });

  it("does not spin on a self-referential cause chain", async () => {
    const cyclic: { message: string; cause?: unknown } = { message: "round and round" };
    cyclic.cause = cyclic;
    const thrown = await thrownBy(CREATE_ROLE, cyclic);
    expect(isAppError(thrown)).toBe(true);
    if (!isAppError(thrown)) return;
    expect(thrown.params).toEqual({ role: "waitron_migrator", sqlState: null });
  });
});

describe("applyInstance's migrator create-role", () => {
  it("runs the createrole_self_grant SET and the CREATE ROLE on ONE transaction handle", async () => {
    // `createPostgresDb` builds a Pool. A pooled, UN-transacted `set … ; create role …` lands the
    // SET on one backend and the CREATE ROLE on another, so the GUC — session-scoped — is gone by
    // the time the role is created and the admin gets no SET-membership on it (C3/probe A). The two
    // statements sharing one transaction handle is what prevents that; a fake that records the two
    // channels separately is what pins it.
    const txStatements: string[] = [];
    const topStatements: string[] = [];
    let txCalls = 0;
    const admin = {
      execute: (q: { queryChunks: { value?: string[] }[] }) => {
        topStatements.push(textOf(q));
        return Promise.resolve({ rows: [] });
      },
      transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
        txCalls += 1;
        const tx = {
          execute: (q: { queryChunks: { value?: string[] }[] }) => {
            txStatements.push(textOf(q));
            return Promise.resolve({ rows: [] });
          },
        };
        return cb(tx);
      },
    } as unknown as Database;

    await applyInstance(CREATE_ROLE, {
      admin,
      database: "waitron_probe",
      adminUri: "postgres://admin@localhost:5432/postgres",
      migrationsRoot: null,
      openTarget: (): Promise<TargetConnection> =>
        Promise.reject(new Error("openTarget must not be reached by this action")),
    });

    expect(txCalls).toBe(1);
    expect(txStatements).toEqual([
      "set local createrole_self_grant = 'set'",
      `create role "waitron_migrator" login createrole password 'unmistakable-generated-password-marker'`,
    ]);
    // Not as loose top-level executes, which is the whole failing case above.
    expect(topStatements).not.toContainEqual(expect.stringContaining("create role"));
  });
});

describe("applyInstance's create-database", () => {
  it("names the migrator as the owner", async () => {
    const executed: string[] = [];
    const admin = {
      execute: (q: { queryChunks: { value?: string[] }[] }) => {
        executed.push(textOf(q));
        return Promise.resolve({ rows: [] });
      },
    } as unknown as Database;
    await applyInstance([{ kind: "create-database", database: "wt", owner: "waitron_migrator" }], {
      admin,
      database: "wt",
      adminUri: "postgres://admin@localhost:5432/postgres",
      migrationsRoot: null,
      openTarget: (): Promise<TargetConnection> =>
        Promise.reject(new Error("openTarget must not be reached by this action")),
    });
    // The owner clause is the whole point of the swap: a database owned by the migrator has every
    // migrated table owned by it, which native replication requires.
    expect(executed).toEqual([`create database "wt" owner "waitron_migrator"`]);
  });
});

describe("applyInstance's create-role statement", () => {
  it("emits no IN ROLE clause for a role that is a member of nothing", async () => {
    // waitron_app (not the migrator) is created AS the migrator on the TARGET handle. A `create role
    // ... login in role` with an empty list is a syntax error, not a harmless no-op, so the empty
    // `memberOf` must drop the clause. Recorded on the target rather than sent to a container:
    // what is under test is the STRING.
    const statements: string[] = [];
    const target = {
      execute: (query: { queryChunks: { value: string[] }[] }) => {
        statements.push(textOf(query));
        return Promise.resolve({ rows: [] });
      },
      close: async () => {},
    } as unknown as Database;

    await applyInstance(
      [
        {
          kind: "create-role",
          role: "waitron_app",
          password: "generated",
          createRole: false,
          memberOf: [],
        },
      ],
      {
        admin: { execute: () => Promise.resolve({ rows: [] }) } as unknown as Database,
        database: "waitron_probe",
        adminUri: "postgres://admin@localhost:5432/postgres",
        migrationsRoot: null,
        openTarget: (): Promise<TargetConnection> =>
          Promise.resolve({ db: target, release: async () => {} }),
      },
    );

    expect(statements).toEqual([`create role "waitron_app" login password 'generated'`]);
    expect(statements[0]).not.toContain("in role");
  });
});

describe("applyInstance's grant-membership failure", () => {
  it("reports a structured refusal naming both roles and the SQLSTATE", async () => {
    // The membership grant runs AS the migrator on the target handle. A grantor without ADMIN OPTION
    // is refused 42501 (proven against a container in `instance-apply.pg.test.ts`); here the target's
    // execute throws it.
    const thrown = await thrownBy(
      GRANT_MEMBERSHIP,
      Object.assign(new Error('permission denied to grant role "app_user"'), { code: "42501" }),
    );
    expect(isAppError(thrown)).toBe(true);
    if (!isAppError(thrown)) return;
    expect(thrown.code).toBe("provisioning.membership_grant_failed");
    expect(thrown.params).toEqual({
      role: "waitron_app",
      memberOf: "app_user",
      sqlState: "42501",
    });
    expect((thrown as Error).cause).toBeUndefined();
  });
});

describe("applyInstance runs the post-migrate role work AS the migrator", () => {
  /** Records DDL run on the admin vs the target, and answers the catalog reads `verifyGrants` makes
   * on the admin (datdba ownership, membership existence). */
  function split(options: { owner?: string; member?: boolean } = {}) {
    const adminDdl: string[] = [];
    const targetDdl: string[] = [];
    const admin = {
      execute: (q: { queryChunks: { value?: string[] }[] }) => {
        const text = textOf(q);
        if (text.includes("pg_database"))
          return Promise.resolve({ rows: [{ owner: options.owner ?? "waitron_migrator" }] });
        if (text.includes("pg_auth_members"))
          return Promise.resolve({ rows: [{ present: options.member ?? true }] });
        adminDdl.push(text);
        return Promise.resolve({ rows: [] });
      },
      transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          execute: (q: { queryChunks: { value?: string[] }[] }) => {
            adminDdl.push(textOf(q));
            return Promise.resolve({ rows: [] });
          },
        };
        return cb(tx);
      },
    } as unknown as Database;
    const target = {
      execute: (q: { queryChunks: { value?: string[] }[] }) => {
        targetDdl.push(textOf(q));
        return Promise.resolve({ rows: [] });
      },
      close: async () => {},
    } as unknown as Database;
    return {
      adminDdl,
      targetDdl,
      deps: {
        admin,
        database: "wt",
        adminUri: "postgres://admin@localhost:5432/postgres",
        migrationsRoot: null,
        openTarget: (): Promise<TargetConnection> =>
          Promise.resolve({ db: target, release: async () => {} }),
      },
    };
  }

  it("grants the membership and creates waitron_app on the target, not the admin", async () => {
    const h = split();
    await applyInstance(
      [
        { kind: "grant-membership", role: "waitron_migrator", memberOf: "app_user" },
        {
          kind: "create-role",
          role: "waitron_app",
          password: "pw",
          createRole: false,
          memberOf: ["app_user"],
        },
      ],
      h.deps,
    );
    // Both run AS the migrator (the target handle carries the role option), because the migrator —
    // not the admin — is the role that holds ADMIN OPTION on app_user.
    expect(h.targetDdl).toEqual([
      `grant "app_user" to "waitron_migrator"`,
      `create role "waitron_app" login password 'pw' in role "app_user"`,
    ]);
    // The admin issued no DDL — only the catalog reads verifyGrants makes.
    expect(h.adminDdl).toEqual([]);
  });

  it("migrates AS the migrator over the role-option connection string", async () => {
    const h = split();
    await applyInstance([{ kind: "migrate" }], h.deps);
    const mock = vi.mocked(applyMigrations);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0]?.[0]).toBe(
      withRole(withDatabase("postgres://admin@localhost:5432/postgres", "wt"), "waitron_migrator"),
    );
  });
});

describe("applyInstance's ownership verification", () => {
  /** A cluster that answers the datdba ownership read and the membership existence read. */
  function cluster(options: { owner?: string; member?: boolean }) {
    const admin = {
      execute: (query: { queryChunks: { value?: string[] }[] }) => {
        const text = textOf(query);
        if (text.includes("pg_database"))
          return Promise.resolve({ rows: [{ owner: options.owner ?? "waitron_migrator" }] });
        if (text.includes("pg_auth_members"))
          return Promise.resolve({ rows: [{ present: options.member ?? true }] });
        return Promise.resolve({ rows: [] });
      },
      close: async () => {},
    } as unknown as Database;
    return {
      admin,
      database: "wt",
      adminUri: "postgres://admin@localhost:5432/postgres",
      migrationsRoot: null,
      openTarget: (): Promise<TargetConnection> =>
        Promise.resolve({ db: admin, release: async () => {} }),
    };
  }

  it("passes when the migrator owns the database after a migrate", async () => {
    await expect(
      applyInstance([{ kind: "migrate" }], cluster({ owner: "waitron_migrator" })),
    ).resolves.toBeUndefined();
  });

  it("refuses when datdba names some other owner", async () => {
    // The whole point of the swap, proven from the fact rather than assumed: ownership is
    // `pg_database.datdba`, not a `has_*` privilege, so a mismatch is a hard refusal.
    let thrown: unknown;
    try {
      await applyInstance([{ kind: "migrate" }], cluster({ owner: "prov_admin" }));
    } catch (error) {
      thrown = error;
    }
    expect(isAppError(thrown)).toBe(true);
    if (!isAppError(thrown)) return;
    expect(thrown.code).toBe("provisioning.database_not_owned");
    expect(thrown.params).toEqual({ database: "wt", owner: "prov_admin" });
  });

  it("refuses when the ownership read comes back empty", async () => {
    // A database dropped between apply and verification reads `rows[0]` undefined; the only safe
    // reading of "we could not see the owner" is that migrator ownership is not proven.
    const empty = {
      execute: () => Promise.resolve({ rows: [] }),
      close: async () => {},
    } as unknown as Database;
    await expect(
      applyInstance([{ kind: "migrate" }], {
        admin: empty,
        database: "wt",
        adminUri: "postgres://admin@localhost:5432/postgres",
        migrationsRoot: null,
        openTarget: (): Promise<TargetConnection> =>
          Promise.resolve({ db: empty, release: async () => {} }),
      }),
    ).rejects.toMatchObject({ code: "provisioning.database_not_owned" });
  });

  it("verifies a membership, and names it when absent, in the plan-summary words", async () => {
    const action: InstanceAction[] = [
      { kind: "migrate" },
      { kind: "grant-membership", role: "waitron_app", memberOf: "app_user" },
    ];
    await expect(applyInstance(action, cluster({ member: true }))).resolves.toBeUndefined();
    await expect(applyInstance(action, cluster({ member: false }))).rejects.toMatchObject({
      code: "provisioning.grant_ineffective",
      params: { database: "wt", missing: [describeAction(action[1] as InstanceAction)] },
    });
  });

  it("does not read ownership when the plan does not migrate", async () => {
    // A create-database-only plan (synthetic — a real plan always migrates right after) must not
    // demand a target connection nor read the catalog: the database may not be readable yet.
    const executed: string[] = [];
    const admin = {
      execute: (query: { queryChunks: { value?: string[] }[] }) => {
        executed.push(textOf(query));
        return Promise.resolve({ rows: [] });
      },
    } as unknown as Database;
    await applyInstance([{ kind: "create-database", database: "wt", owner: "waitron_migrator" }], {
      admin,
      database: "wt",
      adminUri: "postgres://admin@localhost:5432/postgres",
      migrationsRoot: null,
      openTarget: (): Promise<TargetConnection> =>
        Promise.reject(new Error("openTarget must not be reached by this plan")),
    });
    expect(executed).toEqual([`create database "wt" owner "waitron_migrator"`]);
  });
});
