import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { Database } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { dockerAvailable } from "./harness.js";
import {
  databaseUrl,
  roleUrl,
  runMigrationSets,
  startMigratedPostgres,
  type RealPostgres,
  type StartedContainer,
} from "./postgres.js";

const FAKE_URI = "postgresql://owner:secret@127.0.0.1:5432/waitron";

function fakeContainer(stop = vi.fn(async () => {})): StartedContainer {
  return { uri: FAKE_URI, stop };
}

describe("roleUrl", () => {
  it("swaps the credentials and leaves host, port and database alone", () => {
    const swapped = new URL(roleUrl(FAKE_URI, "app_probe", "pw"));
    expect(swapped.username).toBe("app_probe");
    expect(swapped.password).toBe("pw");
    expect(swapped.host).toBe("127.0.0.1:5432");
    expect(swapped.pathname).toBe("/waitron");
  });
});

describe("databaseUrl", () => {
  it("swaps the database and leaves credentials, host and port alone", () => {
    const swapped = new URL(databaseUrl(FAKE_URI, "clone_7"));
    expect(swapped.pathname).toBe("/clone_7");
    expect(swapped.username).toBe("owner");
    expect(swapped.password).toBe("secret");
    expect(swapped.host).toBe("127.0.0.1:5432");
  });
});

describe("startMigratedPostgres when the container will not start", () => {
  const options = {
    dockerRequired: "The example suite requires a running Docker daemon.",
    migrate: async () => {},
    start: () => Promise.reject(new Error("Cannot connect to the Docker daemon")),
  };

  it("throws the caller's own message, never a generic one", async () => {
    await expect(startMigratedPostgres(options)).rejects.toThrow(
      "The example suite requires a running Docker daemon.",
    );
  });

  it("keeps the underlying failure as the cause", async () => {
    const error = await startMigratedPostgres(options).catch((e: unknown) => e);
    expect((error as Error).cause).toBeInstanceOf(Error);
    expect(((error as Error).cause as Error).message).toContain("Docker daemon");
  });
});

describe("startMigratedPostgres when migration fails", () => {
  it("stops the container and propagates the original error", async () => {
    const stop = vi.fn(async () => {});
    const boom = new Error("relation already exists");
    await expect(
      startMigratedPostgres({
        dockerRequired: "unused here",
        migrate: () => Promise.reject(boom),
        start: async () => fakeContainer(stop),
      }),
    ).rejects.toBe(boom);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

describe("startMigratedPostgres on the happy path", () => {
  it("exposes the container's uri and leaves it running until the caller stops it", async () => {
    const stop = vi.fn(async () => {});
    const pg = await startMigratedPostgres({
      dockerRequired: "unused here",
      migrate: async () => {},
      start: async () => fakeContainer(stop),
    });
    expect(pg.uri).toBe(FAKE_URI);
    expect(stop).not.toHaveBeenCalled();
    await pg.stop();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("passes the container's uri to migrate", async () => {
    const migrate = vi.fn(async () => {});
    await startMigratedPostgres({
      dockerRequired: "unused here",
      migrate,
      start: async () => fakeContainer(),
    });
    expect(migrate).toHaveBeenCalledWith(FAKE_URI);
  });
});

describe.runIf(dockerAvailable())("against a real container", () => {
  let pg: RealPostgres;

  beforeAll(async () => {
    pg = await startMigratedPostgres({
      dockerRequired: "This test starts its own container and is gated on dockerAvailable().",
      migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
    });
  }, 120_000);

  afterAll(async () => {
    if (pg !== undefined) await pg.stop();
  });

  it("connect() reaches a migrated database", async () => {
    const db = await pg.connect();
    try {
      const result = await db.execute<{ n: number }>(sql`select count(*)::int as n from tenants`);
      expect((result.rows[0] as { n: number }).n).toBe(0);
    } finally {
      await db.close();
    }
  });

  it("gives every connect() its own backend process", async () => {
    const [a, b] = await Promise.all([pg.connect(), pg.connect()]);
    try {
      const pidOf = async (db: Database) => {
        const result = await db.execute<{ pid: number }>(sql`select pg_backend_pid()::int as pid`);
        return (result.rows[0] as { pid: number }).pid;
      };
      expect(await pidOf(a)).not.toBe(await pidOf(b));
    } finally {
      await a.close();
      await b.close();
    }
  });

  it("connectAs() authenticates as the role the caller created", async () => {
    const owner = await pg.connect();
    try {
      await owner.execute(sql.raw("create role probe login password 'probe_pw'"));
    } finally {
      await owner.close();
    }
    const asProbe = await pg.connectAs("probe", "probe_pw");
    try {
      const result = await asProbe.execute<{ who: string }>(sql`select current_user as who`);
      expect((result.rows[0] as { who: string }).who).toBe("probe");
    } finally {
      await asProbe.close();
    }
  });

  /**
   * Runs `work` and proves it left no backend process behind.
   *
   * A separate, long-lived connection is the observer: it is the constant against which both the
   * "before" and "after" counts are taken, so only `work`'s own connection can account for a
   * difference between them.
   *
   * Both of `runMigrationSets`'s close paths go through here, because a guard with no test that
   * fails when it is deleted is not a guard. The failure path was the one the five copies this
   * module replaces got wrong; the success path is the one a later edit could quietly drop while
   * the failure-path test stayed green.
   */
  const expectNoLeakedBackend = async (work: () => Promise<unknown>): Promise<void> => {
    const observer = await pg.connect();
    try {
      const backendCount = async (): Promise<number> => {
        const result = await observer.execute<{ n: number }>(
          sql`select count(*)::int as n from pg_stat_activity where datname = current_database()`,
        );
        return (result.rows[0] as { n: number }).n;
      };

      const before = await backendCount();
      await work();

      // `runMigrationSets` awaits its close before returning or rethrowing, so the close has
      // already happened by now — but PostgreSQL can take a moment to reap the backend process
      // after the client disconnects, so poll on a short deadline rather than asserting
      // immediately.
      //
      // toBeLessThanOrEqual, not toBe: `before` is itself a snapshot, and a backend from an
      // earlier test in this file can still be winding down when it is taken. If that happens,
      // `before` is inflated by one and exact equality would fail on a race that has nothing to
      // do with the code under test. A leaked backend from THIS call still pins `after` at
      // `before + 1` for the whole deadline, which toBeLessThanOrEqual still catches.
      const deadline = Date.now() + 2000;
      let after = await backendCount();
      while (after > before && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        after = await backendCount();
      }
      expect(after).toBeLessThanOrEqual(before);
    } finally {
      await observer.close();
    }
  };

  it("runMigrationSets rejects when a set's folder holds no migrations, and closes its connection", async () => {
    await expectNoLeakedBackend(async () => {
      await expect(
        runMigrationSets(pg.uri, [
          { migrationsFolder: "/nonexistent-waitron-migrations", migrationsTable: "probe" },
        ]),
      ).rejects.toThrow();
    });
  });

  it("runMigrationSets closes its connection when every set succeeds", async () => {
    // CORE_MIGRATIONS has already run against this container in beforeAll, so Drizzle's journal
    // makes this a no-op — which is the point: the migrations are not under test here, the
    // connection's fate on the path where nothing throws is.
    await expectNoLeakedBackend(() => runMigrationSets(pg.uri, [CORE_MIGRATIONS]));
  });
});
