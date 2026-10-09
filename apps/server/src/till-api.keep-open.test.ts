import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deviceProfiles,
  locations,
  withTransaction,
  workingOrderLines,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createCatalogue, addProductToMenu } from "@waitron/catalogue";
import {
  createPinThrottle,
  hashPin,
  loginWithPin,
  persons,
  registerModulePermissions,
} from "@waitron/identity";
import {
  createDepartment,
  createServiceZone,
  replaceMenuWeek,
  saveMenuPeriod,
  setProfileServiceAccess,
  periodExtensions,
  VENUE_SERVICE_PERMISSIONS,
} from "@waitron/venue-service";
import { setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { send } from "./testing/bill-venue.js";
import { mountTillApi } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import { DEVICE_COOKIE } from "./device-session.js";

registerModulePermissions(VENUE_SERVICE_PERMISSIONS);
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let v: PartyVenue;
let app: Hono;
let department: string;
let zone: string;
let lunch: string;
let afternoon: string;
let lunchItem: string;
let afternoonItem: string;
let manager: string;
let staff: string;
let managerCookie: string;
let staffCookie: string;
let deliCookie: string;
const at = (time: string) => vi.setSystemTime(new Date(`2026-10-05T${time}:00+02:00`));
const run = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, fn);
const read = () => `/api/service-zones/${zone}/keep-open`;
const write = () => `/api/service-zones/${zone}/period-extension`;
const body = () => ({ periodId: lunch, until: "14:30" });
const rows = () =>
  suite.db.select().from(periodExtensions).where(eq(periodExtensions.departmentId, department));
const call = (method: string, path: string, body?: unknown, cookie = managerCookie) =>
  send(app, cookie, method, path, body);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at("13:50");
  v = await setupPartyVenue(suite.db);
  const f = await run(async (tx) => {
    const department = (
      await createDepartment(tx, v.cfg, { name: "Restaurant", defaultServiceMode: "prepay" })
    ).id;
    const zone = (await createServiceZone(tx, v.cfg, { name: "Dining", departmentId: department }))
      .id;
    const menus: { period: string; item: string }[] = [];
    for (const name of ["Lunch", "Afternoon"]) {
      const menu = await createCatalogue(tx, { name });
      const item = await addProductToMenu(tx, {
        menuId: menu.id,
        productId: v.productId("Burger"),
        grossPrice: name === "Lunch" ? "12.00" : "15.00",
      });
      await publishWorkingMenu(tx, menu.id);
      const period = await saveMenuPeriod(tx, v.cfg, department, {
        name,
        menuId: menu.id,
        staffMenuIds: [],
      });
      menus.push({ period: period.id, item: item.id });
    }
    await replaceMenuWeek(
      tx,
      v.cfg,
      department,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        slots: [
          { periodId: menus[0]!.period, startsAt: "12:00", endsAt: "14:00" },
          { periodId: menus[1]!.period, startsAt: "14:00", endsAt: "19:00" },
        ],
      })),
      new Date(),
    );
    const [admin] = await tx
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.role, "admin"));
    const [operator] = await tx
      .insert(persons)
      .values({ displayName: "Waiter", role: "staff", pinHash: hashPin("5555") })
      .returning({ id: persons.id });
    return {
      department,
      zone,
      lunch: menus[0]!.period,
      afternoon: menus[1]!.period,
      lunchItem: menus[0]!.item,
      afternoonItem: menus[1]!.item,
      manager: admin!.id,
      staff: operator!.id,
    };
  });
  ({ department, zone, lunch, afternoon, lunchItem, afternoonItem, manager, staff } = f);
  const cookie = async (
    personId: string,
    pin: string,
    allowedDepartment = department,
    startingZone = zone,
  ) => {
    const [profile] = await suite.db
      .insert(deviceProfiles)
      .values({ name: randomUUID(), formFactor: "till", capabilities: ["take-orders"] })
      .returning({ id: deviceProfiles.id });
    await run((tx) =>
      setProfileServiceAccess(tx, v.cfg, profile!.id, {
        departmentId: allowedDepartment,
        allowedZoneIds: null,
        startingZoneId: startingZone,
        stationIds: [],
        watcherIds: [],
      }),
    );
    const device = await enrolDeviceForTest(suite.db, v.cfg, {
      name: randomUUID(),
      profileId: profile!.id,
    });
    const session = await run((tx) =>
      loginWithPin(tx, { deviceId: device.deviceId, personId, pin }),
    );
    return `${SESSION_COOKIE}=${session.token}; ${DEVICE_COOKIE}=${device.deviceId}.${device.token}`;
  };
  managerCookie = await cookie(manager, "1234");
  staffCookie = await cookie(staff, "5555");
  const deli = await run(async (tx) => {
    const id = (await createDepartment(tx, v.cfg, { name: "Deli", defaultServiceMode: "prepay" }))
      .id;
    return {
      id,
      zone: (await createServiceZone(tx, v.cfg, { name: "Deli counter", departmentId: id })).id,
    };
  });
  deliCookie = await cookie(manager, "1234", deli.id, deli.zone);
  app = new Hono();
  mountTillApi(
    app,
    {
      db: suite.db,
      backend: v.backend,
      clock: v.clock,
      cfg: v.cfg,
      secureCookies: false,
      venueLocale: v.cfg.locale,
      pinThrottle: createPinThrottle({ now: () => 1000 }),
    },
    () => {},
  );
});
afterEach(() => vi.useRealTimers());

describe("the till keeps a running period open today", () => {
  it("offers the current period to staff without management permission", async () => {
    const answer = await call("GET", read(), undefined, staffCookie);
    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({
      period: {
        id: lunch,
        name: "Lunch",
        endsAt: "14:00",
        running: true,
        extendedUntil: null,
        next: { name: "Afternoon", startsAt: "14:00" },
      },
    });
    const period = (answer.json as { period: { choices: string[] } }).period;
    expect(period.choices[0]).toBe("14:15");
    expect(period.choices.at(-1)).toBe("05:00");
  });
  it("keeps Lunch orderable and displaces Afternoon, including a stored quantity increase", async () => {
    const id = randomUUID();
    const park = (id: string, menuItemId: string) =>
      call("POST", "/api/working-orders", {
        id,
        zoneId: zone,
        lines: [{ menuItemId, quantity: "1" }],
      });
    expect((await park(id, lunchItem)).status).toBe(200);
    expect((await call("PUT", write(), body())).status).toBe(204);
    expect(await rows()).toEqual([
      expect.objectContaining({
        departmentId: department,
        periodId: lunch,
        businessDay: "2026-10-05",
        startsAt: "14:00:00",
        endsAt: "14:30:00",
      }),
    ]);
    at("14:15");
    expect((await park(randomUUID(), lunchItem)).status).toBe(200);
    const refused = await park(randomUUID(), afternoonItem);
    expect(refused.status).toBe(400);
    expect(refused.json).toMatchObject({ code: "menu_period.not_running" });
    expect(
      (await call("PUT", `/api/working-orders/${id}/lines/1`, { revision: 0, quantity: "2" }))
        .status,
    ).toBe(200);
    expect(
      await suite.db
        .select({ quantity: workingOrderLines.quantity, price: workingOrderLines.unitPriceGross })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, id)),
    ).toEqual([{ quantity: 2000, price: 1200 }]);
    for (const path of [`/api/menu-state?zoneId=${zone}`, `/api/service-zones/${zone}/offers`]) {
      const answer = await call("GET", path);
      expect(answer.status).toBe(200);
      expect(answer.json).toMatchObject({
        service: {
          open: true,
          periodName: "Lunch",
          keepOpen: {
            periodId: lunch,
            periodName: "Lunch",
            endsAt: "14:30",
            running: true,
            extendedUntil: "14:30",
          },
        },
      });
    }
    at("14:30");
    expect((await park(randomUUID(), afternoonItem)).status).toBe(200);
    expect((await park(randomUUID(), lunchItem)).status).toBe(400);
  });
  it("removes an extension with an explicit null", async () => {
    expect((await call("PUT", write(), body())).status).toBe(204);
    expect((await call("PUT", write(), { periodId: lunch, until: null })).status).toBe(204);
    expect(await rows()).toEqual([]);
    at("14:15");
    const answer = await call("GET", read());
    expect(answer.json).toMatchObject({ period: { id: afternoon, extendedUntil: null } });
  });
  it("refuses staff then accepts a manager PIN without requiring take-orders", async () => {
    const refused = await call("PUT", write(), body(), staffCookie);
    expect(refused.status).toBe(403);
    expect(refused.json).toMatchObject({ code: "authorization.not_permitted" });
    expect(await rows()).toEqual([]);
    expect(
      (
        await call(
          "PUT",
          write(),
          { ...body(), override: { personId: manager, pin: "1234" } },
          staffCookie,
        )
      ).status,
    ).toBe(204);
    expect(await rows()).toHaveLength(1);
  });
  it("refuses a correct staff PIN", async () => {
    const answer = await call(
      "PUT",
      write(),
      { ...body(), override: { personId: staff, pin: "5555" } },
      staffCookie,
    );
    expect(answer.status).toBe(403);
    expect(answer.json).toMatchObject({ code: "authorization.not_permitted" });
    expect(await rows()).toEqual([]);
  });
  it("uses the shared PIN attempt throttle", async () => {
    for (let i = 0; i < 4; i++) {
      const answer = await call(
        "PUT",
        write(),
        { ...body(), override: { personId: manager, pin: "9999" } },
        staffCookie,
      );
      expect(answer.status).toBe(401);
      expect(answer.json).toMatchObject({ code: "pin.invalid" });
    }
    const answer = await call(
      "PUT",
      write(),
      { ...body(), override: { personId: manager, pin: "1234" } },
      staffCookie,
    );
    expect(answer.status).toBe(429);
    expect(answer.json).toMatchObject({ code: "pin.throttled" });
    expect(await rows()).toEqual([]);
  });
  it.each(["GET", "PUT"])(
    "refuses %s for a zone outside the profile department",
    async (method) => {
      const answer = await call(
        method,
        method === "GET" ? read() : write(),
        method === "GET" ? undefined : body(),
        deliCookie,
      );
      expect(answer.status).toBe(403);
      expect(answer.json).toMatchObject({ code: "service_zone.not_allowed" });
      expect(await rows()).toEqual([]);
    },
  );
  it.each(["GET", "PUT"])("requires a session for %s", async (method) => {
    const answer = await call(
      method,
      method === "GET" ? read() : write(),
      method === "GET" ? undefined : body(),
      "",
    );
    expect(answer.status).toBe(401);
    expect(answer.json).toMatchObject({ code: "session.required" });
  });
  it.each([
    [false, { until: "14:30" }, "management.request_invalid", 400],
    [false, { periodId: "invalid", until: "14:30" }, "management.request_invalid", 400],
    [false, { periodId: null, until: "14:30" }, "management.request_invalid", 400],
    [true, { until: 42 }, "management.request_invalid", 400],
    [true, { until: [] }, "management.request_invalid", 400],
    [true, {}, "management.request_invalid", 400],
    [true, { until: "14:10" }, "period_extension.invalid", 400],
    [true, { until: "13:45" }, "period_extension.invalid", 400],
  ] as const)(
    "refuses invalid input %s %j without writing",
    async (includePeriod, patch, code, status) => {
      const answer = await call("PUT", write(), {
        ...(includePeriod ? { periodId: lunch } : {}),
        ...patch,
      });
      expect(answer.status).toBe(status);
      expect(answer.json).toMatchObject({ code });
      expect(await rows()).toEqual([]);
    },
  );
  it("refuses another period", async () => {
    const answer = await call("PUT", write(), { periodId: afternoon, until: "14:30" });
    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({ code: "period_extension.not_allowed" });
    expect(await rows()).toEqual([]);
  });
  it("refuses an unreadable location clock without writing", async () => {
    await suite.db
      .update(locations)
      .set({ timeZone: "not/a-zone" })
      .where(eq(locations.id, v.cfg.locationId));
    const answer = await call("PUT", write(), body());
    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({ code: "time_zone.unreadable" });
    expect(await rows()).toEqual([]);
  });
});
