import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPostgresDb } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { dockerAvailable } from "./harness.js";
import { databaseUrl, runMigrationSets, type StartedContainer } from "./postgres.js";
import {
  idempotentRoleStatement,
  startSharedContainer,
  type SharedContainerHandle,
} from "./shared-container.js";

const FAKE_URI = "postgresql://owner:secret@127.0.0.1:5432/waitron";

function fakeContainer(stop = vi.fn(async () => {})): StartedContainer {
  return { uri: FAKE_URI, stop };
}

/**
 * `idempotentRoleStatement` is pure, so both its shape and its delegated validation are provable
 * without a container. That it is genuinely idempotent — run twice, no throw — is a runtime
 * property proven in the real block below.
 */
describe("idempotentRoleStatement", () => {
  it("wraps the CREATE ROLE in a duplicate_object-swallowing DO block", () => {
    expect(idempotentRoleStatement({ name: "probe", password: "pw", inRole: "app_user" })).toBe(
      "do $$ begin create role probe login password 'pw' in role app_user; " +
        "exception when duplicate_object then null; end $$",
    );
  });

  // Delegates to probeRoleStatement, so a field that would need escaping is refused rather than
  // interpolated into the DO block's body.
  it("refuses an unsafe field", () => {
    expect(() =>
      idempotentRoleStatement({ name: "probe", password: "pw'; drop role app_user --" }),
    ).toThrowError(/unsafe password/);
  });
});

describe("startSharedContainer without a container", () => {
  it("stops the container when setup throws, and propagates the original error", async () => {
    const stop = vi.fn(async () => {});
    await expect(
      // A hyphen in a template key fails assertSafeIdentifier before any connection is opened —
      // a deterministic mid-setup throw with no daemon required.
      startSharedContainer({
        templates: { "bad-name": async () => {} },
        start: async () => fakeContainer(stop),
      }),
    ).rejects.toThrow(/unsafe template name/);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("propagates a start() failure with no container to stop", async () => {
    await expect(
      startSharedContainer({
        templates: {},
        start: () => Promise.reject(new Error("Cannot connect to the Docker daemon")),
      }),
    ).rejects.toThrow("Docker daemon");
  });

  it("rethrows `dockerRequired` in place of a raw start() failure, keeping the cause", async () => {
    const raw = new Error("Cannot connect to the Docker daemon");
    await expect(
      startSharedContainer({
        templates: {},
        dockerRequired: "start Docker first",
        start: () => Promise.reject(raw),
      }),
    ).rejects.toThrow("start Docker first");
    // The raw daemon error is preserved as the cause, not discarded.
    await startSharedContainer({
      templates: {},
      dockerRequired: "start Docker first",
      start: () => Promise.reject(raw),
    }).catch((error: unknown) => {
      expect((error as { cause?: unknown }).cause).toBe(raw);
    });
  });

  it("returns the container uri and leaves it running until teardown", async () => {
    const stop = vi.fn(async () => {});
    const { handle, teardown } = await startSharedContainer({
      templates: {},
      start: async () => fakeContainer(stop),
    });
    expect(handle.uri).toBe(FAKE_URI);
    expect(handle.templates).toEqual({});
    expect(stop).not.toHaveBeenCalled();
    await teardown();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

describe.runIf(dockerAvailable())("startSharedContainer against a real container", () => {
  let handle: SharedContainerHandle;
  let teardown: () => Promise<void>;

  beforeAll(async () => {
    // Two templates that BOTH run CORE, in one cluster: the second's `CREATE ROLE app_user` would
    // fail with "role already exists" if CORE were not idempotent (it guards on pg_roles — see
    // drizzle/0001_tenancy_rls.sql). That this resolves at all is the proof it is idempotent.
    ({ handle, teardown } = await startSharedContainer({
      templates: {
        core: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
        core_again: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
      },
      // `shared_member` is a member of BOTH app_user and shared_probe — the two-membership case a
      // single-`inRole` role cannot carry, expressed with an inRole ARRAY (apps/server's `sync_applier`
      // is this shape). `shared_probe` precedes it, so it exists when `in role …, shared_probe` runs;
      // `app_user` comes from the CORE template.
      roles: [
        { name: "shared_probe", password: "probe_pw", inRole: "app_user" },
        { name: "shared_member", password: "member_pw", inRole: ["app_user", "shared_probe"] },
      ],
    }));
  }, 120_000);

  afterAll(async () => {
    if (teardown !== undefined) await teardown();
  });

  it("maps each template key to its own migrated database", () => {
    expect(handle.templates).toEqual({ core: "template_core", core_again: "template_core_again" });
  });

  it("a clone of a template has the migrated schema", async () => {
    const admin = await createPostgresDb(handle.uri);
    try {
      await admin.execute(sql.raw(`create database clone_probe template ${handle.templates.core}`));
    } finally {
      await admin.close();
    }
    const clone = await createPostgresDb(databaseUrl(handle.uri, "clone_probe"));
    try {
      const result = await clone.execute<{ n: number }>(
        sql`select count(*)::int as n from tenants`,
      );
      expect((result.rows[0] as { n: number }).n).toBe(0);
    } finally {
      await clone.close();
      const dropper = await createPostgresDb(handle.uri);
      try {
        await dropper.execute(sql.raw("drop database if exists clone_probe with (force)"));
      } finally {
        await dropper.close();
      }
    }
  });

  it("creates a role with several memberships from an inRole array, after the roles it references", async () => {
    const admin = await createPostgresDb(handle.uri);
    try {
      // shared_member's `inRole: ["app_user", "shared_probe"]` produced BOTH memberships; the
      // shared_probe one could only have been created after shared_probe itself, which precedes it
      // in `roles`. The two rows are the observable proof of the array AND the ordering.
      const result = await admin.execute<{ grp: string }>(
        sql`select grp.rolname as grp from pg_auth_members m
            join pg_roles member on member.oid = m.member
            join pg_roles grp on grp.oid = m.roleid
            where member.rolname = 'shared_member' order by grp.rolname`,
      );
      expect(result.rows.map((row) => (row as { grp: string }).grp)).toEqual([
        "app_user",
        "shared_probe",
      ]);
    } finally {
      await admin.close();
    }
  });

  it("created the role once, and creating it again does not throw", async () => {
    const admin = await createPostgresDb(handle.uri);
    try {
      // startSharedContainer already created shared_probe once; run the idempotent statement twice
      // more — neither may throw a `role already exists`.
      const statement = idempotentRoleStatement({
        name: "shared_probe",
        password: "probe_pw",
        inRole: "app_user",
      });
      await admin.execute(sql.raw(statement));
      await admin.execute(sql.raw(statement));
      const result = await admin.execute<{ n: number }>(
        sql`select count(*)::int as n from pg_roles where rolname = 'shared_probe'`,
      );
      expect((result.rows[0] as { n: number }).n).toBe(1);
    } finally {
      await admin.close();
    }
  });
});
