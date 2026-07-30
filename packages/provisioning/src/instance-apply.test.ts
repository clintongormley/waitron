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
    expect(thrown.params).toEqual({ role: "waitron_migrator", sqlstate: "42710" });
  });

  it("finds a SQLSTATE that the driver's wrapper buried under .cause", async () => {
    // Drizzle does not re-expose the pg error's `code` on its own wrapper; it attaches the original
    // as `cause`. Asserted here against a hand-built two-level shape, and against the REAL Drizzle
    // shape in `instance-apply.rls.test.ts` ("never lets the generated password reach a thrown
    // error", which pins `sqlstate: "42704"` from an actual container).
    const buried = Object.assign(new Error("Failed query: create role ..."), {
      cause: Object.assign(new Error('role "app_user" does not exist'), { code: "42704" }),
    });
    const thrown = await thrownBy(CREATE_ROLE, buried);
    expect(isAppError(thrown)).toBe(true);
    if (!isAppError(thrown)) return;
    expect(thrown.params).toEqual({ role: "waitron_migrator", sqlstate: "42704" });
  });

  it("reports null rather than inventing one when there is no SQLSTATE", async () => {
    const thrown = await thrownBy(CREATE_ROLE, new Error("the pool is closed"));
    expect(isAppError(thrown)).toBe(true);
    if (!isAppError(thrown)) return;
    expect(thrown.params).toEqual({ role: "waitron_migrator", sqlstate: null });
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
    expect(thrown.params).toEqual({ role: "waitron_migrator", sqlstate: null });
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
    expect(thrown.params).toEqual({ role: "waitron_migrator", sqlstate: null });
  });

  it("does not spin on a self-referential cause chain", async () => {
    const cyclic: { message: string; cause?: unknown } = { message: "round and round" };
    cyclic.cause = cyclic;
    const thrown = await thrownBy(CREATE_ROLE, cyclic);
    expect(isAppError(thrown)).toBe(true);
    if (!isAppError(thrown)) return;
    expect(thrown.params).toEqual({ role: "waitron_migrator", sqlstate: null });
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
      sqlstate: "42501",
    });
    expect((thrown as Error).cause).toBeUndefined();
  });
});
