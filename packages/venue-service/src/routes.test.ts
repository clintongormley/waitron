import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CATALOGUE_MIGRATIONS,
  addProductToMenu,
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
import {
  departmentSalePolicies,
  departments,
  zoneSalePolicies,
  zoneServicePolicies,
} from "./schema/service.js";
import { configureZone, createDepartment, listServiceZones } from "./operations.js";
import { replaceMenuWeek, saveMenuPeriod } from "./menu-timetable.js";
import { setRoutingCell } from "./routing-store.js";
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

const departmentSettings = {
  name: "New dining",
  tradingName: "Dining receipt",
  printTradingName: true,
  orderStart: "counter",
  paidWhen: "ticket_then_pay",
  collectionNumber: "numbered",
  receiptPrintMode: "on_request",
} as const;
const zoneSettings = {
  orderStart: "counter",
  paidWhen: "ticket_then_pay",
  collectionNumber: "numbered",
  receiptPrintMode: "on_request",
} as const;

async function settingsFixture() {
  const fx = await fixture();
  const department = await withTransaction(db, async (tx) => {
    const department = await createDepartment(tx, fx, {
      name: "Dining",
      orderStart: "table",
    });
    await configureZone(tx, fx, {
      zoneId: fx.zoneId,
      departmentId: department.id,
      orderStart: "table",
    });
    return department;
  });
  return {
    ...fx,
    departmentId: department.id,
    departmentPath: `/management-api/venue-service/departments/${department.id}/settings`,
    zonePath: `/management-api/venue-service/zones/${fx.zoneId}/service-settings`,
  };
}

async function settingsSnapshot(fx: Awaited<ReturnType<typeof settingsFixture>>) {
  const model = await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie);
  expect(model.status).toBe(200);
  const transfers = await send(
    fx.app,
    "GET",
    `/management-api/venue-service/departments/${fx.departmentId}/transfers`,
    fx.managerCookie,
  );
  expect(transfers.status).toBe(200);
  return { model: await model.json(), transfers: await transfers.json() };
}

describe("whole service settings saves", () => {
  it("saves every department field and optional transfers in one PUT", async () => {
    const fx = await settingsFixture();
    const destination = await withTransaction(db, (tx) =>
      createDepartment(tx, fx, {
        name: "Bar",
        orderStart: "counter",
      }),
    );
    const saved = await send(fx.app, "PUT", fx.departmentPath, fx.managerCookie, {
      ...departmentSettings,
      transfers: { receivingProfileId: null, destinationDepartmentIds: [destination.id] },
    });
    expect(saved.status).toBe(204);
    const { model, transfers } = await settingsSnapshot(fx);
    expect(model.departments.find((row: { id: string }) => row.id === fx.departmentId)).toEqual({
      id: fx.departmentId,
      name: "New dining",
      tradingName: "Dining receipt",
      active: true,
      isDefault: false,
    });
    expect(
      model.salePolicies.departments.find(
        (row: { departmentId: string }) => row.departmentId === fx.departmentId,
      ),
    ).toEqual({
      departmentId: fx.departmentId,
      orderStart: "counter",
      paidWhen: "ticket_then_pay",
      collectionNumber: "numbered",
      receiptPrintMode: "on_request",
      printTradingName: true,
    });
    expect(transfers).toEqual({
      departmentId: fx.departmentId,
      receivingProfileId: null,
      destinationDepartmentIds: [destination.id],
    });
    expect(
      (
        await send(fx.app, "PUT", fx.departmentPath, fx.managerCookie, {
          ...departmentSettings,
          orderStart: "table",
          receiptPrintMode: "auto",
          printTradingName: false,
        })
      ).status,
    ).toBe(204);
    const read = await settingsSnapshot(fx);
    expect(read.transfers).toEqual(transfers);
    expect(
      (
        await db
          .select()
          .from(departmentSalePolicies)
          .where(eq(departmentSalePolicies.departmentId, fx.departmentId))
      )[0]!.orderStart,
    ).toBe("table");
    expect(
      read.model.salePolicies.departments.find(
        (row: { departmentId: string }) => row.departmentId === fx.departmentId,
      ).receiptPrintMode,
    ).toBe("auto");
    expect(
      (await send(fx.app, "PUT", fx.departmentPath, fx.managerCookie, departmentSettings)).status,
    ).toBe(204);

    expect(
      (
        await db
          .select()
          .from(departmentSalePolicies)
          .where(eq(departmentSalePolicies.departmentId, fx.departmentId))
      )[0]!.orderStart,
    ).toBe("counter");
  });

  it.each([true, false])(
    "refuses a name clash with active=%s without writing any settings",
    async (active) => {
      const fx = await settingsFixture();
      const other = await withTransaction(db, (tx) =>
        createDepartment(tx, fx, { name: "Taken", orderStart: "counter" }),
      );
      await db.update(departments).set({ active }).where(eq(departments.id, other.id));
      const before = await settingsSnapshot(fx);
      const response = await send(fx.app, "PUT", fx.departmentPath, fx.managerCookie, {
        ...departmentSettings,
        name: "Taken",
        transfers: { receivingProfileId: null, destinationDepartmentIds: [other.id] },
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: { code: active ? "department.name_taken" : "department.name_disabled" },
      });
      expect(await settingsSnapshot(fx)).toEqual(before);
    },
  );

  it("rolls back the department and sale policy when a transfer names itself", async () => {
    const fx = await settingsFixture();
    const other = await withTransaction(db, (tx) =>
      createDepartment(tx, fx, { name: "Bar", orderStart: "counter" }),
    );
    expect(
      (
        await send(
          fx.app,
          "PUT",
          `/management-api/venue-service/departments/${fx.departmentId}/transfers`,
          fx.managerCookie,
          {
            receivingProfileId: null,
            destinationDepartmentIds: [other.id],
          },
        )
      ).status,
    ).toBe(204);
    const before = await settingsSnapshot(fx);
    const response = await send(fx.app, "PUT", fx.departmentPath, fx.managerCookie, {
      ...departmentSettings,
      transfers: { receivingProfileId: null, destinationDepartmentIds: [fx.departmentId] },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: "department_transfer.settings_invalid",
        params: { field: "destinationDepartmentIds" },
      },
    });
    expect(await settingsSnapshot(fx)).toEqual(before);
  });

  it.each([
    { patch: { name: "  " }, field: "name" },
    { patch: { unexpected: true }, field: "unexpected" },
    { patch: { receiptPrintMode: "never" }, field: "receiptPrintMode" },
    { patch: { receiptPrintMode: null }, field: "receiptPrintMode" },
    { patch: { orderStart: null }, field: "orderStart" },
    { patch: { paidWhen: ["prepay"] }, field: "paidWhen" },
    { patch: { collectionNumber: ["none"] }, field: "collectionNumber" },
    { patch: { printTradingName: null }, field: "printTradingName" },
    { patch: { transfers: null }, field: "transfers" },
    {
      patch: { transfers: { receivingProfileId: null, destinationDepartmentIds: [], extra: true } },
      field: "extra",
    },
    {
      patch: { transfers: { receivingProfileId: null, destinationDepartmentIds: "invalid" } },
      field: "destinationDepartmentIds",
    },
    {
      patch: { transfers: { receivingProfileId: 1, destinationDepartmentIds: [] } },
      field: "receivingProfileId",
    },
    {
      patch: { transfers: { receivingProfileId: null, destinationDepartmentIds: [1] } },
      field: "destinationDepartmentIds",
    },
  ])(
    "refuses malformed department settings at $field without writes ($patch)",
    async ({ patch, field }) => {
      const fx = await settingsFixture();
      const before = await settingsSnapshot(fx);
      const response = await send(fx.app, "PUT", fx.departmentPath, fx.managerCookie, {
        ...departmentSettings,
        ...patch,
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field } },
      });
      expect(await settingsSnapshot(fx)).toEqual(before);
    },
  );

  it.each(["foreign", "disabled"])("refuses a %s department without writes", async (kind) => {
    const fx = await settingsFixture();
    let path = fx.departmentPath;
    if (kind === "foreign") {
      const foreign = await fixture();
      const department = await withTransaction(db, (tx) =>
        createDepartment(tx, foreign, { name: "Foreign", orderStart: "counter" }),
      );
      path = `/management-api/venue-service/departments/${department.id}/settings`;
    } else
      await db
        .update(departments)
        .set({ active: false })
        .where(eq(departments.id, fx.departmentId));
    const before = await settingsSnapshot(fx);
    const response = await send(fx.app, "PUT", path, fx.managerCookie, departmentSettings);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "department.not_found" } });
    expect(await settingsSnapshot(fx)).toEqual(before);
  });

  it("saves all four zone overrides and clears all four to inherit", async () => {
    const fx = await settingsFixture();
    expect(
      (
        await send(fx.app, "PUT", fx.departmentPath, fx.managerCookie, {
          ...departmentSettings,
          orderStart: "table",
        })
      ).status,
    ).toBe(204);
    for (const [input, , effective] of [
      [zoneSettings, "prepay", zoneSettings],
      [
        {
          orderStart: "table",
          paidWhen: "prepay",
          collectionNumber: "none",
          receiptPrintMode: "auto",
        },
        "table_tab",
        {
          orderStart: "table",
          paidWhen: "prepay",
          collectionNumber: "none",
          receiptPrintMode: "auto",
        },
      ],
      [
        { orderStart: null, paidWhen: null, collectionNumber: null, receiptPrintMode: null },
        null,
        {
          orderStart: "table",
          paidWhen: "ticket_then_pay",
          collectionNumber: "numbered",
          receiptPrintMode: "on_request",
        },
      ],
    ] as const) {
      expect((await send(fx.app, "PUT", fx.zonePath, fx.managerCookie, input)).status).toBe(204);
      const { model } = await settingsSnapshot(fx);
      expect(model.salePolicies.zones).toEqual([
        { zoneId: fx.zoneId, ...input, effective: { ...effective, printTradingName: true } },
      ]);
      const [stored] = await db
        .select()
        .from(zoneSalePolicies)
        .where(eq(zoneSalePolicies.zoneId, fx.zoneId));
      expect(stored!.orderStart).toBe(input.orderStart);
    }
    expect((await send(fx.app, "PUT", fx.zonePath, fx.managerCookie, zoneSettings)).status).toBe(
      204,
    );
    const [retained] = await db
      .select()
      .from(zoneSalePolicies)
      .where(eq(zoneSalePolicies.zoneId, fx.zoneId));
    expect(retained!.orderStart).toBe("counter");
  });

  it.each([
    { receiptPrintMode: "never" },
    { unexpected: true },
    { paidWhen: ["prepay"] },
    { orderStart: "table_tab" },
    { collectionNumber: true },
  ])("refuses invalid zone settings without writes (%j)", async (patch) => {
    const fx = await settingsFixture();
    const before = await settingsSnapshot(fx);
    const response = await send(fx.app, "PUT", fx.zonePath, fx.managerCookie, {
      ...zoneSettings,
      ...patch,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: Object.keys(patch)[0] } },
    });
    expect(await settingsSnapshot(fx)).toEqual(before);
  });

  it("refuses a disabled zone with service_zone.not_found", async () => {
    const fx = await settingsFixture();
    await db.update(floorZones).set({ active: false }).where(eq(floorZones.id, fx.zoneId));
    const before = await settingsSnapshot(fx);
    const response = await send(fx.app, "PUT", fx.zonePath, fx.managerCookie, zoneSettings);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "service_zone.not_found" } });
    expect(await settingsSnapshot(fx)).toEqual(before);
  });

  it.each(["departmentPath", "zonePath"] as const)("requires a manager for %s", async (path) => {
    const fx = await settingsFixture();
    const body = path === "departmentPath" ? departmentSettings : zoneSettings;
    expect((await send(fx.app, "PUT", fx[path], undefined, body)).status).toBe(401);
    expect((await send(fx.app, "PUT", fx[path], fx.staffCookie, body)).status).toBe(403);
  });
});

describe("venue service management routes", () => {
  it("saves directional transfer settings only for a manager", async () => {
    const fx = await fixture();
    const { source, destination } = await withTransaction(db, async (tx) => ({
      source: await createDepartment(tx, fx, { name: "Deli", orderStart: "table" }),
      destination: await createDepartment(tx, fx, {
        name: "Restaurant",
        orderStart: "table",
      }),
    }));
    const path = `/management-api/venue-service/departments/${source.id}/transfers`;
    expect((await send(fx.app, "GET", path)).status).toBe(401);
    expect(
      (
        await send(fx.app, "PUT", path, fx.staffCookie, {
          receivingProfileId: null,
          destinationDepartmentIds: [destination.id],
        })
      ).status,
    ).toBe(403);
    expect((await send(fx.app, "GET", `${path}/profiles`, fx.staffCookie)).status).toBe(403);
    const choices = await send(fx.app, "GET", `${path}/profiles`, fx.managerCookie);
    expect(choices.status).toBe(200);
    expect(await choices.json()).toEqual([]);
    const saved = await send(fx.app, "PUT", path, fx.managerCookie, {
      receivingProfileId: null,
      destinationDepartmentIds: [destination.id],
    });
    expect(saved.status).toBe(204);
    const read = await send(fx.app, "GET", path, fx.managerCookie);
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({
      departmentId: source.id,
      receivingProfileId: null,
      destinationDepartmentIds: [destination.id],
    });
    const reverse = await send(
      fx.app,
      "GET",
      `/management-api/venue-service/departments/${destination.id}/transfers`,
      fx.managerCookie,
    );
    expect(await reverse.json()).toEqual({
      departmentId: destination.id,
      receivingProfileId: null,
      destinationDepartmentIds: [],
    });
  });

  it.each([
    [{ destinationDepartmentIds: [] }, "receivingProfileId"],
    [{ receivingProfileId: null }, "destinationDepartmentIds"],
    [{ receivingProfileId: [], destinationDepartmentIds: [] }, "receivingProfileId"],
    [{ receivingProfileId: null, destinationDepartmentIds: null }, "destinationDepartmentIds"],
    [
      { receivingProfileId: null, destinationDepartmentIds: ["invalid"] },
      "destinationDepartmentIds",
    ],
    [{ receivingProfileId: null, destinationDepartmentIds: [], surprise: true }, "surprise"],
  ])("refuses malformed transfer settings %j", async (body, field) => {
    const fx = await fixture();
    const source = await withTransaction(db, (tx) =>
      createDepartment(tx, fx, { name: "Deli", orderStart: "table" }),
    );
    const path = `/management-api/venue-service/departments/${source.id}/transfers`;
    const response = await send(fx.app, "PUT", path, fx.managerCookie, body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field } },
    });
  });

  it("department and zone answers omit retired style fields", async () => {
    const fx = await fixture();
    const created = await send(
      fx.app,
      "POST",
      "/management-api/venue-service/departments",
      fx.managerCookie,
      { name: "Answer" },
    );
    expect(created.status).toBe(201);
    const department = await created.json();
    expect(department).not.toHaveProperty("defaultServiceMode");
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

    const model = await (
      await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)
    ).json();
    expect(
      model.departments.find((row: { id: string }) => row.id === department.id),
    ).not.toHaveProperty("defaultServiceMode");
    expect(model.zones.find((row: { id: string }) => row.id === fx.zoneId)).not.toHaveProperty(
      "serviceModeOverride",
    );
  });

  it.each(["prepay", "table_tab", "ticket_then_pay", null])(
    "refuses retired department request fields without writes (%s)",
    async (defaultServiceMode) => {
      const fx = await fixture();
      const department = await withTransaction(db, (tx) =>
        createDepartment(tx, fx, { name: "Dining", orderStart: "table" }),
      );
      const before = await (
        await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)
      ).json();
      for (const method of ["POST", "PATCH"] as const) {
        const path =
          method === "POST"
            ? "/management-api/venue-service/departments"
            : `/management-api/venue-service/departments/${department.id}`;
        const response = await send(fx.app, method, path, fx.managerCookie, {
          name: "Changed",
          tradingName: "Changed receipt",
          defaultServiceMode,
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
          error: { code: "management.request_invalid", params: { field: "defaultServiceMode" } },
        });
        expect(
          await (
            await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)
          ).json(),
        ).toEqual(before);
      }
    },
  );

  it("patches only the trading name without changing the department name or service settings", async () => {
    const fx = await fixture();
    const department = await withTransaction(db, (tx) =>
      createDepartment(tx, fx, {
        name: "Dining",
        tradingName: "Original receipt",
        orderStart: "table",
      }),
    );
    const before = await db.all(
      sql`select * from department_sale_policies where department_id = ${department.id}`,
    );
    const response = await send(
      fx.app,
      "PATCH",
      `/management-api/venue-service/departments/${department.id}`,
      fx.managerCookie,
      { tradingName: "New receipt" },
    );
    expect(response.status).toBe(204);
    expect(
      await db.select().from(departments).where(eq(departments.id, department.id)),
    ).toMatchObject([{ name: "Dining", tradingName: "New receipt", active: true }]);
    expect(
      await db.all(
        sql`select * from department_sale_policies where department_id = ${department.id}`,
      ),
    ).toEqual(before);
  });

  it.each(["table", "counter", null] as const)(
    "moving a zone retains its service overrides (%s)",
    async (orderStart) => {
      const fx = await fixture();
      const [source, target] = await withTransaction(db, async (tx) => {
        const source = await createDepartment(tx, fx, { name: "Source", orderStart: "counter" });
        const target = await createDepartment(tx, fx, { name: "Target", orderStart: "table" });
        await configureZone(tx, fx, { zoneId: fx.zoneId, departmentId: source.id, orderStart });
        await tx.run(
          sql`update zone_sale_policies set paid_when = 'ticket_then_pay', collection_number = 'numbered', receipt_print_mode = 'on_request' where zone_id = ${fx.zoneId}`,
        );
        return [source, target];
      });
      const before = await db.all(
        sql`select * from zone_sale_policies where zone_id = ${fx.zoneId}`,
      );
      const response = await send(
        fx.app,
        "PUT",
        `/management-api/venue-service/zones/${fx.zoneId}`,
        fx.managerCookie,
        { departmentId: target!.id },
      );
      expect(response.status).toBe(204);
      expect(
        await db.all(sql`select * from zone_sale_policies where zone_id = ${fx.zoneId}`),
      ).toEqual(before);
      expect(
        await db
          .select({ departmentId: zoneServicePolicies.departmentId })
          .from(zoneServicePolicies)
          .where(eq(zoneServicePolicies.zoneId, fx.zoneId)),
      ).toEqual([{ departmentId: target!.id }]);
      expect(source!.id).not.toBe(target!.id);
    },
  );

  it.each(["prepay", "table_tab", "ticket_then_pay", null])(
    "refuses the retired zone request field without writes (%s)",
    async (serviceMode) => {
      const fx = await fixture();
      const department = await withTransaction(db, (tx) =>
        createDepartment(tx, fx, { name: "Dining", orderStart: "table" }),
      );
      await withTransaction(db, (tx) =>
        configureZone(tx, fx, {
          zoneId: fx.zoneId,
          departmentId: department.id,
          orderStart: "counter",
        }),
      );
      const before = await (
        await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)
      ).json();
      const response = await send(
        fx.app,
        "PUT",
        `/management-api/venue-service/zones/${fx.zoneId}`,
        fx.managerCookie,
        { departmentId: department.id, serviceMode },
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "serviceMode" } },
      });
      expect(
        await (await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)).json(),
      ).toEqual(before);
    },
  );

  it("refuses the retired invoice-first style without changing departments or zones", async () => {
    const fx = await fixture();
    const department = await withTransaction(db, (tx) =>
      createDepartment(tx, fx, { name: "Dining", orderStart: "table" }),
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

  it.each([undefined, -2_147_483_648, 2_147_483_647])(
    "creates a floor zone with display order %s and assigns its department in one request",
    async (displayOrder) => {
      const fx = await fixture();
      const department = (await (
        await send(fx.app, "POST", "/management-api/venue-service/departments", fx.managerCookie, {
          name: "Terrace service",
        })
      ).json()) as { id: string };

      const response = await send(
        fx.app,
        "POST",
        "/management-api/venue-service/zones",
        fx.managerCookie,
        { name: "Garden", departmentId: department.id, displayOrder },
      );
      expect(response.status).toBe(201);
      const { id } = (await response.json()) as { id: string };
      expect(await db.select().from(floorZones).where(eq(floorZones.id, id))).toMatchObject([
        {
          locationId: fx.locationId,
          name: "Garden",
          active: true,
          displayOrder: displayOrder ?? 0,
        },
      ]);
      expect(
        await db.select().from(zoneServicePolicies).where(eq(zoneServicePolicies.zoneId, id)),
      ).toMatchObject([{ departmentId: department.id }]);
      expect(db.all(sql`select order_start from zone_sale_policies where zone_id = ${id}`)).toEqual(
        [{ order_start: null }],
      );
    },
  );

  it.each([-2_147_483_649, 2_147_483_648, 1e300, null, 0.5, "1"])(
    "refuses an invalid zone display order %s without writing a zone",
    async (displayOrder) => {
      const fx = await fixture();
      const department = await withTransaction(db, (tx) =>
        createDepartment(tx, fx, { name: "Order department", orderStart: "counter" }),
      );
      const response = await send(
        fx.app,
        "POST",
        "/management-api/venue-service/zones",
        fx.managerCookie,
        { name: "Invalid order", departmentId: department.id, displayOrder },
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "displayOrder" } },
      });
      expect(
        await db.select().from(floorZones).where(eq(floorZones.locationId, fx.locationId)),
      ).toMatchObject([{ name: "Terrace" }]);
    },
  );

  it("refuses an array zone-creation body", async () => {
    const fx = await fixture();
    const response = await send(
      fx.app,
      "POST",
      "/management-api/venue-service/zones",
      fx.managerCookie,
      [],
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "body" } },
    });
  });

  it.each([true, false])(
    "keeps the zone active flag %s when assigning a disabled department",
    async (active) => {
      const fx = await fixture();
      const department = await withTransaction(db, (tx) =>
        createDepartment(tx, fx, { name: "Disabled department", orderStart: "counter" }),
      );
      await withTransaction(db, async (tx) => {
        await tx
          .update(departments)
          .set({ active: false })
          .where(eq(departments.id, department.id));
        await tx.update(floorZones).set({ active }).where(eq(floorZones.id, fx.zoneId));
      });
      const response = await send(
        fx.app,
        "PUT",
        `/management-api/venue-service/zones/${fx.zoneId}`,
        fx.managerCookie,
        { departmentId: department.id },
      );
      expect(response.status).toBe(active ? 409 : 204);
      if (active)
        expect(await response.json()).toMatchObject({
          error: { code: "zone.department_inactive", params: { zoneId: fx.zoneId } },
        });
      const policies = await db
        .select({ departmentId: zoneServicePolicies.departmentId })
        .from(zoneServicePolicies)
        .where(eq(zoneServicePolicies.zoneId, fx.zoneId));
      expect(policies).toEqual(active ? [] : [{ departmentId: department.id }]);
      expect(
        await db
          .select({ active: floorZones.active })
          .from(floorZones)
          .where(eq(floorZones.id, fx.zoneId)),
      ).toEqual([{ active }]);
    },
  );

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
        { name: "Restaurant", orderStart: "counter" },
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

  it("writes order start through both policy routes and refuses unknown values", async () => {
    const fx = await fixture();
    const department = await withTransaction(db, async (tx) => {
      const row = await createDepartment(
        tx,
        { locationId: fx.locationId },
        { name: "Start route", orderStart: "counter" },
      );
      await configureZone(
        tx,
        { locationId: fx.locationId },
        { zoneId: fx.zoneId, departmentId: row.id },
      );
      return row;
    });
    for (const [path, value] of [
      [
        `/management-api/venue-service/departments/${department.id}/sale-policy/orderStart`,
        "table",
      ],
      [`/management-api/venue-service/zones/${fx.zoneId}/sale-policy/orderStart`, "counter"],
    ] as const) {
      expect((await send(fx.app, "PATCH", path, fx.managerCookie, { value })).status).toBe(204);
      const bad = await send(fx.app, "PATCH", path, fx.managerCookie, { value: "tab" });
      expect(bad.status).toBe(400);
      expect(await bad.json()).toEqual({
        error: { code: "management.request_invalid", params: { field: "orderStart" } },
      });
    }
    expect(
      db.all(
        sql`select p.order_start from departments d join department_sale_policies p on p.department_id=d.id where d.id=${department.id}`,
      ),
    ).toEqual([{ order_start: "table" }]);
    expect(
      db.all(
        sql`select p.order_start from zone_service_policies s join zone_sale_policies p on p.zone_id=s.zone_id where s.zone_id=${fx.zoneId}`,
      ),
    ).toEqual([{ order_start: "counter" }]);
    const zonePath = `/management-api/venue-service/zones/${fx.zoneId}/sale-policy/orderStart`;
    expect((await send(fx.app, "PATCH", zonePath, fx.managerCookie, { value: null })).status).toBe(
      204,
    );
    expect(
      db.all(
        sql`select p.order_start from zone_service_policies s join zone_sale_policies p on p.zone_id=s.zone_id where s.zone_id=${fx.zoneId}`,
      ),
    ).toEqual([{ order_start: null }]);
  });

  it.each(["department", "zone"] as const)(
    "refuses Never and malformed %s receipt modes without changing rows",
    async (kind) => {
      const fx = await fixture();
      const department = await withTransaction(db, async (tx) => {
        const row = await createDepartment(
          tx,
          { locationId: fx.locationId },
          {
            name: "Receipt boundary",
            orderStart: "counter",
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
      const path =
        kind === "department"
          ? `/management-api/venue-service/departments/${department.id}/sale-policy/receiptPrintMode`
          : `/management-api/venue-service/zones/${fx.zoneId}/sale-policy/receiptPrintMode`;
      const rows = () =>
        db.all(
          kind === "department"
            ? sql`select * from department_sale_policies where department_id = ${department.id}`
            : sql`select * from zone_sale_policies where zone_id = ${fx.zoneId}`,
        );
      for (const value of ["auto", "on_request", ...(kind === "zone" ? [null] : [])]) {
        expect((await send(fx.app, "PATCH", path, fx.managerCookie, { value })).status).toBe(204);
        expect(rows()[0]).toMatchObject({ receipt_print_mode: value });
      }
      const before = rows();
      for (const value of [
        "never",
        "unknown",
        ["auto"],
        1,
        ...(kind === "department" ? [null] : []),
      ]) {
        const response = await send(fx.app, "PATCH", path, fx.managerCookie, { value });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: { code: "management.request_invalid", params: { field: "receiptPrintMode" } },
        });
        expect(rows()).toEqual(before);
      }
    },
  );

  it("refuses an unknown zone policy field without clearing the receipt override", async () => {
    const fx = await fixture();
    const department = await withTransaction(db, async (tx) => {
      const row = await createDepartment(
        tx,
        { locationId: fx.locationId },
        {
          name: "Restaurant",
          orderStart: "counter",
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
          value: "on_request",
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
    expect(saved.rows).toEqual([{ receipt_print_mode: "on_request" }]);
  });

  it("serves no interval-list hours writes and no department hours in the venue read", async () => {
    const fx = await fixture();
    const department = (await (
      await send(fx.app, "POST", "/management-api/venue-service/departments", fx.managerCookie, {
        name: "Restaurant",
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

  it("the retired station fallback route answers 404 without changing routing", async () => {
    const fx = await fixture();
    const path = `/management-api/venue-service/stations/${fx.stationId}/fallback`;
    const [another] = await db
      .insert(kitchenStations)
      .values({ locationId: fx.locationId, name: "Second bar" })
      .returning({ id: kitchenStations.id });
    const readRouting = async () => {
      const response = await send(
        fx.app,
        "GET",
        "/management-api/venue-service/routing",
        fx.managerCookie,
      );
      expect(response.status).toBe(200);
      return response.json();
    };
    const before = await readRouting();
    for (const body of [
      { fallbackStationId: another!.id },
      { fallbackStationId: null },
      { fallbackStationId: fx.stationId },
      { fallbackStationId: randomUUID() },
      { fallbackStationId: "invalid" },
      {},
    ]) {
      expect((await send(fx.app, "PUT", path, fx.managerCookie, body)).status).toBe(404);
      expect(await readRouting()).toEqual(before);
    }
    for (const id of [randomUUID(), "invalid"]) {
      expect(
        (
          await send(
            fx.app,
            "PUT",
            `/management-api/venue-service/stations/${id}/fallback`,
            fx.managerCookie,
            { fallbackStationId: another!.id },
          )
        ).status,
      ).toBe(404);
      expect(await readRouting()).toEqual(before);
    }
  });

  it("the retired dashboard station today route answers 404 without changing its state", async () => {
    const fx = await fixture();
    const path = `/management-api/venue-service/stations/${fx.stationId}/today`;
    const read = async () =>
      (await send(fx.app, "GET", "/management-api/venue-service/routing", fx.managerCookie)).json();
    const before = await read();
    for (const state of ["closed", "open", null, "unknown", undefined]) {
      expect(
        (await send(fx.app, "PUT", path, fx.managerCookie, state === undefined ? {} : { state }))
          .status,
      ).toBe(404);
    }
    expect(await read()).toEqual(before);
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
      },
    );
    const department = (await created.json()) as { id: string };
    const departmentInput = {
      name: "Deli",
      tradingName: "Deli counter",
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
      })
    ).json()) as { id: string };
    const paths = [
      {
        method: "PATCH" as const,
        path: `/management-api/venue-service/departments/${department.id}`,
        body: { name: "Deli", tradingName: "Deli" },
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
          { name },
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
          orderStart: "table",
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
        createDepartment(tx, scope, { name: "Restaurant", orderStart: "table" }),
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
        { name: "Other" },
      )
    ).json()) as { id: string };
    expect(
      (
        await send(
          fx.app,
          "PATCH",
          `/management-api/venue-service/departments/${department.id}`,
          fx.managerCookie,
          { name: "Wrong", tradingName: "Wrong" },
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

  it("configures a department and its menus", async () => {
    const fx = await fixture();
    const created = await send(
      fx.app,
      "POST",
      "/management-api/venue-service/departments",
      fx.managerCookie,
      {
        name: "Restaurant",
        tradingName: "Dining room",
      },
    );
    expect(created.status).toBe(201);
    const department = (await created.json()) as { id: string };
    expect(
      (
        await send(
          fx.app,
          "PATCH",
          `/management-api/venue-service/departments/${department.id}/sale-policy/orderStart`,
          fx.managerCookie,
          { value: "table" },
        )
      ).status,
    ).toBe(204);
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
    expect(
      (
        await send(
          fx.app,
          "PATCH",
          `/management-api/venue-service/zones/${fx.zoneId}/sale-policy/orderStart`,
          fx.managerCookie,
          { value: "counter" },
        )
      ).status,
    ).toBe(204);

    expect(
      (
        await send(
          fx.app,
          "POST",
          `/management-api/venue-service/departments/${department.id}/menu-periods`,
          fx.managerCookie,
          { name: "Open", menuId: fx.menuId, staffMenuIds: [] },
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await send(
          fx.app,
          "PUT",
          `/management-api/venue-service/departments/${department.id}/all-day-menu`,
          fx.managerCookie,
          { menuId: fx.menuId },
        )
      ).status,
    ).toBe(404);
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
    ).toBe(404);

    const listed = await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie);
    expect(listed.status).toBe(200);
    const body = await listed.json();
    expect(body).not.toHaveProperty("zoneMenus");
    expect(body).toMatchObject({
      departments: [
        {
          id: department.id,
          name: "Restaurant",
          tradingName: "Dining room",
        },
      ],
      zones: [
        {
          id: fx.zoneId,
          departmentId: department.id,
          serviceMode: "prepay",
        },
      ],
      readiness: [
        {
          code: "department.no_periods",
          departmentId: department.id,
          departmentName: "Restaurant",
        },
        { code: "zone.menu_unpublished", zoneId: fx.zoneId, zoneName: "Terrace" },
      ],
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
      { name: "Events" },
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
      { name: "Deli" },
    );
    const department = (await created.json()) as { id: string };
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

describe("routing cell route", () => {
  const base = "/management-api/venue-service/routing";
  const noPrep = { kind: "no_preparation" } as const;
  const categoryCell = (categoryId: string, zoneId: string | null = null) => ({
    row: { kind: "category", categoryId },
    zoneId,
  });

  async function cellsOf(fx: Fixture): Promise<unknown[]> {
    const response = await send(fx.app, "GET", base, fx.managerCookie);
    expect(response.status).toBe(200);
    return ((await response.json()) as { cells: unknown[] }).cells;
  }

  async function servedZone(fx: Fixture): Promise<void> {
    await withTransaction(db, async (tx) => {
      const department = await createDepartment(
        tx,
        { locationId: fx.locationId },
        { name: "Dining", orderStart: "table" },
      );
      await configureZone(
        tx,
        { locationId: fx.locationId },
        { zoneId: fx.zoneId, departmentId: department.id },
      );
    });
  }

  async function lager(fx: Fixture): Promise<string> {
    return (
      await withTransaction(db, (tx) =>
        createProduct(tx, {
          catalogueId: fx.menuId,
          name: "Lager",
          categoryId: fx.categoryId,
          pricingUnit: "each",
          unitPrice: "3.00",
          vatClass: "general",
        }),
      )
    ).id;
  }

  it("sets a category Every zone cell to No preparation and the model GET shows it", async () => {
    const fx = await fixture();
    const response = await send(fx.app, "PUT", `${base}/cell`, fx.managerCookie, {
      address: { row: { kind: "category", categoryId: fx.categoryId }, zoneId: null },
      target: { kind: "no_preparation" },
    });
    expect(response.status).toBe(204);
    expect(await cellsOf(fx)).toEqual([
      { row: { kind: "category", categoryId: fx.categoryId }, zoneId: null, target: noPrep },
    ]);
  });

  it("clears on explicit target:null; refuses a missing target with field target", async () => {
    const fx = await fixture();
    const address = categoryCell(fx.categoryId);
    expect(
      (await send(fx.app, "PUT", `${base}/cell`, fx.managerCookie, { address, target: noPrep }))
        .status,
    ).toBe(204);
    const missing = await send(fx.app, "PUT", `${base}/cell`, fx.managerCookie, { address });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({
      error: { code: "management.request_invalid", params: { field: "target" } },
    });
    expect(await cellsOf(fx)).toEqual([{ ...address, target: noPrep }]);
    expect(
      (await send(fx.app, "PUT", `${base}/cell`, fx.managerCookie, { address, target: null }))
        .status,
    ).toBe(204);
    expect(await cellsOf(fx)).toEqual([]);
  });

  it("refuses All × Every zone for set and clear", async () => {
    const fx = await fixture();
    await servedZone(fx);
    const allEvery = { row: { kind: "all" }, zoneId: null };
    for (const [path, body] of [
      [`${base}/cell`, { address: allEvery, target: noPrep }],
      [`${base}/cell`, { address: allEvery, target: null }],
      [`${base}/preview`, { kind: "cell", address: allEvery, target: noPrep }],
      [`${base}/preview`, { kind: "cell", address: allEvery, target: null }],
    ] as const) {
      const response = await send(
        fx.app,
        path.endsWith("cell") ? "PUT" : "POST",
        path,
        fx.managerCookie,
        body,
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "management.request_invalid", params: { field: "address" } },
      });
    }
    expect(await cellsOf(fx)).toEqual([]);
    const allTerrace = { row: { kind: "all" }, zoneId: fx.zoneId };
    expect(
      (
        await send(fx.app, "PUT", `${base}/cell`, fx.managerCookie, {
          address: allTerrace,
          target: noPrep,
        })
      ).status,
    ).toBe(204);
    expect(await cellsOf(fx)).toEqual([{ ...allTerrace, target: noPrep }]);
  });

  it("refuses a malformed address, an unknown subject (route.subject_not_found) and a foreign or inactive zone/station (route.station_inactive, the zone code)", async () => {
    const fx = await fixture(),
      other = await fixture();
    await servedZone(fx);
    await servedZone(other);
    const category = { kind: "category", categoryId: fx.categoryId };
    for (const address of [
      undefined,
      null,
      [],
      "category",
      { row: category },
      { zoneId: null },
      { row: category, zoneId: null, extra: true },
      { row: null, zoneId: null },
      { row: { kind: "zone", zoneId: fx.zoneId }, zoneId: null },
      { row: { kind: "category" }, zoneId: null },
      { row: { kind: "category", categoryId: "bad-id" }, zoneId: null },
      { row: { kind: "category", categoryId: fx.categoryId, productId: null }, zoneId: null },
      { row: { kind: "product", categoryId: fx.categoryId }, zoneId: null },
      { row: { kind: "all", categoryId: fx.categoryId }, zoneId: fx.zoneId },
      { row: category, zoneId: "terrace" },
      { row: category, zoneId: [] },
    ]) {
      const response = await send(fx.app, "PUT", `${base}/cell`, fx.managerCookie, {
        address,
        target: noPrep,
      });
      expect(response.status, JSON.stringify(address)).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "management.request_invalid", params: { field: "address" } },
      });
    }
    const extra = await send(fx.app, "PUT", `${base}/cell`, fx.managerCookie, {
      address: categoryCell(fx.categoryId),
      target: noPrep,
      position: 0,
    });
    expect(extra.status).toBe(400);
    expect(await extra.json()).toEqual({
      error: { code: "management.request_invalid", params: { field: "position" } },
    });
    const [offStation] = await db
      .insert(kitchenStations)
      .values({ locationId: fx.locationId, name: "Off", active: false })
      .returning({ id: kitchenStations.id });
    for (const [address, target, status, error] of [
      [
        { row: { kind: "category", categoryId: crypto.randomUUID() }, zoneId: null },
        noPrep,
        404,
        { code: "route.subject_not_found", params: { subject: "category" } },
      ],
      [
        { row: { kind: "product", productId: crypto.randomUUID() }, zoneId: null },
        noPrep,
        404,
        { code: "route.subject_not_found", params: { subject: "product" } },
      ],
      [categoryCell(fx.categoryId, other.zoneId), noPrep, 404, { code: "service_zone.not_found" }],
      [
        categoryCell(fx.categoryId),
        { kind: "station", stationId: other.stationId },
        409,
        { code: "route.station_inactive" },
      ],
      [
        categoryCell(fx.categoryId),
        { kind: "station", stationId: offStation!.id },
        409,
        { code: "route.station_inactive" },
      ],
    ] as const) {
      const response = await send(fx.app, "PUT", `${base}/cell`, fx.managerCookie, {
        address,
        target,
      });
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error });
    }
    await db.update(floorZones).set({ active: false }).where(eq(floorZones.id, fx.zoneId));
    const inactiveZone = await send(fx.app, "PUT", `${base}/cell`, fx.managerCookie, {
      address: categoryCell(fx.categoryId, fx.zoneId),
      target: noPrep,
    });
    expect(inactiveZone.status).toBe(404);
    expect(await inactiveZone.json()).toMatchObject({ error: { code: "service_zone.not_found" } });
    expect(await cellsOf(fx)).toEqual([]);
  });

  it("refuses a preview with a key it does not read, or a malformed address", async () => {
    const fx = await fixture();
    await servedZone(fx);
    const extra = await send(fx.app, "POST", `${base}/preview`, fx.managerCookie, {
      kind: "cell",
      address: categoryCell(fx.categoryId),
      target: noPrep,
      position: 0,
    });
    expect(extra.status).toBe(400);
    expect(await extra.json()).toEqual({
      error: { code: "management.request_invalid", params: { field: "position" } },
    });
    for (const address of [
      { row: { kind: "category", categoryId: "bad-id" }, zoneId: null },
      { row: { kind: "all" }, zoneId: null },
      { row: { kind: "category", categoryId: fx.categoryId }, zoneId: "terrace" },
    ]) {
      const response = await send(fx.app, "POST", `${base}/preview`, fx.managerCookie, {
        kind: "cell",
        address,
        target: noPrep,
      });
      expect(response.status, JSON.stringify(address)).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "management.request_invalid", params: { field: "address" } },
      });
    }
  });

  it("keeps each location's cells to itself", async () => {
    const fx = await fixture(),
      other = await fixture();
    expect(
      (
        await send(other.app, "PUT", `${base}/cell`, other.managerCookie, {
          address: categoryCell(fx.categoryId),
          target: noPrep,
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await send(fx.app, "PUT", `${base}/cell`, fx.managerCookie, {
          address: categoryCell(fx.categoryId),
          target: null,
        })
      ).status,
    ).toBe(204);
    expect(await cellsOf(fx)).toEqual([]);
    expect(await cellsOf(other)).toEqual([{ ...categoryCell(fx.categoryId), target: noPrep }]);
  });

  it("refuses a malformed target: an array, a string, a station without its id, an unknown kind", async () => {
    const fx = await fixture();
    for (const target of [
      [],
      "no_preparation",
      { kind: "station" },
      { kind: "station", stationId: "bar" },
      { kind: "station", stationId: fx.stationId, noPreparation: true },
      { kind: "no_preparation", stationId: fx.stationId },
      { kind: "zone" },
      {},
      true,
    ]) {
      for (const [method, path, body] of [
        ["PUT", `${base}/cell`, { address: categoryCell(fx.categoryId), target }],
        ["POST", `${base}/preview`, { kind: "cell", address: categoryCell(fx.categoryId), target }],
      ] as const) {
        const response = await send(fx.app, method, path, fx.managerCookie, body);
        expect(response.status, JSON.stringify(target)).toBe(400);
        expect(await response.json()).toEqual({
          error: { code: "management.request_invalid", params: { field: "target" } },
        });
      }
    }
    const missing = await send(fx.app, "POST", `${base}/preview`, fx.managerCookie, {
      kind: "cell",
      address: categoryCell(fx.categoryId),
    });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({
      error: { code: "management.request_invalid", params: { field: "target" } },
    });
    expect(await cellsOf(fx)).toEqual([]);
  });

  it("revalidates on save: a station disabled after the preview is refused on the write with route.station_inactive", async () => {
    const fx = await fixture();
    await lager(fx);
    const [upstairs] = await db
      .insert(kitchenStations)
      .values({ locationId: fx.locationId, name: "Upstairs" })
      .returning({ id: kitchenStations.id });
    const change = {
      address: categoryCell(fx.categoryId),
      target: { kind: "station", stationId: upstairs!.id },
    };
    const preview = await send(fx.app, "POST", `${base}/preview`, fx.managerCookie, {
      kind: "cell",
      ...change,
    });
    expect(preview.status).toBe(200);
    expect(await preview.json()).not.toEqual([]);
    await db
      .update(kitchenStations)
      .set({ active: false })
      .where(eq(kitchenStations.id, upstairs!.id));
    const write = await send(fx.app, "PUT", `${base}/cell`, fx.managerCookie, change);
    expect(write.status).toBe(409);
    expect(await write.json()).toMatchObject({
      error: { code: "route.station_inactive", params: { stationId: upstairs!.id } },
    });
    expect(await cellsOf(fx)).toEqual([]);
  });

  it("previews a cell change without writing", async () => {
    const fx = await fixture();
    const productId = await lager(fx);
    const path = `${base}/preview`;
    const result = await send(fx.app, "POST", path, fx.managerCookie, {
      kind: "cell",
      address: categoryCell(fx.categoryId),
      target: noPrep,
    });
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual([
      expect.objectContaining({
        productId,
        productName: "Lager",
        zoneId: fx.zoneId,
        from: { kind: "station", stationId: fx.stationId },
        to: { kind: "no_preparation" },
      }),
    ]);
    const clear = await send(fx.app, "POST", path, fx.managerCookie, {
      kind: "cell",
      address: categoryCell(fx.categoryId),
      target: null,
    });
    expect(clear.status).toBe(200);
    expect(await clear.json()).toEqual([]);
    for (const kind of ["claim", "assignment", "exception", "exception_order", undefined]) {
      const response = await send(fx.app, "POST", path, fx.managerCookie, {
        kind,
        address: categoryCell(fx.categoryId),
        target: noPrep,
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "management.request_invalid", params: { field: "kind" } },
      });
    }
    expect(await cellsOf(fx)).toEqual([]);
  });

  it("sets and clears a No category cell, Every zone included, and the model GET shows it", async () => {
    const fx = await fixture();
    await servedZone(fx);
    const every = { row: { kind: "no_category" }, zoneId: null };
    const terrace = { row: { kind: "no_category" }, zoneId: fx.zoneId };
    const allTerrace = { row: { kind: "all" }, zoneId: fx.zoneId };
    const station = { kind: "station", stationId: fx.stationId };
    for (const [address, target] of [
      [every, noPrep],
      [terrace, station],
      [allTerrace, noPrep],
    ] as const)
      expect(
        (await send(fx.app, "PUT", `${base}/cell`, fx.managerCookie, { address, target })).status,
        JSON.stringify(address),
      ).toBe(204);
    const shown = await cellsOf(fx);
    expect(shown).toHaveLength(3);
    expect(shown).toEqual(
      expect.arrayContaining([
        { ...every, target: noPrep },
        { ...terrace, target: station },
        { ...allTerrace, target: noPrep },
      ]),
    );
    for (const address of [every, terrace])
      expect(
        (await send(fx.app, "PUT", `${base}/cell`, fx.managerCookie, { address, target: null }))
          .status,
      ).toBe(204);
    expect(await cellsOf(fx)).toEqual([{ ...allTerrace, target: noPrep }]);
  });

  it("refuses a No category address with an extra key", async () => {
    const fx = await fixture();
    await servedZone(fx);
    for (const row of [
      { kind: "no_category", categoryId: fx.categoryId },
      { kind: "no_category", productId: null },
      { kind: "no_category", zoneId: fx.zoneId },
    ])
      for (const [method, path, body] of [
        ["PUT", `${base}/cell`, { address: { row, zoneId: fx.zoneId }, target: noPrep }],
        [
          "POST",
          `${base}/preview`,
          { kind: "cell", address: { row, zoneId: null }, target: noPrep },
        ],
      ] as const) {
        const response = await send(fx.app, method, path, fx.managerCookie, body);
        expect(response.status, `${method} ${JSON.stringify(row)}`).toBe(400);
        expect(await response.json()).toEqual({
          error: { code: "management.request_invalid", params: { field: "address" } },
        });
      }
    expect(await cellsOf(fx)).toEqual([]);
  });

  it("previews a No category cell change without writing", async () => {
    const fx = await fixture();
    await servedZone(fx);
    await lager(fx);
    const bread = await withTransaction(db, (tx) =>
      createProduct(tx, {
        catalogueId: fx.menuId,
        name: "Bread",
        categoryId: null,
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "general",
      }),
    );
    const response = await send(fx.app, "POST", `${base}/preview`, fx.managerCookie, {
      kind: "cell",
      address: { row: { kind: "no_category" }, zoneId: null },
      target: noPrep,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      expect.objectContaining({
        productId: bread.id,
        productName: "Bread",
        zoneId: fx.zoneId,
        from: { kind: "station", stationId: fx.stationId },
        to: { kind: "no_preparation" },
      }),
    ]);
    expect(await cellsOf(fx)).toEqual([]);
  });

  it("refuses a supervisor and staff (403) and an unauthenticated request (401); a manager is allowed", async () => {
    const fx = await fixture();
    const set = { address: categoryCell(fx.categoryId), target: noPrep };
    for (const [method, path, body, allowed] of [
      ["GET", base, undefined, 200],
      ["PUT", `${base}/cell`, set, 204],
      ["POST", `${base}/preview`, { kind: "cell", ...set }, 200],
    ] as const) {
      for (const [cookie, status] of [
        [undefined, 401],
        [fx.staffCookie, 403],
        [fx.supervisorCookie, 403],
      ] as const)
        expect((await send(fx.app, method, path, cookie, body)).status).toBe(status);
      if (method === "PUT") expect(await cellsOf(fx)).toEqual([]);
      expect((await send(fx.app, method, path, fx.managerCookie, body)).status).toBe(allowed);
    }
    expect(await cellsOf(fx)).toEqual([{ ...set.address, target: noPrep }]);
  });

  it("the routing GET reports canMakeDefault for a manager", async () => {
    const fx = await fixture();
    const response = await send(fx.app, "GET", base, fx.managerCookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      canMakeDefault: true,
      defaultStationId: fx.stationId,
      cells: [],
    });
  });

  it("no legacy routing endpoint remains mounted", async () => {
    const fx = await fixture();
    const id = crypto.randomUUID();
    for (const [method, path, body] of [
      ["PUT", `${base}/claims/${fx.categoryId}`, { noPreparation: true }],
      ["DELETE", `${base}/claims/${fx.categoryId}`, undefined],
      ["PUT", `${base}/products/${id}/assignment`, { noPreparation: true }],
      ["POST", `${base}/exceptions`, { categoryId: fx.categoryId, noPreparation: true }],
      [
        "PUT",
        `${base}/exceptions/${id}`,
        { zoneId: null, categoryId: fx.categoryId, productId: null, noPreparation: true },
      ],
      ["DELETE", `${base}/exceptions/${id}`, undefined],
      ["PUT", `${base}/exception-order`, { ids: [] }],
    ] as const) {
      const response = await send(fx.app, method, path, fx.managerCookie, body);
      expect(response.status, `${method} ${path}`).toBe(404);
      expect(await response.text()).toBe("404 Not Found");
    }
  });

  it("no longer serves the routing explanation", async () => {
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
    const path = `${base}/explain?productId=${product.id}`;
    for (const query of ["", "&weekday=5&time=22:00", "&date=2026-10-09&time=20:00"]) {
      const response = await send(fx.app, "GET", `${path}${query}`, fx.managerCookie);
      expect(response.status, query).toBe(404);
      expect(await response.text()).toBe("404 Not Found");
    }
  });
});

describe("a routing cell's period choices on the routes", () => {
  const base = "/management-api/venue-service/routing";
  const lunchFixture = async () => {
    const fx = await fixture();
    const { lunch, lager, downstairs, department } = await withTransaction(db, async (tx) => {
      const cfg = { locationId: fx.locationId };
      const dining = await createDepartment(tx, cfg, {
        name: "Dining",
        orderStart: "table",
      });
      await configureZone(tx, cfg, { zoneId: fx.zoneId, departmentId: dining.id });
      const product = await createProduct(tx, {
        catalogueId: fx.menuId,
        name: "Lager",
        categoryId: fx.categoryId,
        pricingUnit: "each",
        unitPrice: "3.00",
        vatClass: "general",
      });
      await addProductToMenu(tx, { menuId: fx.menuId, productId: product.id });
      const period = await saveMenuPeriod(tx, cfg, dining.id, {
        name: "Lunch",
        menuId: fx.menuId,
        staffMenuIds: [],
        colour: "green",
      });
      const [station] = await tx
        .insert(kitchenStations)
        .values({ locationId: fx.locationId, name: "Downstairs bar" })
        .returning({ id: kitchenStations.id });
      return {
        lunch: period.id,
        lager: product.id,
        downstairs: station!.id,
        department: dining.id,
      };
    });
    return { ...fx, lunch, lager, downstairs, department };
  };
  const address = (fx: { categoryId: string }) => ({
    row: { kind: "category", categoryId: fx.categoryId },
    zoneId: null,
  });
  const at = (stationId: string) => ({ kind: "station", stationId });

  it("saves a cell's Lunch line and the model shows it, with Lunch's department and products", async () => {
    const fx = await lunchFixture();
    const periods = [{ periodId: fx.lunch, target: at(fx.downstairs) }];
    const saved = await send(fx.app, "PUT", `${base}/cell`, fx.managerCookie, {
      address: address(fx),
      target: at(fx.stationId),
      periods,
    });
    expect(saved.status).toBe(204);
    const model = (await (await send(fx.app, "GET", base, fx.managerCookie)).json()) as {
      cells: unknown[];
      periods: unknown[];
    };
    expect(model.cells).toEqual([{ ...address(fx), target: at(fx.stationId), periods }]);
    expect(model.periods).toEqual([
      {
        id: fx.lunch,
        departmentId: fx.department,
        departmentName: "Dining",
        name: "Lunch",
        colour: "green",
        productIds: [fx.lager],
      },
    ]);
  });

  it("answers a refused line with its status: 409 route.period_invalid, 404 for an unknown period", async () => {
    const fx = await lunchFixture();
    const unknown = crypto.randomUUID();
    for (const [periods, status, error] of [
      [
        [
          { periodId: fx.lunch, target: at(fx.downstairs) },
          { periodId: fx.lunch, target: { kind: "no_preparation" } },
        ],
        409,
        { code: "route.period_invalid", params: { periodId: fx.lunch, reason: "repeated" } },
      ],
      [
        [{ periodId: unknown, target: at(fx.downstairs) }],
        404,
        { code: "route.subject_not_found", params: { subject: "period", id: unknown } },
      ],
    ] as const) {
      const response = await send(fx.app, "PUT", `${base}/cell`, fx.managerCookie, {
        address: address(fx),
        target: at(fx.stationId),
        periods,
      });
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error });
    }
  });

  it("refuses periods on the default cell by its address, on a cleared cell and in a malformed list by field periods", async () => {
    const fx = await lunchFixture();
    const lunchLine = { periodId: fx.lunch, target: at(fx.downstairs) };
    const refusals: [Record<string, unknown>, string][] = [
      [
        {
          address: { row: { kind: "all" }, zoneId: null },
          target: at(fx.stationId),
          periods: [lunchLine],
        },
        "address",
      ],
      [{ address: address(fx), target: null, periods: [lunchLine] }, "periods"],
      [{ address: address(fx), target: null, periods: [] }, "periods"],
      [{ address: address(fx), target: at(fx.stationId), periods: lunchLine }, "periods"],
      [{ address: address(fx), target: at(fx.stationId), periods: [null] }, "periods"],
      [
        { address: address(fx), target: at(fx.stationId), periods: [{ periodId: fx.lunch }] },
        "periods",
      ],
      [
        {
          address: address(fx),
          target: at(fx.stationId),
          periods: [{ periodId: fx.lunch, target: null }],
        },
        "periods",
      ],
      [
        { address: address(fx), target: at(fx.stationId), periods: [{ ...lunchLine, extra: 1 }] },
        "periods",
      ],
      [
        {
          address: address(fx),
          target: at(fx.stationId),
          periods: [{ ...lunchLine, periodId: "lunch" }],
        },
        "periods",
      ],
      [
        {
          address: address(fx),
          target: at(fx.stationId),
          periods: [{ periodId: fx.lunch, target: { kind: "station" } }],
        },
        "periods",
      ],
    ];
    for (const [body, field] of refusals) {
      for (const [method, path, sent] of [
        ["PUT", `${base}/cell`, body],
        ["POST", `${base}/preview`, { kind: "cell", ...body }],
      ] as const) {
        const response = await send(fx.app, method, path, fx.managerCookie, sent);
        expect(response.status, `${method} ${JSON.stringify(body)}`).toBe(400);
        expect(await response.json()).toEqual({
          error: { code: "management.request_invalid", params: { field } },
        });
      }
    }
    const model = (await (await send(fx.app, "GET", base, fx.managerCookie)).json()) as {
      cells: unknown[];
    };
    expect(model.cells).toEqual([]);
  });

  it("previews adding a Lunch line as the cell's products moving during Lunch alone", async () => {
    const fx = await lunchFixture();
    await send(fx.app, "PUT", `${base}/cell`, fx.managerCookie, {
      address: address(fx),
      target: at(fx.stationId),
    });
    const response = await send(fx.app, "POST", `${base}/preview`, fx.managerCookie, {
      kind: "cell",
      address: address(fx),
      target: at(fx.stationId),
      periods: [{ periodId: fx.lunch, target: at(fx.downstairs) }],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        productId: fx.lager,
        productName: "Lager",
        zoneId: fx.zoneId,
        zoneName: "Terrace",
        from: at(fx.stationId),
        to: at(fx.downstairs),
        toNoReplacement: false,
        periodIds: [fx.lunch],
      },
    ]);
  });
});

describe("what a supervisor reaches of prep stations", () => {
  it("answers 404 for the removed read-only overview route, to a manager and a supervisor", async () => {
    const f = await fixture();
    for (const cookie of [f.managerCookie, f.supervisorCookie])
      expect(
        (await send(f.app, "GET", "/management-api/venue-service/stations/overview", cookie))
          .status,
      ).toBe(404);
  });
  it("refuses a supervisor's routing read", async () => {
    const f = await fixture();
    expect(
      (await send(f.app, "GET", "/management-api/venue-service/routing", f.supervisorCookie))
        .status,
    ).toBe(403);
  });
  it("has no management route for a supervisor to change a station's state today", async () => {
    const f = await fixture();
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
    ).toBe(404);
  });
});

it.each([false, true])("answers department name clashes with 409 (active=%s)", async (active) => {
  const fx = await fixture();
  const path = "/management-api/venue-service/departments";
  const original = await send(fx.app, "POST", path, fx.managerCookie, {
    name: "Deli",
  });
  expect(original.status).toBe(201);
  const target = (await original.json()) as { id: string };
  if (!active)
    await db.update(departments).set({ active: false }).where(eq(departments.id, target.id));
  const expected = active
    ? { code: "department.name_taken", params: { name: "Deli" } }
    : { code: "department.name_disabled", params: { name: "Deli", departmentId: target.id } };
  const duplicate = await send(fx.app, "POST", path, fx.managerCookie, {
    name: "Deli",
  });
  expect(duplicate.status).toBe(409);
  expect(await duplicate.json()).toEqual({ error: expected });
  const source = (await (
    await send(fx.app, "POST", path, fx.managerCookie, {
      name: "Bar",
    })
  ).json()) as { id: string };
  const rename = await send(fx.app, "PATCH", `${path}/${source.id}`, fx.managerCookie, {
    name: "Deli",
    tradingName: "Bar",
  });
  expect(rename.status).toBe(409);
  expect(await rename.json()).toEqual({ error: expected });
});

describe("name-only department creation", () => {
  it("accepts a name alone and defaults trading name and counter service", async () => {
    const fx = await fixture();
    const response = await send(
      fx.app,
      "POST",
      "/management-api/venue-service/departments",
      fx.managerCookie,
      { name: "Brunch" },
    );
    expect(response.status).toBe(201);
    const made = await response.json();
    expect(made).toMatchObject({
      name: "Brunch",
      tradingName: "Brunch",

      active: true,
    });
    const model = await (
      await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)
    ).json();
    expect(
      model.salePolicies.departments.find(
        (row: { departmentId: string }) => row.departmentId === made.id,
      ),
    ).toMatchObject({ orderStart: "counter" });
  });
  it.each([null, "invalid", [], 1])(
    "refuses explicitly invalid style %j without creating a department",
    async (defaultServiceMode) => {
      const fx = await fixture();
      const before = await (
        await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)
      ).json();
      const response = await send(
        fx.app,
        "POST",
        "/management-api/venue-service/departments",
        fx.managerCookie,
        { name: "Invalid", defaultServiceMode },
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "defaultServiceMode" } },
      });
      expect(
        await (await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)).json(),
      ).toEqual(before);
    },
  );
  it("renames a disabled department through its existing full-body route", async () => {
    const fx = await fixture();
    const row = await withTransaction(db, (tx) =>
      createDepartment(tx, fx, {
        name: "Closed",
        tradingName: "Shop",
        orderStart: "counter",
      }),
    );
    await db.update(departments).set({ active: false }).where(eq(departments.id, row.id));
    const response = await send(
      fx.app,
      "PATCH",
      `/management-api/venue-service/departments/${row.id}`,
      fx.managerCookie,
      { name: "Renamed", tradingName: "Shop" },
    );
    expect(response.status).toBe(204);
    expect(
      (await db.select().from(departments).where(eq(departments.id, row.id)))[0],
    ).toMatchObject({ name: "Renamed", active: false });
  });
});

describe("station service-times planning route", () => {
  const path = (id: string, range = "from=2026-10-12&to=2026-10-12") =>
    `/management-api/venue-service/stations/${id}/service-times?${range}`;
  it("serves the same read-only default-station answer to managers and supervisors", async () => {
    const f = await fixture();
    for (const cookie of [f.managerCookie, f.supervisorCookie]) {
      const response = await send(f.app, "GET", path(f.stationId), cookie);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ always: "default", days: [] });
    }
  });
  it.each([
    ["staff", 403, "authorization.not_permitted"],
    ["anonymous", 401, "management_session.required"],
  ] as const)("refuses %s reads", async (kind, status, code) => {
    const f = await fixture();
    const response = await send(
      f.app,
      "GET",
      path(f.stationId),
      kind === "staff" ? f.staffCookie : undefined,
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { code } });
  });
  it.each([
    ["", "from"],
    ["from=2026-10-12", "to"],
    ["from=2026-10-12&to=2026-11-23", "to"],
    ["from=2026-10-12&to=2026-10-18&week=unknown", "week"],
  ])("refuses incomplete or overlong date range %s", async (query, field) => {
    const f = await fixture();
    const response = await send(f.app, "GET", path(f.stationId, query!), f.managerCookie);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field } },
    });
  });
  it("refuses unknown and foreign stations by the same domain code", async () => {
    const f = await fixture(),
      other = await fixture();
    for (const id of [randomUUID(), other.stationId]) {
      const response = await send(f.app, "GET", path(id), f.managerCookie);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        error: { code: "station.not_found", params: { stationId: id } },
      });
    }
  });
});
it("the station planning route returns the configured period ranges for a non-default station", async () => {
  const f = await fixture();
  const expected = await withTransaction(db, async (tx) => {
    const cfg = { locationId: f.locationId };
    const departmentId = (await createDepartment(tx, cfg, { name: "Dining", orderStart: "table" }))
      .id;
    await configureZone(tx, cfg, { zoneId: f.zoneId, departmentId });
    const product = await createProduct(tx, {
      catalogueId: f.menuId,
      name: randomUUID(),
      categoryId: f.categoryId,
      pricingUnit: "each",
      unitPrice: "3",
      vatClass: "general",
    });
    await addProductToMenu(tx, { menuId: f.menuId, productId: product.id });
    const periodId = (
      await saveMenuPeriod(tx, cfg, departmentId, {
        name: "Lunch",
        menuId: f.menuId,
        staffMenuIds: [],
        colour: "blue",
      })
    ).id;
    const ranges = [{ periodId, startsAt: "12:00", endsAt: "16:00" }];
    await replaceMenuWeek(
      tx,
      cfg,
      departmentId,
      Array.from({ length: 7 }, (_, weekday) => ({ weekday, slots: weekday === 1 ? ranges : [] })),
      new Date("2026-10-10T10:00:00Z"),
    );
    const [station] = await tx
      .insert(kitchenStations)
      .values({ ...cfg, name: "Cocktails" })
      .returning();
    await setRoutingCell(
      tx,
      cfg,
      { row: { kind: "category", categoryId: f.categoryId }, zoneId: f.zoneId },
      { kind: "station", stationId: station!.id },
    );
    return { stationId: station!.id, departmentId, ranges };
  });
  const response = await send(
    f.app,
    "GET",
    `/management-api/venue-service/stations/${expected.stationId}/service-times?from=2026-10-12&to=2026-10-12`,
    f.supervisorCookie,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    always: null,
    days: [
      {
        date: "2026-10-12",
        departments: [{ departmentId: expected.departmentId, ranges: expected.ranges }],
      },
    ],
  });
});
