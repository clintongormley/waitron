import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import {
  openVenueDatabase,
  locationDayCutoverChanges,
  locationBusinessDaySettings,
  locations,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { venueFiscalSelection } from "@waitron/provisioning";
import {
  createDepartment,
  saveMenuPeriod,
  replaceMenuWeek,
  resolveDepartmentService,
} from "@waitron/venue-service";
import { createOpenOrder } from "./working-order.js";
import { randomUUID } from "node:crypto";
import { ALL_MODULES } from "./modules.js";
import { mountLocationSettingsApi } from "./location-settings-api.js";
import { readVenueDetails } from "./venue-details.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let venue: Venue;
let app: Hono;
let at: Date;
const inTx = <T>(fn: Parameters<typeof withTransaction<T>>[1]) => withTransaction(suite.db, fn);
beforeEach(async () => {
  venue = await setupVenue(suite.db);
  at = new Date("2026-11-02T12:00:00.000Z");
  app = new Hono();
  mountLocationSettingsApi(
    app,
    {
      db: suite.db,
      cfg: venue.cfg,
      now: () => at,
      fiscal: venueFiscalSelection(ALL_MODULES, "ES-common").contribution!,
    },
    () => {},
  );
});
function request(method: string, path: string, body?: unknown, cookie = venue.managerCookie) {
  return app.request(`/management-api/venue-details${path}`, {
    method,
    headers: { cookie, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function authorRange(startsAt: string, endsAt: string) {
  return inTx(async (tx) => {
    const department = await createDepartment(tx, venue.cfg, {
      name: "Late service",
      orderStart: "counter",
    });
    const menuId = (await tx.execute<{ id: string }>(sql`select id from catalogues limit 1`))
      .rows[0]!.id;
    const period = await saveMenuPeriod(
      tx,
      venue.cfg,
      department.id,
      {
        name: "Service",
        menuId,
        staffMenuIds: [],
      },
      0,
    );
    await replaceMenuWeek(
      tx,
      venue.cfg,
      department.id,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        slots: [{ periodId: period.id, startsAt, endsAt }],
      })),
      at,
      0,
    );
    return { department, period };
  });
}

describe("business-day start scheduling", () => {
  it.each([
    ["22:00", "04:30"],
    ["05:00", "05:00"],
  ])("refuses scalar PATCH without reinterpreting %s–%s", async (startsAt, endsAt) => {
    const { department, period } = await authorRange(startsAt, endsAt);
    const before = await inTx((tx) => readVenueDetails(tx, venue.cfg));
    const serviceAt = new Date("2026-11-03T02:30:00.000Z");
    const serviceBefore = await inTx((tx) =>
      resolveDepartmentService(tx, venue.cfg, department.id, serviceAt),
    );
    expect(serviceBefore.open).toBe(true);
    const response = await request("PATCH", "", {
      expected: before.details,
      changes: { dayCutover: "03:00" },
    });
    const answer = await response.json();
    const after = await inTx((tx) =>
      resolveDepartmentService(tx, venue.cfg, department.id, serviceAt),
    );
    let resave: unknown = "accepted";
    try {
      await inTx((tx) =>
        replaceMenuWeek(
          tx,
          venue.cfg,
          department.id,
          [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
            weekday,
            slots: [{ periodId: period.id, startsAt, endsAt }],
          })),
          at,
          0,
        ),
      );
    } catch (error) {
      resave = error;
    }
    expect({ status: response.status, answer, service: after, resave }).toEqual({
      status: 400,
      answer: {
        error: {
          code: "venue.business_day_invalid",
          params: { field: "dayCutover", reason: "effective_date_required" },
        },
      },
      service: serviceBefore,
      resave: "accepted",
    });
    expect((await inTx((tx) => readVenueDetails(tx, venue.cfg))).details).toEqual(before.details);
  });
});

const proposal = (overrides: Record<string, unknown> = {}) => ({
  effectiveBusinessDay: "2026-11-04",
  dayCutover: "03:00",
  expectedClockRevision: 0,
  ...overrides,
});
async function clockRows() {
  return {
    changes: await suite.db.select().from(locationDayCutoverChanges),
    settings: await suite.db.select().from(locationBusinessDaySettings),
  };
}
async function expectRefusal(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
}
describe("dated route protection", () => {
  it("saves one future row, keeps today's and the initial clock, and previews both bounds", async () => {
    const before = await inTx((tx) => readVenueDetails(tx, venue.cfg));
    const preview = await request(
      "GET",
      "/business-day-start/preview?effectiveBusinessDay=2026-11-04&dayCutover=03%3A00&expectedClockRevision=0",
    );
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({
      revision: 0,
      previousDay: {
        businessDay: "2026-11-03",
        dayCutover: "05:00",
        startAt: "2026-11-03T04:00:00.000Z",
        endAt: "2026-11-04T02:00:00.000Z",
      },
      effectiveDay: {
        businessDay: "2026-11-04",
        dayCutover: "03:00",
        startAt: "2026-11-04T02:00:00.000Z",
        endAt: "2026-11-05T02:00:00.000Z",
      },
      locksAt: "2026-11-03T04:00:00.000Z",
      conflicts: [],
      conflictCount: 0,
    });
    expect(await clockRows()).toEqual({ changes: [], settings: [] });
    const save = await request("PUT", "/business-day-start", proposal());
    expect(save.status).toBe(200);
    expect(await save.json()).toMatchObject({
      changed: true,
      model: {
        details: before.details,
        businessDayClock: {
          revision: 1,
          currentBusinessDay: "2026-11-02",
          pending: { effectiveBusinessDay: "2026-11-04", dayCutover: "03:00", editable: true },
        },
      },
    });
    expect((await suite.db.select().from(locations))[0]!.dayCutover).toBe("05:00:00");
    expect(await clockRows()).toEqual({
      changes: [
        {
          locationId: venue.cfg.locationId,
          effectiveBusinessDay: "2026-11-04",
          dayCutover: "03:00:00",
        },
      ],
      settings: [{ locationId: venue.cfg.locationId, revision: 1 }],
    });
  });
  it.each([
    null,
    [],
    {},
    { unexpected: 1 },
    proposal({ effectiveBusinessDay: null }),
    proposal({ effectiveBusinessDay: "2026-02-30" }),
    proposal({ effectiveBusinessDay: "2026-11-02" }),
    proposal({ effectiveBusinessDay: "2026-11-03" }),
    proposal({ effectiveBusinessDay: "2027-11-04" }),
    proposal({ dayCutover: "24:00" }),
    proposal({ dayCutover: null }),
    proposal({ dayCutover: "02:30:01" }),
    proposal({ expectedClockRevision: -1 }),
    proposal({ expectedClockRevision: 0.5 }),
    proposal({ expectedClockRevision: "0" }),
    proposal({ extra: true }),
  ])("rejects malformed or non-future proposal %j", async (body) => {
    await expectRefusal(
      await request("PUT", "/business-day-start", body),
      400,
      "venue.business_day_invalid",
    );
    expect(await clockRows()).toEqual({ changes: [], settings: [] });
  });
  it("replaces and cancels once, retaining the revision against stale and ABA editors", async () => {
    expect((await request("PUT", "/business-day-start", proposal())).status).toBe(200);
    await expectRefusal(
      await request("PUT", "/business-day-start", proposal({ dayCutover: "07:00" })),
      409,
      "venue.business_day_changed",
    );
    expect(
      (
        await request(
          "PUT",
          "/business-day-start",
          proposal({ expectedClockRevision: 1, dayCutover: "07:00" }),
        )
      ).status,
    ).toBe(200);
    expect(
      (await request("DELETE", "/business-day-start", { expectedClockRevision: 2 })).status,
    ).toBe(200);
    expect(await clockRows()).toEqual({
      changes: [],
      settings: [{ locationId: venue.cfg.locationId, revision: 3 }],
    });
    expect(
      (await request("PUT", "/business-day-start", proposal({ expectedClockRevision: 3 }))).status,
    ).toBe(200);
    await expectRefusal(
      await request("DELETE", "/business-day-start", { expectedClockRevision: 0 }),
      409,
      "venue.business_day_changed",
    );
    expect((await clockRows()).settings[0]!.revision).toBe(4);
  });
  it("keeps equivalence and already-cancelled operations quiet but checks revisions first", async () => {
    const same = await request("PUT", "/business-day-start", proposal({ dayCutover: "05:00:00" }));
    expect(same.status).toBe(200);
    expect(await same.json()).toMatchObject({ changed: false });
    const absent = await request("DELETE", "/business-day-start", { expectedClockRevision: 0 });
    expect(absent.status).toBe(200);
    expect(await absent.json()).toMatchObject({ changed: false });
    expect(await clockRows()).toEqual({ changes: [], settings: [] });
    await expectRefusal(
      await request("DELETE", "/business-day-start", { expectedClockRevision: 1 }),
      409,
      "venue.business_day_changed",
    );
    expect((await request("PUT", "/business-day-start", proposal())).status).toBe(200);
    await expectRefusal(
      await request(
        "PUT",
        "/business-day-start",
        proposal({ expectedClockRevision: 1, dayCutover: "05:00" }),
      ),
      409,
      "venue.business_day_locked",
    );
  });
  it.each(["PUT", "DELETE"])(
    "refuses %s at the preceding-day lock, preserves retained rows after activation",
    async (method) => {
      expect((await request("PUT", "/business-day-start", proposal())).status).toBe(200);
      const rows = await clockRows();
      at = new Date("2026-11-03T04:00:00.000Z");
      await expectRefusal(
        await request(
          method,
          "/business-day-start",
          method === "PUT"
            ? proposal({ expectedClockRevision: 1, dayCutover: "07:00" })
            : { expectedClockRevision: 1 },
        ),
        409,
        "venue.business_day_locked",
      );
      expect(await clockRows()).toEqual(rows);
      at = new Date("2026-11-04T02:00:00.000Z");
      await expectRefusal(
        await request(
          "PUT",
          "/business-day-start",
          proposal({ expectedClockRevision: 1, dayCutover: "07:00" }),
        ),
        400,
        "venue.business_day_invalid",
      );
      const read = await request("GET", "");
      expect(read.status).toBe(200);
      expect(await read.json()).toMatchObject({
        details: { dayCutover: "03:00" },
        businessDayClock: { pending: null, currentBusinessDay: "2026-11-04" },
      });
      expect(
        (
          await request(
            "PUT",
            "/business-day-start",
            proposal({
              effectiveBusinessDay: "2026-11-06",
              expectedClockRevision: 1,
              dayCutover: "07:00",
            }),
          )
        ).status,
      ).toBe(200);
      expect((await clockRows()).changes).toHaveLength(2);
    },
  );
  it.each(["PUT", "DELETE", "GET"])("requires the proper permission for %s", async (method) => {
    const path =
      method === "GET"
        ? "/business-day-start/preview?effectiveBusinessDay=2026-11-04&dayCutover=03%3A00&expectedClockRevision=0"
        : "/business-day-start";
    const body =
      method === "GET" ? undefined : method === "PUT" ? proposal() : { expectedClockRevision: 0 };
    await expectRefusal(await request(method, path, body, ""), 401, "management_session.required");
    await expectRefusal(
      await request(method, path, body, venue.staffCookie),
      403,
      "authorization.not_permitted",
    );
    expect(await clockRows()).toEqual({ changes: [], settings: [] });
  });
  it("refuses ambiguous and skipped transitions but accepts a nearby unambiguous date", async () => {
    at = new Date("2026-10-22T12:00:00.000Z");
    await expectRefusal(
      await request(
        "PUT",
        "/business-day-start",
        proposal({ effectiveBusinessDay: "2026-10-25", dayCutover: "02:30" }),
      ),
      400,
      "venue.business_day_invalid",
    );
    at = new Date("2027-03-25T12:00:00.000Z");
    await expectRefusal(
      await request(
        "PUT",
        "/business-day-start",
        proposal({ effectiveBusinessDay: "2027-03-28", dayCutover: "02:30" }),
      ),
      400,
      "venue.business_day_invalid",
    );
    expect(
      (
        await request(
          "PUT",
          "/business-day-start",
          proposal({ effectiveBusinessDay: "2027-03-30", dayCutover: "02:30" }),
        )
      ).status,
    ).toBe(200);
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
describe("transaction-time and persisted history checks", () => {
  it.each(["save", "cancel", "minimum-date"])(
    "rechecks queued %s using the time after acquisition",
    async (kind) => {
      if (kind === "cancel" || kind === "save")
        expect((await request("PUT", "/business-day-start", proposal())).status).toBe(200);
      const before = await clockRows();
      const entered = deferred(),
        release = deferred(),
        queued = deferred();
      const writer = inTx(async () => {
        entered.resolve();
        await release.promise;
      });
      await entered.promise;
      const realLock = suite.db.withWriteLock.bind(suite.db);
      const spy = vi
        .spyOn(suite.db, "withWriteLock")
        .mockImplementation(<T>(body: () => Promise<T>) => {
          queued.resolve();
          return realLock(body);
        });
      let response!: ReturnType<typeof request>;
      try {
        response =
          kind === "cancel"
            ? request("DELETE", "/business-day-start", { expectedClockRevision: 1 })
            : request(
                "PUT",
                "/business-day-start",
                proposal({ expectedClockRevision: kind === "save" ? 1 : 0, dayCutover: "07:00" }),
              );
        await queued.promise;
        at = new Date("2026-11-03T04:00:00.000Z");
      } finally {
        spy.mockRestore();
        release.resolve();
      }
      await writer;
      await expectRefusal(
        await response,
        kind === "minimum-date" ? 400 : 409,
        kind === "minimum-date" ? "venue.business_day_invalid" : "venue.business_day_locked",
      );
      expect(await clockRows()).toEqual(before);
      const model = await inTx((tx) => readVenueDetails(tx, venue.cfg));
      expect(
        (
          await request("PATCH", "", {
            expected: model.details,
            changes: { addressLine1: "Fresh address" },
          })
        ).status,
      ).toBe(200);
    },
  );
  it("refuses a future order anchor, including cancellation after a backward clock correction", async () => {
    expect((await request("PUT", "/business-day-start", proposal())).status).toBe(200);
    const before = await clockRows();
    await inTx((tx) => createOpenOrder(tx, venue.cfg, randomUUID(), [], null));
    await suite.db.execute(
      sql`update working_orders set opened_at = '2026-11-04T02:00:00.000Z' where location_id = ${venue.cfg.locationId}`,
    );
    await expectRefusal(
      await request("DELETE", "/business-day-start", { expectedClockRevision: 1 }),
      409,
      "venue.business_day_locked",
    );
    await expectRefusal(
      await request(
        "PUT",
        "/business-day-start",
        proposal({ expectedClockRevision: 1, dayCutover: "07:00" }),
      ),
      409,
      "venue.business_day_locked",
    );
    expect(await clockRows()).toEqual(before);
  });
  it("locks time-zone edits after clock history but permits a name edit", async () => {
    expect((await request("PUT", "/business-day-start", proposal())).status).toBe(200);
    const model = await inTx((tx) => readVenueDetails(tx, venue.cfg));
    const timezone = await request("PATCH", "", {
      expected: model.details,
      changes: { timeZone: "UTC", name: "Must roll back" },
    });
    await expectRefusal(timezone, 409, "venue.detail_locked");
    expect((await inTx((tx) => readVenueDetails(tx, venue.cfg))).details).toEqual(model.details);
    expect(
      (await request("PATCH", "", { expected: model.details, changes: { name: "Allowed" } }))
        .status,
    ).toBe(200);
  });
  it("keeps an unreadable initial clock visible and refuses dated repair", async () => {
    await suite.db.execute(
      sql`update locations set day_cutover = '06:00garbage' where id = ${venue.cfg.locationId}`,
    );
    const read = await request("GET", "");
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      details: { dayCutover: "06:00garbage" },
      businessDayClock: { currentBusinessDay: null, pending: null },
    });
    await expectRefusal(
      await request("PUT", "/business-day-start", proposal()),
      400,
      "venue.business_day_invalid",
    );
    expect(await clockRows()).toEqual({ changes: [], settings: [] });
  });
});

it("keeps a same-start request quiet even near its ordinary repeated boundary", async () => {
  await suite.db.execute(
    sql`update locations set day_cutover = '02:30:00' where id = ${venue.cfg.locationId}`,
  );
  at = new Date("2026-10-22T12:00:00.000Z");
  const response = await request(
    "PUT",
    "/business-day-start",
    proposal({ effectiveBusinessDay: "2026-10-25", dayCutover: "02:30" }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ changed: false });
  expect(await clockRows()).toEqual({ changes: [], settings: [] });
});

it("reads pending and activated boundaries from a reopened complete database copy", async () => {
  expect((await request("PUT", "/business-day-start", proposal())).status).toBe(200);
  const directory = await mkdtemp(join(tmpdir(), "a495-clock-reopen-"));
  try {
    await suite.db.archiveTo(join(directory, "venue.db"));
    const reopened = await openVenueDatabase(directory);
    try {
      const before = await withTransaction(reopened.venue, (tx) =>
        readVenueDetails(tx, venue.cfg, new Date("2026-11-04T01:59:59.999Z")),
      );
      expect(before.details.dayCutover).toBe("05:00");
      expect(before.businessDayClock).toMatchObject({
        currentBusinessDay: "2026-11-03",
        revision: 1,
        pending: { editable: false },
      });
      const activated = await withTransaction(reopened.venue, (tx) =>
        readVenueDetails(tx, venue.cfg, new Date("2026-11-04T02:00:00.000Z")),
      );
      expect(activated.details.dayCutover).toBe("03:00");
      expect(activated.businessDayClock).toMatchObject({
        currentBusinessDay: "2026-11-04",
        revision: 1,
        pending: null,
      });
      expect(await reopened.venue.select().from(locationDayCutoverChanges)).toEqual(
        (await clockRows()).changes,
      );
    } finally {
      await reopened.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("keeps another location's clock rows isolated and rejects a client-selected location", async () => {
  const [original] = await suite.db.select().from(locations);
  const otherId = randomUUID();
  await suite.db.insert(locations).values({ ...original!, id: otherId, name: "Other location" });
  await suite.db
    .insert(locationDayCutoverChanges)
    .values({ locationId: otherId, effectiveBusinessDay: "2026-11-05", dayCutover: "07:00:00" });
  await suite.db.insert(locationBusinessDaySettings).values({ locationId: otherId, revision: 9 });
  await expectRefusal(
    await request("PUT", "/business-day-start", proposal({ locationId: otherId })),
    400,
    "venue.business_day_invalid",
  );
  expect((await request("PUT", "/business-day-start", proposal())).status).toBe(200);
  expect(await clockRows()).toEqual({
    changes: expect.arrayContaining([
      { locationId: otherId, effectiveBusinessDay: "2026-11-05", dayCutover: "07:00:00" },
      {
        locationId: venue.cfg.locationId,
        effectiveBusinessDay: "2026-11-04",
        dayCutover: "03:00:00",
      },
    ]),
    settings: expect.arrayContaining([
      { locationId: otherId, revision: 9 },
      { locationId: venue.cfg.locationId, revision: 1 },
    ]),
  });
  expect((await clockRows()).changes).toHaveLength(2);
  expect((await clockRows()).settings).toHaveLength(2);
});

describe("dated start schedule refusal", () => {
  it("previews conflicts without writing and refuses incompatible PUT through the real boundary", async () => {
    const { department } = await authorRange("05:00", "05:00");
    const saved = await clockRows();
    const query = new URLSearchParams(proposal() as unknown as Record<string, string>);
    const preview = await request("GET", `/business-day-start/preview?${query}`);
    expect(preview.status).toBe(200);
    const body = await preview.json();
    expect(body.conflictCount).toBe(7);
    expect(body.conflicts).toHaveLength(7);
    expect(body.conflicts[0]).toMatchObject({ departmentId: department.id, reason: "all_day" });
    const response = await request("PUT", "/business-day-start", proposal());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "venue.business_day_hours_conflict", params: { conflictCount: 7 } },
    });
    expect(await clockRows()).toEqual(saved);
  });
});
