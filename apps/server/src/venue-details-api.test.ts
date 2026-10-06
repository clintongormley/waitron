import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createOpenOrder } from "./working-order.js";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { venueFiscalSelection } from "@waitron/provisioning";
import { ALL_MODULES } from "./modules.js";
import { mountLocationSettingsApi } from "./location-settings-api.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";
import { readVenueDetails } from "./venue-details.js";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { TrustedClock } from "@waitron/fiscal";
import { recordTillSale } from "./till-sale.js";
import { offerProducts } from "./testing/zone-offers.js";
import { deviceRequestCfg } from "./testing/session-device.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let venue: Venue;
let app: Hono;
beforeEach(async () => {
  venue = await setupVenue(suite.db);
  app = new Hono();
  mountLocationSettingsApi(
    app,
    {
      db: suite.db,
      cfg: venue.cfg,
      now: () => new Date("2026-10-06T02:00:00Z"),
      readBackupDeadlines: () => ({ archive: "2026-10-06T03:36:00.000Z", cloud: null }),
      fiscal: venueFiscalSelection(ALL_MODULES, "ES-common").contribution!,
    },
    () => {},
  );
});
const initial = () => withTransaction(suite.db, (tx) => readVenueDetails(tx, venue.cfg));
function request(method: string, cookie?: string, body?: unknown) {
  return app.request("/management-api/venue-details", {
    method,
    headers: { "content-type": "application/json", ...(cookie === undefined ? {} : { cookie }) },
    ...(method === "PATCH" ? { body: JSON.stringify(body) } : {}),
  });
}
describe("venue details HTTP boundary", () => {
  it("reads exact deployed values and returns the saved model and no-op result", async () => {
    const model = await initial();
    const response = await request("GET", venue.managerCookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(model);
    const patch = { expected: model.details, changes: { name: " New display " } };
    const saved = await request("PATCH", venue.managerCookie, patch);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({
      changed: true,
      model: { ...model, details: { ...model.details, name: "New display" } },
    });
    const repeat = await request("PATCH", venue.managerCookie, patch);
    expect(repeat.status).toBe(200);
    expect(await repeat.json()).toEqual({
      changed: false,
      model: { ...model, details: { ...model.details, name: "New display" } },
    });
  });
  it.each(["GET", "PATCH"])("requires a session and refuses staff for %s", async (method) => {
    const model = await initial();
    const body = { expected: model.details, changes: {} };
    const absent = await request(method, undefined, body);
    expect(absent.status).toBe(401);
    expect(await absent.json()).toEqual({
      error: { code: "management_session.required", params: {} },
    });
    const staff = await request(method, venue.staffCookie, body);
    expect(staff.status).toBe(403);
    expect(await staff.json()).toEqual({
      error: {
        code: "authorization.not_permitted",
        params: { permission: method === "GET" ? "venue.view" : "venue.configure" },
      },
    });
  });
  it("serves a supervisor read but refuses even an unchanged patch", async () => {
    await suite.db.execute(sql`update persons set role = 'supervisor' where role = 'manager'`);
    const model = await initial();
    const read = await request("GET", venue.managerCookie);
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(model);
    const save = await request("PATCH", venue.managerCookie, {
      expected: model.details,
      changes: {},
    });
    expect(save.status).toBe(403);
    expect(await save.json()).toEqual({
      error: { code: "authorization.not_permitted", params: { permission: "venue.configure" } },
    });
  });
  it.each([
    ["body", { unexpected: "private value" }],
    ["changes", { changes: { unexpected: "private value" } }],
    ["expected", { expected: { unexpected: "private value" } }],
  ])("names the containing %s for an unknown key", async (field, addition) => {
    const model = await initial();
    const response = await request("PATCH", venue.managerCookie, {
      expected: model.details,
      changes: { name: "Must not write" },
      ...addition,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "venue.detail_invalid", params: { field, reason: "unknown_field" } },
    });
    expect((await initial()).details).toEqual(model.details);
  });
  it.each(["country", "taxId", "legalName", "locationId", "fiscalTerritory"])(
    "refuses a crafted %s identity edit",
    async (field) => {
      const model = await initial();
      const response = await request("PATCH", venue.managerCookie, {
        expected: model.details,
        changes: { [field]: "private", name: "Must not write" },
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: { code: "venue.detail_read_only", params: { field } },
      });
      expect((await initial()).details).toEqual(model.details);
    },
  );
  it("returns the exact invalid field and stale-field refusal with no partial save", async () => {
    const model = await initial();
    const invalid = await request("PATCH", venue.managerCookie, {
      expected: model.details,
      changes: { name: "Not committed", city: "" },
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: { code: "venue.detail_invalid", params: { field: "city", reason: "required" } },
    });
    expect((await initial()).details).toEqual(model.details);
    await suite.db.execute(
      sql`update locations set city = 'New saved town' where id = ${venue.cfg.locationId}`,
    );
    const stale = await request("PATCH", venue.managerCookie, {
      expected: model.details,
      changes: { name: "Not committed", city: "My town" },
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      error: { code: "venue.detail_changed", params: { field: "city" } },
    });
    expect((await initial()).details).toEqual({ ...model.details, city: "New saved town" });
  });
});

describe("fresh authorization and history at the HTTP write", () => {
  it("rechecks order history since the GET, refuses the whole clock patch and serves a no-op", async () => {
    const model = await initial();
    await withTransaction(suite.db, (tx) => createOpenOrder(tx, venue.cfg, randomUUID(), [], null));
    const locked = await request("PATCH", venue.managerCookie, {
      expected: model.details,
      changes: { name: "Do not commit", dayCutover: "04:00" },
    });
    expect(locked.status).toBe(409);
    expect(await locked.json()).toEqual({
      error: { code: "venue.detail_locked", params: { field: "dayCutover", reason: "orders" } },
    });
    expect((await initial()).details).toEqual(model.details);
    const noOp = await request("PATCH", venue.managerCookie, {
      expected: model.details,
      changes: { dayCutover: "05:00:00", province: "28" },
    });
    expect(noOp.status).toBe(200);
    expect(await noOp.json()).toEqual({
      changed: false,
      model: {
        ...model,
        hasOrderHistory: true,
        policy: {
          ...model.policy,
          dayCutover: { decision: "refuse", reasons: ["orders"] },
          timeZone: { decision: "refuse", reasons: ["orders"] },
        },
      },
    });
  });
  it("permits an administrator read and edit", async () => {
    await suite.db.execute(sql`update persons set role = 'admin' where role = 'manager'`);
    const model = await initial();
    const read = await request("GET", venue.managerCookie);
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(model);
    const saved = await request("PATCH", venue.managerCookie, {
      expected: model.details,
      changes: { name: "Admin correction" },
    });
    expect(saved.status).toBe(200);
    expect((await initial()).details.name).toBe("Admin correction");
  });
  it.each(["GET", "PATCH"])("refuses an expired session for %s", async (method) => {
    const model = await initial();
    await suite.db.execute(
      sql`update management_sessions set last_seen_at = '2000-01-01T00:00:00.000Z'`,
    );
    const response = await request(method, venue.managerCookie, {
      expected: model.details,
      changes: {},
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "management_session.expired", params: {} },
    });
    expect((await initial()).details).toEqual(model.details);
  });
  it("refuses a location identifier on the envelope and keeps the deployed location", async () => {
    const model = await initial();
    const response = await request("PATCH", venue.managerCookie, {
      expected: model.details,
      changes: { name: "Not saved" },
      locationId: randomUUID(),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "venue.detail_read_only", params: { field: "locationId" } },
    });
    expect((await initial()).details).toEqual(model.details);
  });
});

it("rechecks a real sale after GET before accepting any clock patch", async () => {
  const response = await request("GET", venue.managerCookie);
  expect(response.status).toBe(200);
  const model = await initial();
  expect(await response.json()).toEqual(model);
  const offers = await withTransaction(suite.db, (tx) => offerProducts(tx, venue.cfg));
  const clock: TrustedClock = {
    now: () => ({
      instant: new Date("2026-10-06T12:00:00Z"),
      offsetMinutes: 120,
      confident: true,
      confidence: "anchored",
      anchorAgeSeconds: 0,
    }),
    anchor: () => {
      throw new Error("An anchored clock is supplied");
    },
    currentAnchor: () => null,
  };
  const backend = new VerifactuBackend({
    clock,
    db: suite.db,
    environment: "preproduction",
    deploymentEnvironment: "preproduction",
    resolveClient: () => Promise.reject(new Error("Local sale contacted AEAT")),
  });
  const cfg = await deviceRequestCfg(suite.db, venue.cfg);
  await recordTillSale({ db: suite.db, backend, clock }, cfg, {
    zoneId: offers.zoneId,
    lines: [{ menuItemId: offers.offerFor(venue.cafeId), quantity: "1" }],
    tender: { method: "cash", amount: "1.50" },
  });
  const before = suite.db.all(sql`select * from locations`);
  const refused = await request("PATCH", venue.managerCookie, {
    expected: model.details,
    changes: { name: "Not committed", dayCutover: "04:30" },
  });
  expect(refused.status).toBe(409);
  expect(await refused.json()).toEqual({
    error: { code: "venue.detail_locked", params: { field: "dayCutover", reason: "sales" } },
  });
  expect(suite.db.all(sql`select * from locations`)).toEqual(before);
  const repeat = await request("PATCH", venue.managerCookie, {
    expected: model.details,
    changes: { province: "28", dayCutover: "05:00:00" },
  });
  expect(repeat.status).toBe(200);
  expect(await repeat.json()).toEqual({ changed: false, model: await initial() });
  expect(suite.db.all(sql`select * from locations`)).toEqual(before);
  expect(suite.db.all(sql`select id from sales`)).toHaveLength(1);
});

describe("venue clock preview", () => {
  const path = "/management-api/venue-details/clock-preview?timeZone=UTC&dayCutover=00%3A00";
  it("uses one instant for saved and proposed clocks and exposes the retained backup deadline without writing", async () => {
    const before = await initial();
    const response = await app.request(path, { headers: { cookie: venue.managerCookie } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      at: "2026-10-06T02:00:00.000Z",
      current: {
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
        civilDate: "2026-10-06",
        timeOfDay: "04:00",
        businessDay: "2026-10-05",
      },
      proposed: {
        timeZone: "UTC",
        dayCutover: "00:00",
        civilDate: "2026-10-06",
        timeOfDay: "02:00",
        businessDay: "2026-10-06",
        transitions: [],
      },
      backupDeadlines: { archive: "2026-10-06T03:36:00.000Z", cloud: null },
    });
    expect(await initial()).toEqual(before);
  });
  it("shows the actual reporting cutover on the next fold and gap days", async () => {
    await suite.db.execute(
      sql`update locations set day_cutover = '02:30:00' where id = ${venue.cfg.locationId}`,
    );
    const response = await app.request(path, { headers: { cookie: venue.managerCookie } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.current.transitions).toEqual([
      {
        at: "2026-10-25T01:00:00.000Z",
        civilDate: "2026-10-25",
        boundaryAt: "2026-10-25T01:30:00.000Z",
        boundaryTime: "02:30",
      },
      {
        at: "2027-03-28T01:00:00.000Z",
        civilDate: "2027-03-28",
        boundaryAt: "2027-03-28T01:30:00.000Z",
        boundaryTime: "03:30",
      },
    ]);
  });
  it.each([
    [undefined, 401],
    ["staff", 403],
    ["supervisor", 200],
  ])("enforces preview read authorization for %s", async (role, status) => {
    if (role === "supervisor")
      await suite.db.execute(sql`update persons set role = 'supervisor' where role = 'manager'`);
    const cookie =
      role === undefined ? undefined : role === "staff" ? venue.staffCookie : venue.managerCookie;
    const response = await app.request(path, { headers: cookie ? { cookie } : {} });
    expect(response.status).toBe(status);
  });
  it.each([
    ["timeZone=Nowhere&dayCutover=05%3A00", "timeZone", "time_zone"],
    ["timeZone=%2B02%3A00&dayCutover=05%3A00", "timeZone", "time_zone"],
    ["timeZone=UTC&dayCutover=25%3A00", "dayCutover", "cutover"],
    ["timeZone=UTC&dayCutover=02%3A30%3A01", "dayCutover", "cutover"],
  ])("refuses invalid preview query %s", async (query, field, reason) => {
    const response = await app.request(`/management-api/venue-details/clock-preview?${query}`, {
      headers: { cookie: venue.managerCookie },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "venue.detail_invalid", params: { field, reason } },
    });
  });
});

it("previews a late cutover on both transition days without moving it to the previous date", async () => {
  const response = await app.request(
    "/management-api/venue-details/clock-preview?timeZone=Europe%2FMadrid&dayCutover=23%3A59%3A00",
    { headers: { cookie: venue.managerCookie } },
  );
  expect(response.status).toBe(200);
  const preview = await response.json();
  expect(preview.proposed.dayCutover).toBe("23:59");
  expect(preview.proposed.transitions).toEqual([
    {
      at: "2026-10-25T01:00:00.000Z",
      civilDate: "2026-10-25",
      boundaryAt: "2026-10-25T22:59:00.000Z",
      boundaryTime: "23:59",
    },
    {
      at: "2027-03-28T01:00:00.000Z",
      civilDate: "2027-03-28",
      boundaryAt: "2027-03-28T21:59:00.000Z",
      boundaryTime: "23:59",
    },
  ]);
});
it("can preview a valid replacement for an unreadable saved zone, including a named fixed-offset zone", async () => {
  await suite.db.execute(
    sql`update locations set time_zone = 'legacy-invalid-zone' where id = ${venue.cfg.locationId}`,
  );
  const response = await app.request(
    "/management-api/venue-details/clock-preview?timeZone=Etc%2FGMT%2B2&dayCutover=00%3A00",
    { headers: { cookie: venue.managerCookie } },
  );
  expect(response.status).toBe(200);
  const preview = await response.json();
  expect(preview.current).toBeNull();
  expect(preview.proposed).toEqual({
    timeZone: "Etc/GMT+2",
    dayCutover: "00:00",
    civilDate: "2026-10-06",
    timeOfDay: "00:00",
    businessDay: "2026-10-06",
    transitions: [],
  });
});
