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
import { readLocationClock } from "@waitron/reporting";
import { businessDayBounds } from "@waitron/shared";
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
async function authorRange(
  startsAt: string,
  endsAt: string,
  options: { name?: string; everySeason?: boolean } = {},
) {
  return inTx(async (tx) => {
    const department = await createDepartment(tx, venue.cfg, {
      name: options.name ?? "Late service",
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
    // Only the season holding the cases' November dates, so each weekday's range is one entry in `conflicts`.
    const seasonId = (
      await tx.execute<{ id: string }>(
        sql`select id from seasons where location_id = ${venue.cfg.locationId} and starts_on <= '11-03' order by starts_on desc limit 1`,
      )
    ).rows[0]!.id;
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
      options.everySeason ? {} : { seasonId },
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
  effectiveBusinessDay: "2026-11-03",
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
const changeoverPassed = {
  error: {
    code: "venue.business_day_invalid",
    params: { field: "dayCutover", reason: "changeover_passed" },
  },
};
async function expectRefusal(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
}
describe("dated route protection", () => {
  it("saves one future row, keeps today's and the initial clock, and previews both bounds", async () => {
    const before = await inTx((tx) => readVenueDetails(tx, venue.cfg));
    const preview = await request(
      "GET",
      "/business-day-start/preview?dayCutover=03%3A00&expectedClockRevision=0",
    );
    expect(preview.status).toBe(200);
    const previewBody = await preview.json();
    expect(previewBody).not.toHaveProperty("locksAt");
    expect(previewBody).toMatchObject({
      revision: 0,
      previousDay: {
        businessDay: "2026-11-02",
        dayCutover: "05:00",
        startAt: "2026-11-02T04:00:00.000Z",
        endAt: "2026-11-03T02:00:00.000Z",
      },
      effectiveDay: {
        businessDay: "2026-11-03",
        dayCutover: "03:00",
        startAt: "2026-11-03T02:00:00.000Z",
        endAt: "2026-11-04T02:00:00.000Z",
      },
      conflicts: [],
      conflictCount: 0,
    });
    expect(await clockRows()).toEqual({ changes: [], settings: [] });
    const save = await request("PUT", "/business-day-start", proposal());
    expect(save.status).toBe(200);
    const saved = await save.json();
    expect(saved).toMatchObject({
      changed: true,
      model: {
        details: before.details,
        businessDayClock: { revision: 1, currentBusinessDay: "2026-11-02" },
      },
    });
    expect(saved.model.businessDayClock.pending).toEqual({
      effectiveBusinessDay: "2026-11-03",
      dayCutover: "03:00",
      startsAt: "2026-11-03T02:00:00.000Z",
    });
    expect((await suite.db.select().from(locations))[0]!.dayCutover).toBe("05:00:00");
    expect(await clockRows()).toEqual({
      changes: [
        {
          locationId: venue.cfg.locationId,
          effectiveBusinessDay: "2026-11-03",
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
    proposal({ dayCutover: "24:00" }),
    proposal({ dayCutover: null }),
    proposal({ dayCutover: "02:30:01" }),
    proposal({ expectedClockRevision: -1 }),
    proposal({ expectedClockRevision: 0.5 }),
    proposal({ expectedClockRevision: "0" }),
    proposal({ extra: true }),
  ])("rejects malformed proposal %j", async (body) => {
    await expectRefusal(
      await request("PUT", "/business-day-start", body),
      400,
      "venue.business_day_invalid",
    );
    expect(await clockRows()).toEqual({ changes: [], settings: [] });
  });
  it.each(["2026-11-02", "2026-11-04", "2027-11-04"])(
    "refuses a Save naming %s when the next changeover is 2026-11-03",
    async (effectiveBusinessDay) => {
      const response = await request(
        "PUT",
        "/business-day-start",
        proposal({ effectiveBusinessDay }),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual(changeoverPassed);
      expect(await clockRows()).toEqual({ changes: [], settings: [] });
    },
  );
  it("replaces and undoes once, retaining the revision against stale and ABA editors", async () => {
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
      (
        await request(
          "PUT",
          "/business-day-start",
          proposal({ expectedClockRevision: 2, dayCutover: "05:00" }),
        )
      ).status,
    ).toBe(200);
    expect(await clockRows()).toEqual({
      changes: [],
      settings: [{ locationId: venue.cfg.locationId, revision: 3 }],
    });
    expect(
      (await request("PUT", "/business-day-start", proposal({ expectedClockRevision: 3 }))).status,
    ).toBe(200);
    await expectRefusal(
      await request(
        "PUT",
        "/business-day-start",
        proposal({ expectedClockRevision: 0, dayCutover: "05:00" }),
      ),
      409,
      "venue.business_day_changed",
    );
    expect((await clockRows()).settings[0]!.revision).toBe(4);
  });
  it("keeps repeated Saves quiet, checks revisions first, and lets the start in force undo a waiting change", async () => {
    const same = await request("PUT", "/business-day-start", proposal({ dayCutover: "05:00:00" }));
    expect(same.status).toBe(200);
    expect(await same.json()).toMatchObject({ changed: false });
    expect(await clockRows()).toEqual({ changes: [], settings: [] });
    await expectRefusal(
      await request(
        "PUT",
        "/business-day-start",
        proposal({ expectedClockRevision: 1, dayCutover: "05:00" }),
      ),
      409,
      "venue.business_day_changed",
    );
    expect((await request("PUT", "/business-day-start", proposal())).status).toBe(200);
    const again = await request(
      "PUT",
      "/business-day-start",
      proposal({ expectedClockRevision: 1 }),
    );
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ changed: false });
    expect((await clockRows()).settings).toEqual([
      { locationId: venue.cfg.locationId, revision: 1 },
    ]);
    const undo = await request(
      "PUT",
      "/business-day-start",
      proposal({ expectedClockRevision: 1, dayCutover: "05:00" }),
    );
    expect(undo.status).toBe(200);
    expect(await undo.json()).toMatchObject({
      changed: true,
      model: { businessDayClock: { revision: 2, pending: null } },
    });
    expect(await clockRows()).toEqual({
      changes: [],
      settings: [{ locationId: venue.cfg.locationId, revision: 2 }],
    });
  });
  it("replaces a waiting change up to its changeover, and after it the next Save takes the following one", async () => {
    expect((await request("PUT", "/business-day-start", proposal())).status).toBe(200);
    at = new Date("2026-11-03T01:59:59.999Z");
    expect(
      (
        await request(
          "PUT",
          "/business-day-start",
          proposal({ expectedClockRevision: 1, dayCutover: "04:00" }),
        )
      ).status,
    ).toBe(200);
    const rows = await clockRows();
    expect(rows.changes).toEqual([
      {
        locationId: venue.cfg.locationId,
        effectiveBusinessDay: "2026-11-03",
        dayCutover: "04:00:00",
      },
    ]);
    at = new Date("2026-11-03T03:00:00.000Z");
    const late = await request(
      "PUT",
      "/business-day-start",
      proposal({ expectedClockRevision: 2, dayCutover: "07:00" }),
    );
    expect(late.status).toBe(400);
    expect(await late.json()).toEqual(changeoverPassed);
    expect(await clockRows()).toEqual(rows);
    const read = await request("GET", "");
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      details: { dayCutover: "04:00" },
      businessDayClock: { pending: null, currentBusinessDay: "2026-11-03" },
    });
    expect(
      (
        await request(
          "PUT",
          "/business-day-start",
          proposal({
            effectiveBusinessDay: "2026-11-04",
            expectedClockRevision: 2,
            dayCutover: "07:00",
          }),
        )
      ).status,
    ).toBe(200);
    expect((await clockRows()).changes).toHaveLength(2);
  });
  it.each(["PUT", "GET"])("requires the proper permission for %s", async (method) => {
    const path =
      method === "GET"
        ? "/business-day-start/preview?dayCutover=03%3A00&expectedClockRevision=0"
        : "/business-day-start";
    const body = method === "GET" ? undefined : proposal();
    await expectRefusal(await request(method, path, body, ""), 401, "management_session.required");
    await expectRefusal(
      await request(method, path, body, venue.staffCookie),
      403,
      "authorization.not_permitted",
    );
    expect(await clockRows()).toEqual({ changes: [], settings: [] });
  });
  it("answers a removed cancel route as it answers any unknown route, writing nothing", async () => {
    await request("PUT", "/business-day-start", proposal());
    const rows = await clockRows();
    for (const cookie of ["", venue.staffCookie, venue.managerCookie]) {
      const removed = await request(
        "DELETE",
        "/business-day-start",
        { expectedClockRevision: 1 },
        cookie,
      );
      const unknown = await request(
        "DELETE",
        "/no-such-route",
        { expectedClockRevision: 1 },
        cookie,
      );
      expect({ status: removed.status, body: await removed.text() }).toEqual({
        status: unknown.status,
        body: await unknown.text(),
      });
    }
    expect(await clockRows()).toEqual(rows);
  });
  it("refuses ambiguous and skipped transitions but accepts a nearby unambiguous date", async () => {
    at = new Date("2026-10-23T01:00:00Z");
    const autumn = await request(
      "PUT",
      "/business-day-start",
      proposal({ effectiveBusinessDay: "2026-10-24", dayCutover: "02:30" }),
    );
    expect(autumn.status).toBe(400);
    expect(await autumn.json()).toEqual({
      error: {
        code: "venue.business_day_invalid",
        params: {
          field: "dayCutover",
          reason: "clock_transition",
          clocksChangeOn: "2026-10-25",
          saveFrom: "2026-10-26T01:30:00.000Z",
        },
      },
    });
    at = new Date("2027-03-27T11:00:00Z");
    const spring = await request(
      "PUT",
      "/business-day-start",
      proposal({ effectiveBusinessDay: "2027-03-28", dayCutover: "02:30" }),
    );
    expect(spring.status).toBe(400);
    expect(await spring.json()).toEqual({
      error: {
        code: "venue.business_day_invalid",
        params: {
          field: "dayCutover",
          reason: "clock_transition",
          clocksChangeOn: "2027-03-28",
          saveFrom: "2027-03-29T00:30:00.000Z",
        },
      },
    });
    expect(await clockRows()).toEqual({ changes: [], settings: [] });
    at = new Date("2027-03-29T01:00:00Z");
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
  it.each(["save", "undo", "plain"])(
    "rechecks queued %s using the time after acquisition",
    async (kind) => {
      if (kind === "undo" || kind === "save")
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
        response = request(
          "PUT",
          "/business-day-start",
          proposal({
            expectedClockRevision: kind === "plain" ? 0 : 1,
            dayCutover: kind === "undo" ? "05:00" : "07:00",
          }),
        );
        await queued.promise;
        at = new Date("2026-11-03T04:00:00.000Z");
      } finally {
        spy.mockRestore();
        release.resolve();
      }
      await writer;
      const refused = await response;
      expect(refused.status).toBe(400);
      expect(await refused.json()).toEqual(changeoverPassed);
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
  it("refuses a future order anchor, including an undo after a backward clock correction", async () => {
    expect((await request("PUT", "/business-day-start", proposal())).status).toBe(200);
    const before = await clockRows();
    await inTx((tx) => createOpenOrder(tx, venue.cfg, randomUUID(), [], null));
    await suite.db.execute(
      sql`update working_orders set opened_at = '2026-11-03T02:00:00.000Z' where location_id = ${venue.cfg.locationId}`,
    );
    await expectRefusal(
      await request(
        "PUT",
        "/business-day-start",
        proposal({ expectedClockRevision: 1, dayCutover: "05:00" }),
      ),
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
        readVenueDetails(tx, venue.cfg, new Date("2026-11-03T01:59:59.999Z")),
      );
      expect(before.details.dayCutover).toBe("05:00");
      expect(before.businessDayClock).toMatchObject({
        currentBusinessDay: "2026-11-02",
        revision: 1,
      });
      expect(before.businessDayClock.pending).toEqual({
        effectiveBusinessDay: "2026-11-03",
        dayCutover: "03:00",
        startsAt: "2026-11-03T02:00:00.000Z",
      });
      const activated = await withTransaction(reopened.venue, (tx) =>
        readVenueDetails(tx, venue.cfg, new Date("2026-11-03T02:00:00.000Z")),
      );
      expect(activated.details.dayCutover).toBe("03:00");
      expect(activated.businessDayClock).toMatchObject({
        currentBusinessDay: "2026-11-03",
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
        effectiveBusinessDay: "2026-11-03",
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
    const query = new URLSearchParams({ dayCutover: "03:00", expectedClockRevision: "0" });
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
  it("counts a range painted in every season once and lists every department through the real boundary", async () => {
    const late = await authorRange("05:00", "05:00", { everySeason: true });
    const bar = await authorRange("05:00", "05:00", { everySeason: true, name: "Bar" });
    const saved = await clockRows();
    const query = new URLSearchParams({ dayCutover: "03:00", expectedClockRevision: "0" });
    const preview = await request("GET", `/business-day-start/preview?${query}`);
    expect(preview.status).toBe(200);
    const body = (await preview.json()) as {
      conflictCount: number;
      conflicts: { departmentId: string; seasonId?: string }[];
    };
    expect(body.conflictCount).toBe(14);
    expect(body.conflicts).toHaveLength(56);
    expect(new Set(body.conflicts.map((c) => c.departmentId))).toEqual(
      new Set([late.department.id, bar.department.id]),
    );
    expect(new Set(body.conflicts.map((c) => c.seasonId)).size).toBe(4);
    const response = await request("PUT", "/business-day-start", proposal());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "venue.business_day_hours_conflict", params: { conflictCount: 14 } },
    });
    expect(await clockRows()).toEqual(saved);
  });
});

describe("the preview chooses the changeover itself", () => {
  async function previewAt(instant: string, dayCutover: string) {
    at = new Date(instant);
    const query = new URLSearchParams({ dayCutover, expectedClockRevision: "0" });
    const response = await request("GET", `/business-day-start/preview?${query}`);
    expect(response.status).toBe(200);
    return (await response.json()) as {
      previousDay: { businessDay: string; dayCutover: string; startAt: string; endAt: string };
      effectiveDay: { businessDay: string };
    };
  }
  it("takes tonight's changeover when the new start is still ahead", async () => {
    const early = await previewAt("2026-10-20T20:00:00Z", "03:00");
    expect(early.effectiveDay.businessDay).toBe("2026-10-21");
    expect(early.previousDay).toEqual({
      businessDay: "2026-10-20",
      dayCutover: "05:00",
      startAt: "2026-10-20T03:00:00.000Z",
      endAt: "2026-10-21T01:00:00.000Z",
    });
    const late = await previewAt("2026-10-20T20:00:00Z", "21:00");
    expect(late.effectiveDay.businessDay).toBe("2026-10-21");
    expect(late.previousDay.endAt).toBe("2026-10-21T19:00:00.000Z");
  });
  it("takes the following changeover when the new start has already passed tonight", async () => {
    const body = await previewAt("2026-10-20T23:00:00Z", "00:30");
    expect(body.effectiveDay.businessDay).toBe("2026-10-22");
    expect(body.previousDay).toMatchObject({
      businessDay: "2026-10-21",
      startAt: "2026-10-21T03:00:00.000Z",
      endAt: "2026-10-21T22:30:00.000Z",
    });
  });
  it("bounds the day the clocks go back at 23 hours", async () => {
    const body = await previewAt("2026-10-24T20:00:00Z", "03:00");
    expect(body.previousDay).toMatchObject({
      startAt: "2026-10-24T03:00:00.000Z",
      endAt: "2026-10-25T02:00:00.000Z",
    });
  });
  it("refuses a query that names the effective date", async () => {
    at = new Date("2026-10-20T20:00:00Z");
    const response = await request(
      "GET",
      "/business-day-start/preview?effectiveBusinessDay=2026-10-21&dayCutover=03%3A00&expectedClockRevision=0",
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "venue.business_day_invalid",
        params: { field: "body", reason: "unknown_field" },
      },
    });
  });
  it("leaves tonight's waiting change in place and takes the following changeover once the new start has passed today", async () => {
    await inTx((tx) =>
      tx.insert(locationDayCutoverChanges).values({
        locationId: venue.cfg.locationId,
        effectiveBusinessDay: "2026-10-21",
        dayCutover: "21:00:00",
      }),
    );
    const body = await previewAt("2026-10-21T11:00:00Z", "10:00");
    expect(body.effectiveDay.businessDay).toBe("2026-10-22");
    expect(body.previousDay).toMatchObject({
      businessDay: "2026-10-21",
      startAt: "2026-10-21T19:00:00.000Z",
      endAt: "2026-10-22T08:00:00.000Z",
    });
    expect((await clockRows()).changes).toHaveLength(1);
  });
  describe("while tonight's 21:00 change waits, it is measured from the start in force", () => {
    let departmentId: string;
    beforeEach(async () => {
      at = new Date("2026-10-20T20:00:00Z");
      departmentId = (await authorRange("06:00", "20:00", { everySeason: true })).department.id;
      await inTx((tx) =>
        tx.insert(locationDayCutoverChanges).values({
          locationId: venue.cfg.locationId,
          effectiveBusinessDay: "2026-10-21",
          dayCutover: "21:00:00",
        }),
      );
    });
    async function conflictsFor(dayCutover: string) {
      const query = new URLSearchParams({ dayCutover, expectedClockRevision: "0" });
      const response = await request("GET", `/business-day-start/preview?${query}`);
      expect(response.status).toBe(200);
      return (await response.json()) as {
        conflictCount: number;
        conflicts: { departmentId: string; startsAt: string; reason: string }[];
      };
    }
    it("a replacing 23:00 clashes with a 06:00 range, as a move from 05:00 would", async () => {
      const body = await conflictsFor("23:00");
      expect(body.conflictCount).toBe(12);
      expect(body.conflicts).toContainEqual(
        expect.objectContaining({ departmentId, startsAt: "06:00", reason: "endpoint_day" }),
      );
    });
    it("going back to 05:00 clashes with nothing", async () => {
      expect(await conflictsFor("05:00")).toMatchObject({ conflictCount: 0, conflicts: [] });
    });
    it("refuses an order opened after 05:00 tomorrow, which the start in force puts in the moved day", async () => {
      await inTx((tx) => createOpenOrder(tx, venue.cfg, randomUUID(), [], null));
      await suite.db.execute(
        sql`update working_orders set opened_at = '2026-10-21T10:00:00.000Z' where location_id = ${venue.cfg.locationId}`,
      );
      const query = new URLSearchParams({ dayCutover: "23:00", expectedClockRevision: "0" });
      const response = await request("GET", `/business-day-start/preview?${query}`);
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: { code: "venue.business_day_locked", params: { reason: "future_history" } },
      });
    });
  });
});

it("the general clock preview shows the dated start in force at the supplied instant", async () => {
  await inTx((tx) =>
    tx.insert(locationDayCutoverChanges).values({
      locationId: venue.cfg.locationId,
      effectiveBusinessDay: "2026-11-04",
      dayCutover: "07:00:00",
    }),
  );
  at = new Date("2026-11-04T06:00:00.000Z");
  const response = await request(
    "GET",
    "/clock-preview?timeZone=Europe%2FMadrid&dayCutover=07%3A00",
  );
  expect(response.status).toBe(200);
  const answer = await response.json();
  expect(answer.current).toMatchObject({ businessDay: "2026-11-04", dayCutover: "07:00" });
});

describe("a Save takes the next changeover", () => {
  async function save(instant: string, body: Record<string, unknown>) {
    at = new Date(instant);
    return request("PUT", "/business-day-start", body);
  }
  async function ownRows() {
    return (await clockRows()).changes.map(({ effectiveBusinessDay, dayCutover }) => ({
      effectiveBusinessDay,
      dayCutover,
    }));
  }
  async function bounds(businessDay: string) {
    const clock = await inTx((tx) => readLocationClock(tx, venue.cfg.locationId));
    return businessDayBounds(clock, businessDay);
  }
  const tuesday = "2026-10-20T20:00:00Z";
  it("Example 1: 03:00 at Tue 22:00 ends today", async () => {
    const response = await save(
      tuesday,
      proposal({ effectiveBusinessDay: "2026-10-21", dayCutover: "03:00" }),
    );
    expect(response.status).toBe(200);
    expect(await ownRows()).toEqual([
      { effectiveBusinessDay: "2026-10-21", dayCutover: "03:00:00" },
    ]);
  });
  it("Example 4: 04:00 replaces tonight's 03:00 and Tue 20 ends at 04:00", async () => {
    await save(tuesday, proposal({ effectiveBusinessDay: "2026-10-21", dayCutover: "03:00" }));
    const response = await save(
      "2026-10-20T21:30:00Z",
      proposal({
        effectiveBusinessDay: "2026-10-21",
        dayCutover: "04:00",
        expectedClockRevision: 1,
      }),
    );
    expect(response.status).toBe(200);
    expect(await ownRows()).toEqual([
      { effectiveBusinessDay: "2026-10-21", dayCutover: "04:00:00" },
    ]);
    expect((await bounds("2026-10-20")).endAt).toBe("2026-10-21T02:00:00.000Z");
  });
  it("Example 5: 05:00 undoes tonight's 03:00", async () => {
    await save(tuesday, proposal({ effectiveBusinessDay: "2026-10-21", dayCutover: "03:00" }));
    const response = await save(
      "2026-10-20T21:45:00Z",
      proposal({
        effectiveBusinessDay: "2026-10-21",
        dayCutover: "05:00",
        expectedClockRevision: 1,
      }),
    );
    expect(response.status).toBe(200);
    expect(await clockRows()).toEqual({
      changes: [],
      settings: [{ locationId: venue.cfg.locationId, revision: 2 }],
    });
  });
  it("replaces a far-off waiting row the old form saved", async () => {
    await suite.db.insert(locationDayCutoverChanges).values({
      locationId: venue.cfg.locationId,
      effectiveBusinessDay: "2027-06-01",
      dayCutover: "07:00:00",
    });
    await suite.db
      .insert(locationBusinessDaySettings)
      .values({ locationId: venue.cfg.locationId, revision: 1 });
    const response = await save(
      tuesday,
      proposal({
        effectiveBusinessDay: "2026-10-21",
        dayCutover: "03:00",
        expectedClockRevision: 1,
      }),
    );
    expect(response.status).toBe(200);
    expect(await ownRows()).toEqual([
      { effectiveBusinessDay: "2026-10-21", dayCutover: "03:00:00" },
    ]);
    expect((await clockRows()).settings).toEqual([
      { locationId: venue.cfg.locationId, revision: 2 },
    ]);
  });
  it.each([
    [tuesday, "03:00", "2026-10-21T03:00:00.000Z"],
    ["2026-10-20T22:20:00Z", "00:30", "2026-10-20T22:31:00Z"],
  ])(
    "refuses a Save whose previewed changeover passed before it arrived (preview at %s, %s)",
    async (previewAt, dayCutover, saveAt) => {
      at = new Date(previewAt);
      const query = new URLSearchParams({ dayCutover, expectedClockRevision: "0" });
      const preview = await request("GET", `/business-day-start/preview?${query}`);
      const effectiveBusinessDay = (await preview.json()).effectiveDay.businessDay;
      expect(effectiveBusinessDay).toBe("2026-10-21");
      const response = await save(saveAt, proposal({ effectiveBusinessDay, dayCutover }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual(changeoverPassed);
      expect(await clockRows()).toEqual({ changes: [], settings: [] });
    },
  );
  describe("while tonight's 21:00 waits and the 05:00 changeover has passed (Wed 13:00)", () => {
    const wednesday = "2026-10-21T11:00:00Z";
    beforeEach(async () => {
      // The fixture's weekday 09:00–17:00 would clash with every start these cases save.
      await inTx(async (tx) => {
        const departmentId = (
          await tx.execute<{ id: string }>(sql`select id from departments limit 1`)
        ).rows[0]!.id;
        await replaceMenuWeek(
          tx,
          venue.cfg,
          departmentId,
          [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, slots: [] })),
          at,
          0,
          {},
        );
      });
      expect(
        (await save(tuesday, proposal({ effectiveBusinessDay: "2026-10-21", dayCutover: "21:00" })))
          .status,
      ).toBe(200);
    });
    async function tuesdayStillOpen() {
      expect((await bounds("2026-10-20")).endAt > new Date(wednesday).toISOString()).toBe(true);
    }
    it("(a) a later 23:00 replaces it", async () => {
      const response = await save(
        wednesday,
        proposal({
          effectiveBusinessDay: "2026-10-21",
          dayCutover: "23:00",
          expectedClockRevision: 1,
        }),
      );
      expect(response.status).toBe(200);
      expect(await ownRows()).toEqual([
        { effectiveBusinessDay: "2026-10-21", dayCutover: "23:00:00" },
      ]);
      await tuesdayStillOpen();
    });
    it("(b) an earlier 10:00 keeps it and follows it", async () => {
      const response = await save(
        wednesday,
        proposal({
          effectiveBusinessDay: "2026-10-22",
          dayCutover: "10:00",
          expectedClockRevision: 1,
        }),
      );
      expect(response.status).toBe(200);
      expect(await ownRows()).toEqual([
        { effectiveBusinessDay: "2026-10-21", dayCutover: "21:00:00" },
        { effectiveBusinessDay: "2026-10-22", dayCutover: "10:00:00" },
      ]);
      expect(await bounds("2026-10-21")).toEqual({
        startAt: "2026-10-21T19:00:00.000Z",
        endAt: "2026-10-22T08:00:00.000Z",
      });
      await tuesdayStillOpen();
    });
    it("(c) the start in force keeps it and follows it", async () => {
      const response = await save(
        wednesday,
        proposal({
          effectiveBusinessDay: "2026-10-22",
          dayCutover: "05:00",
          expectedClockRevision: 1,
        }),
      );
      expect(response.status).toBe(200);
      expect(await ownRows()).toEqual([
        { effectiveBusinessDay: "2026-10-21", dayCutover: "21:00:00" },
        { effectiveBusinessDay: "2026-10-22", dayCutover: "05:00:00" },
      ]);
      await tuesdayStillOpen();
    });
    it("(d) 21:00 again changes nothing", async () => {
      const response = await save(
        wednesday,
        proposal({
          effectiveBusinessDay: "2026-10-21",
          dayCutover: "21:00",
          expectedClockRevision: 1,
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ changed: false });
      expect(await ownRows()).toEqual([
        { effectiveBusinessDay: "2026-10-21", dayCutover: "21:00:00" },
      ]);
      expect((await clockRows()).settings[0]!.revision).toBe(1);
      await tuesdayStillOpen();
    });
  });
});
