import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import {
  assertSafeIdentifier,
  pickTemplate,
  probeRoleStatement,
  resolveSharedHandle,
  usePgliteDb,
  useTemplateDb,
} from "./lifecycle.js";
import { dockerAvailable } from "./harness.js";
import { runMigrationSets } from "./postgres.js";
import { startSharedContainer, type SharedContainerHandle } from "./shared-container.js";

/**
 * `usePgliteDb` owns its own `beforeAll`/`afterAll`, so a suite using it cannot write an unguarded
 * teardown — the failure mode `guarded-teardowns.test.ts` polices is removed by construction rather
 * than detected. These tests are therefore about the CONTRACT: that the accessor yields a migrated
 * database once the hook has run, and that reading it too early fails loudly instead of yielding
 * `undefined`.
 */
describe("usePgliteDb", () => {
  const pg = usePgliteDb({ migrations: [CORE_MIGRATIONS] });

  // Read at describe-body time — i.e. BEFORE `beforeAll` has run. Captured here rather than inside
  // an `it` because calling the helper from a test body would register hooks after collection,
  // which vitest does not allow.
  let earlyRead: unknown;
  try {
    void pg.db;
  } catch (error) {
    earlyRead = error;
  }

  it("throws a named error if read before the hook has run", () => {
    // Returning `undefined` here is exactly how the unguarded teardowns produced
    // "Cannot read properties of undefined" instead of the real failure.
    expect(earlyRead).toBeInstanceOf(Error);
    expect((earlyRead as Error).message).toMatch(/not started/i);
  });

  it("yields a migrated database", async () => {
    const result = await pg.db.execute(sql`select count(*)::int as n from tenants`);
    expect(result.rows[0]).toEqual({ n: 0 });
  });

  it("yields the same handle throughout the suite", () => {
    expect(pg.db).toBe(pg.db);
  });
});

/**
 * The handle must be assigned the moment the resource exists, not at the end of the hook. If a later
 * step throws — a bad migration, a throwing `setup` — a handle assigned last is still `undefined`,
 * so `afterAll` closes nothing and the resource leaks silently. That is worse than the noisy
 * `TypeError` this helper exists to prevent, because nothing reports it.
 *
 * Proven from inside `setup`, which is the last thing that can throw during startup: if `db` is
 * readable there, it was assigned before anything that could fail, and `afterAll` can always close
 * it. `useRealPostgres` has the identical shape and would need a container to assert it directly.
 */
describe("usePgliteDb assigns its handle before setup can throw", () => {
  let readableInsideSetup = false;
  const pg = usePgliteDb({
    migrations: [CORE_MIGRATIONS],
    setup: async () => {
      try {
        void pg.db;
        readableInsideSetup = true;
      } catch {
        readableInsideSetup = false;
      }
    },
  });

  it("so a failure after startup still leaves the database closable", () => {
    expect(readableInsideSetup).toBe(true);
  });
});

/**
 * `useRealPostgres` itself needs a container, so its happy path is exercised by the RLS suites that
 * use it rather than here. Its one branching decision is extracted so both arms are provable without
 * Docker — a container is a heavy price for asserting a string.
 */
describe("probeRoleStatement", () => {
  it("grants membership when inRole is given", () => {
    expect(probeRoleStatement({ name: "probe", password: "pw", inRole: "app_user" })).toBe(
      "create role probe login password 'pw' in role app_user",
    );
  });

  it("omits the membership clause otherwise", () => {
    expect(probeRoleStatement({ name: "probe", password: "pw" })).toBe(
      "create role probe login password 'pw'",
    );
  });

  // The fields are plain `string` on an exported interface, so safety cannot rest on callers being
  // careful. A quote in the password would otherwise close the literal and change the statement.
  it.each([
    ["name", { name: "probe; drop role app_user --", password: "pw" }],
    ["password", { name: "probe", password: "pw'; drop role app_user --" }],
    ["inRole", { name: "probe", password: "pw", inRole: 'app_user"' }],
  ])("refuses an unsafe %s", (field, probe) => {
    expect(() => probeRoleStatement(probe)).toThrowError(new RegExp(`unsafe ${field}`));
  });
});

/**
 * The identifiers `useTemplateDb`/`startSharedContainer` build reach `CREATE DATABASE`/`DROP
 * DATABASE`, utility statements that take no placeholder — so the name is validated, not bound.
 * Both arms are provable without a container.
 */
describe("assertSafeIdentifier", () => {
  it("returns the value unchanged when it is a safe token", () => {
    expect(assertSafeIdentifier("clone name", "clone_42")).toBe("clone_42");
  });

  it("refuses a value that is not a safe token", () => {
    expect(() => assertSafeIdentifier("clone name", "clone-42; drop database x --")).toThrowError(
      /unsafe clone name/,
    );
  });
});

/**
 * The seam that lets `useTemplateDb` be tested without a globalSetup. A supplied `getHandle` is
 * used verbatim; omitting it falls through to vitest's cross-worker `inject("sharedPg")`, which
 * with no globalSetup providing it is `undefined` here — so the default path both proves it reads
 * that channel AND that an unprovided handle is turned into an actionable error rather than a
 * `Cannot read properties of undefined` three frames deep in `cloneTemplate`.
 */
describe("resolveSharedHandle", () => {
  it("uses a supplied getHandle verbatim", () => {
    const handle: SharedContainerHandle = {
      uri: "postgresql://x/y",
      templates: { core: "template_core" },
    };
    expect(resolveSharedHandle(() => handle)).toBe(handle);
  });

  it("throws an actionable error when no globalSetup provided a shared container", () => {
    // This package wires no globalSetup, so `inject("sharedPg")` is undefined on the default path.
    expect(inject("sharedPg")).toBeUndefined();
    expect(() => resolveSharedHandle(undefined)).toThrowError(/no shared container in scope/);
  });
});

describe("pickTemplate", () => {
  const handle: SharedContainerHandle = {
    uri: "postgresql://x/y",
    templates: { core: "template_core", manifest: "template_manifest" },
  };

  it("returns the database name a template key maps to", () => {
    expect(pickTemplate(handle, "manifest")).toBe("template_manifest");
  });

  it("throws naming what IS available when the key is unknown", () => {
    expect(() => pickTemplate(handle, "missing")).toThrowError(
      /no template named "missing".*core.*manifest/s,
    );
  });
});

/**
 * `useTemplateDb` needs a shared container, so its happy path is exercised here directly rather
 * than left to a converted consumer. The container is booted once for the block; each assertion
 * about a clone runs against a database no other test has touched, cloned from the migrated
 * `core` template.
 */
describe.runIf(dockerAvailable())("useTemplateDb against a real container", () => {
  let handle: SharedContainerHandle | undefined;
  let teardown: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    ({ handle, teardown } = await startSharedContainer({
      templates: { core: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]) },
      roles: [{ name: "shared_probe", password: "probe_pw", inRole: "app_user" }],
    }));
  }, 120_000);

  afterAll(async () => {
    if (teardown !== undefined) await teardown();
  });

  describe("clones the template into a fresh admin-owned database", () => {
    let readableInsideSetup = false;
    const suite = useTemplateDb({
      template: "core",
      getHandle: () => {
        if (handle === undefined) throw new Error("shared handle not booted yet");
        return handle;
      },
      setup: async ({ admin }) => {
        // Proves the handle is assigned before setup can throw (same property usePgliteDb asserts):
        // if `suite.pg` is readable here, afterAll can always drop the clone.
        try {
          void suite.pg;
          readableInsideSetup = true;
        } catch {
          readableInsideSetup = false;
        }
        // A marker the "setup ran" assertion below reads back — also proves the admin connection
        // seeds the clone, not the template.
        await admin.execute(sql.raw("create table setup_marker (x int)"));
      },
    });

    // Read at describe-body time — BEFORE beforeAll — the same way lifecycle's usePgliteDb test
    // captures its early read.
    let earlyRead: unknown;
    try {
      void suite.pg;
    } catch (error) {
      earlyRead = error;
    }

    it("throws a named error if read before the hook has run", () => {
      expect(earlyRead).toBeInstanceOf(Error);
      expect((earlyRead as Error).message).toMatch(/not started/i);
    });

    it("yields a migrated clone", async () => {
      const result = await suite.pg.connect().then(async (db) => {
        try {
          return await db.execute<{ n: number }>(sql`select count(*)::int as n from tenants`);
        } finally {
          await db.close();
        }
      });
      expect((result.rows[0] as { n: number }).n).toBe(0);
    });

    it("assigns its handle before setup can throw", () => {
      expect(readableInsideSetup).toBe(true);
    });

    it("ran setup against the clone", async () => {
      const result = await suite.admin.execute<{ present: string | null }>(
        sql`select to_regclass('setup_marker')::text as present`,
      );
      expect((result.rows[0] as { present: string | null }).present).toBe("setup_marker");
    });

    it("admin is a superuser connection", async () => {
      const result = await suite.admin.execute<{ s: boolean }>(
        sql`select rolsuper as s from pg_roles where rolname = current_user`,
      );
      expect((result.rows[0] as { s: boolean }).s).toBe(true);
    });

    it("connectAs reaches a role startSharedContainer created once at the cluster", async () => {
      const asProbe = await suite.pg.connectAs("shared_probe", "probe_pw");
      try {
        const result = await asProbe.execute<{ who: string }>(sql`select current_user as who`);
        expect((result.rows[0] as { who: string }).who).toBe("shared_probe");
      } finally {
        await asProbe.close();
      }
    });
  });
});
