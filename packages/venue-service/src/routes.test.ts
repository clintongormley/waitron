import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS, createCatalogue, createCategory } from "@waitron/catalogue";
import { CORE_MIGRATIONS, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  hashPin,
  IDENTITY_MIGRATIONS,
  registerModulePermissions,
  startManagementSession,
} from "@waitron/identity";
import type { ModuleRouteContext } from "@waitron/module";
import { locationId } from "@waitron/shared";
import { MANAGEMENT_COOKIE, type Logger } from "@waitron/server-kit";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
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
  managerCookie: string;
  staffCookie: string;
  zoneId: string;
  stationId: string;
  menuId: string;
  categoryId: string;
}

async function fixture(): Promise<Fixture> {
  await seedTenant(db);
  const location = await db.execute<{ id: string }>(sql`
    insert into locations (name, invoice_locales, operation_description) values ('Venue', array['en-GB'], 'Hospitality') returning id`);
  const scopedLocationId = locationId(location.rows[0]!.id);
  const zone = await db.execute<{ id: string }>(sql`
    insert into floor_zones (location_id, name) values (${scopedLocationId}, 'Terrace') returning id`);
  const station = await db.execute<{ id: string }>(sql`
    insert into kitchen_stations (location_id, name) values (${scopedLocationId}, 'Terrace bar') returning id`);

  const { menuId, categoryId, managerSessionId, staffSessionId } = await db.transaction(
    async (tx) => {
      const menu = await createCatalogue(tx, { name: "Drinks" });
      const category = await createCategory(tx, { name: { en: "Cocktails" } });
      const manager = await tx.execute<{ id: string }>(sql`
        insert into persons (display_name, pin_hash, role)
        values (${`Manager ${scopedLocationId}`}, ${hashPin("1234")}, 'manager') returning id`);
      const staff = await tx.execute<{ id: string }>(sql`
        insert into persons (display_name, pin_hash, role)
        values (${`Staff ${scopedLocationId}`}, ${hashPin("1234")}, 'staff') returning id`);
      const managerSession = await startManagementSession(tx, {
        personId: manager.rows[0]!.id,
      });
      const staffSession = await startManagementSession(tx, {
        personId: staff.rows[0]!.id,
      });
      return {
        menuId: menu.id,
        categoryId: category.id,
        managerSessionId: managerSession.id,
        staffSessionId: staffSession.id,
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
    managerCookie: `${MANAGEMENT_COOKIE}=${managerSessionId}`,
    staffCookie: `${MANAGEMENT_COOKIE}=${staffSessionId}`,
    zoneId: zone.rows[0]!.id,
    stationId: station.rows[0]!.id,
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
    // A SECOND venue (a new location) in the SAME tenant — one tenant per database, so the scoping
    // that still exists is by LOCATION, not tenant. `fx`'s manager (location L1) must not reach rows
    // or references that live in `other`'s location (L2). (The cross-TENANT half of this probe was
    // dropped: with one tenant per database it asserts a property the schema no longer has.)
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
});
