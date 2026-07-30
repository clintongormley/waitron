import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import type { Database } from "@waitron/db";
import { applyInstance } from "./instance-apply.js";
import type { InstanceAction } from "./instance-plan.js";

/**
 * The light target, deliberately (CLAUDE.md §4: "pick the lighter one when the heavier one's
 * justification does not apply").
 *
 * What these tests exercise is how `applyInstance` CLASSIFIES a failure its admin connection hands
 * back — which `code` it rethrows, and what it keeps of the original. None of that involves
 * privileges, RLS or concurrency, so neither PGlite nor a container is needed: a fake `admin` whose
 * `execute` throws exactly the error under test reaches the branch directly, and is the only way to
 * reach the "the driver gave us no SQLSTATE at all" branch at all — a real Postgres always gives
 * one.
 *
 * The real-shape receipts live in `instance-apply.rls.test.ts`, against a container: that a genuine
 * Drizzle failure actually carries `42704` where this file's walk looks for it, and that a genuine
 * non-owning CREATEROLE admin actually fails a membership grant with `42501`.
 */
function throwingAdmin(error: unknown): Database {
  return {
    execute: () => {
      throw error;
    },
  } as unknown as Database;
}

function depsThrowing(error: unknown) {
  return {
    admin: throwingAdmin(error),
    database: "waitron_probe",
    adminUri: "postgres://admin@localhost:5432/postgres",
    migrationsRoot: null,
    openTarget: (): Promise<Database> =>
      Promise.reject(new Error("openTarget must not be reached by these actions")),
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

const CREATE_ROLE: InstanceAction[] = [
  {
    kind: "create-role",
    role: "waitron_migrator",
    password: "unmistakable-generated-password-marker",
    createRole: true,
    memberOf: ["app_user"],
  },
];

const GRANT_MEMBERSHIP: InstanceAction[] = [
  { kind: "grant-membership", role: "waitron_app", memberOf: "app_user" },
];

describe("applyInstance's create-role failure", () => {
  it("carries the SQLSTATE the driver reported", async () => {
    // Why this param exists: `role` alone cannot tell an operator whether the role already exists
    // (42710), whether the membership target does not (42704), or whether their admin connection
    // simply is not allowed to do this (42501). Those three want three different next actions, and
    // before this param the answer was "read the Postgres log".
    const thrown = await thrownBy(CREATE_ROLE, Object.assign(new Error("boom"), { code: "42710" }));
    expect(isAppError(thrown)).toBe(true);
    if (!isAppError(thrown)) return;
    expect(thrown.code).toBe("provisioning.role_creation_failed");
    expect(thrown.params).toEqual({ role: "waitron_migrator", sqlState: "42710" });
  });

  it("finds a SQLSTATE that the driver's wrapper buried under .cause", async () => {
    // Drizzle does not re-expose the pg error's `code` on its own wrapper; it attaches the original
    // as `cause`. Asserted here against a hand-built two-level shape, and against the REAL Drizzle
    // shape in `instance-apply.rls.test.ts` ("never lets the generated password reach a thrown
    // error", which pins `sqlState: "42704"` from an actual container).
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
    // The shape check is the whole safety argument for printing this param: five characters of
    // `[0-9A-Z]` cannot be a 32-character base64url password (identifiers.ts) or a connection
    // string. Node's own error codes are the realistic near-miss — `ENOENT` is six characters, so
    // it is dropped rather than surfaced as a fake SQLSTATE.
    const thrown = await thrownBy(
      CREATE_ROLE,
      Object.assign(new Error("no such file"), { code: "ENOENT" }),
    );
    expect(isAppError(thrown)).toBe(true);
    if (!isAppError(thrown)) return;
    expect(thrown.params).toEqual({ role: "waitron_migrator", sqlState: null });
  });

  it("still never lets the generated password reach the thrown error", async () => {
    // The property `51b1e4d` added and this param must not undo: the failing statement embeds the
    // generated password in its literal text, and both Drizzle's wrapper and Postgres's own message
    // quote that statement back.
    const leaky = Object.assign(
      new Error(
        'Failed query: create role "waitron_migrator" login createrole password ' +
          "'unmistakable-generated-password-marker' in role \"app_user\"",
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
    // A chain that is long but not cyclic: the SQLSTATE sits below the depth bound, so it is not
    // found. Losing a diagnostic on an absurd error shape is the deliberate trade for a walk that
    // terminates — reporting `null` is exactly what "no SQLSTATE to be had" already means.
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

describe("applyInstance's create-role statement", () => {
  it("emits no IN ROLE clause for a role that is a member of nothing", async () => {
    // Every role `REQUIREMENTS` (instance-plan.ts) describes today is a member of something, so
    // nothing else in this package reaches this branch — and a `create role ... login in role`
    // with an empty list is a syntax error, not a harmless no-op. Recorded rather than asserted
    // through a container because what is under test is the STRING, not what Postgres does with it.
    // Every statement in this file is built with `sql.raw`, whose whole text lands in a single
    // `StringChunk` — `{ queryChunks: [{ value: ["create role ..."] }] }`, confirmed by inspecting
    // a real `sql.raw` object rather than assumed. Reading it back is what lets this assert the
    // literal SQL without a database to send it to.
    const statements: string[] = [];
    const admin = {
      execute: (query: { queryChunks: { value: string[] }[] }) => {
        statements.push(query.queryChunks.map((chunk) => chunk.value.join("")).join(""));
        return Promise.resolve({ rows: [] });
      },
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
        admin,
        database: "waitron_probe",
        adminUri: "postgres://admin@localhost:5432/postgres",
        migrationsRoot: null,
        openTarget: (): Promise<Database> =>
          Promise.reject(new Error("openTarget must not be reached by these actions")),
      },
    );

    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe(`create role "waitron_app" login password 'generated'`);
    expect(statements[0]).not.toContain("in role");
  });
});

describe("applyInstance's grant-membership failure", () => {
  it("reports a structured refusal naming both roles and the SQLSTATE", async () => {
    // Before this catch existed the driver's own error escaped raw. That is a reachable path for a
    // real operator, not a hypothetical: a CREATEROLE admin that did not itself create `app_user`
    // holds no ADMIN OPTION on it and Postgres refuses the grant with 42501 — proven against a
    // container in `instance-apply.rls.test.ts`.
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

describe("applyInstance's post-apply grant verification", () => {
  /**
   * A fake cluster that answers the three ACL reads. `datacl`/`nspacl` shapes are the ones a real
   * `postgres:18-alpine` produced, copied rather than invented:
   * `{=Tc/owner_a,owner_a=CTc/owner_a,r_mig=C/owner_a}` for a database granted by its owner, and for
   * `public` granted WITH GRANT OPTION, `pg_database_owner=UC` and `=U` and `r_mig=C*`, each
   * followed by a slash and `pg_database_owner`.
   */
  function cluster(options: { datacl?: string[]; nspacl?: string[]; member?: boolean }) {
    const answer = (query: { queryChunks: { value?: string[] }[] }) => {
      const text = query.queryChunks.map((chunk) => chunk.value?.join("") ?? "").join(" ");
      if (text.includes("pg_database"))
        return Promise.resolve({ rows: [{ acl: options.datacl ?? [] }] });
      if (text.includes("pg_namespace"))
        return Promise.resolve({ rows: [{ acl: options.nspacl ?? [] }] });
      if (text.includes("pg_auth_members")) {
        return Promise.resolve({ rows: [{ present: options.member ?? false }] });
      }
      return Promise.resolve({ rows: [] });
    };
    // `close` is real: `applyInstance`'s `finally` closes whatever `openTarget` returned, and a
    // fixture without it turned a refusal into `TypeError: target?.close is not a function`.
    const db = { execute: answer, close: async () => {} } as unknown as Database;
    return {
      admin: db,
      database: "acl_db",
      adminUri: "postgres://admin@localhost:5432/postgres",
      migrationsRoot: null,
      openTarget: (): Promise<Database> => Promise.resolve(db),
    };
  }

  const DATABASE_GRANT: InstanceAction[] = [
    { kind: "grant-database-create", role: "waitron_migrator", database: "acl_db" },
  ];
  const SCHEMA_GRANT: InstanceAction[] = [
    { kind: "grant-schema-create", role: "waitron_migrator", withGrantOption: true },
  ];

  it("passes when the ACL carries the grant the plan asked for", async () => {
    await expect(
      applyInstance(
        DATABASE_GRANT,
        cluster({ datacl: ["=Tc/owner_a", "owner_a=CTc/owner_a", "waitron_migrator=C/owner_a"] }),
      ),
    ).resolves.toBeUndefined();
  });

  it("refuses when the GRANT succeeded but the ACL does not carry it", async () => {
    // The silent case, and the whole reason this check exists: PostgreSQL answers a GRANT from a
    // role with no grant option with a WARNING, so `execute` resolves and the privilege is absent.
    let thrown: unknown;
    try {
      await applyInstance(
        DATABASE_GRANT,
        cluster({ datacl: ["=Tc/owner_a", "owner_a=CTc/owner_a"] }),
      );
    } catch (error) {
      thrown = error;
    }
    expect(isAppError(thrown)).toBe(true);
    if (!isAppError(thrown)) return;
    expect(thrown.code).toBe("provisioning.grant_ineffective");
    expect(thrown.params).toEqual({
      database: "acl_db",
      missing: ["create on database acl_db to waitron_migrator"],
    });
  });

  it("refuses a NULL datacl, which is what a database nobody granted on reads as", async () => {
    await expect(applyInstance(DATABASE_GRANT, cluster({ datacl: [] }))).rejects.toMatchObject({
      code: "provisioning.grant_ineffective",
    });
  });

  it("treats a bare C as missing when the plan asked for WITH GRANT OPTION", async () => {
    // The `*` is not cosmetic: the empty-database migrations re-grant CREATE ON SCHEMA public to
    // each support role they create and then revoke it, and a grant this role cannot pass on fails
    // partway through that dance (instance-plan.ts). A check that ignored the option would call a
    // half-provisioned deployment good.
    await expect(
      applyInstance(SCHEMA_GRANT, cluster({ nspacl: ["waitron_migrator=C/pg_database_owner"] })),
    ).rejects.toMatchObject({ code: "provisioning.grant_ineffective" });

    await expect(
      applyInstance(SCHEMA_GRANT, cluster({ nspacl: ["waitron_migrator=C*/pg_database_owner"] })),
    ).resolves.toBeUndefined();
  });

  it("does not mistake PUBLIC's own empty-grantee entry for a role's", async () => {
    // `=U/pg_database_owner` is the grant to PUBLIC. Matching on a bare `=` rather than `<role>=`
    // would read it as satisfying any role.
    await expect(
      applyInstance(SCHEMA_GRANT, cluster({ nspacl: ["=UC*/pg_database_owner"] })),
    ).rejects.toMatchObject({ code: "provisioning.grant_ineffective" });
  });

  it("verifies a membership, and names it when absent", async () => {
    const action: InstanceAction[] = [
      { kind: "grant-membership", role: "waitron_app", memberOf: "app_user" },
    ];
    await expect(applyInstance(action, cluster({ member: true }))).resolves.toBeUndefined();
    await expect(applyInstance(action, cluster({ member: false }))).rejects.toMatchObject({
      code: "provisioning.grant_ineffective",
      params: { database: "acl_db", missing: ["app_user to waitron_app"] },
    });
  });

  it("collects every missing grant rather than stopping at the first", async () => {
    const actions: InstanceAction[] = [...DATABASE_GRANT, ...SCHEMA_GRANT];
    let thrown: unknown;
    try {
      await applyInstance(actions, cluster({}));
    } catch (error) {
      thrown = error;
    }
    expect(isAppError(thrown)).toBe(true);
    if (!isAppError(thrown)) return;
    // Both, so one re-run fixes everything rather than uncovering the next failure each time.
    expect(thrown.params).toEqual({
      database: "acl_db",
      missing: [
        "create on database acl_db to waitron_migrator",
        "create on schema public to waitron_migrator with grant option",
      ],
    });
  });

  it("refuses when the catalog read comes back empty rather than assuming the best", async () => {
    // A database dropped between the plan and the verification, or a `public` schema that is not
    // there. `rows[0]` is then undefined, and the only safe reading of "we could not see the ACL"
    // is that the grant is not proven — not that it is fine.
    const empty = { execute: () => Promise.resolve({ rows: [] }), close: async () => {} };
    const deps = {
      admin: empty as unknown as Database,
      database: "acl_db",
      adminUri: "postgres://admin@localhost:5432/postgres",
      migrationsRoot: null,
      openTarget: (): Promise<Database> => Promise.resolve(empty as unknown as Database),
    };
    await expect(applyInstance(DATABASE_GRANT, deps)).rejects.toMatchObject({
      code: "provisioning.grant_ineffective",
    });
    await expect(applyInstance(SCHEMA_GRANT, deps)).rejects.toMatchObject({
      code: "provisioning.grant_ineffective",
    });
    await expect(
      applyInstance(
        [{ kind: "grant-membership", role: "waitron_app", memberOf: "app_user" }],
        deps,
      ),
    ).rejects.toMatchObject({ code: "provisioning.grant_ineffective" });
  });

  it("checks a schema grant that did NOT ask for the grant option", async () => {
    // `REQUIREMENTS` gives only `waitron_migrator` a schema grant and always WITH GRANT OPTION, so
    // nothing in a real plan reaches the plain branch — but `InstanceAction` permits it, and a bare
    // `C` must satisfy a request that did not ask for the option.
    const plain: InstanceAction[] = [
      { kind: "grant-schema-create", role: "waitron_app", withGrantOption: false },
    ];
    await expect(
      applyInstance(plain, cluster({ nspacl: ["waitron_app=C/pg_database_owner"] })),
    ).resolves.toBeUndefined();
    await expect(
      applyInstance(plain, cluster({ nspacl: ["waitron_app=U/pg_database_owner"] })),
    ).rejects.toMatchObject({
      code: "provisioning.grant_ineffective",
      params: { database: "acl_db", missing: ["create on schema public to waitron_app"] },
    });
  });

  it("reads nothing at all when the plan carries no grants", async () => {
    // A plan of only `create-database` must not pay for three catalog reads, and more importantly
    // must not demand a target connection that may not exist yet.
    const executed: string[] = [];
    const admin = {
      execute: (query: { queryChunks: { value?: string[] }[] }) => {
        executed.push(query.queryChunks.map((chunk) => chunk.value?.join("") ?? "").join(""));
        return Promise.resolve({ rows: [] });
      },
    } as unknown as Database;
    await applyInstance([{ kind: "create-database", database: "acl_db" }], {
      admin,
      database: "acl_db",
      adminUri: "postgres://admin@localhost:5432/postgres",
      migrationsRoot: null,
      openTarget: (): Promise<Database> =>
        Promise.reject(new Error("openTarget must not be reached by these actions")),
    });
    expect(executed).toEqual(['create database "acl_db"']);
  });
});
