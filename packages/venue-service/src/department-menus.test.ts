import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CATALOGUE_MIGRATIONS,
  buildMenuDocument,
  createCatalogue,
  menuDocumentHash,
  publishMenu,
} from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  floorZones,
  kitchenStations,
  locations,
  withTransaction,
  type Database,
  type Transaction,
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
import { locationId as brandLocationId, type LocationId } from "@waitron/shared";
import { MANAGEMENT_COOKIE, type Logger } from "@waitron/server-kit";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import {
  configureZone,
  createDepartment,
  deactivateServiceZone,
  listVenueReadiness,
  listZoneOffers,
} from "./operations.js";
import {
  addDepartmentMenu,
  listDepartmentMenus,
  setDepartmentAllDayMenu,
  setDepartmentMenus,
  setZoneAllDayMenu,
} from "./department-menus.js";
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
  timeoutMs: 60_000,
});

let db: Database;
beforeAll(() => {
  db = suite.db;
});

const scoped = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(db, fn);

async function publish(tx: Transaction, menuId: string): Promise<string> {
  const { document } = await buildMenuDocument(tx, menuId);
  return (await publishMenu(tx, menuId, menuDocumentHash(document), "person-1")).versionId;
}

/**
 * Restaurant (Barra, Sala, Terraza) and Deli (Mostrador deli), with four published menus and no
 * department list yet.
 */
async function venue() {
  const [location] = await db
    .insert(locations)
    .values({ name: "Casa", invoiceLocales: ["es-ES"], operationDescription: "Hostelería" })
    .returning({ id: locations.id });
  const locationId: LocationId = brandLocationId(location!.id);
  const cfg = { locationId };
  await db.insert(kitchenStations).values({ locationId, name: "Cocina", isDefault: true });
  const zone = async (name: string, displayOrder: number) =>
    (
      await db
        .insert(floorZones)
        .values({ locationId, name, displayOrder })
        .returning({ id: floorZones.id })
    )[0]!.id;
  const barra = await zone("Barra", 0);
  const sala = await zone("Sala", 1);
  const terraza = await zone("Terraza", 2);
  const mostrador = await zone("Mostrador deli", 3);
  return scoped(async (tx) => {
    const restaurant = (
      await createDepartment(tx, cfg, { name: "Restaurant", defaultServiceMode: "table_tab" })
    ).id;
    const deli = (await createDepartment(tx, cfg, { name: "Deli", defaultServiceMode: "prepay" }))
      .id;
    for (const zoneId of [barra, sala, terraza])
      await configureZone(tx, cfg, { zoneId, departmentId: restaurant });
    await configureZone(tx, cfg, { zoneId: mostrador, departmentId: deli });
    const menu = async (name: string) => {
      const id = (await createCatalogue(tx, { name })).id;
      return { id, versionId: await publish(tx, id) };
    };
    const desayunos = await menu("Desayunos");
    const almuerzo = await menu("Almuerzo");
    const bebidas = await menu("Bebidas");
    const deliParaLlevar = await menu("Deli para llevar");
    return {
      cfg,
      restaurant,
      deli,
      barra,
      sala,
      terraza,
      mostrador,
      desayunos,
      almuerzo,
      bebidas,
      deliParaLlevar,
    };
  });
}

type Venue = Awaited<ReturnType<typeof venue>>;

const servedIds = async (v: Venue, zoneId: string) =>
  scoped(async (tx) => (await listZoneOffers(tx, v.cfg, zoneId)).menus.map((menu) => menu.id));
const defaultOf = async (v: Venue, zoneId: string) =>
  scoped(async (tx) => (await listZoneOffers(tx, v.cfg, zoneId)).defaultMenuId);

/** Restaurant lists Bebidas, Desayunos and Deli para llevar, with Bebidas its all-day default. */
async function restaurantWithDefault(v: Venue) {
  await scoped(async (tx) => {
    await setDepartmentMenus(tx, v.cfg, v.restaurant, [
      v.bebidas.id,
      v.desayunos.id,
      v.deliParaLlevar.id,
    ]);
    await setDepartmentAllDayMenu(tx, v.cfg, v.restaurant, v.bebidas.id);
  });
}

describe("a department's menu list", () => {
  it("is what every zone of the department serves, in its order, and only that department's", async () => {
    const v = await venue();
    await scoped((tx) =>
      setDepartmentMenus(tx, v.cfg, v.restaurant, [
        v.bebidas.id,
        v.desayunos.id,
        v.deliParaLlevar.id,
      ]),
    );
    const restaurantList = [v.bebidas.id, v.desayunos.id, v.deliParaLlevar.id];
    for (const zoneId of [v.barra, v.sala, v.terraza])
      expect(await servedIds(v, zoneId)).toEqual(restaurantList);
    expect(await servedIds(v, v.mostrador)).toEqual([]);

    await scoped((tx) => setDepartmentMenus(tx, v.cfg, v.deli, [v.deliParaLlevar.id]));
    expect(await servedIds(v, v.mostrador)).toEqual([v.deliParaLlevar.id]);
    for (const zoneId of [v.barra, v.sala, v.terraza])
      expect(await servedIds(v, zoneId)).toEqual(restaurantList);
    expect(await scoped((tx) => listDepartmentMenus(tx, v.cfg))).toEqual(
      expect.arrayContaining([
        { departmentId: v.restaurant, menuIds: restaurantList, allDayMenuId: null },
        { departmentId: v.deli, menuIds: [v.deliParaLlevar.id], allDayMenuId: null },
      ]),
    );
  });

  it("gives every zone the department's all-day default unless the zone overrides it", async () => {
    const v = await venue();
    await restaurantWithDefault(v);
    for (const zoneId of [v.barra, v.sala, v.terraza])
      expect(await defaultOf(v, zoneId)).toBe(v.bebidas.id);

    await scoped((tx) => setZoneAllDayMenu(tx, v.cfg, v.barra, v.desayunos.id));
    expect(await defaultOf(v, v.barra)).toBe(v.desayunos.id);
    expect(await defaultOf(v, v.sala)).toBe(v.bebidas.id);

    await scoped((tx) => setZoneAllDayMenu(tx, v.cfg, v.barra, null));
    expect(await defaultOf(v, v.barra)).toBe(v.bebidas.id);
  });

  it("refuses a default outside the department's list", async () => {
    const v = await venue();
    await restaurantWithDefault(v);
    await expect(
      scoped((tx) => setZoneAllDayMenu(tx, v.cfg, v.mostrador, v.bebidas.id)),
    ).rejects.toMatchObject({
      code: "department_menu.not_found",
      params: { departmentId: v.deli, menuId: v.bebidas.id },
    });
    await expect(
      scoped((tx) => setDepartmentAllDayMenu(tx, v.cfg, v.restaurant, v.almuerzo.id)),
    ).rejects.toMatchObject({
      code: "department_menu.not_found",
      params: { departmentId: v.restaurant, menuId: v.almuerzo.id },
    });
  });

  it("refuses to remove a menu a default still names, naming every use, inactive zones included", async () => {
    const v = await venue();
    await restaurantWithDefault(v);
    await scoped((tx) => setZoneAllDayMenu(tx, v.cfg, v.barra, v.bebidas.id));
    const withoutBebidas = [v.desayunos.id, v.deliParaLlevar.id];
    const inUse = {
      code: "department_menu.in_use",
      params: {
        departmentId: v.restaurant,
        menuId: v.bebidas.id,
        uses: [{ kind: "department_all_day" }, { kind: "zone_all_day", zoneId: v.barra }],
      },
    };
    await expect(
      scoped((tx) => setDepartmentMenus(tx, v.cfg, v.restaurant, withoutBebidas)),
    ).rejects.toMatchObject(inUse);
    expect(await servedIds(v, v.sala)).toEqual([v.bebidas.id, v.desayunos.id, v.deliParaLlevar.id]);

    await scoped((tx) => deactivateServiceZone(tx, v.cfg, v.barra));
    await expect(
      scoped((tx) => setDepartmentMenus(tx, v.cfg, v.restaurant, withoutBebidas)),
    ).rejects.toMatchObject(inUse);

    await scoped((tx) => setZoneAllDayMenu(tx, v.cfg, v.barra, null));
    await scoped((tx) => setDepartmentAllDayMenu(tx, v.cfg, v.restaurant, null));
    await scoped((tx) => setDepartmentMenus(tx, v.cfg, v.restaurant, withoutBebidas));
    expect(await servedIds(v, v.sala)).toEqual(withoutBebidas);
  });

  it("refuses an unknown menu, another venue's department and a menu named twice", async () => {
    const v = await venue();
    const other = await venue();
    const unknown = "00000000-0000-4000-8000-000000000099";
    await expect(
      scoped((tx) => setDepartmentMenus(tx, v.cfg, v.restaurant, [v.bebidas.id, unknown])),
    ).rejects.toMatchObject({ code: "catalogue.not_found", params: { catalogueId: unknown } });
    await expect(
      scoped((tx) => setDepartmentMenus(tx, v.cfg, other.restaurant, [v.bebidas.id])),
    ).rejects.toMatchObject({
      code: "department.not_found",
      params: { departmentId: other.restaurant },
    });
    await expect(
      scoped((tx) => setDepartmentMenus(tx, v.cfg, v.restaurant, [v.bebidas.id, v.bebidas.id])),
    ).rejects.toMatchObject({ code: "management.request_invalid", params: { field: "menuIds" } });
    expect(await scoped((tx) => listDepartmentMenus(tx, other.cfg))).toEqual(
      expect.arrayContaining([{ departmentId: other.restaurant, menuIds: [], allDayMenuId: null }]),
    );
  });

  it("refuses another venue's department or zone as the subject of a default, clearing included", async () => {
    const v = await venue();
    const other = await venue();
    await restaurantWithDefault(other);
    await scoped((tx) => setZoneAllDayMenu(tx, other.cfg, other.barra, other.desayunos.id));
    for (const menuId of [other.bebidas.id, null]) {
      await expect(
        scoped((tx) => setDepartmentAllDayMenu(tx, v.cfg, other.restaurant, menuId)),
      ).rejects.toMatchObject({
        code: "department.not_found",
        params: { departmentId: other.restaurant },
      });
      await expect(
        scoped((tx) => setZoneAllDayMenu(tx, v.cfg, other.barra, menuId)),
      ).rejects.toMatchObject({ code: "service_zone.not_found", params: { zoneId: other.barra } });
    }
    expect(await defaultOf(other, other.sala)).toBe(other.bebidas.id);
    expect(await defaultOf(other, other.barra)).toBe(other.desayunos.id);
  });

  it("appends a menu added without a position, and leaves a listed menu where it is", async () => {
    const v = await venue();
    await scoped((tx) =>
      setDepartmentMenus(tx, v.cfg, v.restaurant, [v.bebidas.id, v.desayunos.id]),
    );
    await scoped((tx) => addDepartmentMenu(tx, v.cfg, v.restaurant, v.almuerzo.id));
    const appended = [v.bebidas.id, v.desayunos.id, v.almuerzo.id];
    expect(await servedIds(v, v.sala)).toEqual(appended);
    await scoped((tx) => addDepartmentMenu(tx, v.cfg, v.restaurant, v.bebidas.id));
    expect(await servedIds(v, v.sala)).toEqual(appended);
    await scoped((tx) =>
      addDepartmentMenu(tx, v.cfg, v.restaurant, v.bebidas.id, { displayOrder: 9 }),
    );
    expect(await servedIds(v, v.sala)).toEqual([v.desayunos.id, v.almuerzo.id, v.bebidas.id]);
  });

  it("keeps the defaults when the list is reordered", async () => {
    const v = await venue();
    await restaurantWithDefault(v);
    await scoped((tx) => setZoneAllDayMenu(tx, v.cfg, v.barra, v.desayunos.id));
    const reordered = [v.deliParaLlevar.id, v.bebidas.id, v.desayunos.id];
    await scoped((tx) => setDepartmentMenus(tx, v.cfg, v.restaurant, reordered));
    expect(await servedIds(v, v.sala)).toEqual(reordered);
    expect(await defaultOf(v, v.sala)).toBe(v.bebidas.id);
    expect(await defaultOf(v, v.barra)).toBe(v.desayunos.id);
    expect(
      (await scoped((tx) => listDepartmentMenus(tx, v.cfg))).find(
        (row) => row.departmentId === v.restaurant,
      ),
    ).toEqual({ departmentId: v.restaurant, menuIds: reordered, allDayMenuId: v.bebidas.id });
  });

  it("drops a zone's override when the zone moves to another department, and serves that department's list", async () => {
    const v = await venue();
    await restaurantWithDefault(v);
    await scoped(async (tx) => {
      await setDepartmentMenus(tx, v.cfg, v.deli, [v.deliParaLlevar.id]);
      await setZoneAllDayMenu(tx, v.cfg, v.barra, v.desayunos.id);
    });
    const left = await scoped(async (tx) => {
      await configureZone(tx, v.cfg, { zoneId: v.barra, departmentId: v.deli });
      return (
        await tx.execute(sql`select menu_id from zone_all_day_menus where zone_id = ${v.barra}`)
      ).rows;
    });
    expect(left).toEqual([]);
    expect(await servedIds(v, v.barra)).toEqual([v.deliParaLlevar.id]);
  });

  it("stops serving a removed menu, and refuses a line asserting its version", async () => {
    const v = await venue();
    await restaurantWithDefault(v);
    await scoped((tx) => setDepartmentMenus(tx, v.cfg, v.restaurant, [v.bebidas.id]));
    expect(await servedIds(v, v.sala)).toEqual([v.bebidas.id]);
    await expect(
      scoped((tx) =>
        listZoneOffers(tx, v.cfg, v.sala, {
          asserted: [{ menuId: v.desayunos.id, versionId: v.desayunos.versionId }],
        }),
      ),
    ).rejects.toMatchObject({
      code: "menu.version_changed",
      params: { menus: [{ menuId: v.desayunos.id, liveVersionId: null }] },
    });
  });

  it("reports each active zone with no all-day default of its own or its department's", async () => {
    const v = await venue();
    await scoped((tx) => setDepartmentMenus(tx, v.cfg, v.restaurant, [v.bebidas.id]));
    const missing = async () =>
      (await scoped((tx) => listVenueReadiness(tx, v.cfg))).filter(
        (issue) => issue.code === "zone.menu_missing",
      );
    const missingIn = (zoneId: string, zoneName: string) => ({
      code: "zone.menu_missing",
      zoneId,
      zoneName,
    });
    expect(await missing()).toEqual([
      missingIn(v.barra, "Barra"),
      missingIn(v.sala, "Sala"),
      missingIn(v.terraza, "Terraza"),
      missingIn(v.mostrador, "Mostrador deli"),
    ]);
    await scoped((tx) => setZoneAllDayMenu(tx, v.cfg, v.sala, v.bebidas.id));
    expect(await missing()).toEqual([
      missingIn(v.barra, "Barra"),
      missingIn(v.terraza, "Terraza"),
      missingIn(v.mostrador, "Mostrador deli"),
    ]);
  });
});

describe("the department menu routes", () => {
  const noopLog: Logger = () => {};

  async function routed() {
    const v = await venue();
    await seedTenant(db);
    const [manager, staff] = await scoped(async (tx) => {
      const person = async (role: "manager" | "staff") =>
        (
          await tx
            .insert(persons)
            .values({
              displayName: `${role} ${v.cfg.locationId}`,
              pinHash: hashPin("1234"),
              role,
            })
            .returning({ id: persons.id })
        )[0]!.id;
      const managerId = await person("manager");
      const staffId = await person("staff");
      return [
        (await startManagementSession(tx, { personId: managerId })).token,
        (await startManagementSession(tx, { personId: staffId })).token,
      ];
    });
    const app = new Hono();
    VENUE_SERVICE_ROUTES.mount(
      app,
      { db, cfg: v.cfg, core: {} as ModuleRouteContext["core"] },
      noopLog,
    );
    const send = (cookie: string, path: string, body: unknown) =>
      app.request(path, {
        method: "PUT",
        headers: { cookie: `${MANAGEMENT_COOKIE}=${cookie}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    return { ...v, manager: manager!, staff: staff!, send };
  }

  const departmentMenus = (departmentId: string) =>
    `/management-api/venue-service/departments/${departmentId}/menus`;
  const departmentAllDay = (departmentId: string) =>
    `/management-api/venue-service/departments/${departmentId}/all-day-menu`;
  const zoneAllDay = (zoneId: string) =>
    `/management-api/venue-service/zones/${zoneId}/all-day-menu`;

  it("set the list and both all-day defaults for a manager who manages venue service, and refuse anyone else", async () => {
    const r = await routed();
    const writes: [string, unknown][] = [
      [departmentMenus(r.restaurant), { menuIds: [r.bebidas.id, r.desayunos.id] }],
      [departmentAllDay(r.restaurant), { menuId: r.bebidas.id }],
      [zoneAllDay(r.barra), { menuId: r.desayunos.id }],
    ];
    for (const [path, body] of writes) expect((await r.send(r.staff, path, body)).status).toBe(403);
    expect(await scoped((tx) => listDepartmentMenus(tx, r.cfg))).toEqual(
      expect.arrayContaining([{ departmentId: r.restaurant, menuIds: [], allDayMenuId: null }]),
    );
    for (const [path, body] of writes)
      expect((await r.send(r.manager, path, body)).status).toBe(204);
    expect(await servedIds(r, r.sala)).toEqual([r.bebidas.id, r.desayunos.id]);
    expect(await defaultOf(r, r.sala)).toBe(r.bebidas.id);
    expect(await defaultOf(r, r.barra)).toBe(r.desayunos.id);

    expect((await r.send(r.manager, zoneAllDay(r.barra), { menuId: null })).status).toBe(204);
    expect((await r.send(r.manager, departmentAllDay(r.restaurant), { menuId: null })).status).toBe(
      204,
    );
    expect(await defaultOf(r, r.barra)).toBeNull();
  });

  it("answer 404 for a menu outside the list and 409 for removing one in use, with their params", async () => {
    const r = await routed();
    await restaurantWithDefault(r);
    const notFound = await r.send(r.manager, zoneAllDay(r.mostrador), { menuId: r.bebidas.id });
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toEqual({
      error: {
        code: "department_menu.not_found",
        params: { departmentId: r.deli, menuId: r.bebidas.id },
      },
    });
    const inUse = await r.send(r.manager, departmentMenus(r.restaurant), {
      menuIds: [r.desayunos.id],
    });
    expect(inUse.status).toBe(409);
    expect(await inUse.json()).toEqual({
      error: {
        code: "department_menu.in_use",
        params: {
          departmentId: r.restaurant,
          menuId: r.bebidas.id,
          uses: [{ kind: "department_all_day" }],
        },
      },
    });
  });

  it("clear an inactive zone's override through the zone route, which lets the menu go", async () => {
    const r = await routed();
    await restaurantWithDefault(r);
    await scoped(async (tx) => {
      await setDepartmentAllDayMenu(tx, r.cfg, r.restaurant, null);
      await setZoneAllDayMenu(tx, r.cfg, r.barra, r.bebidas.id);
      await deactivateServiceZone(tx, r.cfg, r.barra);
    });
    const remaining = { menuIds: [r.desayunos.id, r.deliParaLlevar.id] };
    expect((await r.send(r.manager, departmentMenus(r.restaurant), remaining)).status).toBe(409);
    expect((await r.send(r.manager, zoneAllDay(r.barra), { menuId: null })).status).toBe(204);
    expect((await r.send(r.manager, departmentMenus(r.restaurant), remaining)).status).toBe(204);
  });

  it("refuse a malformed body naming the field", async () => {
    const r = await routed();
    for (const [path, body, field] of [
      [departmentMenus(r.restaurant), { menuIds: [r.bebidas.id, r.bebidas.id] }, "menuIds"],
      [departmentMenus(r.restaurant), { menuIds: ["not-a-uuid"] }, "menuIds"],
      [departmentMenus(r.restaurant), {}, "menuIds"],
      [departmentAllDay(r.restaurant), {}, "menuId"],
      [zoneAllDay(r.barra), { menuId: "not-a-uuid" }, "menuId"],
    ] as const) {
      const refused = await r.send(r.manager, path, body);
      expect(refused.status, `${path} ${JSON.stringify(body)}`).toBe(400);
      expect(await refused.json()).toEqual({
        error: { code: "management.request_invalid", params: { field } },
      });
    }
  });
});
