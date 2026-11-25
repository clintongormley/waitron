import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { withTransaction, type Database, withFoldedPersonChanges } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { recordIncidentOnce } from "@waitron/core";
import {
  hashSessionToken,
  dashboardSessions,
  persons,
  startManagementSession,
  type BuiltInRoleKey,
} from "@waitron/identity";
import { fixturePinHash } from "./testing/known-secret-hashes.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { AppError, backupOrigin } from "@waitron/shared";
import { mountDiskStopApi } from "./disk-stop-api.js";
import "./errors.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

const NOW = new Date("2026-10-25T09:00:00.000Z");
const HOUR = 3_600_000;
const PATH = "/management-api/disk-stop";
const DELETED = { count: 3, date: "2026-10-21", lastDate: "2026-10-24", severalDays: true };

interface Person {
  id: string;
  token: string;
  cookie: string;
}

let staff: Person;
let supervisor: Person;
let manager: Person;
let admin: Person;
let stoppedSince: Date | null;

async function seedPerson(role: BuiltInRoleKey, name: string): Promise<Person> {
  return withTransaction(suite.db, async (tx) => {
    const [p] = await seedPersons(tx, { displayName: name, pinHash: fixturePinHash("1234"), role });
    const session = await startManagementSession(tx, { method: "password", personId: p!.id });
    return { id: p!.id, token: session.token, cookie: `${MANAGEMENT_COOKIE}=${session.token}` };
  });
}

beforeEach(async () => {
  staff = await seedPerson("staff", "Paula");
  supervisor = await seedPerson("supervisor", "Simon");
  manager = await seedPerson("manager", "Martha");
  admin = await seedPerson("admin", "Anna");
  stoppedSince = null;
});

function appFor(db: Database = suite.db): Hono {
  const app = new Hono();
  mountDiskStopApi(app, { db, disk: { since: () => stoppedSince } }, () => {});
  return app;
}

const read = (cookie?: string, app = appFor()) =>
  app.request(PATH, { headers: cookie === undefined ? {} : { cookie } });

async function bodyOf(person: Person, app = appFor()) {
  const response = await read(person.cookie, app);
  expect(response.status).toBe(200);
  return (await response.json()) as { stopped: boolean };
}

async function expectRefused(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe(code);
}

async function recordDeletion(detectedAt: Date): Promise<void> {
  await withTransaction(suite.db, (tx) =>
    recordIncidentOnce(tx, {
      origin: backupOrigin(),
      error: new AppError("backup.archives_deleted", DELETED),
      severity: "warning",
      detectedAt,
    }),
  );
}

/** Not through `withTransaction`, whose drain would deliver a change a case left waiting. */
async function setLastSeen(person: Person, at: Date): Promise<void> {
  await suite.db
    .update(dashboardSessions)
    .set({ lastSeenAt: at.toISOString() })
    .where(eq(dashboardSessions.tokenHash, hashSessionToken(person.token)));
}

async function lastSeen(person: Person): Promise<string> {
  const [row] = await suite.db
    .select({ lastSeenAt: dashboardSessions.lastSeenAt })
    .from(dashboardSessions)
    .where(eq(dashboardSessions.tokenHash, hashSessionToken(person.token)));
  return row!.lastSeenAt;
}

/** A disk that refuses any write turn which changed a row; a turn that only reads commits. */
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

describe("GET /management-api/disk-stop", () => {
  it("answers no stop to a staff session when none is noted", async () => {
    expect(await bodyOf(staff)).toEqual({ stopped: false });
  });

  it("refuses a request with no session", async () => {
    await expectRefused(await read(), 401, "management_session.required");
  });

  it("refuses an idle-expired session", async () => {
    await setLastSeen(staff, new Date(Date.now() - 31 * 60_000));
    await expectRefused(await read(staff.cookie), 401, "management_session.expired");
  });

  it("refuses a suspended person", async () => {
    await withTransaction(suite.db, (tx) =>
      tx
        .update(persons)
        .set(withFoldedPersonChanges({ status: "suspended" }))
        .where(eq(persons.id, staff.id)),
    );
    await expectRefused(await read(staff.cookie), 403, "person.suspended");
  });

  it("tells every role the stop holds", async () => {
    stoppedSince = new Date(NOW.getTime() - HOUR);
    for (const person of [staff, supervisor, manager, admin]) {
      expect(await bodyOf(person)).toEqual({ stopped: true });
    }
  });

  it("answers with just the stop even after a recent backup deletion", async () => {
    stoppedSince = NOW;
    await recordDeletion(new Date(NOW.getTime() - HOUR));
    expect(await bodyOf(manager)).toEqual({ stopped: true });
  });

  it("leaves the session's last-seen time alone", async () => {
    const seeded = new Date(Date.now() - 60_000);
    await setLastSeen(staff, seeded);
    await bodyOf(staff);
    expect(await lastSeen(staff)).toBe(seeded.toISOString());
  });

  it("answers on a full disk with a change waiting, and leaves the change waiting", async () => {
    stoppedSince = NOW;
    await recordDeletion(new Date(NOW.getTime() - HOUR));
    suite.db.run(
      sql`insert into change_log (id, payload) values ('ds1', '{"resource":"zz","id":"1"}')`,
    );
    expect(await bodyOf(manager, appFor(writeRefusingDb()))).toEqual({
      stopped: true,
    });
    expect(suite.db.all<{ id: string }>(sql`select id from change_log where id = 'ds1'`)).toEqual([
      { id: "ds1" },
    ]);
  });
});
