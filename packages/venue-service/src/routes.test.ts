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
  deviceProfiles,
  devices,
  floorZones,
  kitchenStations,
  locations,
  tills,
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
import { resolveNewOrderZone } from "./operations.js";
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
    .values({ locationId: scopedLocationId, name: "Terrace bar" })
    .returning({ id: kitchenStations.id });

  const { menuId, categoryId, managerSessionId, staffSessionId } = await db.transaction(
    async (tx) => {
      const menu = await createCatalogue(tx, { name: "Drinks" });
      const category = await createCategory(tx, { name: { en: "Cocktails" } });
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
      const managerSession = await startManagementSession(tx, {
        personId: manager!.id,
      });
      const staffSession = await startManagementSession(tx, {
        personId: staff!.id,
      });
      return {
        menuId: menu.id,
        categoryId: category.id,
        managerSessionId: managerSession.token,
        staffSessionId: staffSession.token,
      };
    },
  );

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
  it("requires an explicit zone when replacing a route and keeps its scope on invalid input", async () => {
    const fx = await fixture();
    const departmentResponse = await send(
      fx.app,
      "POST",
      "/management-api/venue-service/departments",
      fx.managerCookie,
      { name: "Dining", defaultServiceMode: "table_tab" },
    );
    const department = (await departmentResponse.json()) as { id: string };
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
    const original = { zoneId: fx.zoneId, categoryId: fx.categoryId, stationId: fx.stationId };
    const created = await send(
      fx.app,
      "POST",
      "/management-api/venue-service/routes",
      fx.managerCookie,
      original,
    );
    expect(created.status).toBe(201);
    const route = (await created.json()) as { id: string };
    const rejected = await send(
      fx.app,
      "PUT",
      `/management-api/venue-service/routes/${route.id}`,
      fx.managerCookie,
      { categoryId: fx.categoryId, noPreparation: true },
    );
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({
      error: { code: "management.request_invalid", params: { field: "zoneId" } },
    });
    const unchanged = (await (
      await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)
    ).json()) as { routes: unknown[] };
    expect(unchanged.routes).toEqual([
      { id: route.id, ...original, productId: null, noPreparation: false },
    ]);
    expect(
      (
        await send(
          fx.app,
          "PUT",
          `/management-api/venue-service/routes/${route.id}`,
          fx.managerCookie,
          { zoneId: null, categoryId: fx.categoryId, noPreparation: true },
        )
      ).status,
    ).toBe(204);
    const updated = (await (
      await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)
    ).json()) as { routes: unknown[] };
    expect(updated.routes).toEqual([
      {
        id: route.id,
        zoneId: null,
        categoryId: fx.categoryId,
        productId: null,
        stationId: null,
        noPreparation: true,
      },
    ]);
  });

  it("edits departments and preparation routes in place", async () => {
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
    const createdRoute = await send(
      fx.app,
      "POST",
      "/management-api/venue-service/routes",
      fx.managerCookie,
      {
        categoryId: fx.categoryId,
        stationId: fx.stationId,
      },
    );
    const route = (await createdRoute.json()) as { id: string };
    const routeInput = { zoneId: null, categoryId: fx.categoryId, noPreparation: true };
    expect(
      (
        await send(
          fx.app,
          "PUT",
          `/management-api/venue-service/routes/${route.id}`,
          fx.managerCookie,
          routeInput,
        )
      ).status,
    ).toBe(204);
    const listed = await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie);
    expect(await listed.json()).toMatchObject({
      departments: [{ id: department.id, ...departmentInput, active: true }],
      routes: [
        {
          id: route.id,
          zoneId: null,
          categoryId: fx.categoryId,
          productId: null,
          stationId: null,
          noPreparation: true,
        },
      ],
    });
    expect(
      (
        await send(
          fx.app,
          "PUT",
          `/management-api/venue-service/routes/${route.id}`,
          fx.managerCookie,
          { zoneId: null, categoryId: fx.categoryId, stationId: fx.stationId },
        )
      ).status,
    ).toBe(204);
  });

  it("checks edit permissions and rejects malformed fields without changing rows", async () => {
    const fx = await fixture();
    const department = (await (
      await send(fx.app, "POST", "/management-api/venue-service/departments", fx.managerCookie, {
        name: "Restaurant",
        defaultServiceMode: "table_tab",
      })
    ).json()) as { id: string };
    const route = (await (
      await send(fx.app, "POST", "/management-api/venue-service/routes", fx.managerCookie, {
        categoryId: fx.categoryId,
        noPreparation: true,
      })
    ).json()) as { id: string };
    const paths = [
      {
        method: "PATCH" as const,
        path: `/management-api/venue-service/departments/${department.id}`,
        body: { name: "Deli", tradingName: "Deli", defaultServiceMode: "prepay" },
      },
      {
        method: "PUT" as const,
        path: `/management-api/venue-service/routes/${route.id}`,
        body: { zoneId: null, categoryId: fx.categoryId, stationId: fx.stationId },
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
    for (const body of [
      { zoneId: null, categoryId: fx.categoryId },
      {
        zoneId: null,
        categoryId: fx.categoryId,
        productId: crypto.randomUUID(),
        noPreparation: true,
      },
      { zoneId: null, categoryId: fx.categoryId, stationId: fx.stationId, noPreparation: true },
    ])
      expect((await send(fx.app, "PUT", paths[1]!.path, fx.managerCookie, body)).status).toBe(400);
    expect(
      await (await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)).json(),
    ).toMatchObject({
      departments: [{ id: department.id, name: "Restaurant" }],
      routes: [{ id: route.id, noPreparation: true }],
    });
  });

  it("scopes edited rows and route references to their venue", async () => {
    // A second location in the same database: `fx`'s manager must not reach rows or references
    // that live in `other`'s location.
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
    const route = (await (
      await send(other.app, "POST", "/management-api/venue-service/routes", other.managerCookie, {
        categoryId: other.categoryId,
        noPreparation: true,
      })
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
      (
        await send(
          fx.app,
          "PUT",
          `/management-api/venue-service/routes/${route.id}`,
          fx.managerCookie,
          { zoneId: null, categoryId: fx.categoryId, noPreparation: true },
        )
      ).status,
    ).toBe(404);
    const own = (await (
      await send(fx.app, "POST", "/management-api/venue-service/routes", fx.managerCookie, {
        categoryId: fx.categoryId,
        noPreparation: true,
      })
    ).json()) as { id: string };
    expect(
      (
        await send(
          fx.app,
          "PUT",
          `/management-api/venue-service/routes/${own.id}`,
          fx.managerCookie,
          { zoneId: null, categoryId: fx.categoryId, stationId: other.stationId },
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await send(
          fx.app,
          "PUT",
          `/management-api/venue-service/routes/${own.id}`,
          fx.managerCookie,
          { zoneId: other.zoneId, categoryId: fx.categoryId, noPreparation: true },
        )
      ).status,
    ).toBe(404);
    await send(
      fx.app,
      "DELETE",
      `/management-api/venue-service/routes/${own.id}`,
      fx.managerCookie,
    );
    expect(
      await (
        await send(other.app, "GET", "/management-api/venue-service", other.managerCookie)
      ).json(),
    ).toMatchObject({
      departments: [{ id: department.id, name: "Other" }],
      routes: [{ id: route.id, categoryId: other.categoryId, noPreparation: true }],
    });
  });

  it("rejects a duplicate route edit and keeps the original route", async () => {
    const fx = await fixture();
    const existing = (await (
      await send(fx.app, "POST", "/management-api/venue-service/routes", fx.managerCookie, {
        categoryId: fx.categoryId,
        noPreparation: true,
      })
    ).json()) as { id: string };
    const secondCategory = await db.transaction((tx) =>
      createCategory(tx, { name: { en: "Other" } }),
    );
    const route = (await (
      await send(fx.app, "POST", "/management-api/venue-service/routes", fx.managerCookie, {
        categoryId: secondCategory.id,
        noPreparation: true,
      })
    ).json()) as { id: string };
    expect(
      (
        await send(
          fx.app,
          "PUT",
          `/management-api/venue-service/routes/${route.id}`,
          fx.managerCookie,
          { zoneId: null, categoryId: fx.categoryId, noPreparation: true },
        )
      ).status,
    ).toBe(409);
    const listed = (await (
      await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)
    ).json()) as { routes: unknown[] };
    expect(listed.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: existing.id, categoryId: fx.categoryId }),
        expect.objectContaining({ id: route.id, categoryId: secondCategory.id }),
      ]),
    );
  });

  it("configures a department, zone menu, and preparation route", async () => {
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
          `/management-api/venue-service/departments/${department.id}/hours`,
          fx.managerCookie,
          {
            hours: [
              { weekday: 1, opensAt: "09:00", closesAt: "14:00" },
              { weekday: 1, opensAt: "17:00", closesAt: "23:00" },
              { weekday: 6, opensAt: "18:00", closesAt: "01:00" },
            ],
          },
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

    const route = await send(
      fx.app,
      "POST",
      "/management-api/venue-service/routes",
      fx.managerCookie,
      {
        zoneId: fx.zoneId,
        categoryId: fx.categoryId,
        stationId: fx.stationId,
      },
    );
    expect(route.status).toBe(201);
    const routeId = ((await route.json()) as { id: string }).id;
    expect(
      (
        await send(fx.app, "POST", "/management-api/venue-service/routes", fx.managerCookie, {
          zoneId: fx.zoneId,
          categoryId: fx.categoryId,
          stationId: fx.stationId,
        })
      ).status,
    ).toBe(409);

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
      routes: [
        {
          zoneId: fx.zoneId,
          categoryId: fx.categoryId,
          stationId: fx.stationId,
          noPreparation: false,
        },
      ],
      hours: [
        { departmentId: department.id, weekday: 1, opensAt: "09:00:00", closesAt: "14:00:00" },
        { departmentId: department.id, weekday: 1, opensAt: "17:00:00", closesAt: "23:00:00" },
        { departmentId: department.id, weekday: 6, opensAt: "18:00:00", closesAt: "01:00:00" },
      ],
      zoneMenus: [{ zoneId: fx.zoneId, menuId: fx.menuId, displayOrder: 0, isDefault: true }],
      readiness: [
        {
          code: "zone.menu_empty",
          zoneId: fx.zoneId,
          menuId: fx.menuId,
        },
      ],
    });
    expect(
      (
        await send(
          fx.app,
          "DELETE",
          `/management-api/venue-service/routes/${routeId}`,
          fx.managerCookie,
        )
      ).status,
    ).toBe(204);

    const blocked = await send(
      fx.app,
      "DELETE",
      `/management-api/venue-service/departments/${department.id}`,
      fx.managerCookie,
    );
    expect(blocked.status).toBe(409);

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

  it("accepts inherited service mode and an explicit no-preparation route", async () => {
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
    expect(
      (
        await send(fx.app, "POST", "/management-api/venue-service/routes", fx.managerCookie, {
          categoryId: fx.categoryId,
          noPreparation: true,
        })
      ).status,
    ).toBe(201);
  });

  it("requires a manager and screens malformed route bodies", async () => {
    const fx = await fixture();
    expect((await send(fx.app, "GET", "/management-api/venue-service")).status).toBe(401);
    expect(
      (await send(fx.app, "GET", "/management-api/venue-service", fx.staffCookie)).status,
    ).toBe(403);
    expect(
      (
        await send(fx.app, "POST", "/management-api/venue-service/routes", fx.managerCookie, {
          categoryId: fx.categoryId,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send(fx.app, "POST", "/management-api/venue-service/routes", fx.managerCookie, {
          categoryId: fx.categoryId,
          productId: crypto.randomUUID(),
          noPreparation: true,
        })
      ).status,
    ).toBe(400);
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
    expect(
      (
        await send(
          fx.app,
          "PUT",
          `/management-api/venue-service/devices/${crypto.randomUUID()}/default-zone`,
          fx.managerCookie,
          { zoneId: fx.zoneId },
        )
      ).status,
    ).toBe(404);
  });

  it("refuses an hours body that is not a list of intervals and keeps the saved hours", async () => {
    const fx = await fixture();
    const department = (await (
      await send(fx.app, "POST", "/management-api/venue-service/departments", fx.managerCookie, {
        name: "Restaurant",
        defaultServiceMode: "table_tab",
      })
    ).json()) as { id: string };
    const path = `/management-api/venue-service/departments/${department.id}/hours`;
    const saved = { weekday: 2, opensAt: "12:00", closesAt: "16:00" };
    expect((await send(fx.app, "PUT", path, fx.managerCookie, { hours: [saved] })).status).toBe(
      204,
    );
    const cases: { body: unknown; field: string }[] = [
      { body: {}, field: "hours" },
      { body: { hours: saved }, field: "hours" },
      { body: { hours: [saved, null] }, field: "hours.1" },
      { body: { hours: [saved, "Monday"] }, field: "hours.1" },
    ];
    for (const { body, field } of cases) {
      const rejected = await send(fx.app, "PUT", path, fx.managerCookie, body);
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toEqual({
        error: { code: "management.request_invalid", params: { field } },
      });
    }
    expect(
      (
        (await (
          await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)
        ).json()) as { hours: unknown[] }
      ).hours,
    ).toEqual([
      { departmentId: department.id, weekday: 2, opensAt: "12:00:00", closesAt: "16:00:00" },
    ]);
  });

  it("refuses an interval with an impossible weekday or clock time, naming its position", async () => {
    const fx = await fixture();
    const department = (await (
      await send(fx.app, "POST", "/management-api/venue-service/departments", fx.managerCookie, {
        name: "Restaurant",
        defaultServiceMode: "table_tab",
      })
    ).json()) as { id: string };
    const path = `/management-api/venue-service/departments/${department.id}/hours`;
    const valid = { weekday: 3, opensAt: "09:00", closesAt: "14:00" };
    expect((await send(fx.app, "PUT", path, fx.managerCookie, { hours: [valid] })).status).toBe(
      204,
    );
    // Each interval has one bad field and every other field valid.
    for (const bad of [
      { ...valid, weekday: "3" },
      { ...valid, weekday: 2.5 },
      { ...valid, weekday: -1 },
      { ...valid, weekday: 7 },
      { ...valid, opensAt: 900 },
      { ...valid, opensAt: ["10:00"] },
      { ...valid, opensAt: "24:00" },
      { ...valid, closesAt: undefined },
      { ...valid, closesAt: ["15:00"] },
      { ...valid, closesAt: "14:60" },
      { ...valid, closesAt: "09:00" },
    ]) {
      const rejected = await send(fx.app, "PUT", path, fx.managerCookie, { hours: [valid, bad] });
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toEqual({
        error: { code: "management.request_invalid", params: { field: "hours.1" } },
      });
    }
    expect(
      (
        (await (
          await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)
        ).json()) as { hours: unknown[] }
      ).hours,
    ).toEqual([
      { departmentId: department.id, weekday: 3, opensAt: "09:00:00", closesAt: "14:00:00" },
    ]);
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

  it("routes a single product rather than a category, and refuses a route naming neither", async () => {
    const fx = await fixture();
    const product = await withTransaction(db, (tx) =>
      createProduct(tx, {
        catalogueId: fx.menuId,
        categoryId: fx.categoryId,
        name: "Negroni",
        pricingUnit: "each",
        unitPrice: "9.00",
        vatClass: "general",
      }),
    );
    const created = await send(
      fx.app,
      "POST",
      "/management-api/venue-service/routes",
      fx.managerCookie,
      { productId: product.id, stationId: fx.stationId },
    );
    expect(created.status).toBe(201);
    const route = (await created.json()) as { id: string };
    const rejected = await send(
      fx.app,
      "POST",
      "/management-api/venue-service/routes",
      fx.managerCookie,
      { categoryId: null, stationId: fx.stationId },
    );
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({
      error: { code: "management.request_invalid", params: { field: "subject" } },
    });
    expect(
      (
        (await (
          await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)
        ).json()) as { routes: unknown[] }
      ).routes,
    ).toEqual([
      {
        id: route.id,
        zoneId: null,
        categoryId: null,
        productId: product.id,
        stationId: fx.stationId,
        noPreparation: false,
      },
    ]);
  });

  it("stores the zone a device's new orders start in", async () => {
    const fx = await fixture();
    const department = (await (
      await send(fx.app, "POST", "/management-api/venue-service/departments", fx.managerCookie, {
        name: "Deli",
        defaultServiceMode: "prepay",
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
    const [till] = await db
      .insert(tills)
      .values({ locationId: fx.locationId, name: "Till 1" })
      .returning({ id: tills.id });
    const [profile] = await db
      .insert(deviceProfiles)
      .values({ name: "Counter", formFactor: "till" })
      .returning({ id: deviceProfiles.id });
    const [device] = await db
      .insert(devices)
      .values({
        locationId: fx.locationId,
        deviceProfileId: profile!.id,
        tillId: till!.id,
        label: "Counter till",
        tokenHash: "scrypt$00$00",
      })
      .returning({ id: devices.id });
    const scope = { locationId: fx.locationId };
    // No zone is the venue's counter default, so without the device's own default a new order
    // from this device has no zone to start in.
    await expect(
      withTransaction(db, (tx) => resolveNewOrderZone(tx, scope, { deviceId: device!.id })),
    ).rejects.toMatchObject({ code: "service_zone.default_missing" });
    expect(
      (
        await send(
          fx.app,
          "PUT",
          `/management-api/venue-service/devices/${device!.id}/default-zone`,
          fx.managerCookie,
          { zoneId: fx.zoneId },
        )
      ).status,
    ).toBe(204);
    await expect(
      withTransaction(db, (tx) => resolveNewOrderZone(tx, scope, { deviceId: device!.id })),
    ).resolves.toMatchObject({ zoneId: fx.zoneId, departmentId: department.id });
  });
});
