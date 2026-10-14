import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { asc, eq, sql } from "drizzle-orm";
import { CORE_MIGRATIONS, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import {
  WORKFORCE_MIGRATIONS,
  WorkforceBackend,
  attendanceDayWork,
  attendanceSourceState,
  rosterVersions,
  shifts,
} from "@waitron/workforce";
import { WORKFORCE_ES_MIGRATIONS, convenioConfig } from "@waitron/workforce-es";
import { mountWorkforceApi } from "./workforce-api.js";
import { markAttendanceSourceChanged } from "./attendance-source-changes.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS, WORKFORCE_ES_MIGRATIONS],
});
const backend = new WorkforceBackend();
let app: Hono, locationId: string, personId: string, otherId: string, cookie: string;
beforeEach(async () => {
  await seedTenant(suite.db);
  const [location] = await suite.db
    .insert(locations)
    .values({
      name: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "04:00",
      invoiceLocales: ["es"],
      operationDescription: "Meals",
    })
    .returning();
  locationId = location!.id;
  const workers = await suite.db
    .insert(persons)
    .values([
      { displayName: "Manager", role: "manager" },
      { displayName: "Worker", role: "staff" },
    ])
    .returning();
  personId = workers[0]!.id;
  otherId = workers[1]!.id;
  const session = await withTransaction(suite.db, (tx) => startManagementSession(tx, { personId }));
  cookie = `${MANAGEMENT_COOKIE}=${session.token}`;
  await suite.db.insert(convenioConfig).values({ locationId });
  app = new Hono();
  mountWorkforceApi(app, { db: suite.db, cfg: { nodeId: crypto.randomUUID() } }, () => {});
});

async function send(method: string, path: string, body?: unknown) {
  return app.request(`/management-api/${path}`, {
    method,
    headers: { cookie, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function version() {
  return withTransaction(suite.db, (tx) =>
    backend.createRosterVersion(tx, {
      locationId,
      period: "2026-01-05",
    }),
  );
}
const shiftBody = (day = "2026-01-05") => ({
  personId,
  locationId,
  startsAt: `${day}T09:00:00Z`,
  endsAt: `${day}T13:00:00Z`,
  startsOffsetMinutes: 60,
  endsOffsetMinutes: 60,
  role: null,
});
async function add(versionId: string, day = "2026-01-05") {
  const response = await send("POST", `roster/${versionId}/shifts`, shiftBody(day));
  expect(response.status).toBe(201);
  return ((await response.json()) as { shiftId: string }).shiftId;
}
async function days() {
  return suite.db.select().from(attendanceDayWork).orderBy(asc(attendanceDayWork.businessDay));
}
async function cleanQueue() {
  await suite.db.delete(attendanceDayWork);
}

describe("accepted rota writes invalidate attendance in their transaction", () => {
  it("watches a newly created empty draft for later publication", async () => {
    const response = await send("POST", "roster", { locationId, period: "2026-01-05" });
    expect(response.status).toBe(201);
    const { versionId } = (await response.json()) as { versionId: string };
    expect(await suite.db.select().from(attendanceSourceState)).toEqual([
      expect.objectContaining({
        source: "rota",
        key: `version:${versionId}`,
        recordKind: "watch",
        previousDays: [],
        nextDueAt: "1970-01-01T00:00:00.000Z",
        fingerprint: null,
      }),
    ]);
    expect(await days()).toEqual([]);
  });

  it("adds the shift's business day with venue bounds", async () => {
    await add(await version());
    expect(await days()).toEqual([
      expect.objectContaining({
        locationId,
        businessDay: "2026-01-05",
        startAt: "2026-01-05T03:00:00.000Z",
        endAt: "2026-01-06T03:00:00.000Z",
      }),
    ]);
  });

  it("dirties both the old and new start-day when a draft shift moves", async () => {
    const id = await add(await version());
    await cleanQueue();
    const response = await send("PATCH", `roster/shifts/${id}`, {
      startsAt: "2026-01-06T09:00:00Z",
      endsAt: "2026-01-06T13:00:00Z",
    });
    expect(response.status).toBe(204);
    expect((await days()).map((row) => row.businessDay)).toEqual(["2026-01-05", "2026-01-06"]);
  });

  it("dirties a processed day on reassignment without inventing worker activity", async () => {
    const id = await add(await version());
    const [work] = await days();
    expect(work).toBeDefined();
    await suite.db.update(attendanceDayWork).set({ evaluatedRevision: work!.dirtyRevision });
    const response = await send("PATCH", `roster/shifts/${id}`, { personId: otherId });
    expect(response.status).toBe(204);
    const [dirty] = await days();
    expect(dirty!.dirtyRevision).toBeGreaterThan(dirty!.evaluatedRevision);
    expect((await suite.db.select().from(shifts).where(eq(shifts.id, id)))[0]!.personId).toBe(
      otherId,
    );
    const { rows } = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from attendance_operation_facts`,
    );
    expect(rows).toEqual([{ n: 0 }]);
  });

  it("retains a deleted shift's old day for reconciliation", async () => {
    const id = await add(await version());
    await cleanQueue();
    expect((await send("DELETE", `roster/shifts/${id}`)).status).toBe(204);
    expect((await days()).map((row) => row.businessDay)).toEqual(["2026-01-05"]);
    expect(await suite.db.select().from(shifts)).toEqual([]);
    expect(await suite.db.select().from(attendanceSourceState)).toContainEqual(
      expect.objectContaining({ key: `shift:${id}`, previousDays: ["2026-01-05"] }),
    );
  });

  it("publishes new days and dirties the superseded version's distinct days", async () => {
    const first = await version();
    await add(first);
    expect((await send("POST", `roster/${first}/publish`)).status).toBe(200);
    const second = await version();
    await add(second, "2026-01-06");
    await cleanQueue();
    expect((await send("POST", `roster/${second}/publish`)).status).toBe(200);
    expect((await days()).map((row) => row.businessDay)).toEqual(["2026-01-05", "2026-01-06"]);
    expect(
      (await suite.db.select().from(rosterVersions).where(eq(rosterVersions.id, first)))[0]!.status,
    ).toBe("superseded");
    expect(await suite.db.select().from(attendanceSourceState)).toContainEqual(
      expect.objectContaining({ key: `version:${first}`, previousDays: ["2026-01-05"] }),
    );
  });

  it("publication discovers newly attached unversioned shifts", async () => {
    const draft = await version();
    await suite.db.insert(shifts).values({ ...shiftBody(), rosterVersionId: null });
    expect((await send("POST", `roster/${draft}/publish`)).status).toBe(200);
    expect((await days()).map((row) => row.businessDay)).toEqual(["2026-01-05"]);
  });

  it("a refused edit commits no invalidation", async () => {
    const id = await add(await version());
    await cleanQueue();
    const before = await suite.db.select().from(attendanceSourceState);
    const response = await send("PATCH", `roster/shifts/${id}`, { endsAt: "2026-01-05T08:00:00Z" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "shift.invalid" } });
    expect(await days()).toEqual([]);
    expect(await suite.db.select().from(attendanceSourceState)).toEqual(before);
  });

  it("a permission refusal commits no invalidation or shift edit", async () => {
    const id = await add(await version());
    const staff = await withTransaction(suite.db, (tx) =>
      startManagementSession(tx, { personId: otherId }),
    );
    cookie = `${MANAGEMENT_COOKIE}=${staff.token}`;
    await cleanQueue();
    const response = await send("DELETE", `roster/shifts/${id}`);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    expect(await days()).toEqual([]);
    expect(await suite.db.select().from(shifts).where(eq(shifts.id, id))).toHaveLength(1);
  });

  it("a repeated invalidation of a deleted shift keeps its saved old scope", async () => {
    const id = await add(await version());
    await send("DELETE", `roster/shifts/${id}`);
    await cleanQueue();
    await withTransaction(suite.db, (tx) => markAttendanceSourceChanged(tx, "shift", id));
    expect((await days()).map((row) => row.businessDay)).toEqual(["2026-01-05"]);
  });

  it("an accepted edit invalidates a previously scanned fingerprint and wakes its watch", async () => {
    const id = await add(await version());
    await suite.db.update(attendanceSourceState).set({
      fingerprint: "previous assignment",
      nextDueAt: "2099-01-01T00:00:00.000Z",
    });
    expect((await send("PATCH", `roster/shifts/${id}`, { role: "bar" })).status).toBe(204);
    expect(await suite.db.select().from(attendanceSourceState)).toContainEqual(
      expect.objectContaining({
        key: `shift:${id}`,
        fingerprint: null,
        nextDueAt: "1970-01-01T00:00:00.000Z",
      }),
    );
  });

  it("keeps captured day bounds when the location's cutover is later changed", async () => {
    const id = await add(await version());
    await suite.db
      .update(locations)
      .set({ dayCutover: "06:00" })
      .where(eq(locations.id, locationId));
    expect((await send("PATCH", `roster/shifts/${id}`, { role: "bar" })).status).toBe(204);
    expect(await days()).toEqual([
      expect.objectContaining({
        businessDay: "2026-01-05",
        startAt: "2026-01-05T03:00:00.000Z",
        endAt: "2026-01-06T03:00:00.000Z",
      }),
    ]);
  });

  it.each([
    ["2026-03-29T00:30:00Z", "2026-03-28", "2026-03-28T03:00:00.000Z", "2026-03-29T02:00:00.000Z"],
    ["2026-03-29T02:00:00Z", "2026-03-29", "2026-03-29T02:00:00.000Z", "2026-03-30T02:00:00.000Z"],
    ["2026-10-25T00:30:00Z", "2026-10-24", "2026-10-24T02:00:00.000Z", "2026-10-25T03:00:00.000Z"],
  ])(
    "uses the start instant's business day at %s across DST",
    async (startsAt, businessDay, startAt, endAt) => {
      const id = await version();
      const response = await send("POST", `roster/${id}/shifts`, {
        ...shiftBody(),
        startsAt,
        endsAt: new Date(Date.parse(startsAt) + 60 * 60 * 1000).toISOString(),
      });
      expect(response.status).toBe(201);
      expect(await days()).toEqual([expect.objectContaining({ businessDay, startAt, endAt })]);
    },
  );

  it("an unattached shift can move and delete without losing either affected day", async () => {
    const [row] = await suite.db
      .insert(shifts)
      .values({ ...shiftBody(), rosterVersionId: null })
      .returning();
    expect(
      (
        await send("PATCH", `roster/shifts/${row!.id}`, {
          startsAt: "2026-01-06T09:00:00Z",
          endsAt: "2026-01-06T13:00:00Z",
        })
      ).status,
    ).toBe(204);
    expect((await days()).map((row) => row.businessDay)).toEqual(["2026-01-05", "2026-01-06"]);
    await cleanQueue();
    expect((await send("DELETE", `roster/shifts/${row!.id}`)).status).toBe(204);
    expect((await days()).map((row) => row.businessDay)).toEqual(["2026-01-05", "2026-01-06"]);
  });

  it("a missing source with no snapshot adds no watch or day", async () => {
    await withTransaction(suite.db, (tx) =>
      markAttendanceSourceChanged(tx, "shift", crypto.randomUUID()),
    );
    await withTransaction(suite.db, (tx) =>
      markAttendanceSourceChanged(tx, "rota", crypto.randomUUID()),
    );
    expect(await days()).toEqual([]);
    expect(await suite.db.select().from(attendanceSourceState)).toEqual([]);
  });

  it("deleting a retained unattached shift captures its day before the row disappears", async () => {
    const [row] = await suite.db
      .insert(shifts)
      .values({ ...shiftBody(), rosterVersionId: null })
      .returning();
    expect((await send("DELETE", `roster/shifts/${row!.id}`)).status).toBe(204);
    expect((await days()).map((row) => row.businessDay)).toEqual(["2026-01-05"]);
  });

  it.each(["create", "add", "edit", "remove", "publish"])(
    "a refused attendance snapshot rolls back the %s command",
    async (action) => {
      const draft = await version();
      const id = await add(draft);
      await cleanQueue();
      const beforeShifts = await suite.db.select().from(shifts);
      const beforeVersions = await suite.db.select().from(rosterVersions);
      const beforeWatches = await suite.db.select().from(attendanceSourceState);
      await suite.db.execute(sql`create trigger refuse_attendance_snapshot
        before insert on attendance_source_state begin select raise(abort, 'test snapshot refusal'); end`);
      try {
        const response =
          action === "create"
            ? await send("POST", "roster", { locationId, period: "2026-01-12" })
            : action === "add"
              ? await send("POST", `roster/${draft}/shifts`, shiftBody("2026-01-06"))
              : action === "edit"
                ? await send("PATCH", `roster/shifts/${id}`, { role: "bar" })
                : action === "remove"
                  ? await send("DELETE", `roster/shifts/${id}`)
                  : await send("POST", `roster/${draft}/publish`);
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: { code: "server.internal" } });
        expect(await suite.db.select().from(shifts)).toEqual(beforeShifts);
        expect(await suite.db.select().from(rosterVersions)).toEqual(beforeVersions);
        expect(await suite.db.select().from(attendanceSourceState)).toEqual(beforeWatches);
        expect(await days()).toEqual([]);
      } finally {
        await suite.db.execute(sql`drop trigger refuse_attendance_snapshot`);
      }
    },
  );
});
