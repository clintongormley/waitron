import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  deviceProfiles,
  workingOrderLines,
  workingOrders,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { addProductToMenu, createCatalogue, createProduct } from "@waitron/catalogue";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin, loginWithPin, persons } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
} from "@waitron/shared";
import {
  createDepartment,
  createServiceZone,
  orderServiceContexts,
  replaceMenuWeek,
  saveMenuPeriod,
  setDepartmentAllDayMenu,
  setDepartmentMenus,
  setProfileServiceAccess,
  setZonePeriodMenu,
  workingLineContexts,
  type MenuSlot,
} from "@waitron/venue-service";
import { nifWithControlLetter } from "@waitron/fiscal-verifactu/src/testing/seed.js";
import { deploymentEnvironment } from "./config.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { ALL_MODULES } from "./modules.js";
import { mountTillApi } from "./till-api.js";
import type { TillConfig } from "./till-config.js";
import { SESSION_COOKIE } from "./till-session.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { BASIC_ACTIONS } from "./testing/session-device.js";

// Browsing follows the department's menu timetable; ordering accepts any menu on the department's
// list, whatever the timetable says, and only those.

const LOCALE = "es-ES";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

/** Monday 5 October 2026 in Madrid, which is on UTC+2 that day. */
const MONDAY_10_00 = new Date("2026-10-05T08:00:00Z");
const MONDAY_12_30 = new Date("2026-10-05T10:30:00Z");
const MONDAY_13_00 = new Date("2026-10-05T11:00:00Z");

let backend: FiscalBackend;
let clock: TrustedClock;

beforeAll(() => {
  clock = {
    now: () => {
      const instant = new Date();
      return {
        instant,
        offsetMinutes: -instant.getTimezoneOffset(),
        confident: true,
        confidence: "anchored",
        anchorAgeSeconds: 0,
      };
    },
    anchor: () => {
      throw new Error("till-api.menu-timetable.test: anchor() is not used");
    },
    currentAnchor: () => null,
  };
  backend = new VerifactuBackend({
    clock,
    db: suite.db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () =>
      Promise.reject(new Error("till-api.menu-timetable.test: resolveClient is never called")),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const at = (instant: Date) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(instant);
};

let nifCounter = 0;
const nextNif = () => nifWithControlLetter(71_000_000 + ++nifCounter);

const MENUS = ["Desayunos", "Almuerzo", "Bebidas", "Café", "Deli para llevar"] as const;
type MenuName = (typeof MENUS)[number];

interface Venue {
  cfg: TillConfig;
  app: Hono;
  cookie: string;
  restaurant: string;
  deli: string;
  barra: string;
  sala: string;
  terraza: string;
  mostrador: string;
  menus: Record<MenuName, string>;
  versions: Record<MenuName, string>;
  /** Tostada on Desayunos (2.50) and on Almuerzo (4.00); its own price is 3.00. */
  tostada: { desayunos: string; almuerzo: string };
  /** Bocadillo on Deli para llevar. */
  bocadillo: string;
}

const slot = (periodId: string, startsAt: string, endsAt: string): MenuSlot => ({
  periodId,
  startsAt,
  endsAt,
});

/**
 * A provisioned venue with Restaurant (Barra, Sala, Terraza) listing Desayunos, Almuerzo, Bebidas
 * and Café, all-day Bebidas, and Deli (Mostrador deli) listing Deli para llevar. With `timetable`,
 * Restaurant runs Mañanas (Desayunos) 09:00–12:00 and Mediodía (Almuerzo) 12:00–16:00 every day,
 * and Barra serves Café for Mañanas. Ana's till has a Restaurant profile starting at Barra.
 */
async function setupVenue(options: { timetable: boolean }): Promise<Venue> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Casa Delgado SL",
        location: {
          name: "Casa Delgado",
          fiscalTerritory: "ES-common",
          invoiceLocales: [LOCALE],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administradora",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );
  const cfg: TillConfig = {
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
  const seeded = await withTransaction(suite.db, async (tx) => {
    const restaurant = (
      await createDepartment(tx, cfg, { name: "Restaurant", defaultServiceMode: "prepay" })
    ).id;
    const deli = (await createDepartment(tx, cfg, { name: "Deli", defaultServiceMode: "prepay" }))
      .id;
    const zone = async (name: string, departmentId: string) =>
      (await createServiceZone(tx, cfg, { name, departmentId })).id;
    const barra = await zone("Barra", restaurant);
    const sala = await zone("Sala", restaurant);
    const terraza = await zone("Terraza", restaurant);
    const mostrador = await zone("Mostrador deli", deli);
    const menus = {} as Record<MenuName, string>;
    for (const name of MENUS) menus[name] = (await createCatalogue(tx, { name })).id;
    const product = (catalogueId: string, name: string, unitPrice: string) =>
      createProduct(tx, {
        catalogueId,
        categoryId: null,
        name,
        pricingUnit: "each",
        unitPrice,
        vatClass: "general",
      });
    const tostada = await product(menus.Desayunos, "Tostada", "3.00");
    const offer = async (menu: MenuName, productId: string, grossPrice?: string) =>
      (await addProductToMenu(tx, { menuId: menus[menu], productId, grossPrice })).id;
    const tostadaOffers = {
      desayunos: await offer("Desayunos", tostada.id, "2.50"),
      almuerzo: await offer("Almuerzo", tostada.id, "4.00"),
    };
    await offer("Café", (await product(menus["Café"], "Cortado", "1.60")).id);
    await offer("Bebidas", (await product(menus.Bebidas, "Agua", "2.00")).id);
    const bocadillo = await offer(
      "Deli para llevar",
      (await product(menus["Deli para llevar"], "Bocadillo", "6.50")).id,
    );
    const versions = {} as Record<MenuName, string>;
    for (const name of MENUS) versions[name] = await publishWorkingMenu(tx, menus[name]);
    await setDepartmentMenus(tx, cfg, restaurant, [
      menus.Desayunos,
      menus.Almuerzo,
      menus.Bebidas,
      menus["Café"],
    ]);
    await setDepartmentAllDayMenu(tx, cfg, restaurant, menus.Bebidas);
    await setDepartmentMenus(tx, cfg, deli, [menus["Deli para llevar"]]);
    await setDepartmentAllDayMenu(tx, cfg, deli, menus["Deli para llevar"]);
    if (options.timetable) {
      const period = async (name: string, menu: MenuName) =>
        (await saveMenuPeriod(tx, cfg, restaurant, { id: null, name, menuId: menus[menu] })).id;
      const mananas = await period("Mañanas", "Desayunos");
      const mediodia = await period("Mediodía", "Almuerzo");
      await replaceMenuWeek(
        tx,
        cfg,
        restaurant,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots: [slot(mananas, "09:00", "12:00"), slot(mediodia, "12:00", "16:00")],
        })),
        MONDAY_10_00,
      );
      await setZonePeriodMenu(tx, cfg, barra, mananas, menus["Café"]);
    }
    const [person] = await tx
      .insert(persons)
      .values({ displayName: "Ana", pinHash: hashPin("5555"), role: "staff" })
      .returning({ id: persons.id });
    return {
      restaurant,
      deli,
      barra,
      sala,
      terraza,
      mostrador,
      menus,
      versions,
      tostada: tostadaOffers,
      bocadillo,
      personId: person!.id,
    };
  });
  const [profile] = await suite.db
    .insert(deviceProfiles)
    .values({
      name: `Till ${randomUUID()}`,
      formFactor: "till",
      capabilities: [...BASIC_ACTIONS, "take-cash"],
    })
    .returning({ id: deviceProfiles.id });
  await withTransaction(suite.db, (tx) =>
    setProfileServiceAccess(tx, cfg, profile!.id, {
      departmentId: seeded.restaurant,
      allowedZoneIds: null,
      startingZoneId: seeded.barra,
      stationIds: [],
      watcherIds: [],
    }),
  );
  const device = await enrolDeviceForTest(suite.db, cfg, {
    name: `Till ${randomUUID()}`,
    profileId: profile!.id,
  });
  const session = await withTransaction(suite.db, (tx) =>
    loginWithPin(tx, { deviceId: device.deviceId, personId: seeded.personId, pin: "5555" }),
  );
  const app = new Hono();
  mountTillApi(
    app,
    { db: suite.db, backend, clock, cfg, secureCookies: false, venueLocale: LOCALE },
    () => {},
  );
  return {
    cfg,
    app,
    cookie: `${SESSION_COOKIE}=${session.token}; ${DEVICE_COOKIE}=${device.deviceId}.${device.token}`,
    ...seeded,
  };
}

async function send(
  v: Venue,
  method: string,
  path: string,
  body?: object,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await v.app.request(path, {
    method,
    headers: { "content-type": "application/json", cookie: v.cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text === "" ? {} : JSON.parse(text) };
}

const park = (v: Venue, zoneId: string, menuItemId: string, menuVersionId?: string) => {
  const id = randomUUID();
  return send(v, "POST", "/api/working-orders", {
    id,
    zoneId,
    lines: [
      { menuItemId, quantity: "1", ...(menuVersionId === undefined ? {} : { menuVersionId }) },
    ],
  }).then((answer) => ({ ...answer, id }));
};

const linesOf = (tx: Transaction, workingOrderId: string) =>
  tx
    .select({
      id: workingOrderLines.id,
      unitPriceGross: workingOrderLines.unitPriceGross,
      menuName: workingLineContexts.menuName,
      menuVersionId: workingLineContexts.menuVersionId,
      departmentId: workingLineContexts.departmentId,
    })
    .from(workingOrderLines)
    .innerJoin(
      workingLineContexts,
      eq(workingLineContexts.workingOrderLineId, workingOrderLines.id),
    )
    .where(eq(workingOrderLines.workingOrderId, workingOrderId));

describe("ordering stays membership-only while browsing follows the timetable", () => {
  it("prices a Desayunos line at Desayunos's price after its period has ended", async () => {
    const v = await setupVenue({ timetable: true });
    at(MONDAY_13_00);
    const offers = await send(v, "GET", `/api/service-zones/${v.sala}/offers`);
    expect(offers.body).toMatchObject({ defaultMenuId: v.menus.Almuerzo });

    const parked = await park(v, v.sala, v.tostada.desayunos, v.versions.Desayunos);
    expect(parked.status).toBe(200);
    const lines = await withTransaction(suite.db, (tx) => linesOf(tx, parked.id));
    expect(lines).toMatchObject([{ unitPriceGross: 250, menuName: "Desayunos" }]);
  });

  it("sells another department's menu in its own zones once it is on the department's list, and only then", async () => {
    const v = await setupVenue({ timetable: true });
    at(MONDAY_13_00);
    await withTransaction(suite.db, (tx) =>
      setDepartmentMenus(tx, v.cfg, v.restaurant, [
        v.menus.Desayunos,
        v.menus.Almuerzo,
        v.menus.Bebidas,
        v.menus["Café"],
        v.menus["Deli para llevar"],
      ]),
    );
    const parked = await park(v, v.barra, v.bocadillo);
    expect(parked.status).toBe(200);
    const recorded = await withTransaction(suite.db, async (tx) => ({
      order: await tx
        .select({ departmentId: orderServiceContexts.departmentId })
        .from(orderServiceContexts)
        .where(eq(orderServiceContexts.workingOrderId, parked.id)),
      lines: await linesOf(tx, parked.id),
    }));
    expect(recorded.order).toEqual([{ departmentId: v.restaurant }]);
    expect(recorded.lines).toMatchObject([
      { departmentId: v.restaurant, menuName: "Deli para llevar" },
    ]);

    expect(await send(v, "GET", `/api/service-zones/${v.mostrador}/offers`)).toEqual({
      status: 403,
      body: { error: { code: "service_zone.not_allowed", params: { zoneId: v.mostrador } } },
    });

    await withTransaction(suite.db, (tx) =>
      setDepartmentMenus(tx, v.cfg, v.restaurant, [
        v.menus.Desayunos,
        v.menus.Almuerzo,
        v.menus.Bebidas,
        v.menus["Café"],
      ]),
    );
    const refused = await park(v, v.barra, v.bocadillo);
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({
      error: {
        code: "service_zone.offer_not_allowed",
        params: { zoneId: v.barra, menuItemId: v.bocadillo },
      },
    });
  });

  it("refuses a line asserting a menu the department no longer lists, and leaves the lines already held as they were", async () => {
    const v = await setupVenue({ timetable: false });
    at(MONDAY_10_00);
    const offers = (await send(v, "GET", `/api/service-zones/${v.sala}/offers`)).body as {
      menus: { id: string; versionId: string }[];
    };
    const desayunos = offers.menus.find((menu) => menu.id === v.menus.Desayunos)!.versionId;
    const held = await park(v, v.sala, v.tostada.desayunos, desayunos);
    expect(held.status).toBe(200);
    const before = await withTransaction(suite.db, (tx) => linesOf(tx, held.id));
    expect(before).toMatchObject([
      { unitPriceGross: 250, menuName: "Desayunos", menuVersionId: desayunos },
    ]);

    await withTransaction(suite.db, (tx) =>
      setDepartmentMenus(tx, v.cfg, v.restaurant, [
        v.menus.Almuerzo,
        v.menus.Bebidas,
        v.menus["Café"],
      ]),
    );
    const order = (await send(v, "GET", `/api/working-orders/${held.id}`)).body as {
      revision: number;
      lines: { workingOrderLineId: string; menuItemId: string; quantity: string }[];
    };
    const added = await send(v, "PUT", `/api/working-orders/${held.id}`, {
      revision: order.revision,
      lines: [
        ...order.lines.map(({ workingOrderLineId, menuItemId, quantity }) => ({
          workingOrderLineId,
          menuItemId,
          quantity,
        })),
        { menuItemId: v.tostada.desayunos, quantity: "1", menuVersionId: desayunos },
      ],
    });
    expect(added).toEqual({
      status: 409,
      body: {
        error: {
          code: "menu.version_changed",
          params: { menus: [{ menuId: v.menus.Desayunos, liveVersionId: null }] },
        },
      },
    });
    expect(await withTransaction(suite.db, (tx) => linesOf(tx, held.id))).toEqual(before);

    const paid = await send(v, "POST", "/api/sales", {
      workingOrderId: held.id,
      lines: [],
      tender: { method: "cash", amount: "5.00" },
    });
    expect(paid.status).toBe(200);
    expect(paid.body).toMatchObject({ total: "2.50", tender: { method: "cash", change: "2.50" } });
    const [settled] = await suite.db
      .select({ status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.id, held.id));
    expect(settled).toEqual({ status: "settled" });
  });
});

describe("GET /api/menu-state", () => {
  const defaultMenu = async (v: Venue, query: string) => {
    const answer = await send(v, "GET", `/api/menu-state${query}`);
    expect(answer.status).toBe(200);
    return answer.body.defaultMenuId;
  };

  it("names the zone's default menu at the moment it is read", async () => {
    const v = await setupVenue({ timetable: true });
    at(MONDAY_10_00);
    expect(await defaultMenu(v, `?zoneId=${v.barra}`)).toBe(v.menus["Café"]);
    expect(await defaultMenu(v, `?zoneId=${v.sala}`)).toBe(v.menus.Desayunos);
    vi.setSystemTime(MONDAY_12_30);
    expect(await defaultMenu(v, `?zoneId=${v.barra}`)).toBe(v.menus.Almuerzo);
  });

  it("names the starting zone's default when no zone is asked for", async () => {
    const v = await setupVenue({ timetable: true });
    at(MONDAY_10_00);
    expect(await defaultMenu(v, "")).toBe(v.menus["Café"]);
  });
});
