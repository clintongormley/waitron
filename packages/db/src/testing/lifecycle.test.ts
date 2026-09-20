// Real PostgreSQL: tests real database lifecycle helpers and authentication as a probe role.
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import {
  assertSafeIdentifier,
  cloneTemplate,
  pickTemplate,
  probeRoleStatement,
  nextCloneName,
  resolveSharedHandle,
  usePgliteDb,
  useRealPostgres,
  useTemplateDb,
} from "./lifecycle.js";
import { dockerAvailable } from "./harness.js";
import { runMigrationSets, startMigratedPostgres } from "./postgres.js";
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

  // The per-test reset, which is on unless a suite opts out, and which nothing asserted. These two
  // cases are a pair and run in this order: the first leaves a row behind, the second is the one
  // that would see it. Without the reset the second fails - which is the whole reason a suite can
  // write a row without cleaning up after itself.
  it("lets a test write a row", async () => {
    await pg.db.execute(sql`insert into catalogues (name) values ('reset probe')`);
    const result = await pg.db.execute(sql`select count(*)::int as n from catalogues`);
    expect(result.rows[0]).toEqual({ n: 1 });
  });

  it("does not hand the next test the row the last one left", async () => {
    const result = await pg.db.execute(sql`select count(*)::int as n from catalogues`);
    expect(result.rows[0]).toEqual({ n: 0 });
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

// Role-statement generation is pure: both membership shapes can be checked without a container.
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

  it("grants several memberships when inRole is an array", () => {
    expect(
      probeRoleStatement({ name: "probe", password: "pw", inRole: ["app_user", "report_reader"] }),
    ).toBe("create role probe login password 'pw' in role app_user, report_reader");
  });

  // The fields are plain `string` on an exported interface, so safety cannot rest on callers being
  // careful. A quote in the password would otherwise close the literal and change the statement.
  it.each([
    ["name", { name: "probe; drop role app_user --", password: "pw" }],
    ["password", { name: "probe", password: "pw'; drop role app_user --" }],
    ["inRole", { name: "probe", password: "pw", inRole: 'app_user"' }],
    ["inRole", { name: "probe", password: "pw", inRole: ["app_user", 'report_reader"'] }],
  ])("refuses an unsafe %s", (field, probe) => {
    expect(() => probeRoleStatement(probe)).toThrowError(new RegExp(`unsafe ${field}`));
  });

  // Every case above puts its bad character in the MIDDLE of the value, which leaves both ends of
  // the rule — that a token starts where it starts and ends where it ends — unchecked. These two
  // put it at each end instead. They reload the module inside the case on purpose: the rule is a
  // module-level constant, so it is built when the module loads rather than while a test runs, and
  // a mutation test only runs a case it saw the code execute in.
  it.each([
    ["starting with a digit", "1probe"],
    ["ending in a semicolon", "probe;"],
  ])("refuses a name %s", async (_shape, name) => {
    vi.resetModules();
    const { probeRoleStatement: fresh } = await import("./identifiers.js");
    expect(() => fresh({ name, password: "pw" })).toThrowError("unsafe name");
    vi.resetModules();
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
 * `cloneTemplate` is exported (used by both `useTemplateDb` and `harness.ts`'s `describeEachTarget`)
 * and interpolates both identifiers into a `CREATE DATABASE … TEMPLATE` utility statement, which
 * takes no placeholder — so it validates them itself rather than trusting callers (CLAUDE.md §3). The
 * validation runs BEFORE any connection opens, so these need no container: a bad name rejects without
 * a server. Proven by construction here — remove either `assertSafeIdentifier` in `cloneTemplate` and
 * the matching case stops throwing.
 */
describe("cloneTemplate validates its identifiers at the choke point", () => {
  it("rejects an unsafe template name before connecting", async () => {
    await expect(
      cloneTemplate("postgresql://x/y", "t; drop database x --", "clone_1"),
    ).rejects.toThrow(/unsafe template/);
  });

  it("rejects an unsafe clone name before connecting", async () => {
    await expect(
      cloneTemplate("postgresql://x/y", "template_core", "c-1; drop database x --"),
    ).rejects.toThrow(/unsafe clone name/);
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

  it("throws an actionable error when the shared container handle is missing", () => {
    // The getHandle seam returning `undefined` models the misconfiguration (a suite converted to
    // useTemplateDb but its globalSetup not wired) directly. It used to be modelled via the DEFAULT
    // `inject("sharedPg")` path being undefined, but since this package now wires a globalSetup
    // (`src/testing/global-setup.ts`) that path returns a real handle — the seam is the honest way to
    // reach the throw. The default-inject path is exercised for real by describeEachTarget and every
    // converted useTemplateDb suite in this package.
    // The whole message, not a phrase of it: the half that says WHAT TO DO — wire the package's
    // globalSetup to a file that calls startSharedContainer and provides the handle — is the half
    // this error exists for, and a phrase match leaves it free to be deleted.
    expect(() => resolveSharedHandle(() => undefined)).toThrowError(
      "useTemplateDb: no shared container in scope. Wire the package's vitest `globalSetup` to a " +
        'file that calls `startSharedContainer` and `provide("sharedPg", handle)`.',
    );
  });
});

/**
 * The one place `clone_<pid>_<n>` is minted. What it has to guarantee is that no two clones alive at
 * the same moment share a name; the counter is per module and the pid separates concurrent workers.
 */
describe("nextCloneName", () => {
  it("mints clone_<pid>_<n>, counting up", () => {
    const first = nextCloneName();
    const second = nextCloneName();
    expect(first).toMatch(new RegExp(`^clone_${process.pid}_\\d+$`));
    const number = (name: string): number => Number(name.slice(`clone_${process.pid}_`.length));
    expect(number(second)).toBe(number(first) + 1);
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

/**
 * `useRealPostgres` (the per-file-container helper) is tested directly here, its home file, the same
 * way `usePgliteDb` and `useTemplateDb` are — not left to be covered incidentally by consumers. Until
 * this package's own suites converted to `useTemplateDb`, they exercised it for free; now nothing here
 * does, so its coverage would depend on packages that convert later. It stays a live, exported helper
 * (the not-yet-converted packages still use it), so it earns one container boot of its own. The
 * `probeRole` and `setup` options and the read-before-start throw are all driven, so the whole helper
 * is exercised, not just the happy path.
 */
describe.runIf(dockerAvailable())("useRealPostgres against a real container", () => {
  const suite = useRealPostgres({
    start: () =>
      startMigratedPostgres({
        dockerRequired: "useRealPostgres's own test requires Docker — it boots a real container.",
        migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
      }),
    probeRole: { name: "real_probe", password: "probe_pw", inRole: "app_user" },
    setup: async ({ admin }) => {
      await admin.execute(sql.raw("create table setup_marker (x int)"));
    },
    timeoutMs: 120_000,
  });

  // Read at describe-body time — BEFORE beforeAll — mirroring the useTemplateDb block above.
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

  it("migrates the container and exposes a superuser admin", async () => {
    const result = await suite.admin.execute<{ n: number }>(
      sql`select count(*)::int as n from tenants`,
    );
    expect((result.rows[0] as { n: number }).n).toBe(0);
    const who = await suite.admin.execute<{ s: boolean }>(
      sql`select rolsuper as s from pg_roles where rolname = current_user`,
    );
    expect((who.rows[0] as { s: boolean }).s).toBe(true);
  });

  it("ran setup against the container", async () => {
    const result = await suite.admin.execute<{ present: string | null }>(
      sql`select to_regclass('setup_marker')::text as present`,
    );
    expect((result.rows[0] as { present: string | null }).present).toBe("setup_marker");
  });

  it("created the probeRole, reachable via connectAs", async () => {
    const asProbe = await suite.pg.connectAs("real_probe", "probe_pw");
    try {
      const result = await asProbe.execute<{ who: string }>(sql`select current_user as who`);
      expect((result.rows[0] as { who: string }).who).toBe("real_probe");
    } finally {
      await asProbe.close();
    }
  });
});
