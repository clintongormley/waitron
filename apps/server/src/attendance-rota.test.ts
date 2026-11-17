import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { seedBusinessDay } from "@waitron/db/testing/seed.js";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { asc, eq, sql } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import {
  WORKFORCE_MIGRATIONS,
  WorkforceBackend,
  attendanceDays,
  rosterVersions,
  shifts,
} from "@waitron/workforce";
import { WORKFORCE_ES_MIGRATIONS, convenioConfig } from "@waitron/workforce-es";
import { mountWorkforceApi } from "./workforce-api.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, WORKFORCE_MIGRATIONS, WORKFORCE_ES_MIGRATIONS],
});
const backend = new WorkforceBackend();
let app: Hono, personId: string, otherId: string, cookie: string;
beforeEach(async () => {
  await seedVenue(suite.db, {
    name: "Madrid",
    timeZone: "Europe/Madrid",
    dayCutover: "04:00",
    invoiceLocales: ["es"],
  });
  const workers = await seedPersons(suite.db, [
    { displayName: "Manager", role: "manager" },
    { displayName: "Worker", role: "staff" },
  ]);
  personId = workers[0]!.id;
  otherId = workers[1]!.id;
  const session = await withTransaction(suite.db, (tx) =>
    startManagementSession(tx, { method: "password", personId }),
  );
  cookie = `${MANAGEMENT_COOKIE}=${session.token}`;
  await suite.db.insert(convenioConfig).values({});
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
      period: "2026-01-05",
    }),
  );
}
const shiftBody = (day = "2026-01-05") => ({
  personId,
  startsAt: `${day}T09:00:00Z`,
  endsAt: `${day}T13:00:00Z`,
  startsOffsetMinutes: 60,
  endsOffsetMinutes: 60,
});
async function add(versionId: string, day = "2026-01-05") {
  const response = await send("POST", `roster/${versionId}/shifts`, shiftBody(day));
  expect(response.status).toBe(201);
  return ((await response.json()) as { shiftId: string }).shiftId;
}
async function days() {
  return suite.db.select().from(attendanceDays).orderBy(asc(attendanceDays.businessDay));
}
async function cleanQueue() {
  await suite.db.delete(attendanceDays);
}

describe("accepted rota writes invalidate attendance in their transaction", () => {
  it("adds the shift's business day with venue bounds", async () => {
    await add(await version());
    expect(await days()).toEqual([
      expect.objectContaining({
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
    await suite.db.update(attendanceDays).set({ evaluatedRevision: work!.dirtyRevision });
    const response = await send("PATCH", `roster/shifts/${id}`, { personId: otherId });
    expect(response.status).toBe(204);
    const [dirty] = await days();
    expect(dirty!.dirtyRevision).toBeGreaterThan(dirty!.evaluatedRevision);
    expect((await suite.db.select().from(shifts).where(eq(shifts.id, id)))[0]!.personId).toBe(
      otherId,
    );
    const { rows } = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from staff_activity`,
    );
    expect(rows).toEqual([{ n: 0 }]);
  });

  it("retains a deleted shift's old day for reconciliation", async () => {
    const id = await add(await version());
    await cleanQueue();
    expect((await send("DELETE", `roster/shifts/${id}`)).status).toBe(204);
    expect((await days()).map((row) => row.businessDay)).toEqual(["2026-01-05"]);
    expect(await suite.db.select().from(shifts)).toEqual([]);
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
  });

  it("publication discovers shifts already on its draft week", async () => {
    const draft = await version();
    await suite.db.insert(shifts).values({ ...shiftBody(), rosterVersionId: draft });
    expect((await send("POST", `roster/${draft}/publish`)).status).toBe(200);
    expect((await days()).map((row) => row.businessDay)).toEqual(["2026-01-05"]);
  });

  it("a refused edit commits no invalidation", async () => {
    const id = await add(await version());
    await cleanQueue();
    const response = await send("PATCH", `roster/shifts/${id}`, { endsAt: "2026-01-05T08:00:00Z" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "shift.invalid" } });
    expect(await days()).toEqual([]);
  });

  it("a permission refusal commits no invalidation or shift edit", async () => {
    const id = await add(await version());
    const staff = await withTransaction(suite.db, (tx) =>
      startManagementSession(tx, { method: "password", personId: otherId }),
    );
    cookie = `${MANAGEMENT_COOKIE}=${staff.token}`;
    await cleanQueue();
    const response = await send("DELETE", `roster/shifts/${id}`);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    expect(await days()).toEqual([]);
    expect(await suite.db.select().from(shifts).where(eq(shifts.id, id))).toHaveLength(1);
  });

  it("keeps captured day bounds when the venue's cutover is later changed", async () => {
    const id = await add(await version());
    await seedBusinessDay(suite.db, { dayCutover: "06:00" });
    expect(
      (await send("PATCH", `roster/shifts/${id}`, { endsAt: "2026-01-05T18:00:00Z" })).status,
    ).toBe(204);
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

  it("a draft shift can move and delete without losing either affected day", async () => {
    const [row] = await suite.db
      .insert(shifts)
      .values({ ...shiftBody(), rosterVersionId: await version() })
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
    expect((await send("DELETE", `roster/shifts/${row!.id}`)).status).toBe(204);
    expect((await days()).map((row) => row.businessDay)).toEqual(["2026-01-05", "2026-01-06"]);
  });

  it("deleting a draft shift captures its day before the row disappears", async () => {
    const [row] = await suite.db
      .insert(shifts)
      .values({ ...shiftBody(), rosterVersionId: await version() })
      .returning();
    expect((await send("DELETE", `roster/shifts/${row!.id}`)).status).toBe(204);
    expect((await days()).map((row) => row.businessDay)).toEqual(["2026-01-05"]);
  });
});

it.each([
  ["2026-01-06T03:00:00Z", ["2026-01-05"]],
  ["2026-01-06T05:00:00Z", ["2026-01-05", "2026-01-06"]],
] as const)(
  "marks the days an overnight shift ending %s can hold activity",
  async (endsAt, expected) => {
    const versionId = await version();
    const response = await send("POST", `roster/${versionId}/shifts`, {
      ...shiftBody(),
      startsAt: "2026-01-06T02:00:00Z",
      endsAt,
    });
    expect(response.status).toBe(201);
    expect((await days()).map((row) => row.businessDay)).toEqual(expected);
  },
);
