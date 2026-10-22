import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTransaction, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  hashPin,
  hashSessionToken,
  managementSessions,
  persons,
  startManagementSession,
  withPassiveManagementRead,
  type PersonRoleValue,
} from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { collectBoxHealth, type BoxHealth, type BoxHealthReaders } from "./box-health.js";
import { mountBoxHealthApi } from "./box-health-api.js";
import type { FreedSpace } from "./free-space-now.js";
import { createStaffNoticeLog } from "./staff-notices.js";
import "./errors.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

const HEALTH = { at: "2026-10-22T09:00:00.000Z" } as BoxHealth;
const FREED: FreedSpace = {
  freedBytes: 700_000,
  deleted: 3,
  failed: 0,
  backupRunning: false,
  freeBytes: 900_000,
};

interface Person {
  id: string;
  token: string;
  cookie: string;
}

let manager: Person;
let admin: Person;
let supervisor: Person;

async function seedPerson(role: PersonRoleValue, name: string): Promise<Person> {
  return withTransaction(suite.db, async (tx) => {
    const [p] = await tx
      .insert(persons)
      .values({ displayName: name, pinHash: hashPin("1234"), role })
      .returning({ id: persons.id });
    const session = await startManagementSession(tx, { personId: p!.id });
    return { id: p!.id, token: session.token, cookie: `${MANAGEMENT_COOKIE}=${session.token}` };
  });
}

beforeEach(async () => {
  manager = await seedPerson("manager", "Marta");
  admin = await seedPerson("admin", "Ana");
  supervisor = await seedPerson("supervisor", "Sergio");
});

function mount(db: Database, readHealth: () => Promise<BoxHealth> = async () => HEALTH) {
  const deps = {
    db,
    readHealth: vi.fn(readHealth),
    freeSpace: vi.fn<(personId: string) => Promise<FreedSpace>>(async () => FREED),
  };
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (c.req.method === "GET" && c.req.header("x-waitron-live") === "1") {
      await withPassiveManagementRead(next);
    } else await next();
  });
  mountBoxHealthApi(app, deps, () => {});
  return { app, deps };
}

function get(app: Hono, cookie?: string, passive = false) {
  return app.request("/api/box/health", {
    headers: {
      ...(cookie === undefined ? {} : { cookie }),
      ...(passive ? { "x-waitron-live": "1" } : {}),
    },
  });
}

function post(app: Hono, cookie?: string) {
  return app.request("/api/box/free-space", {
    method: "POST",
    headers: cookie === undefined ? {} : { cookie },
  });
}

/** Not through `withTransaction`, whose drain would deliver a change a case left waiting. */
async function setLastSeen(person: Person, at: Date): Promise<void> {
  await suite.db
    .update(managementSessions)
    .set({ lastSeenAt: at.toISOString() })
    .where(eq(managementSessions.tokenHash, hashSessionToken(person.token)));
}

async function lastSeen(person: Person): Promise<string> {
  const [row] = await suite.db
    .select({ lastSeenAt: managementSessions.lastSeenAt })
    .from(managementSessions)
    .where(eq(managementSessions.tokenHash, hashSessionToken(person.token)));
  return row!.lastSeenAt;
}

/** A disk so full that the first write of every write turn is refused before it runs. */
function lockRefusingDb(error: Error): Database {
  return new Proxy(suite.db, {
    get(target, prop) {
      if (prop === "withWriteLock") {
        return async () => {
          throw error;
        };
      }
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

/** A full disk that refuses any write turn which changed a row; a turn that only reads commits. */
function writeRefusingDb(): Database {
  const changes = () => suite.db.all<{ n: number }>(sql`select total_changes() as n`)[0]!.n;
  return new Proxy(suite.db, {
    get(target, prop) {
      if (prop === "withWriteLock") {
        return <T>(body: () => Promise<T>) =>
          target.withWriteLock(async () => {
            const before = changes();
            const value = await body();
            if (changes() !== before) throw new AppError("storage.disk_full", {});
            return value;
          });
      }
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

const DISK_FULL = () => new AppError("storage.disk_full", {});

describe.each([
  ["with room", () => suite.db],
  ["on a full disk", () => lockRefusingDb(DISK_FULL())],
])("%s", (_label, db) => {
  it("a manager reads the health and frees space as themselves", async () => {
    const { app, deps } = mount(db());
    const read = await get(app, manager.cookie);
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(HEALTH);
    const freed = await post(app, manager.cookie);
    expect(freed.status).toBe(200);
    expect(await freed.json()).toEqual(FREED);
    expect(deps.freeSpace).toHaveBeenCalledTimes(1);
    expect(deps.freeSpace).toHaveBeenCalledWith(manager.id);
  });

  it("an admin reads the health and frees space too", async () => {
    const { app, deps } = mount(db());
    expect((await get(app, admin.cookie)).status).toBe(200);
    expect((await post(app, admin.cookie)).status).toBe(200);
    expect(deps.freeSpace).toHaveBeenCalledWith(admin.id);
  });

  async function expectRefused(cookie: string | undefined, status: number, code: string) {
    const { app, deps } = mount(db());
    for (const response of [
      await get(app, cookie),
      await get(app, cookie, true),
      await post(app, cookie),
    ]) {
      expect(response.status).toBe(status);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(code);
    }
    expect(deps.readHealth).not.toHaveBeenCalled();
    expect(deps.freeSpace).not.toHaveBeenCalled();
  }

  it("refuses a request with no session", async () => {
    await expectRefused(undefined, 401, "management_session.required");
  });

  it("refuses a supervisor, who may not manage the system", async () => {
    await expectRefused(supervisor.cookie, 403, "authorization.not_permitted");
  });

  it("refuses an ended session", async () => {
    await withTransaction(suite.db, (tx) =>
      tx
        .update(managementSessions)
        .set({ endedAt: new Date().toISOString() })
        .where(eq(managementSessions.tokenHash, hashSessionToken(manager.token))),
    );
    await expectRefused(manager.cookie, 401, "management_session.required");
  });

  it("refuses a session idle for 31 minutes", async () => {
    await setLastSeen(manager, new Date(Date.now() - 31 * 60_000));
    await expectRefused(manager.cookie, 401, "management_session.expired");
  });

  it("refuses a suspended person", async () => {
    await withTransaction(suite.db, (tx) =>
      tx.update(persons).set({ status: "suspended" }).where(eq(persons.id, manager.id)),
    );
    await expectRefused(manager.cookie, 403, "person.suspended");
  });
});

describe("the session's last-seen time", () => {
  const minuteAgo = () => new Date(Date.now() - 60_000);

  it("is left alone by a passive read and moved by a read or a deletion someone asked for", async () => {
    const { app } = mount(suite.db);

    const seeded = minuteAgo();
    await setLastSeen(manager, seeded);
    expect((await get(app, manager.cookie, true)).status).toBe(200);
    expect(await lastSeen(manager)).toBe(seeded.toISOString());

    for (const call of [() => get(app, manager.cookie), () => post(app, manager.cookie)]) {
      const before = minuteAgo();
      await setLastSeen(manager, before);
      expect((await call()).status).toBe(200);
      expect(Date.parse(await lastSeen(manager))).toBeGreaterThan(before.getTime());
    }
  });

  it("is left alone on a full disk, read or deletion, passive or not", async () => {
    const { app } = mount(lockRefusingDb(DISK_FULL()));
    for (const call of [
      () => get(app, manager.cookie, true),
      () => get(app, manager.cookie),
      () => post(app, manager.cookie),
    ]) {
      const seeded = minuteAgo();
      await setLastSeen(manager, seeded);
      expect((await call()).status).toBe(200);
      expect(await lastSeen(manager)).toBe(seeded.toISOString());
    }
  });
});

describe("on a full disk with a change waiting to be delivered", () => {
  function readers(): BoxHealthReaders {
    return {
      now: () => new Date("2026-10-22T09:00:00Z"),
      notices: {
        sources: [],
        clock: { now: () => ({ at: new Date("2026-10-22T09:00:00Z"), trusted: true }) as never },
        filing: () => true,
        log: createStaffNoticeLog(() => {}),
      },
      stream: () => ({ state: "off" }),
      authorityClock: () => ({ state: "ok", driftSeconds: 0, measuredAt: "2026-10-22T09:00:00Z" }),
      timeHealth: async () => ({ synced: true, source: "timedatectl", warn: false }),
      disk: { since: () => new Date("2026-10-22T08:00:00Z") },
      space: {
        current: () => ({ freeBytes: 0, readAt: new Date("2026-10-22T09:00:00Z"), lowSince: null }),
      },
      usage: async () => ({
        freeBytes: 0,
        totalBytes: 100_000,
        databaseBytes: 10,
        backupsBytes: 20,
        logBytes: 30,
        otherBytes: 40,
      }),
      free: async () => 0,
      leftovers: async () => ({ bytes: 700_000, backupRunning: false }),
      paymentsEnabled: true,
      canFree: () => true,
    };
  }

  beforeEach(() => {
    suite.db.run(
      sql`insert into change_log (id, payload) values ('zz1', '{"resource":"zz","id":"1"}')`,
    );
  });

  const waiting = () => suite.db.all<{ id: string }>(sql`select id from change_log`).length;

  it("the stand-in refuses the change-log delivery a transaction ends with", async () => {
    await expect(withTransaction(writeRefusingDb(), async () => {})).rejects.toMatchObject({
      code: "storage.disk_full",
    });
    expect(waiting()).toBe(1);
  });

  it("answers the box's real health read, passive or not, and leaves the change waiting", async () => {
    const db = writeRefusingDb();
    const { app } = mount(db, () => collectBoxHealth(db, readers()));
    for (const passive of [false, true]) {
      const seeded = new Date(Date.now() - 60_000);
      await setLastSeen(manager, seeded);
      const response = await get(app, manager.cookie, passive);
      expect(response.status).toBe(200);
      const body = (await response.json()) as BoxHealth;
      expect(body.disk.stoppedSince).toBe("2026-10-22T08:00:00.000Z");
      expect(body.sales).toEqual({ lastAt: null });
      expect(await lastSeen(manager)).toBe(seeded.toISOString());
    }
    expect(waiting()).toBe(1);
  });
});

describe("errors other than a full disk", () => {
  it("are not retried by the fallback session check", async () => {
    const { app, deps } = mount(lockRefusingDb(new Error("boom")));
    for (const response of [await get(app, manager.cookie), await post(app, manager.cookie)]) {
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: { code: "server.internal" } });
    }
    expect(deps.readHealth).not.toHaveBeenCalled();
    expect(deps.freeSpace).not.toHaveBeenCalled();
  });

  it("a health read refused by a full disk answers 507", async () => {
    const { app } = mount(suite.db, async () => {
      throw new AppError("storage.disk_full", {});
    });
    const response = await get(app, manager.cookie);
    expect(response.status).toBe(507);
    expect(await response.json()).toEqual({ error: { code: "storage.disk_full", params: {} } });
  });
});
