import { eq, sql } from "drizzle-orm";
import { setClaim } from "./routing-store.js";
import { setStationToday } from "./station-times.js";
import { seedStationWeek } from "./testing/station-week.js";
import { clockChangeAfter, minutesAfter } from "./testing/clock-change.js";
import { saveSpecialDate } from "./hours.js";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CATALOGUE_MIGRATIONS,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  diningTables,
  floorZones,
  kitchenStations,
  locations,
  withTransaction,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  hashPin,
  IDENTITY_MIGRATIONS,
  persons,
  registerModulePermissions,
  startManagementSession,
} from "@waitron/identity";
import type { ModuleRouteContext } from "@waitron/module";
import { locationId, type LocationId } from "@waitron/shared";
import { MANAGEMENT_COOKIE, type Logger } from "@waitron/server-kit";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { zoneServicePolicies } from "./schema/service.js";
import { configureZone, createDepartment, listServiceZones } from "./operations.js";
import { VENUE_SERVICE_PERMISSIONS } from "./permissions.js";
import { VENUE_SERVICE_ROUTES } from "./routes.js";

registerModulePermissions(VENUE_SERVICE_PERMISSIONS);

const suite = useVenueDb({
  migrations: [
    CORE_MIGRATIONS,
    CATALOGUE_MIGRATIONS,
    VENUE_SERVICE_MIGRATIONS,
    IDENTITY_MIGRATIONS,
  ],
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

const noopLog: Logger = () => {};

interface Fixture {
  app: Hono;
  locationId: LocationId;
  managerCookie: string;
  staffCookie: string;
  supervisorCookie: string;
  zoneId: string;
  stationId: string;
  menuId: string;
  categoryId: string;
}

async function fixture(): Promise<Fixture> {
  await seedTenant(db);
  const [location] = await db
    .insert(locations)
    .values({ name: "Venue", invoiceLocales: ["en-GB"], operationDescription: "Hospitality" })
    .returning({ id: locations.id });
  const scopedLocationId = locationId(location!.id);
  const [zone] = await db
    .insert(floorZones)
    .values({ locationId: scopedLocationId, name: "Terrace" })
    .returning({ id: floorZones.id });
  const [station] = await db
    .insert(kitchenStations)
    .values({ locationId: scopedLocationId, name: "Terrace bar", isDefault: true })
    .returning({ id: kitchenStations.id });

  const { menuId, categoryId, managerSessionId, staffSessionId, supervisorSessionId } =
    await db.transaction(async (tx) => {
      const menu = await createCatalogue(tx, { name: "Drinks" });
      const category = await createCategory(tx, { name: `Cocktails ${scopedLocationId}` });
      const [manager] = await tx
        .insert(persons)
        .values({
          displayName: `Manager ${scopedLocationId}`,
          pinHash: hashPin("1234"),
          role: "manager",
        })
        .returning({ id: persons.id });
      const [staff] = await tx
        .insert(persons)
        .values({
          displayName: `Staff ${scopedLocationId}`,
          pinHash: hashPin("1234"),
          role: "staff",
        })
        .returning({ id: persons.id });
      const [supervisor] = await tx
        .insert(persons)
        .values({
          displayName: `Supervisor ${scopedLocationId}`,
          pinHash: hashPin("1234"),
          role: "supervisor",
        })
        .returning({ id: persons.id });
      const managerSession = await startManagementSession(tx, {
        personId: manager!.id,
      });
      const staffSession = await startManagementSession(tx, {
        personId: staff!.id,
      });
      const supervisorSession = await startManagementSession(tx, {
        personId: supervisor!.id,
      });
      return {
        menuId: menu.id,
        categoryId: category.id,
        managerSessionId: managerSession.token,
        staffSessionId: staffSession.token,
        supervisorSessionId: supervisorSession.token,
      };
    });

  const app = new Hono();
  VENUE_SERVICE_ROUTES.mount(
    app,
    {
      db,
      cfg: { locationId: scopedLocationId },
      core: {} as ModuleRouteContext["core"],
    },
    noopLog,
  );
  return {
    app,
    locationId: scopedLocationId,
    managerCookie: `${MANAGEMENT_COOKIE}=${managerSessionId}`,
    staffCookie: `${MANAGEMENT_COOKIE}=${staffSessionId}`,
    supervisorCookie: `${MANAGEMENT_COOKIE}=${supervisorSessionId}`,
    zoneId: zone!.id,
    stationId: station!.id,
    menuId,
    categoryId,
  };
}

async function send(
  app: Hono,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  cookie?: string,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cookie !== undefined) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  return app.request(path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("venue service management routes", () => {
  it("refuses the retired invoice-first style without changing departments or zones", async () => {
    const fx = await fixture();
    const department = await withTransaction(db, (tx) =>
      createDepartment(tx, fx, { name: "Dining", defaultServiceMode: "table_tab" }),
    );
    await withTransaction(db, (tx) =>
      configureZone(tx, fx, { zoneId: fx.zoneId, departmentId: department.id }),
    );
    const before = await (
      await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)
    ).json();
    for (const [method, path, body, field] of [
      [
        "POST",
        "/management-api/venue-service/departments",
        { name: "Retired", defaultServiceMode: "invoice_first" },
        "defaultServiceMode",
      ],
      [
        "PATCH",
        `/management-api/venue-service/departments/${department.id}`,
        { name: "Retired", tradingName: "Retired", defaultServiceMode: "invoice_first" },
        "defaultServiceMode",
      ],
      [
        "PUT",
        `/management-api/venue-service/zones/${fx.zoneId}`,
        { departmentId: department.id, serviceMode: "invoice_first" },
        "serviceMode",
      ],
    ] as const) {
      const response = await send(fx.app, method, path, fx.managerCookie, body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field } },
      });
      expect(
        await (await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)).json(),
      ).toEqual(before);
    }
  });

  it("creates a floor zone and assigns its department in one request", async () => {
    const fx = await fixture();
    const department = (await (
      await send(fx.app, "POST", "/management-api/venue-service/departments", fx.managerCookie, {
        name: "Terrace service",
        defaultServiceMode: "prepay",
      })
    ).json()) as { id: string };

    const response = await send(
      fx.app,
      "POST",
      "/management-api/venue-service/zones",
      fx.managerCookie,
      { name: "Garden", departmentId: department.id },
    );
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    expect(await db.select().from(floorZones).where(eq(floorZones.id, id))).toMatchObject([
      { locationId: fx.locationId, name: "Garden", active: true },
    ]);
    expect(
      await db.select().from(zoneServicePolicies).where(eq(zoneServicePolicies.zoneId, id)),
    ).toMatchObject([{ departmentId: department.id, serviceMode: null }]);
  });

  it("refuses a missing department without retaining a floor zone", async () => {
    const fx = await fixture();
    const response = await send(
      fx.app,
      "POST",
      "/management-api/venue-service/zones",
      fx.managerCookie,
      { name: "Orphan garden", departmentId: crypto.randomUUID() },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "department.not_found" } });
    expect(await db.select().from(floorZones).where(eq(floorZones.name, "Orphan garden"))).toEqual(
      [],
    );
  });

  it("refuses a blank zone name at the write boundary", async () => {
    const fx = await fixture();
    const department = (await (
      await send(fx.app, "POST", "/management-api/venue-service/departments", fx.managerCookie, {
        name: "Garden service",
        defaultServiceMode: "prepay",
      })
    ).json()) as { id: string };
    const response = await send(
      fx.app,
      "POST",
      "/management-api/venue-service/zones",
      fx.managerCookie,
      { name: "   ", departmentId: department.id },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "name" } },
    });
  });

  it("reports a duplicate zone name and leaves its department assignment unchanged", async () => {
    const fx = await fixture();
    const department = (await (
      await send(fx.app, "POST", "/management-api/venue-service/departments", fx.managerCookie, {
        name: "Garden service",
        defaultServiceMode: "prepay",
      })
    ).json()) as { id: string };
    const response = await send(
      fx.app,
      "POST",
      "/management-api/venue-service/zones",
      fx.managerCookie,
      { name: "Terrace", departmentId: department.id },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "zone.name_taken" } });
    expect(
      await db.select().from(zoneServicePolicies).where(eq(zoneServicePolicies.zoneId, fx.zoneId)),
    ).toEqual([]);
  });

  it("rolls back the floor zone when its department assignment fails", async () => {
    const fx = await fixture();
    const department = (await (
      await send(fx.app, "POST", "/management-api/venue-service/departments", fx.managerCookie, {
        name: "Garden service",
        defaultServiceMode: "prepay",
      })
    ).json()) as { id: string };
    await db.execute(sql`
      create trigger refuse_garden_assignment before insert on zone_service_policies
      when new.zone_id in (select id from floor_zones where name = 'Rollback garden')
      begin select raise(abort, 'assignment refused'); end
    `);
    try {
      const response = await send(
        fx.app,
        "POST",
        "/management-api/venue-service/zones",
        fx.managerCookie,
        { name: "Rollback garden", departmentId: department.id },
      );
      expect(response.status).toBe(500);
      expect(
        await db.select().from(floorZones).where(eq(floorZones.name, "Rollback garden")),
      ).toEqual([]);
    } finally {
      await db.execute(sql`drop trigger refuse_garden_assignment`);
    }
  });

  it("previews department removal with zone names and active table counts", async () => {
    const fx = await fixture();
    const department = (await (
      await send(fx.app, "POST", "/management-api/venue-service/departments", fx.managerCookie, {
        name: "Restaurant",
        defaultServiceMode: "table_tab",
      })
    ).json()) as { id: string };
    const [secondZone] = await db
      .insert(floorZones)
      .values({
        locationId: fx.locationId,
        name: "Dining room",
      })
      .returning({ id: floorZones.id });
    await withTransaction(db, async (tx) => {
      await configureZone(
        tx,
        { locationId: fx.locationId },
        {
          zoneId: fx.zoneId,
          departmentId: department.id,
        },
      );
      await configureZone(
        tx,
        { locationId: fx.locationId },
        {
          zoneId: secondZone!.id,
          departmentId: department.id,
        },
      );
      await tx.insert(diningTables).values([
        { locationId: fx.locationId, label: "T1", zoneId: fx.zoneId },
        { locationId: fx.locationId, label: "T2", zoneId: fx.zoneId, active: false },
        { locationId: fx.locationId, label: "D1", zoneId: secondZone!.id },
        { locationId: fx.locationId, label: "D2", zoneId: secondZone!.id },
      ]);
    });

    const response = await send(
      fx.app,
      "GET",
      `/management-api/venue-service/departments/${department.id}/removal-impact`,
      fx.managerCookie,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      zones: [
        { id: secondZone!.id, name: "Dining room", activeTableCount: 2 },
        { id: fx.zoneId, name: "Terrace", activeTableCount: 1 },
      ],
    });
  });

  it("previews removal of an unconfigured zone with its active table count", async () => {
    const fx = await fixture();
    await db.insert(diningTables).values([
      { locationId: fx.locationId, label: "T1", zoneId: fx.zoneId },
      { locationId: fx.locationId, label: "T2", zoneId: fx.zoneId, active: false },
    ]);
    const response = await send(
      fx.app,
      "GET",
      `/management-api/venue-service/zones/${fx.zoneId}/removal-impact`,
      fx.managerCookie,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      zones: [{ id: fx.zoneId, name: "Terrace", activeTableCount: 1 }],
    });

    const otherVenue = await fixture();
    const outside = await send(
      fx.app,
      "GET",
      `/management-api/venue-service/zones/${otherVenue.zoneId}/removal-impact`,
      fx.managerCookie,
    );
    expect(outside.status).toBe(404);
    expect(await outside.json()).toMatchObject({
      error: { code: "service_zone.not_found", params: { zoneId: otherVenue.zoneId } },
    });
  });

  it("reads inherited sale policy and edits one field with a clearable zone override", async () => {
    const fx = await fixture();
    const created = await send(
      fx.app,
      "POST",
      "/management-api/venue-service/departments",
      fx.managerCookie,
      {
        name: "Restaurant",
        tradingName: "Dining Room",
        defaultServiceMode: "prepay",
      },
    );
    expect(created.status).toBe(201);
    const department = (await created.json()) as { id: string };
    expect(
      (
        await send(
          fx.app,
          "PUT",
          `/management-api/venue-service/zones/${fx.zoneId}`,
          fx.managerCookie,
          {
            departmentId: department.id,
            serviceMode: null,
          },
        )
      ).status,
    ).toBe(204);

    const departmentPath = `/management-api/venue-service/departments/${department.id}/sale-policy/receiptPrintMode`;
    const zonePath = `/management-api/venue-service/zones/${fx.zoneId}/sale-policy/paidWhen`;
    expect(
      (await send(fx.app, "PATCH", departmentPath, fx.managerCookie, { value: "on_request" }))
        .status,
    ).toBe(204);
    expect(
      (await send(fx.app, "PATCH", zonePath, fx.managerCookie, { value: "ticket_then_pay" }))
        .status,
    ).toBe(204);
    const read = async () =>
      (
        (await (
          await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)
        ).json()) as {
          salePolicies: {
            departments: { departmentId: string; receiptPrintMode: string }[];
            zones: {
              zoneId: string;
              paidWhen: string | null;
              effective: { paidWhen: string; receiptPrintMode: string };
            }[];
          };
        }
      ).salePolicies;
    expect(await read()).toMatchObject({
      departments: [{ departmentId: department.id, receiptPrintMode: "on_request" }],
      zones: [
        {
          zoneId: fx.zoneId,
          paidWhen: "ticket_then_pay",
          effective: { paidWhen: "ticket_then_pay", receiptPrintMode: "on_request" },
        },
      ],
    });
    expect((await send(fx.app, "PATCH", zonePath, fx.managerCookie, { value: null })).status).toBe(
      204,
    );
    expect((await read()).zones[0]).toMatchObject({
      paidWhen: null,
      effective: { paidWhen: "prepay" },
    });
  });

  it("persists department and zone collection settings and the department receipt-heading switch", async () => {
    const fx = await fixture();
    const department = await withTransaction(db, async (tx) => {
      const row = await createDepartment(
        tx,
        { locationId: fx.locationId },
        { name: "Restaurant", defaultServiceMode: "prepay" },
      );
      await configureZone(
        tx,
        { locationId: fx.locationId },
        { zoneId: fx.zoneId, departmentId: row.id },
      );
      return row;
    });
    const departmentPath = `/management-api/venue-service/departments/${department.id}/sale-policy`;
    const zonePath = `/management-api/venue-service/zones/${fx.zoneId}/sale-policy`;
    for (const [path, value] of [
      [`${departmentPath}/collectionNumber`, "numbered"],
      [`${zonePath}/collectionNumber`, "none"],
      [`${departmentPath}/printTradingName`, false],
    ] as const) {
      expect((await send(fx.app, "PATCH", path, fx.managerCookie, { value })).status).toBe(204);
    }
    const read = async () =>
      (await (
        await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)
      ).json()) as { salePolicies: { departments: unknown[]; zones: unknown[] } };
    expect((await read()).salePolicies).toMatchObject({
      departments: [
        { departmentId: department.id, collectionNumber: "numbered", printTradingName: false },
      ],
      zones: [
        {
          zoneId: fx.zoneId,
          collectionNumber: "none",
          effective: { collectionNumber: "none", printTradingName: false },
        },
      ],
    });
    expect(
      (
        await send(fx.app, "PATCH", `${zonePath}/collectionNumber`, fx.managerCookie, {
          value: null,
        })
      ).status,
    ).toBe(204);
    expect((await read()).salePolicies.zones[0]).toMatchObject({
      collectionNumber: null,
      effective: { collectionNumber: "numbered" },
    });
    for (const field of ["collectionNumber", "printTradingName"] as const) {
      const response = await send(fx.app, "PATCH", `${departmentPath}/${field}`, fx.managerCookie, {
        value: "bad",
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field } },
      });
    }
  });

  it("refuses invalid policy values, unauthorized writes and another venue's department", async () => {
    const fx = await fixture();
    const other = await fixture();
    const created = await send(
      fx.app,
      "POST",
      "/management-api/venue-service/departments",
      fx.managerCookie,
      {
        name: "Restaurant",
        tradingName: "Restaurant",
        defaultServiceMode: "prepay",
      },
    );
    const department = (await created.json()) as { id: string };
    const path = `/management-api/venue-service/departments/${department.id}/sale-policy/paidWhen`;
    for (const value of [null, 1, "invoice_first", "bad"]) {
      const response = await send(fx.app, "PATCH", path, fx.managerCookie, { value });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "paidWhen" } },
      });
    }
    const unknown = await send(
      fx.app,
      "PATCH",
      `/management-api/venue-service/departments/${department.id}/sale-policy/unknown`,
      fx.managerCookie,
      { value: true },
    );
    expect(unknown.status).toBe(400);
    expect(
      (await send(fx.app, "PATCH", path, fx.staffCookie, { value: "ticket_then_pay" })).status,
    ).toBe(403);
    const foreign = await send(other.app, "PATCH", path, other.managerCookie, {
      value: "ticket_then_pay",
    });
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toMatchObject({ error: { code: "department.not_found" } });
  });

  it("refuses an unknown zone policy field without clearing the receipt override", async () => {
    const fx = await fixture();
    const department = await withTransaction(db, async (tx) => {
      const row = await createDepartment(
        tx,
        { locationId: fx.locationId },
        {
          name: "Restaurant",
          defaultServiceMode: "prepay",
        },
      );
      await configureZone(
        tx,
        { locationId: fx.locationId },
        {
          zoneId: fx.zoneId,
          departmentId: row.id,
        },
      );
      return row;
    });
    expect(department.id).toBeTruthy();
    const base = `/management-api/venue-service/zones/${fx.zoneId}/sale-policy`;
    expect(
      (
        await send(fx.app, "PATCH", `${base}/receiptPrintMode`, fx.managerCookie, {
          value: "never",
        })
      ).status,
    ).toBe(204);
    const unknown = await send(fx.app, "PATCH", `${base}/nonsense`, fx.managerCookie, {
      value: null,
    });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "nonsense" } },
    });
    const saved = await db.execute<{ receipt_print_mode: string | null }>(sql`
      select receipt_print_mode from zone_sale_policies where zone_id = ${fx.zoneId}`);
    expect(saved.rows).toEqual([{ receipt_print_mode: "never" }]);
  });

  it("serves no interval-list hours writes and no department hours in the venue read", async () => {
    const fx = await fixture();
    const department = (await (
      await send(fx.app, "POST", "/management-api/venue-service/departments", fx.managerCookie, {
        name: "Restaurant",
        defaultServiceMode: "table_tab",
      })
    ).json()) as { id: string };
    const hours = [{ weekday: 5, opensAt: "19:00", closesAt: "21:00" }];
    for (const path of [
      `/management-api/venue-service/stations/${fx.stationId}/hours`,
      `/management-api/venue-service/departments/${department.id}/hours`,
    ])
      expect((await send(fx.app, "PUT", path, fx.managerCookie, { hours })).status).toBe(404);
    const listed = await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie);
    expect(listed.status).toBe(200);
    expect(Object.keys((await listed.json()) as object)).not.toContain("hours");
  });

  it("saves and clears a fallback while refusing loops and a missing key", async () => {
    const fx = await fixture();
    const path = `/management-api/venue-service/stations/${fx.stationId}/fallback`;
    const [another] = await db
      .insert(kitchenStations)
      .values({ locationId: fx.locationId, name: "Second bar" })
      .returning({ id: kitchenStations.id });
    expect(
      (await send(fx.app, "PUT", path, fx.managerCookie, { fallbackStationId: another!.id }))
        .status,
    ).toBe(204);
    const saved = (await (
      await send(fx.app, "GET", "/management-api/venue-service/routing", fx.managerCookie)
    ).json()) as { stationTimes: { stationId: string; fallbackStationId: string | null }[] };
    expect(
      saved.stationTimes.find((station) => station.stationId === fx.stationId)?.fallbackStationId,
    ).toBe(another!.id);
    const missing = await send(fx.app, "PUT", path, fx.managerCookie, {});
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "fallbackStationId" } },
    });
    const loop = await send(fx.app, "PUT", path, fx.managerCookie, {
      fallbackStationId: fx.stationId,
    });
    expect(loop.status).toBe(409);
    expect(await loop.json()).toMatchObject({ error: { code: "station.fallback_loop" } });
    const other = await fixture();
    expect(
      (await send(fx.app, "PUT", path, fx.managerCookie, { fallbackStationId: other.stationId }))
        .status,
    ).toBe(409);
    expect(
      (await send(fx.app, "PUT", path, fx.managerCookie, { fallbackStationId: null })).status,
    ).toBe(204);
    const cleared = (await (
      await send(fx.app, "GET", "/management-api/venue-service/routing", fx.managerCookie)
    ).json()) as { stationTimes: { stationId: string; fallbackStationId: string | null }[] };
    expect(
      cleared.stationTimes.find((station) => station.stationId === fx.stationId)?.fallbackStationId,
    ).toBeNull();
  });

  it("saves and clears today's by-hand state and validates its value", async () => {
    const fx = await fixture();
    const path = `/management-api/venue-service/stations/${fx.stationId}/today`;
    expect((await send(fx.app, "PUT", path, fx.managerCookie, { state: "closed" })).status).toBe(
      204,
    );
    const model = (await (
      await send(fx.app, "GET", "/management-api/venue-service/routing", fx.managerCookie)
    ).json()) as { stationTimes: { stationId: string; today: string | null }[] };
    expect(model.stationTimes.find((station) => station.stationId === fx.stationId)?.today).toBe(
      "closed",
    );
    for (const state of [undefined, "unknown"]) {
      const response = await send(
        fx.app,
        "PUT",
        path,
        fx.managerCookie,
        state === undefined ? {} : { state },
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "state" } },
      });
    }
    expect((await send(fx.app, "PUT", path, fx.managerCookie, { state: null })).status).toBe(204);
  });
  it("keeps stored rules and foreign station or zone references within their location", async () => {
    const fx = await fixture(),
      other = await fixture();
    const base = "/management-api/venue-service/routing";
    expect(
      (
        await send(other.app, "PUT", `${base}/claims/${fx.categoryId}`, other.managerCookie, {
          noPreparation: true,
        })
      ).status,
    ).toBe(204);
    expect(
      (await send(fx.app, "DELETE", `${base}/claims/${fx.categoryId}`, fx.managerCookie)).status,
    ).toBe(204);
    expect(await (await send(fx.app, "GET", base, fx.managerCookie)).json()).toMatchObject({
      claims: [],
      exceptions: [],
    });
    expect(await (await send(other.app, "GET", base, other.managerCookie)).json()).toMatchObject({
      claims: [{ categoryId: fx.categoryId }],
    });
    const created = await send(other.app, "POST", `${base}/exceptions`, other.managerCookie, {
      categoryId: other.categoryId,
      noPreparation: true,
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect(
      (
        await send(fx.app, "PUT", `${base}/exceptions/${id}`, fx.managerCookie, {
          zoneId: null,
          categoryId: fx.categoryId,
          productId: null,
          noPreparation: true,
        })
      ).status,
    ).toBe(404);
    expect(
      (await send(fx.app, "DELETE", `${base}/exceptions/${id}`, fx.managerCookie)).status,
    ).toBe(404);
    expect(
      (await send(fx.app, "PUT", `${base}/exception-order`, fx.managerCookie, { ids: [id] }))
        .status,
    ).toBe(400);
    for (const [body, status, code] of [
      [{ categoryId: fx.categoryId, stationId: other.stationId }, 409, "route.station_inactive"],
      [{ zoneId: other.zoneId, noPreparation: true }, 404, "service_zone.not_found"],
    ] as const) {
      const response = await send(fx.app, "POST", `${base}/exceptions`, fx.managerCookie, body);
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code } });
    }
    expect(await (await send(other.app, "GET", base, other.managerCookie)).json()).toMatchObject({
      exceptions: [{ id, target: { kind: "no_preparation" } }],
    });
  });

  it("reads, claims, creates, replaces, reorders and removes stored preparation rules", async () => {
    const fx = await fixture();
    const base = "/management-api/venue-service/routing";
    expect(
      (
        await send(fx.app, "PUT", `${base}/claims/${fx.categoryId}`, fx.managerCookie, {
          stationId: fx.stationId,
        })
      ).status,
    ).toBe(204);
    const first = await send(fx.app, "POST", `${base}/exceptions`, fx.managerCookie, {
      categoryId: fx.categoryId,
      noPreparation: true,
    });
    expect(first.status).toBe(201);
    const { id } = (await first.json()) as { id: string };
    const input = {
      zoneId: null,
      categoryId: fx.categoryId,
      productId: null,
      stationId: fx.stationId,
    };
    expect(
      (await send(fx.app, "PUT", `${base}/exceptions/${id}`, fx.managerCookie, input)).status,
    ).toBe(204);
    expect(
      (await send(fx.app, "PUT", `${base}/exception-order`, fx.managerCookie, { ids: [id] }))
        .status,
    ).toBe(204);
    const response = await send(fx.app, "GET", base, fx.managerCookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      claims: [
        {
          categoryId: fx.categoryId,
          target: { kind: "station", stationId: fx.stationId },
          stationOff: false,
        },
      ],
      exceptions: [
        {
          id,
          position: 0,
          zoneId: null,
          categoryId: fx.categoryId,
          productId: null,
          target: { kind: "station", stationId: fx.stationId },
          neverMatches: false,
          stationOff: false,
        },
      ],
      stations: [{ id: fx.stationId, name: "Terrace bar", active: true }],
    });
    expect(
      (
        await send(fx.app, "PUT", `${base}/claims/${fx.categoryId}`, fx.managerCookie, {
          noPreparation: true,
        })
      ).status,
    ).toBe(204);
    expect(
      (await send(fx.app, "DELETE", `${base}/claims/${fx.categoryId}`, fx.managerCookie)).status,
    ).toBe(204);
    expect(
      (await send(fx.app, "DELETE", `${base}/exceptions/${id}`, fx.managerCookie)).status,
    ).toBe(204);
    expect(await (await send(fx.app, "GET", base, fx.managerCookie)).json()).toMatchObject({
      claims: [],
      exceptions: [],
    });
  });

  it("rejects missing or conflicting targets, dual subjects and empty conditions by field", async () => {
    const fx = await fixture();
    const base = "/management-api/venue-service/routing";
    for (const [body, field] of [
      [{ categoryId: fx.categoryId }, "target"],
      [{ categoryId: fx.categoryId, stationId: fx.stationId, noPreparation: true }, "target"],
      [
        { categoryId: fx.categoryId, productId: crypto.randomUUID(), noPreparation: true },
        "subject",
      ],
      [{ noPreparation: true }, "condition"],
    ] as const) {
      const res = await send(fx.app, "POST", `${base}/exceptions`, fx.managerCookie, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: { code: "management.request_invalid", params: { field } },
      });
    }
    const missingClaimTarget = await send(
      fx.app,
      "PUT",
      `${base}/claims/${fx.categoryId}`,
      fx.managerCookie,
      {},
    );
    expect(missingClaimTarget.status).toBe(400);
    expect(await missingClaimTarget.json()).toEqual({
      error: { code: "management.request_invalid", params: { field: "target" } },
    });
    for (const ids of [undefined, "bad", ["bad-id"], [crypto.randomUUID()]]) {
      const response = await send(fx.app, "PUT", `${base}/exception-order`, fx.managerCookie, {
        ids,
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "management.request_invalid", params: { field: "ids" } },
      });
    }
    expect(
      (await send(fx.app, "PUT", `${base}/exception-order`, fx.managerCookie, { ids: [] })).status,
    ).toBe(204);
  });

  it("requires explicit replacement condition keys and preserves the rejected exception", async () => {
    const fx = await fixture();
    const base = "/management-api/venue-service/routing";
    const created = await send(fx.app, "POST", `${base}/exceptions`, fx.managerCookie, {
      categoryId: fx.categoryId,
      noPreparation: true,
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const complete: Record<string, unknown> = {
      zoneId: null,
      categoryId: fx.categoryId,
      productId: null,
      noPreparation: true,
    };
    for (const field of ["zoneId", "categoryId", "productId"]) {
      const body = { ...complete };
      delete body[field];
      const response = await send(
        fx.app,
        "PUT",
        `${base}/exceptions/${id}`,
        fx.managerCookie,
        body,
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "management.request_invalid", params: { field } },
      });
    }
    expect(await (await send(fx.app, "GET", base, fx.managerCookie)).json()).toMatchObject({
      exceptions: [
        {
          id,
          zoneId: null,
          categoryId: fx.categoryId,
          productId: null,
          target: { kind: "no_preparation" },
        },
      ],
    });
  });

  it("gates every stored-rule endpoint and applies domain status codes", async () => {
    const fx = await fixture();
    const base = "/management-api/venue-service/routing";
    for (const [method, path, body] of [
      ["GET", base, undefined],
      ["PUT", `${base}/claims/${fx.categoryId}`, { noPreparation: true }],
      ["DELETE", `${base}/claims/${fx.categoryId}`, undefined],
      ["PUT", `${base}/products/${crypto.randomUUID()}/assignment`, { noPreparation: true }],
      ["POST", `${base}/exceptions`, { categoryId: fx.categoryId, noPreparation: true }],
      [
        "PUT",
        `${base}/exceptions/${crypto.randomUUID()}`,
        { zoneId: null, categoryId: fx.categoryId, productId: null, noPreparation: true },
      ],
      ["DELETE", `${base}/exceptions/${crypto.randomUUID()}`, undefined],
      ["PUT", `${base}/exception-order`, { ids: [] }],
    ] as const) {
      expect((await send(fx.app, method, path, undefined, body)).status).toBe(401);
      expect((await send(fx.app, method, path, fx.staffCookie, body)).status).toBe(403);
    }
    const missing = await send(
      fx.app,
      "DELETE",
      `${base}/exceptions/${crypto.randomUUID()}`,
      fx.managerCookie,
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "route.not_found" } });
    expect(
      (
        await send(fx.app, "PUT", `${base}/claims/${fx.categoryId}`, fx.managerCookie, {
          stationId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await send(fx.app, "PUT", `${base}/claims/bad-id`, fx.managerCookie, {
          noPreparation: true,
        })
      ).status,
    ).toBe(400);
  });

  it("edits a department in place", async () => {
    const fx = await fixture();
    const created = await send(
      fx.app,
      "POST",
      "/management-api/venue-service/departments",
      fx.managerCookie,
      {
        name: "Restaurant",
        defaultServiceMode: "table_tab",
      },
    );
    const department = (await created.json()) as { id: string };
    const departmentInput = {
      name: "Deli",
      tradingName: "Deli counter",
      defaultServiceMode: "prepay",
    };
    expect(
      (
        await send(
          fx.app,
          "PATCH",
          `/management-api/venue-service/departments/${department.id}`,
          fx.managerCookie,
          departmentInput,
        )
      ).status,
    ).toBe(204);
    const listed = await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie);
    expect(await listed.json()).toMatchObject({
      departments: [{ id: department.id, ...departmentInput, active: true }],
    });
  });

  it("checks edit permissions and rejects malformed fields without changing rows", async () => {
    const fx = await fixture();
    const department = (await (
      await send(fx.app, "POST", "/management-api/venue-service/departments", fx.managerCookie, {
        name: "Restaurant",
        defaultServiceMode: "table_tab",
      })
    ).json()) as { id: string };
    const paths = [
      {
        method: "PATCH" as const,
        path: `/management-api/venue-service/departments/${department.id}`,
        body: { name: "Deli", tradingName: "Deli", defaultServiceMode: "prepay" },
      },
    ];
    for (const { method, path, body } of paths) {
      expect((await send(fx.app, method, path, undefined, body)).status).toBe(401);
      expect((await send(fx.app, method, path, fx.staffCookie, body)).status).toBe(403);
      expect((await send(fx.app, method, path, fx.managerCookie, {})).status).toBe(400);
      expect(
        (await send(fx.app, method, path.replace(/[^/]+$/, "bad-id"), fx.managerCookie, body))
          .status,
      ).toBe(400);
    }
    for (const body of [
      { name: "", tradingName: "Deli", defaultServiceMode: "prepay" },
      { name: "Deli", tradingName: "", defaultServiceMode: "prepay" },
      { name: "Deli", tradingName: "Deli", defaultServiceMode: "wrong" },
    ])
      expect((await send(fx.app, "PATCH", paths[0]!.path, fx.managerCookie, body)).status).toBe(
        400,
      );
    expect(
      await (await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)).json(),
    ).toMatchObject({
      departments: [{ id: department.id, name: "Restaurant" }],
    });
  });

  describe("a department's active field on the edit route", () => {
    async function twoDepartments(fx: Fixture) {
      const ids: string[] = [];
      for (const name of ["Restaurant", "Events"]) {
        const created = await send(
          fx.app,
          "POST",
          "/management-api/venue-service/departments",
          fx.managerCookie,
          { name, defaultServiceMode: "table_tab" },
        );
        ids.push(((await created.json()) as { id: string }).id);
      }
      return ids as [string, string];
    }
    async function listed(fx: Fixture) {
      return (
        (await (
          await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)
        ).json()) as {
          departments: { id: string; name: string; active: boolean }[];
          zones: { id: string; active?: boolean }[];
        }
      ).departments;
    }

    it("disables with active: false, as Disable does, and enables again with active: true", async () => {
      const fx = await fixture();
      const [restaurant, events] = await twoDepartments(fx);
      await withTransaction(db, (tx) =>
        configureZone(tx, fx, { zoneId: fx.zoneId, departmentId: restaurant }),
      );
      const path = `/management-api/venue-service/departments/${restaurant}`;
      expect((await send(fx.app, "PATCH", path, fx.managerCookie, { active: false })).status).toBe(
        204,
      );
      expect(await listed(fx)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: restaurant, name: "Restaurant", active: false }),
          expect.objectContaining({ id: events, active: true }),
        ]),
      );
      const [zone] = await db
        .select({ active: floorZones.active })
        .from(floorZones)
        .where(eq(floorZones.id, fx.zoneId));
      expect(zone!.active).toBe(false);

      expect((await send(fx.app, "PATCH", path, fx.managerCookie, { active: true })).status).toBe(
        204,
      );
      expect(await listed(fx)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: restaurant, name: "Restaurant", active: true }),
        ]),
      );
      const [after] = await db
        .select({ active: floorZones.active })
        .from(floorZones)
        .where(eq(floorZones.id, fx.zoneId));
      expect(after!.active).toBe(false);
    });

    it("takes an edit and active together", async () => {
      const fx = await fixture();
      const [restaurant] = await twoDepartments(fx);
      const path = `/management-api/venue-service/departments/${restaurant}`;
      expect((await send(fx.app, "DELETE", path, fx.managerCookie)).status).toBe(204);
      expect(
        (
          await send(fx.app, "PATCH", path, fx.managerCookie, {
            name: "Dining",
            tradingName: "Dining room",
            defaultServiceMode: "prepay",
            active: true,
          })
        ).status,
      ).toBe(204);
      expect(await listed(fx)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: restaurant, name: "Dining", active: true }),
        ]),
      );
    });

    it("refuses to disable the last active department with department.last_active", async () => {
      const fx = await fixture();
      const [restaurant, events] = await twoDepartments(fx);
      await send(
        fx.app,
        "DELETE",
        `/management-api/venue-service/departments/${events}`,
        fx.managerCookie,
      );
      const refused = await send(
        fx.app,
        "PATCH",
        `/management-api/venue-service/departments/${restaurant}`,
        fx.managerCookie,
        { active: false },
      );
      expect(refused.status).toBe(409);
      expect(await refused.json()).toMatchObject({
        error: { code: "department.last_active", params: { departmentId: restaurant } },
      });
      expect(await listed(fx)).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: restaurant, active: true })]),
      );
    });

    it("refuses an explicit null or a non-boolean active, and changes nothing", async () => {
      const fx = await fixture();
      const [restaurant] = await twoDepartments(fx);
      const path = `/management-api/venue-service/departments/${restaurant}`;
      for (const active of [null, "false", 0]) {
        const refused = await send(fx.app, "PATCH", path, fx.managerCookie, { active });
        expect(refused.status, String(active)).toBe(400);
        expect(await refused.json()).toMatchObject({
          error: { code: "management.request_invalid", params: { field: "active" } },
        });
      }
      expect(await listed(fx)).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: restaurant, active: true })]),
      );
    });

    it("answers department.not_found for another venue's department and leaves it disabled", async () => {
      const fx = await fixture();
      const other = await fixture();
      const [otherRestaurant] = await twoDepartments(other);
      await send(
        other.app,
        "PATCH",
        `/management-api/venue-service/departments/${otherRestaurant}`,
        other.managerCookie,
        { active: false },
      );
      const refused = await send(
        fx.app,
        "PATCH",
        `/management-api/venue-service/departments/${otherRestaurant}`,
        fx.managerCookie,
        { active: true },
      );
      expect(refused.status).toBe(404);
      expect(await refused.json()).toMatchObject({
        error: { code: "department.not_found", params: { departmentId: otherRestaurant } },
      });
      expect(await listed(other)).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: otherRestaurant, active: false })]),
      );
    });

    it("refuses active from a staff session", async () => {
      const fx = await fixture();
      const [restaurant] = await twoDepartments(fx);
      const path = `/management-api/venue-service/departments/${restaurant}`;
      const refused = await send(fx.app, "PATCH", path, fx.staffCookie, { active: false });
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({
        error: { code: "authorization.not_permitted" },
      });
    });
  });

  it("shows a configured inactive zone to management while excluding it from new-order choices", async () => {
    const fx = await fixture();
    const department = await withTransaction(db, (tx) =>
      createDepartment(
        tx,
        { locationId: fx.locationId },
        {
          name: "Restaurant",
          defaultServiceMode: "table_tab",
        },
      ),
    );
    await withTransaction(db, (tx) =>
      configureZone(
        tx,
        { locationId: fx.locationId },
        {
          zoneId: fx.zoneId,
          departmentId: department.id,
        },
      ),
    );
    await db.update(floorZones).set({ active: false }).where(eq(floorZones.id, fx.zoneId));

    const response = await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie);
    expect(response.status).toBe(200);
    expect(
      ((await response.json()) as { zones: { id: string; active: boolean }[] }).zones,
    ).toContainEqual(expect.objectContaining({ id: fx.zoneId, active: false }));
    expect(
      await withTransaction(db, (tx) => listServiceZones(tx, { locationId: fx.locationId })),
    ).not.toContainEqual(expect.objectContaining({ id: fx.zoneId }));
  });

  it("lists only the venue's departments and every one of its zones, switched off included, for a manager", async () => {
    const fx = await fixture();
    const other = await fixture();
    for (const venue of [fx, other]) {
      const scope = { locationId: venue.locationId };
      const department = await withTransaction(db, (tx) =>
        createDepartment(tx, scope, { name: "Restaurant", defaultServiceMode: "table_tab" }),
      );
      await withTransaction(db, (tx) =>
        configureZone(tx, scope, { zoneId: venue.zoneId, departmentId: department.id }),
      );
    }
    await db.update(floorZones).set({ active: false }).where(eq(floorZones.id, fx.zoneId));
    const path = "/management-api/venue-service/departments-and-zones";

    expect((await send(fx.app, "GET", path)).status).toBe(401);
    expect((await send(fx.app, "GET", path, fx.staffCookie)).status).toBe(403);
    const response = await send(fx.app, "GET", path, fx.managerCookie);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, { id: string; active?: boolean }[]>;
    const whole = (await (
      await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)
    ).json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["departments", "zones"]);
    expect(body.departments).toEqual(whole.departments);
    expect(body.zones).toEqual(whole.zones);
    expect(body.zones).toContainEqual(expect.objectContaining({ id: fx.zoneId, active: false }));
    expect(body.zones).not.toContainEqual(expect.objectContaining({ id: other.zoneId }));
  });

  it("scopes edited departments to their venue", async () => {
    // A manager cannot edit a department in another location sharing the same database.
    const fx = await fixture();
    const other = await fixture();
    const department = (await (
      await send(
        other.app,
        "POST",
        "/management-api/venue-service/departments",
        other.managerCookie,
        { name: "Other", defaultServiceMode: "prepay" },
      )
    ).json()) as { id: string };
    expect(
      (
        await send(
          fx.app,
          "PATCH",
          `/management-api/venue-service/departments/${department.id}`,
          fx.managerCookie,
          { name: "Wrong", tradingName: "Wrong", defaultServiceMode: "prepay" },
        )
      ).status,
    ).toBe(404);
    expect(
      await (
        await send(other.app, "GET", "/management-api/venue-service", other.managerCookie)
      ).json(),
    ).toMatchObject({
      departments: [{ id: department.id, name: "Other" }],
    });
  });

  it("configures a department and zone menu", async () => {
    const fx = await fixture();
    const created = await send(
      fx.app,
      "POST",
      "/management-api/venue-service/departments",
      fx.managerCookie,
      {
        name: "Restaurant",
        tradingName: "Dining room",
        defaultServiceMode: "table_tab",
      },
    );
    expect(created.status).toBe(201);
    const department = (await created.json()) as { id: string };

    expect(
      (
        await send(
          fx.app,
          "PUT",
          `/management-api/venue-service/zones/${fx.zoneId}`,
          fx.managerCookie,
          { departmentId: department.id, serviceMode: "prepay" },
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await send(
          fx.app,
          "PUT",
          `/management-api/venue-service/zones/${fx.zoneId}/menus/${fx.menuId}`,
          fx.managerCookie,
          { makeDefault: true },
        )
      ).status,
    ).toBe(204);

    const listed = await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({
      departments: [
        {
          id: department.id,
          name: "Restaurant",
          tradingName: "Dining room",
          defaultServiceMode: "table_tab",
        },
      ],
      zones: [
        {
          id: fx.zoneId,
          departmentId: department.id,
          serviceMode: "prepay",
        },
      ],
      zoneMenus: [{ zoneId: fx.zoneId, menuId: fx.menuId, displayOrder: 0, isDefault: true }],
      readiness: [{ code: "zone.menu_unpublished", zoneId: fx.zoneId }],
    });
    const blocked = await send(
      fx.app,
      "DELETE",
      `/management-api/venue-service/departments/${department.id}`,
      fx.managerCookie,
    );
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({
      error: { code: "department.last_active", params: { departmentId: department.id } },
    });

    const spare = await send(
      fx.app,
      "POST",
      "/management-api/venue-service/departments",
      fx.managerCookie,
      { name: "Events", defaultServiceMode: "prepay" },
    );
    const spareDepartment = (await spare.json()) as { id: string };
    expect(
      (
        await send(
          fx.app,
          "DELETE",
          `/management-api/venue-service/departments/${spareDepartment.id}`,
          fx.managerCookie,
        )
      ).status,
    ).toBe(204);
  });

  it("accepts inherited service mode", async () => {
    const fx = await fixture();
    const created = await send(
      fx.app,
      "POST",
      "/management-api/venue-service/departments",
      fx.managerCookie,
      { name: "Deli", defaultServiceMode: "prepay" },
    );
    const department = (await created.json()) as { id: string };
    expect(
      (
        await send(
          fx.app,
          "PUT",
          `/management-api/venue-service/zones/${fx.zoneId}`,
          fx.managerCookie,
          { departmentId: department.id, serviceMode: null },
        )
      ).status,
    ).toBe(204);
  });

  it("requires a manager and screens malformed resource ids", async () => {
    const fx = await fixture();
    expect((await send(fx.app, "GET", "/management-api/venue-service")).status).toBe(401);
    expect(
      (await send(fx.app, "GET", "/management-api/venue-service", fx.staffCookie)).status,
    ).toBe(403);
    expect(
      (
        await send(
          fx.app,
          "PUT",
          "/management-api/venue-service/zones/not-a-uuid",
          fx.managerCookie,
          { departmentId: crypto.randomUUID() },
        )
      ).status,
    ).toBe(400);
  });

  it("stores a zone menu's explicit display order and refuses one that is not a whole number from zero", async () => {
    const fx = await fixture();
    const department = (await (
      await send(fx.app, "POST", "/management-api/venue-service/departments", fx.managerCookie, {
        name: "Restaurant",
        defaultServiceMode: "table_tab",
      })
    ).json()) as { id: string };
    expect(
      (
        await send(
          fx.app,
          "PUT",
          `/management-api/venue-service/zones/${fx.zoneId}`,
          fx.managerCookie,
          { departmentId: department.id },
        )
      ).status,
    ).toBe(204);
    const path = `/management-api/venue-service/zones/${fx.zoneId}/menus/${fx.menuId}`;
    expect((await send(fx.app, "PUT", path, fx.managerCookie, { displayOrder: 3 })).status).toBe(
      204,
    );
    for (const displayOrder of ["4", 4.5, -1]) {
      const rejected = await send(fx.app, "PUT", path, fx.managerCookie, { displayOrder });
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toEqual({
        error: { code: "management.request_invalid", params: { field: "displayOrder" } },
      });
    }
    expect(
      (
        (await (
          await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)
        ).json()) as { zoneMenus: unknown[] }
      ).zoneMenus,
    ).toEqual([{ zoneId: fx.zoneId, menuId: fx.menuId, displayOrder: 3, isDefault: false }]);
  });
});

describe("the venue's service settings", () => {
  const SETTINGS = "/management-api/venue-service/settings";
  it("lets a supervisor read the settings without editing them or reading the wider operations model", async () => {
    const fx = await fixture();
    const read = await send(fx.app, "GET", SETTINGS, fx.supervisorCookie);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      settings: { editSentLines: true },
      kitchenTicketGrouping: "combined",
      clearingWorkflow: false,
    });
    expect(
      (await send(fx.app, "GET", "/management-api/venue-service", fx.supervisorCookie)).status,
    ).toBe(403);
    const write = await send(fx.app, "PUT", SETTINGS, fx.supervisorCookie, {
      editSentLines: false,
    });
    expect(write.status).toBe(403);
    expect(await write.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    expect((await send(fx.app, "GET", SETTINGS, fx.staffCookie)).status).toBe(403);
    expect((await send(fx.app, "GET", SETTINGS, fx.managerCookie)).status).toBe(200);
  });
  async function stored(fx: Fixture): Promise<unknown> {
    return (
      (await (
        await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)
      ).json()) as { settings: unknown }
    ).settings;
  }

  it("allows changes to items already sent to the kitchen until a manager turns it off", async () => {
    const fx = await fixture();
    expect(await stored(fx)).toEqual({ editSentLines: true });
    expect(
      (await send(fx.app, "PUT", SETTINGS, fx.managerCookie, { editSentLines: false })).status,
    ).toBe(204);
    expect(await stored(fx)).toEqual({ editSentLines: false });
    expect(
      (await send(fx.app, "PUT", SETTINGS, fx.managerCookie, { editSentLines: true })).status,
    ).toBe(204);
    expect(await stored(fx)).toEqual({ editSentLines: true });
  });

  it("refuses a value that is not true or false, naming the field, and keeps the stored one", async () => {
    const fx = await fixture();
    expect(
      (await send(fx.app, "PUT", SETTINGS, fx.managerCookie, { editSentLines: false })).status,
    ).toBe(204);
    for (const body of [
      {},
      { editSentLines: "true" },
      { editSentLines: null },
      { editSentLines: 1 },
    ]) {
      const rejected = await send(fx.app, "PUT", SETTINGS, fx.managerCookie, body);
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toEqual({
        error: { code: "management.request_invalid", params: { field: "editSentLines" } },
      });
    }
    expect(await stored(fx)).toEqual({ editSentLines: false });
  });

  it("lets only a signed-in manager change it", async () => {
    const fx = await fixture();
    const body = { editSentLines: false };
    expect((await send(fx.app, "PUT", SETTINGS, undefined, body)).status).toBe(401);
    const refused = await send(fx.app, "PUT", SETTINGS, fx.staffCookie, body);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    expect(await stored(fx)).toEqual({ editSentLines: true });
  });
});

describe("the kitchen ticket grouping setting", () => {
  const GROUPING = "/management-api/venue-service/settings/kitchen-ticket-grouping";
  async function stored(fx: Fixture): Promise<unknown> {
    return (
      (await (
        await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)
      ).json()) as { kitchenTicketGrouping: unknown }
    ).kitchenTicketGrouping;
  }

  it("reads combined until a manager chooses separate, and back", async () => {
    const fx = await fixture();
    expect(await stored(fx)).toBe("combined");
    expect(
      (await send(fx.app, "PUT", GROUPING, fx.managerCookie, { kitchenTicketGrouping: "separate" }))
        .status,
    ).toBe(204);
    expect(await stored(fx)).toBe("separate");
    expect(
      (await send(fx.app, "PUT", GROUPING, fx.managerCookie, { kitchenTicketGrouping: "combined" }))
        .status,
    ).toBe(204);
    expect(await stored(fx)).toBe("combined");
  });

  it("refuses anything but the two choices, naming the field, and keeps the stored one", async () => {
    const fx = await fixture();
    expect(
      (await send(fx.app, "PUT", GROUPING, fx.managerCookie, { kitchenTicketGrouping: "separate" }))
        .status,
    ).toBe(204);
    for (const body of [
      {},
      { kitchenTicketGrouping: "bogus" },
      { kitchenTicketGrouping: "Combined" },
      { kitchenTicketGrouping: null },
      { kitchenTicketGrouping: ["combined"] },
    ]) {
      const rejected = await send(fx.app, "PUT", GROUPING, fx.managerCookie, body);
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toEqual({
        error: { code: "management.request_invalid", params: { field: "kitchenTicketGrouping" } },
      });
    }
    expect(await stored(fx)).toBe("separate");
  });

  it("lets only a signed-in manager change it", async () => {
    const fx = await fixture();
    const body = { kitchenTicketGrouping: "separate" };
    expect((await send(fx.app, "PUT", GROUPING, undefined, body)).status).toBe(401);
    const refused = await send(fx.app, "PUT", GROUPING, fx.staffCookie, body);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    expect(await stored(fx)).toBe("combined");
  });

  it("leaves the edit-sent-lines setting's shape alone", async () => {
    const fx = await fixture();
    expect(
      (await send(fx.app, "PUT", GROUPING, fx.managerCookie, { kitchenTicketGrouping: "separate" }))
        .status,
    ).toBe(204);
    const body = (await (
      await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)
    ).json()) as { settings: unknown };
    expect(body.settings).toEqual({ editSentLines: true });
  });
});

describe("the print-held-work setting", () => {
  const PRINT_HELD_WORK = "/management-api/venue-service/settings/print-held-work";
  async function stored(fx: Fixture): Promise<unknown> {
    return (
      (await (
        await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)
      ).json()) as { printHeldWork: unknown }
    ).printHeldWork;
  }

  it("reads off until a manager turns it on, and back", async () => {
    const fx = await fixture();
    expect(await stored(fx)).toBe(false);
    expect(
      (await send(fx.app, "PUT", PRINT_HELD_WORK, fx.managerCookie, { printHeldWork: true }))
        .status,
    ).toBe(204);
    expect(await stored(fx)).toBe(true);
    expect(
      (await send(fx.app, "PUT", PRINT_HELD_WORK, fx.managerCookie, { printHeldWork: false }))
        .status,
    ).toBe(204);
    expect(await stored(fx)).toBe(false);
  });

  it("refuses anything but true or false, naming the field, and keeps the stored value", async () => {
    const fx = await fixture();
    expect(
      (await send(fx.app, "PUT", PRINT_HELD_WORK, fx.managerCookie, { printHeldWork: true }))
        .status,
    ).toBe(204);
    for (const body of [
      {},
      { printHeldWork: "false" },
      { printHeldWork: 0 },
      { printHeldWork: null },
      { printHeldWork: [false] },
    ]) {
      const rejected = await send(fx.app, "PUT", PRINT_HELD_WORK, fx.managerCookie, body);
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toEqual({
        error: { code: "management.request_invalid", params: { field: "printHeldWork" } },
      });
    }
    expect(await stored(fx)).toBe(true);
  });

  it("lets only a signed-in manager change it", async () => {
    const fx = await fixture();
    const body = { printHeldWork: true };
    expect((await send(fx.app, "PUT", PRINT_HELD_WORK, undefined, body)).status).toBe(401);
    const refused = await send(fx.app, "PUT", PRINT_HELD_WORK, fx.staffCookie, body);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    expect(await stored(fx)).toBe(false);
  });

  it("leaves the other settings as they were", async () => {
    const fx = await fixture();
    expect(
      (await send(fx.app, "PUT", PRINT_HELD_WORK, fx.managerCookie, { printHeldWork: true }))
        .status,
    ).toBe(204);
    const body = (await (
      await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)
    ).json()) as { settings: unknown; kitchenTicketGrouping: unknown };
    expect(body.settings).toEqual({ editSentLines: true });
    expect(body.kitchenTicketGrouping).toBe("combined");
  });
});

describe("the clearing setting", () => {
  const CLEARING = "/management-api/venue-service/settings/clearing-workflow";
  async function stored(fx: Fixture): Promise<unknown> {
    return (
      (await (
        await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)
      ).json()) as { clearingWorkflow: unknown }
    ).clearingWorkflow;
  }

  it("reads off until a manager turns it on, and back", async () => {
    const fx = await fixture();
    expect(await stored(fx)).toBe(false);
    expect(
      (await send(fx.app, "PUT", CLEARING, fx.managerCookie, { clearingWorkflow: true })).status,
    ).toBe(204);
    expect(await stored(fx)).toBe(true);
    expect(
      (await send(fx.app, "PUT", CLEARING, fx.managerCookie, { clearingWorkflow: false })).status,
    ).toBe(204);
    expect(await stored(fx)).toBe(false);
  });

  it("refuses anything but true or false, naming the field, and keeps the stored value", async () => {
    const fx = await fixture();
    expect(
      (await send(fx.app, "PUT", CLEARING, fx.managerCookie, { clearingWorkflow: true })).status,
    ).toBe(204);
    for (const body of [
      {},
      { clearingWorkflow: "false" },
      { clearingWorkflow: 0 },
      { clearingWorkflow: null },
      { clearingWorkflow: [false] },
    ]) {
      const rejected = await send(fx.app, "PUT", CLEARING, fx.managerCookie, body);
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toEqual({
        error: { code: "management.request_invalid", params: { field: "clearingWorkflow" } },
      });
    }
    expect(await stored(fx)).toBe(true);
  });

  it("lets only a signed-in manager change it", async () => {
    const fx = await fixture();
    const body = { clearingWorkflow: true };
    expect((await send(fx.app, "PUT", CLEARING, undefined, body)).status).toBe(401);
    const refused = await send(fx.app, "PUT", CLEARING, fx.staffCookie, body);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    expect(await stored(fx)).toBe(false);
  });

  it("leaves the other settings as they were", async () => {
    const fx = await fixture();
    expect(
      (await send(fx.app, "PUT", CLEARING, fx.managerCookie, { clearingWorkflow: true })).status,
    ).toBe(204);
    const body = (await (
      await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)
    ).json()) as {
      settings: unknown;
      kitchenTicketGrouping: unknown;
      printHeldWork: unknown;
      releaseReminderMinutes: unknown;
    };
    expect(body.settings).toEqual({ editSentLines: true });
    expect(body.kitchenTicketGrouping).toBe("combined");
    expect(body.printHeldWork).toBe(false);
    expect(body.releaseReminderMinutes).toBe(10);
  });
});

describe("the release-reminder setting", () => {
  const RELEASE_REMINDER = "/management-api/venue-service/settings/release-reminder-minutes";
  async function stored(fx: Fixture): Promise<unknown> {
    return (
      (await (
        await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)
      ).json()) as { releaseReminderMinutes: unknown }
    ).releaseReminderMinutes;
  }

  it("reads 10 minutes until a manager changes it, and can be switched off and back on", async () => {
    const fx = await fixture();
    expect(await stored(fx)).toBe(10);
    for (const minutes of [15, 1, 120, null, 10]) {
      expect(
        (
          await send(fx.app, "PUT", RELEASE_REMINDER, fx.managerCookie, {
            releaseReminderMinutes: minutes,
          })
        ).status,
      ).toBe(204);
      expect(await stored(fx)).toBe(minutes);
    }
  });

  it("refuses anything but whole minutes from 1 to 120 or null, naming the field, and keeps the stored value", async () => {
    const fx = await fixture();
    expect(
      (
        await send(fx.app, "PUT", RELEASE_REMINDER, fx.managerCookie, {
          releaseReminderMinutes: 20,
        })
      ).status,
    ).toBe(204);
    for (const body of [
      {},
      { releaseReminderMinutes: 0 },
      { releaseReminderMinutes: -5 },
      { releaseReminderMinutes: 121 },
      { releaseReminderMinutes: 2.5 },
      { releaseReminderMinutes: "10" },
      { releaseReminderMinutes: true },
      { releaseReminderMinutes: [10] },
    ]) {
      const rejected = await send(fx.app, "PUT", RELEASE_REMINDER, fx.managerCookie, body);
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toEqual({
        error: { code: "management.request_invalid", params: { field: "releaseReminderMinutes" } },
      });
    }
    expect(await stored(fx)).toBe(20);
  });

  it("lets only a signed-in manager change it", async () => {
    const fx = await fixture();
    const body = { releaseReminderMinutes: null };
    expect((await send(fx.app, "PUT", RELEASE_REMINDER, undefined, body)).status).toBe(401);
    const refused = await send(fx.app, "PUT", RELEASE_REMINDER, fx.staffCookie, body);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    expect(await stored(fx)).toBe(10);
  });

  it("leaves the other settings as they were", async () => {
    const fx = await fixture();
    expect(
      (
        await send(fx.app, "PUT", RELEASE_REMINDER, fx.managerCookie, {
          releaseReminderMinutes: null,
        })
      ).status,
    ).toBe(204);
    const body = (await (
      await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)
    ).json()) as { settings: unknown; kitchenTicketGrouping: unknown; printHeldWork: unknown };
    expect(body.settings).toEqual({ editSentLines: true });
    expect(body.kitchenTicketGrouping).toBe("combined");
    expect(body.printHeldWork).toBe(false);
  });
});

describe("Prep stations product assignment route", () => {
  it("requires a manager and writes one prioritized product-wide exception", async () => {
    const fx = await fixture();
    const product = await withTransaction(db, (tx) =>
      createProduct(tx, {
        catalogueId: fx.menuId,
        name: "Bread",
        categoryId: null,
        pricingUnit: "each",
        unitPrice: "3.00",
        vatClass: "general",
      }),
    );
    const path = `/management-api/venue-service/routing/products/${product.id}/assignment`;
    expect((await send(fx.app, "PUT", path, undefined, { stationId: fx.stationId })).status).toBe(
      401,
    );
    expect(
      (await send(fx.app, "PUT", path, fx.staffCookie, { stationId: fx.stationId })).status,
    ).toBe(403);
    expect(
      (await send(fx.app, "PUT", path, fx.managerCookie, { stationId: fx.stationId })).status,
    ).toBe(204);
    expect(
      (await send(fx.app, "PUT", path, fx.managerCookie, { noPreparation: true })).status,
    ).toBe(204);
    const model = (await (
      await send(fx.app, "GET", "/management-api/venue-service/routing", fx.managerCookie)
    ).json()) as { exceptions: { productId: string; target: unknown }[] };
    expect(
      model.exceptions
        .filter((e) => e.productId === product.id)
        .map(({ productId, target }) => ({ productId, target })),
    ).toEqual([{ productId: product.id, target: { kind: "no_preparation" } }]);
  });
});

describe("routing preview route", () => {
  it("previews assignment and exception changes without saving them", async () => {
    const fx = await fixture();
    const product = await withTransaction(db, (tx) =>
      createProduct(tx, {
        catalogueId: fx.menuId,
        name: "Bread",
        categoryId: null,
        pricingUnit: "each",
        unitPrice: "3.00",
        vatClass: "general",
      }),
    );
    const path = "/management-api/venue-service/routing/preview";
    const assignment = await send(fx.app, "POST", path, fx.managerCookie, {
      kind: "assignment",
      productId: product.id,
      target: { kind: "no_preparation" },
    });
    expect(assignment.status).toBe(200);
    expect(await assignment.json()).toEqual([
      expect.objectContaining({ productId: product.id, to: { kind: "no_preparation" } }),
    ]);
    const exception = await send(fx.app, "POST", path, fx.managerCookie, {
      kind: "exception",
      id: null,
      input: {
        productId: product.id,
        target: { kind: "station", stationId: fx.stationId },
      },
    });
    expect(exception.status).toBe(200);
    expect(await exception.json()).toEqual([]);
    expect(
      await (
        await send(fx.app, "GET", "/management-api/venue-service/routing", fx.managerCookie)
      ).json(),
    ).toMatchObject({ claims: [], exceptions: [] });
  });

  it("validates preview shapes and preserves saved exceptions", async () => {
    const fx = await fixture();
    const path = "/management-api/venue-service/routing/preview";
    const created = await send(
      fx.app,
      "POST",
      "/management-api/venue-service/routing/exceptions",
      fx.managerCookie,
      {
        categoryId: fx.categoryId,
        noPreparation: true,
      },
    );
    const { id } = (await created.json()) as { id: string };
    for (const [body, field] of [
      [{ kind: "claim", categoryId: fx.categoryId, target: [] }, "target"],
      [{ kind: "claim", categoryId: fx.categoryId, target: { kind: "unknown" } }, "target"],
      [{ kind: "exception", id, input: null }, "input"],
      [
        {
          kind: "exception",
          id,
          input: { categoryId: fx.categoryId, target: { kind: "no_preparation" } },
        },
        "zoneId",
      ],
      [{ kind: "exception_order", ids: null }, "ids"],
      [{ kind: "unknown" }, "kind"],
    ] as const) {
      const response = await send(fx.app, "POST", path, fx.managerCookie, body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field } },
      });
    }
    for (const body of [
      { kind: "exception_delete", id },
      { kind: "exception_order", ids: [id] },
      {
        kind: "exception",
        id,
        input: {
          zoneId: null,
          categoryId: fx.categoryId,
          productId: null,
          target: { kind: "no_preparation" },
        },
      },
    ]) {
      const response = await send(fx.app, "POST", path, fx.managerCookie, body);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([]);
    }
    expect(
      await (
        await send(fx.app, "GET", "/management-api/venue-service/routing", fx.managerCookie)
      ).json(),
    ).toMatchObject({ exceptions: [{ id }] });
  });

  it("requires a manager, returns moves, and leaves the claim unchanged", async () => {
    const fx = await fixture();
    const product = await withTransaction(db, (tx) =>
      createProduct(tx, {
        catalogueId: fx.menuId,
        name: "Lager",
        categoryId: fx.categoryId,
        pricingUnit: "each",
        unitPrice: "3.00",
        vatClass: "general",
      }),
    );
    const path = "/management-api/venue-service/routing/preview";
    const body = {
      kind: "claim",
      categoryId: fx.categoryId,
      target: { kind: "no_preparation" },
    };
    expect((await send(fx.app, "POST", path, undefined, body)).status).toBe(401);
    expect((await send(fx.app, "POST", path, fx.staffCookie, body)).status).toBe(403);
    const result = await send(fx.app, "POST", path, fx.managerCookie, body);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual([
      expect.objectContaining({
        productId: product.id,
        productName: "Lager",
        zoneId: fx.zoneId,
        from: { kind: "station", stationId: fx.stationId },
        to: { kind: "no_preparation" },
      }),
    ]);
    expect(
      await (
        await send(fx.app, "GET", "/management-api/venue-service/routing", fx.managerCookie)
      ).json(),
    ).toMatchObject({ claims: [] });
  });
  it("accepts omitted nullable conditions for a new exception as the save route does", async () => {
    const fx = await fixture();
    const response = await send(
      fx.app,
      "POST",
      "/management-api/venue-service/routing/preview",
      fx.managerCookie,
      {
        kind: "exception",
        id: null,
        input: { categoryId: fx.categoryId, target: { kind: "no_preparation" } },
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });
});

describe("routing explanation route", () => {
  it("requires a manager and explains a product in its service zone", async () => {
    const fx = await fixture();
    await withTransaction(db, async (tx) => {
      const department = await createDepartment(
        tx,
        { locationId: fx.locationId },
        { name: "Dining", defaultServiceMode: "table_tab" },
      );
      await configureZone(
        tx,
        { locationId: fx.locationId },
        { zoneId: fx.zoneId, departmentId: department.id },
      );
    });
    const product = await withTransaction(db, (tx) =>
      createProduct(tx, {
        catalogueId: fx.menuId,
        name: "Lager",
        categoryId: fx.categoryId,
        pricingUnit: "each",
        unitPrice: "3.00",
        vatClass: "general",
      }),
    );
    const path = `/management-api/venue-service/routing/explain?productId=${product.id}&zoneId=${fx.zoneId}`;
    expect((await send(fx.app, "GET", path)).status).toBe(401);
    expect((await send(fx.app, "GET", path, fx.staffCookie)).status).toBe(403);
    const response = await send(fx.app, "GET", path, fx.managerCookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      route: { kind: "station", stationId: fx.stationId },
      decidedBy: { kind: "default" },
      fallbacks: [],
      noReplacement: false,
      stations: [{ id: fx.stationId, name: "Terrace bar", active: true }],
    });
    const second = await withTransaction(db, (tx) =>
      createProduct(tx, {
        catalogueId: fx.menuId,
        name: "Olives",
        customerName: { en: "Marinated olives" },
        kitchenName: "OLV",
        categoryId: fx.categoryId,
        pricingUnit: "each",
        unitPrice: "2.00",
        vatClass: "general",
      }),
    );
    const withExtras = await send(
      fx.app,
      "GET",
      `${path}&extraId=${product.id}&extraId=${second.id}`,
      fx.managerCookie,
    );
    expect(withExtras.status).toBe(200);
    expect(await withExtras.json()).toMatchObject({
      extras: [{ productId: product.id }, { productId: second.id }],
      extrasWaitOnDish: false,
    });
    const unknown = await send(
      fx.app,
      "GET",
      `${path}&extraId=00000000-0000-4000-8000-000000000000`,
      fx.managerCookie,
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({
      error: { code: "route.subject_not_found", params: { subject: "product" } },
    });
    expect(
      (
        await send(
          fx.app,
          "GET",
          "/management-api/venue-service/routing/explain?productId=bad",
          fx.managerCookie,
        )
      ).status,
    ).toBe(400);
  });
});

it.each([
  "weekday=5",
  "time=22:00",
  "weekday=7&time=22:00",
  "weekday=5&time=24:00",
  "weekday=&time=22:00",
  "weekday=1.5&time=22:00",
  "weekday=5&time=2:00",
  "date=2026-10-09",
  "date=2026-02-30&time=20:00",
  "date=09-10-2026&time=20:00",
  "date=2026-10-09&weekday=5&time=20:00",
])("refuses invalid explanation time: %s", async (query) => {
  const fx = await fixture();
  const response = await send(
    fx.app,
    "GET",
    `/management-api/venue-service/routing/explain?productId=${fx.categoryId}&${query}`,
    fx.managerCookie,
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    error: { code: "management.request_invalid", params: { field: "when" } },
  });
});

it("applies scheduled hours through the explain route and honors manual open only for now", async () => {
  const fx = await fixture();
  const product = await withTransaction(db, async (tx) => {
    await tx.update(locations).set({ timeZone: "UTC" }).where(eq(locations.id, fx.locationId));
    const cfg = { locationId: fx.locationId };
    const [station] = await tx
      .insert(kitchenStations)
      .values({ ...cfg, name: "Upstairs" })
      .returning();
    await setClaim(tx, cfg, fx.categoryId, { kind: "station", stationId: station!.id });
    await seedStationWeek(tx, cfg, station!.id, [
      { weekday: 5, opensAt: "18:00", closesAt: "21:00" },
    ]);
    await setStationToday(tx, cfg, station!.id, "open", new Date());
    return {
      id: (
        await createProduct(tx, {
          catalogueId: fx.menuId,
          name: "Lager",
          categoryId: fx.categoryId,
          pricingUnit: "each",
          unitPrice: "3.00",
          vatClass: "general",
        })
      ).id,
      stationId: station!.id,
    };
  });
  const path = `/management-api/venue-service/routing/explain?productId=${product.id}`;
  const now = await send(fx.app, "GET", path, fx.managerCookie);
  expect(now.status).toBe(200);
  expect(await now.json()).toMatchObject({
    route: { kind: "station", stationId: product.stationId },
    fallbacks: [],
    clockReadable: true,
  });
  const scheduled = await send(fx.app, "GET", `${path}&weekday=5&time=22:00`, fx.managerCookie);
  expect(scheduled.status).toBe(200);
  expect(await scheduled.json()).toMatchObject({
    route: null,
    noReplacement: true,
    clockReadable: true,
    fallbacks: [{ stationId: product.stationId, why: "out_of_hours" }],
  });
});

it("previews a date and local time with that date's special hours through the explain route", async () => {
  const fx = await fixture();
  const product = await withTransaction(db, async (tx) => {
    await tx
      .update(locations)
      .set({ timeZone: "Europe/Madrid" })
      .where(eq(locations.id, fx.locationId));
    const cfg = { locationId: fx.locationId };
    const [station] = await tx
      .insert(kitchenStations)
      .values({ ...cfg, name: "Upstairs" })
      .returning();
    await setClaim(tx, cfg, fx.categoryId, { kind: "station", stationId: station!.id });
    await saveSpecialDate(
      tx,
      cfg,
      null,
      {
        date: "2026-10-09",
        name: "Staff party",
        colour: "purple",
        closeWholeVenue: true,
        cells: [],
      },
      new Date("2026-09-01T10:00:00Z"),
    );
    return {
      id: (
        await createProduct(tx, {
          catalogueId: fx.menuId,
          name: "Shandy",
          categoryId: fx.categoryId,
          pricingUnit: "each",
          unitPrice: "3.00",
          vatClass: "general",
        })
      ).id,
      stationId: station!.id,
    };
  });
  const path = `/management-api/venue-service/routing/explain?productId=${product.id}`;
  const special = await send(fx.app, "GET", `${path}&date=2026-10-09&time=20:00`, fx.managerCookie);
  expect(special.status).toBe(200);
  expect(await special.json()).toMatchObject({
    fallbacks: [{ stationId: product.stationId, why: "out_of_hours" }],
  });
  const weekday = await send(fx.app, "GET", `${path}&weekday=5&time=20:00`, fx.managerCookie);
  expect(await weekday.json()).toMatchObject({
    route: { kind: "station", stationId: product.stationId },
    fallbacks: [],
  });
  const forward = clockChangeAfter("Europe/Madrid", "2027-01-01T00:00:00Z", "forward");
  const skipped = await send(
    fx.app,
    "GET",
    `${path}&date=${forward.date}&time=${minutesAfter(forward.before, 1)}`,
    fx.managerCookie,
  );
  expect(skipped.status).toBe(400);
  expect(await skipped.json()).toMatchObject({
    error: { code: "management.request_invalid", params: { field: "time" } },
  });
});

describe("read-only station overview", () => {
  it("serves today's station status to a supervisor without exposing routing configuration", async () => {
    const f = await fixture();
    const response = await send(
      f.app,
      "GET",
      "/management-api/venue-service/stations/overview",
      f.supervisorCookie,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual([
      "clockReadable",
      "defaultStationId",
      "stationTimes",
      "stations",
      "todayEnds",
    ]);
    expect(body.stations).toEqual([{ id: f.stationId, name: "Terrace bar", active: true }]);
    expect(body.stationTimes).toEqual([
      expect.objectContaining({ stationId: f.stationId, status: { open: true, why: "default" } }),
    ]);
    expect(
      (await send(f.app, "GET", "/management-api/venue-service/routing", f.supervisorCookie))
        .status,
    ).toBe(403);
    expect(
      (
        await send(
          f.app,
          "PUT",
          `/management-api/venue-service/stations/${f.stationId}/today`,
          f.supervisorCookie,
          { state: "closed" },
        )
      ).status,
    ).toBe(403);
  });
  it("refuses staff and unauthenticated overview reads while serving managers", async () => {
    const f = await fixture();
    for (const [cookie, status] of [
      [f.staffCookie, 403],
      [undefined, 401],
      [f.managerCookie, 200],
    ] as const) {
      expect(
        (await send(f.app, "GET", "/management-api/venue-service/stations/overview", cookie))
          .status,
      ).toBe(status);
    }
  });
});
