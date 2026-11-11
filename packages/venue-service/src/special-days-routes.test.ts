import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildMenuDocument,
  createCatalogue,
  menuDocumentHash,
  publishMenu,
} from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  floorZones,
  settings as businessDaySettingsTable,
  specialDays,
  withTransaction,
  type Database,
  type Transaction,
  venueLocationId,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import {
  hashPin,
  persons,
  registerModulePermissions,
  startManagementSession,
} from "@waitron/identity";
import type { ModuleRouteContext } from "@waitron/module";
import { MANAGEMENT_COOKIE, type Logger } from "@waitron/server-kit";
import { saveMenuPeriod } from "./menu-timetable.js";
import { configureZone, createDepartment } from "./operations.js";
import { VENUE_SERVICE_PERMISSIONS } from "./permissions.js";
import { VENUE_SERVICE_ROUTES } from "./routes.js";
import { readSpecialDay, saveSpecialDay, type SpecialDayDetail } from "./special-days.js";

registerModulePermissions(VENUE_SERVICE_PERMISSIONS);

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

const scoped = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(db, fn);
const BASE = "/management-api/venue-service/special-days";
const noopLog: Logger = () => {};

async function routed() {
  await seedVenue(db, {
    name: `Venue ${randomUUID()}`,
    invoiceLocales: ["es-ES"],
    operationDescription: "Hospitality",
    timeZone: "Europe/Madrid",
    dayCutover: "06:00",
  });
  const venueId = await venueLocationId(db);
  const cfg = { locationId: venueId };
  const [zone] = await db
    .insert(floorZones)
    .values({ name: "Room", displayOrder: 0 })
    .returning({ id: floorZones.id });
  const made = await scoped(async (tx) => {
    const restaurant = (await createDepartment(tx, { name: "Restaurant", orderStart: "table" })).id;
    await configureZone(tx, { zoneId: zone!.id, departmentId: restaurant });
    const menuId = (await createCatalogue(tx, { name: `Dinner ${cfg.locationId}` })).id;
    const { document } = await buildMenuDocument(tx, menuId);
    await publishMenu(tx, menuId, menuDocumentHash(document), "person-1");
    const dinner = (
      await saveMenuPeriod(tx, restaurant, { name: "Dinner", menuId, staffMenuIds: [] })
    ).id;
    const person = async (role: "manager" | "supervisor") => {
      const [row] = await tx
        .insert(persons)
        .values({ displayName: `${role} ${randomUUID()}`, pinHash: hashPin("1234"), role })
        .returning({ id: persons.id });
      return `${MANAGEMENT_COOKIE}=${(await startManagementSession(tx, { personId: row!.id })).token}`;
    };
    return {
      restaurant,
      dinner,
      manager: await person("manager"),
      supervisor: await person("supervisor"),
    };
  });
  const app = new Hono();
  VENUE_SERVICE_ROUTES.mount(app, { db, cfg: {}, core: {} as ModuleRouteContext["core"] }, noopLog);
  const send = (
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    cookie: string,
    body?: unknown,
  ) =>
    app.request(`${BASE}${path}`, {
      method,
      headers: {
        cookie,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { ...made, cfg, room: zone!.id, app, send };
}
type Routed = Awaited<ReturnType<typeof routed>>;

const christmas = (r: Routed) => ({
  name: "Christmas",
  repeatsYearly: false,
  dates: [
    { date: "2030-12-24", closedAllDay: false },
    { date: "2030-12-25", closedAllDay: true },
  ],
  paint: [
    {
      departmentId: r.restaurant,
      date: "2030-12-24",
      ranges: [{ periodId: r.dinner, startsAt: "19:00", endsAt: "23:00" }],
    },
  ],
  zonePaint: [
    {
      zoneId: r.room,
      date: "2030-12-24",
      ranges: [{ kind: "closed", startsAt: "19:00", endsAt: "20:00" }],
    },
  ],
});

const expectedDetail = (r: Routed, id: string) => ({
  id,
  name: "Christmas",
  repeatsYearly: false,
  dates: [
    { date: "2030-12-24", closedAllDay: false },
    { date: "2030-12-25", closedAllDay: true },
  ],
  paint: [
    {
      departmentId: r.restaurant,
      date: "2030-12-24",
      ranges: [{ periodId: r.dinner, startsAt: "19:00", endsAt: "23:00" }],
    },
  ],
  zonePaint: [
    {
      zoneId: r.room,
      date: "2030-12-24",
      ranges: [{ kind: "closed", startsAt: "19:00", endsAt: "20:00" }],
    },
  ],
});

const seeded = (r: Routed) => scoped((tx) => saveSpecialDay(tx, null, christmas(r), new Date(), 1));
const stored = (id: string) => scoped((tx) => readSpecialDay(tx, id));
const countDays = async () => (await db.select().from(specialDays)).length;

async function answers(response: Response, status: number, error?: Record<string, unknown>) {
  expect(response.status).toBe(status);
  if (error !== undefined) expect(await response.json()).toEqual({ error });
}

async function refusedAs(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe(code);
}

describe("the special-day routes", () => {
  it("POST creates a special day and answers 201 with it", async () => {
    const r = await routed();
    const response = await r.send("POST", "", r.manager, {
      ...christmas(r),
      expectedClockRevision: 1,
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as SpecialDayDetail;
    expect(body).toEqual(expectedDetail(r, body.id));
    expect(await stored(body.id)).toEqual(body);
  });

  it("GET reads a special day for a venue viewer", async () => {
    const r = await routed();
    const day = await seeded(r);
    const response = await r.send("GET", `/${day.id}`, r.supervisor);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expectedDetail(r, day.id));
  });

  it("GET lists the venue's special days with their dates for a venue viewer, by name", async () => {
    const r = await routed();
    const christmasDay = await seeded(r);
    const fair = await scoped((tx) =>
      saveSpecialDay(
        tx,
        null,
        {
          name: "Annual fair",
          repeatsYearly: true,
          dates: [{ date: "2030-04-20", closedAllDay: true }],
        },
        new Date(),
        1,
      ),
    );
    const response = await r.send("GET", "", r.supervisor);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        id: fair.id,
        name: "Annual fair",
        repeatsYearly: true,
        dates: [{ date: "2030-04-20", closedAllDay: true }],
      },
      {
        id: christmasDay.id,
        name: "Christmas",
        repeatsYearly: false,
        dates: [
          { date: "2030-12-24", closedAllDay: false },
          { date: "2030-12-25", closedAllDay: true },
        ],
      },
    ]);
  });

  it("GET lists nothing for a venue with no special days, and refuses a request with no session", async () => {
    const r = await routed();
    const response = await r.send("GET", "", r.manager);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect((await r.send("GET", "", "")).status).toBe(401);
  });

  it("PUT updates a special day and keeps paint the body leaves out", async () => {
    const r = await routed();
    const day = await seeded(r);
    const response = await r.send("PUT", `/${day.id}`, r.manager, {
      name: "Christmas Eve",
      repeatsYearly: false,
      dates: [{ date: "2030-12-24", closedAllDay: false }],
      expectedClockRevision: 1,
    });
    expect(response.status).toBe(200);
    const expected = {
      ...expectedDetail(r, day.id),
      name: "Christmas Eve",
      dates: [{ date: "2030-12-24", closedAllDay: false }],
    };
    expect(await response.json()).toEqual(expected);
    expect(await stored(day.id)).toEqual(expected);
  });

  it("DELETE removes a special day and answers 204", async () => {
    const r = await routed();
    const day = await seeded(r);
    await answers(
      await r.send("DELETE", `/${day.id}`, r.manager, { expectedClockRevision: 1 }),
      204,
    );
    expect(await countDays()).toBe(0);
  });

  it("refuses an unknown body key on POST and PUT, writing nothing", async () => {
    const r = await routed();
    const day = await seeded(r);
    const body = { ...christmas(r), expectedClockRevision: 1, id: randomUUID() };
    await answers(await r.send("POST", "", r.manager, body), 400, {
      code: "management.request_invalid",
      params: { field: "id" },
    });
    await answers(await r.send("PUT", `/${day.id}`, r.manager, { ...body, name: "X" }), 400, {
      code: "management.request_invalid",
      params: { field: "id" },
    });
    expect(await countDays()).toBe(1);
    expect(await stored(day.id)).toEqual(day);
  });

  it("refuses a viewer every write, writing nothing", async () => {
    const r = await routed();
    const day = await seeded(r);
    const body = { ...christmas(r), expectedClockRevision: 1 };
    for (const response of [
      await r.send("POST", "", r.supervisor, body),
      await r.send("PUT", `/${day.id}`, r.supervisor, body),
      await r.send("DELETE", `/${day.id}`, r.supervisor, { expectedClockRevision: 1 }),
    ])
      await refusedAs(response, 403, "authorization.not_permitted");
    expect(await countDays()).toBe(1);
    expect(await stored(day.id)).toEqual(day);
  });

  it("answers special_day.not_found for an id it does not hold", async () => {
    const r = await routed();
    const missing = randomUUID();
    const error = { code: "special_day.not_found", params: { specialDayId: missing } };
    await answers(await r.send("GET", `/${missing}`, r.manager), 404, error);
    await answers(
      await r.send("PUT", `/${missing}`, r.manager, { ...christmas(r), expectedClockRevision: 1 }),
      404,
      error,
    );
    await answers(
      await r.send("DELETE", `/${missing}`, r.manager, { expectedClockRevision: 1 }),
      404,
      error,
    );
  });

  it("refuses a malformed id", async () => {
    const r = await routed();
    await answers(await r.send("GET", "/not-a-uuid", r.manager), 400, {
      code: "shared.invalid_id",
      params: { kind: "SpecialDayId", value: "not-a-uuid" },
    });
  });

  it("refuses a write with no clock revision or a stale one, writing nothing", async () => {
    const r = await routed();
    const day = await seeded(r);
    await scoped((tx) =>
      tx
        .update(businessDaySettingsTable)
        .set({ revision: 2 })
        .where(eq(businessDaySettingsTable.module, "business_day")),
    );
    const error = { code: "hours.clock_changed", params: {} };
    for (const expectedClockRevision of [undefined, 0]) {
      const revision = expectedClockRevision === undefined ? {} : { expectedClockRevision };
      await answers(
        await r.send("POST", "", r.manager, { ...christmas(r), name: "New", ...revision }),
        409,
        error,
      );
      await answers(
        await r.send("PUT", `/${day.id}`, r.manager, { ...christmas(r), name: "X", ...revision }),
        409,
        error,
      );
      await answers(await r.send("DELETE", `/${day.id}`, r.manager, revision), 409, error);
    }
    expect(await countDays()).toBe(1);
    expect(await stored(day.id)).toEqual(day);
    await answers(
      await r.send("DELETE", `/${day.id}`, r.manager, { expectedClockRevision: 2 }),
      204,
    );
  });

  it("refuses a write with no clock revision while the stored one is still 0, writing nothing", async () => {
    const r = await routed();
    const day = await seeded(r);
    const error = { code: "hours.clock_changed", params: {} };
    await answers(
      await r.send("POST", "", r.manager, { ...christmas(r), name: "New" }),
      409,
      error,
    );
    await answers(
      await r.send("PUT", `/${day.id}`, r.manager, { ...christmas(r), name: "X" }),
      409,
      error,
    );
    await answers(await r.send("DELETE", `/${day.id}`, r.manager, {}), 409, error);
    expect(await countDays()).toBe(1);
    expect(await stored(day.id)).toEqual(day);
  });

  it("answers special_day.date_taken with 409, naming the holder", async () => {
    const r = await routed();
    const day = await seeded(r);
    await answers(
      await r.send("POST", "", r.manager, {
        name: "Other",
        repeatsYearly: false,
        dates: [{ date: "2030-12-25", closedAllDay: false }],
        expectedClockRevision: 1,
      }),
      409,
      {
        code: "special_day.date_taken",
        params: { date: "2030-12-25", specialDayId: day.id, name: "Christmas" },
      },
    );
    expect(await countDays()).toBe(1);
  });

  it("refuses a zone closure outside its department's hours on that date, storing nothing", async () => {
    const r = await routed();
    const body = {
      ...christmas(r),
      zonePaint: [
        {
          zoneId: r.room,
          date: "2030-12-24",
          ranges: [{ kind: "closed", startsAt: "18:00", endsAt: "20:00" }],
        },
      ],
      expectedClockRevision: 1,
    };
    const error = {
      code: "special_day.invalid",
      params: {
        field: "zonePaint.0.ranges.0",
        reason: "outside_hours",
        zoneId: r.room,
        date: "2030-12-24",
      },
    };
    await answers(await r.send("POST", "", r.manager, body), 400, error);
    expect(await countDays()).toBe(0);
    const day = await seeded(r);
    await answers(await r.send("PUT", `/${day.id}`, r.manager, body), 400, error);
    expect(await countDays()).toBe(1);
    expect(await stored(day.id)).toEqual(day);
  });

  it("measures against the department paint the same request sends", async () => {
    const r = await routed();
    const response = await r.send("POST", "", r.manager, {
      ...christmas(r),
      paint: [
        {
          departmentId: r.restaurant,
          date: "2030-12-24",
          ranges: [{ periodId: r.dinner, startsAt: "18:00", endsAt: "23:00" }],
        },
      ],
      zonePaint: [
        {
          zoneId: r.room,
          date: "2030-12-24",
          ranges: [{ kind: "closed", startsAt: "18:00", endsAt: "20:00" }],
        },
      ],
      expectedClockRevision: 1,
    });
    expect(response.status).toBe(201);
  });

  it("leaves Open zone paint unchecked", async () => {
    const r = await routed();
    const open = await r.send("POST", "", r.manager, {
      ...christmas(r),
      zonePaint: [
        {
          zoneId: r.room,
          date: "2030-12-24",
          ranges: [
            { kind: "open", startsAt: "06:00", endsAt: "07:00" },
            { kind: "closed", startsAt: "19:00", endsAt: "20:00" },
          ],
        },
      ],
      expectedClockRevision: 1,
    });
    expect(open.status).toBe(201);
  });

  it("leaves a date closed all day unchecked", async () => {
    const other = await routed();
    const closedDay = await other.send("POST", "", other.manager, {
      ...christmas(other),
      zonePaint: [
        ...christmas(other).zonePaint,
        {
          zoneId: other.room,
          date: "2030-12-25",
          ranges: [{ kind: "closed", startsAt: "18:00", endsAt: "20:00" }],
        },
      ],
      expectedClockRevision: 1,
    });
    expect(closedDay.status).toBe(201);
  });

  it("reads an upper-case zone id as the stored zone", async () => {
    const r = await routed();
    const upper = r.room.toUpperCase();
    const zonePaint = (startsAt: string) => [
      {
        zoneId: upper,
        date: "2030-12-24",
        ranges: [{ kind: "closed", startsAt, endsAt: "20:00" }],
      },
    ];
    await answers(
      await r.send("POST", "", r.manager, {
        ...christmas(r),
        zonePaint: zonePaint("18:00"),
        expectedClockRevision: 1,
      }),
      400,
      {
        code: "special_day.invalid",
        params: {
          field: "zonePaint.0.ranges.0",
          reason: "outside_hours",
          zoneId: r.room,
          date: "2030-12-24",
        },
      },
    );
    const response = await r.send("POST", "", r.manager, {
      ...christmas(r),
      zonePaint: zonePaint("19:00"),
      expectedClockRevision: 1,
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as SpecialDayDetail;
    expect(body.zonePaint.map((entry) => entry.zoneId)).toEqual([r.room]);
  });

  it("names a refused closure by its entry's and its range's places as sent", async () => {
    const r = await routed();
    await answers(
      await r.send("POST", "", r.manager, {
        ...christmas(r),
        zonePaint: [
          {
            zoneId: r.room,
            date: "2030-12-24",
            ranges: [
              { kind: "open", startsAt: "06:00", endsAt: "07:00" },
              { kind: "closed", startsAt: "18:00", endsAt: "20:00" },
            ],
          },
        ],
        expectedClockRevision: 1,
      }),
      400,
      {
        code: "special_day.invalid",
        params: {
          field: "zonePaint.0.ranges.1",
          reason: "outside_hours",
          zoneId: r.room,
          date: "2030-12-24",
        },
      },
    );
    await answers(
      await r.send("POST", "", r.manager, {
        ...christmas(r),
        zonePaint: [
          {
            zoneId: r.room,
            date: "2030-12-25",
            ranges: [{ kind: "closed", startsAt: "18:00", endsAt: "20:00" }],
          },
          {
            zoneId: r.room,
            date: "2030-12-24",
            ranges: [{ kind: "closed", startsAt: "18:00", endsAt: "20:00" }],
          },
        ],
        expectedClockRevision: 1,
      }),
      400,
      {
        code: "special_day.invalid",
        params: {
          field: "zonePaint.1.ranges.0",
          reason: "outside_hours",
          zoneId: r.room,
          date: "2030-12-24",
        },
      },
    );
    expect(await countDays()).toBe(0);
  });

  it("answers special_day.invalid with 400", async () => {
    const r = await routed();
    const response = await r.send("POST", "", r.manager, {
      name: "Broken",
      repeatsYearly: false,
      dates: [{ date: "2030-13-40", closedAllDay: false }],
      expectedClockRevision: 1,
    });
    await answers(response, 400, {
      code: "special_day.invalid",
      params: { field: "dates.0.date" },
    });
  });

  it("answers 400 for a department or zone the body paints that the venue does not hold, on POST and PUT, writing nothing", async () => {
    const r = await routed();
    const day = await seeded(r);
    const before = await stored(day.id);
    const unknown = randomUUID();
    const departmentPaint = { ...christmas(r).paint[0]!, departmentId: unknown };
    const zonePaint = { ...christmas(r).zonePaint[0]!, zoneId: unknown };
    for (const [method, path] of [
      ["POST", ""],
      ["PUT", `/${day.id}`],
    ] as const) {
      const department = await r.send(method, path, r.manager, {
        ...christmas(r),
        paint: [departmentPaint],
        expectedClockRevision: 1,
      });
      expect(department.status, method).toBe(400);
      expect(await department.json()).toEqual({
        error: { code: "department.not_found", params: { departmentId: unknown } },
      });
      const zone = await r.send(method, path, r.manager, {
        ...christmas(r),
        zonePaint: [zonePaint],
        expectedClockRevision: 1,
      });
      expect(zone.status, method).toBe(400);
      expect(await zone.json()).toEqual({
        error: { code: "service_zone.not_found", params: { zoneId: unknown } },
      });
    }
    expect(await countDays()).toBe(1);
    expect(await stored(day.id)).toEqual(before);
  });
});
