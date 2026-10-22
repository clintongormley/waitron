import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { withTransaction, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { recordIncident } from "@waitron/core";
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
import { AppError, jobOrigin } from "@waitron/shared";
import { mountAlertsApi } from "./alerts-api.js";
import { createAlertRegistry } from "./alerts.js";
import { ALL_ALERT_CLAIMS } from "./modules.js";
import "./errors.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

const NOW = new Date("2026-10-22T09:00:00.000Z");
const ALERTS = "/management-api/alerts";
const HANDLED = "/management-api/alerts/handled";

interface Person {
  id: string;
  token: string;
  cookie: string;
}

let manager: Person;
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
  supervisor = await seedPerson("supervisor", "Sergio");
  await withTransaction(suite.db, (tx) =>
    recordIncident(tx, {
      origin: jobOrigin("fiscal_filing"),
      error: new AppError("fiscal.registro_rechazado" as never, {} as never),
      severity: "error",
      detectedAt: NOW,
    }),
  );
});

function appFor(db: Database): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (c.req.method === "GET" && c.req.header("x-waitron-live") === "1") {
      await withPassiveManagementRead(next);
    } else await next();
  });
  mountAlertsApi(
    app,
    {
      db,
      registry: createAlertRegistry({ claims: ALL_ALERT_CLAIMS, sources: [] }),
      now: () => NOW,
    },
    () => {},
  );
  return app;
}

function get(app: Hono, path: string, cookie?: string, passive = false) {
  return app.request(path, {
    headers: {
      ...(cookie === undefined ? {} : { cookie }),
      ...(passive ? { "x-waitron-live": "1" } : {}),
    },
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

/** A disk that refuses any write turn which changed a row, with `refusal`; a turn that only reads
 * commits. */
function writeRefusingDb(refusal: () => Error = () => new AppError("storage.disk_full", {})) {
  const changes = () => suite.db.all<{ n: number }>(sql`select total_changes() as n`)[0]!.n;
  return new Proxy(suite.db, {
    get(target, prop) {
      if (prop === "withWriteLock") {
        return <T>(body: () => Promise<T>) =>
          target.withWriteLock(async () => {
            const before = changes();
            const value = await body();
            if (changes() !== before) throw refusal();
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

const codes = async (response: Response) =>
  ((await response.json()) as { alerts: { code: string }[] }).alerts.map((a) => a.code);

const minuteAgo = () => new Date(Date.now() - 60_000);

describe("on a full disk", () => {
  it("the stand-in refuses a turn that stamps the session", async () => {
    await expect(
      withTransaction(writeRefusingDb(), (tx) =>
        tx.update(persons).set({ displayName: "M" }).where(eq(persons.id, manager.id)),
      ),
    ).rejects.toMatchObject({ code: "storage.disk_full" });
  });

  it("a manager's ordinary read lists the alerts and leaves the last-seen time alone", async () => {
    const app = appFor(writeRefusingDb());
    const seeded = minuteAgo();
    await setLastSeen(manager, seeded);
    const response = await get(app, ALERTS, manager.cookie);
    expect(response.status).toBe(200);
    expect(await codes(response)).toEqual(["fiscal.registro_rechazado"]);
    expect(await lastSeen(manager)).toBe(seeded.toISOString());
  });

  it("the handled list answers too", async () => {
    const response = await get(appFor(writeRefusingDb()), HANDLED, manager.cookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ visible: true, alerts: [] });
  });

  describe("with a change waiting to be delivered", () => {
    beforeEach(() => {
      suite.db.run(
        sql`insert into change_log (id, payload) values ('zz1', '{"resource":"zz","id":"1"}')`,
      );
    });
    const waiting = () =>
      suite.db.all<{ id: string }>(sql`select id from change_log where id = 'zz1'`).length;

    it("the stand-in refuses the change-log delivery a transaction ends with", async () => {
      await expect(withTransaction(writeRefusingDb(), async () => {})).rejects.toMatchObject({
        code: "storage.disk_full",
      });
      expect(waiting()).toBe(1);
    });

    it("a passive read and an ordinary one list the alerts and leave the change waiting", async () => {
      const app = appFor(writeRefusingDb());
      for (const passive of [true, false]) {
        const seeded = minuteAgo();
        await setLastSeen(manager, seeded);
        const response = await get(app, ALERTS, manager.cookie, passive);
        expect(response.status).toBe(200);
        expect(await codes(response)).toEqual(["fiscal.registro_rechazado"]);
        expect(await lastSeen(manager)).toBe(seeded.toISOString());
      }
      expect(waiting()).toBe(1);
    });
  });
});

describe.each([
  ["with room", () => suite.db],
  ["on a full disk", () => writeRefusingDb()],
])("refusals %s", (_label, db) => {
  async function expectRefused(cookie: string | undefined, status: number, code: string) {
    const app = appFor(db());
    for (const response of [
      await get(app, ALERTS, cookie),
      await get(app, ALERTS, cookie, true),
      await get(app, HANDLED, cookie),
    ]) {
      expect(response.status).toBe(status);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(code);
    }
  }

  it("refuses a request with no session", async () => {
    await expectRefused(undefined, 401, "management_session.required");
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

  it("shows nothing to a person holding no alert permission", async () => {
    const response = await get(appFor(db()), ALERTS, supervisor.cookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ visible: false, alerts: [] });
  });
});

describe("with room", () => {
  it("an ordinary read still moves the last-seen time", async () => {
    const before = minuteAgo();
    await setLastSeen(manager, before);
    expect((await get(appFor(suite.db), ALERTS, manager.cookie)).status).toBe(200);
    expect(Date.parse(await lastSeen(manager))).toBeGreaterThan(before.getTime());
  });
});

describe("an error other than a full disk", () => {
  it("is not retried by the fallback session check", async () => {
    const app = appFor(writeRefusingDb(() => new Error("boom")));
    const response = await get(app, ALERTS, manager.cookie);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "server.internal" } });
  });
});
