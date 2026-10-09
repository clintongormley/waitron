import { offerMenuThroughZone } from "@waitron/venue-service/testing/zone-menus.js";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  deviceProfiles,
  locations,
  parties,
  workingOrderLines,
  workingOrders,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  addProductToMenu,
  createCatalogue,
  createProduct,
  createExtraList,
  writeProductModifiers,
  deactivateCatalogue,
} from "@waitron/catalogue";
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
  departments,
  createServiceZone,
  deleteMenuPeriod,
  menuPeriods,
  orderServiceContexts,
  replaceMenuWeek,
  saveMenuPeriod,
  updateMenuPeriod,
  setProfileServiceAccess,
  workingLineContexts,
  type MenuSlot,
} from "@waitron/venue-service";
import { nifWithControlLetter } from "@waitron/fiscal-verifactu/src/testing/seed.js";
import { VENUE_SERVICE } from "./modules.js";
import { createTable } from "./tables.js";
import { deploymentEnvironment } from "./config.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { ALL_MODULES } from "./modules.js";
import { mountTillApi } from "./till-api.js";
import type { TillConfig } from "./till-config.js";
import { SESSION_COOKIE } from "./till-session.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { BASIC_ACTIONS } from "./testing/session-device.js";

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
      throw new Error("till-api.service-periods.test: anchor() is not used");
    },
    currentAnchor: () => null,
  };
  backend = new VerifactuBackend({
    clock,
    db: suite.db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () =>
      Promise.reject(new Error("till-api.service-periods.test: resolveClient is never called")),
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
    for (const departmentId of [restaurant, deli]) {
      const initialPeriods = await tx
        .select({ id: menuPeriods.id })
        .from(menuPeriods)
        .where(eq(menuPeriods.departmentId, departmentId));
      await replaceMenuWeek(
        tx,
        cfg,
        departmentId,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, slots: [] })),
        MONDAY_10_00,
      );
      for (const period of initialPeriods) await deleteMenuPeriod(tx, cfg, period.id);
    }
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
    await offerMenuThroughZone(tx, cfg, mostrador, menus["Deli para llevar"], {
      makeDefault: true,
    });
    if (options.timetable) {
      const period = async (name: string, menu: MenuName) =>
        (
          await saveMenuPeriod(tx, cfg, restaurant, {
            name,
            menuId: menus[menu],
            staffMenuIds: [menus.Bebidas, menus["Café"]],
          })
        ).id;
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
    } else {
      await offerMenuThroughZone(tx, cfg, barra, menus.Bebidas, { makeDefault: true });
      for (const menu of [menus.Desayunos, menus.Almuerzo, menus["Café"]])
        await offerMenuThroughZone(tx, cfg, barra, menu);
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

async function replacePeriodMembership(
  tx: Transaction,
  cfg: TillConfig,
  departmentId: string,
  menuIds: readonly string[],
) {
  const periods = await tx
    .select({ id: menuPeriods.id, menuId: menuPeriods.menuId })
    .from(menuPeriods)
    .where(eq(menuPeriods.departmentId, departmentId));
  for (const period of periods)
    await updateMenuPeriod(tx, cfg, period.id, {
      staffMenuIds: menuIds.filter((id) => id !== period.menuId),
    });
}

describe("ordering uses period membership while browsing follows the timetable", () => {
  it("keeps a stored Desayunos line at its published price after its period has ended", async () => {
    const v = await setupVenue({ timetable: true });
    at(MONDAY_10_00);
    const parked = await park(v, v.sala, v.tostada.desayunos, v.versions.Desayunos);
    expect(parked.status).toBe(200);
    at(MONDAY_13_00);
    const offers = await send(v, "GET", `/api/service-zones/${v.sala}/offers`);
    expect(offers.body).toMatchObject({ defaultMenuId: v.menus.Almuerzo });
    expect((await editMealLine(v, parked.id, { note: "No salt" })).status).toBe(200);
    const lines = await withTransaction(suite.db, (tx) => linesOf(tx, parked.id));
    expect(lines).toMatchObject([{ unitPriceGross: 250, menuName: "Desayunos" }]);
  });

  it("sells another department's menu in its own zones once it is in the department's periods, and only then", async () => {
    const v = await setupVenue({ timetable: true });
    at(MONDAY_13_00);
    await withTransaction(suite.db, (tx) =>
      replacePeriodMembership(tx, v.cfg, v.restaurant, [
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
      replacePeriodMembership(tx, v.cfg, v.restaurant, [
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

  it("refuses a line asserting a menu removed from the department's periods, and leaves the lines already held as they were", async () => {
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
      replacePeriodMembership(tx, v.cfg, v.restaurant, [
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

async function mealVenue(weekdays: readonly number[] = [1]): Promise<Venue> {
  const v = await setupVenue({ timetable: true });
  await withTransaction(suite.db, async (tx) => {
    const periods = await tx
      .select()
      .from(menuPeriods)
      .where(eq(menuPeriods.departmentId, v.restaurant));
    const lunch = periods.find((period) => period.menuId === v.menus.Almuerzo)!;
    const dinner = periods.find((period) => period.menuId === v.menus.Desayunos)!;
    await updateMenuPeriod(tx, v.cfg, lunch.id, { name: "Lunch" });
    await updateMenuPeriod(tx, v.cfg, dinner.id, { name: "Dinner" });
    await replaceMenuWeek(
      tx,
      v.cfg,
      v.restaurant,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        slots: weekdays.includes(weekday)
          ? [slot(lunch.id, "12:00", "14:00"), slot(dinner.id, "19:00", "23:00")]
          : [],
      })),
      MONDAY_10_00,
    );
  });
  return v;
}

const mondayAt = (time: string) => new Date(`2026-10-05T${time}:00+02:00`);

async function editMealLine(v: Venue, id: string, patch: { quantity?: string; note?: string }) {
  const read = await send(v, "GET", `/api/working-orders/${id}`);
  expect(read.status).toBe(200);
  const order = read.body as {
    revision: number;
    lines: {
      workingOrderLineId: string;
      menuItemId: string;
      quantity: string;
      note: string | null;
    }[];
  };
  return send(v, "PUT", `/api/working-orders/${id}`, {
    revision: order.revision,
    lines: order.lines.map(({ workingOrderLineId, menuItemId, quantity, note }) => ({
      workingOrderLineId,
      menuItemId,
      quantity,
      ...(note === null ? {} : { note }),
      ...patch,
    })),
  });
}

describe("service periods gate only added dishes and added stored quantities", () => {
  const offsetLunch = async (v: Venue, offset: number) =>
    withTransaction(suite.db, async (tx) => {
      const [lunch] = await tx
        .select({ id: menuPeriods.id })
        .from(menuPeriods)
        .where(eq(menuPeriods.menuId, v.menus.Almuerzo));
      await updateMenuPeriod(tx, v.cfg, lunch!.id, { endOffsetMinutes: offset });
    });

  it.each([
    [-15, "13:44", 200],
    [-15, "13:45", 400],
    [15, "14:00", 200],
    [15, "14:14", 200],
    [15, "14:15", 400],
  ] as const)("end-offset %s gates fresh Lunch at %s with %s", async (offset, time, status) => {
    at(mondayAt("13:00"));
    const v = await mealVenue();
    await offsetLunch(v, offset);
    at(mondayAt(time));
    const held = await park(v, v.sala, v.tostada.almuerzo, v.versions.Almuerzo);
    expect(held.status).toBe(status);
    if (status === 400)
      expect(held.body).toMatchObject({
        error: {
          code: "menu_period.not_running",
          params: { departmentId: v.restaurant, menuId: v.menus.Almuerzo },
        },
      });
    else
      expect(await withTransaction(suite.db, (tx) => linesOf(tx, held.id))).toMatchObject([
        { unitPriceGross: 400, menuName: "Almuerzo", menuVersionId: v.versions.Almuerzo },
      ]);
  });

  it("end-offset permits fresh Lunch in grace while refusing a stored increase without changes", async () => {
    at(mondayAt("13:50"));
    const v = await mealVenue();
    await offsetLunch(v, 15);
    const held = await park(v, v.sala, v.tostada.almuerzo);
    expect(held.status).toBe(200);
    const before = await send(v, "GET", `/api/working-orders/${held.id}`);
    at(mondayAt("14:05"));
    expect((await park(v, v.sala, v.tostada.almuerzo)).status).toBe(200);
    const otherRoot = await park(v, v.sala, v.tostada.desayunos);
    expect(otherRoot).toMatchObject({
      status: 400,
      body: { error: { code: "menu_period.not_running", params: { menuId: v.menus.Desayunos } } },
    });
    expect(await editMealLine(v, held.id, { quantity: "2" })).toEqual({
      status: 400,
      body: {
        error: {
          code: "menu_period.not_running",
          params: { departmentId: v.restaurant, menuId: v.menus.Almuerzo },
        },
      },
    });
    expect(await send(v, "GET", `/api/working-orders/${held.id}`)).toEqual(before);
    expect((await editMealLine(v, held.id, { note: "No salt" })).status).toBe(200);
  });

  it("end-offset sends a saved unsent table draft in grace and replays the same submission after expiry", async () => {
    at(mondayAt("13:50"));
    const v = await mealVenue();
    await offsetLunch(v, 15);
    await suite.db
      .update(departments)
      .set({ defaultServiceMode: "table_tab" })
      .where(eq(departments.id, v.restaurant));
    const { id: tableId } = await withTransaction(suite.db, (tx) =>
      createTable(tx, v.cfg, { label: "Grace table", zoneId: v.sala }),
    );
    const seated = await send(v, "POST", `/api/tables/${tableId}/seat`, { guestCount: 2 });
    expect(seated.status).toBe(200);
    const { partyId, tabId } = seated.body as { partyId: string; tabId: string };
    const saved = await send(v, "PUT", `/api/parties/${partyId}/drafts`, {
      draftId: null,
      revision: 0,
      lines: [
        {
          clientLineId: randomUUID(),
          menuItemId: v.tostada.almuerzo,
          quantity: "1",
          menuVersionId: v.versions.Almuerzo,
        },
      ],
    });
    expect(saved.status).toBe(200);
    const draft = saved.body as { id: string; revision: number; lines: { id: string }[] };
    const [party] = await suite.db
      .select({ revision: parties.revision })
      .from(parties)
      .where(eq(parties.id, partyId));
    const body = {
      submissionId: randomUUID(),
      draftRevision: draft.revision,
      expectedPartyRevision: party!.revision,
      groups: [{ lineIds: draft.lines.map((line) => line.id), release: "fire" }],
    };
    at(mondayAt("14:05"));
    const submitted = await send(
      v,
      "POST",
      `/api/parties/${partyId}/drafts/${draft.id}/submit`,
      body,
    );
    expect(submitted.status).toBe(200);
    expect(await withTransaction(suite.db, (tx) => linesOf(tx, tabId))).toMatchObject([
      { unitPriceGross: 400, menuVersionId: v.versions.Almuerzo },
    ]);
    at(mondayAt("14:15"));
    expect(
      await send(v, "POST", `/api/parties/${partyId}/drafts/${draft.id}/submit`, body),
    ).toEqual(submitted);
    expect(await withTransaction(suite.db, (tx) => linesOf(tx, tabId))).toHaveLength(1);
  });

  it.each([
    [-15, "13:45", true, false, false],
    [15, "14:05", false, false, true],
    [15, "14:15", false, false, false],
  ] as const)(
    "end-offset polling carries eligibility at %s/%s",
    async (offset, time, open, orderable, sendable) => {
      at(mondayAt("13:00"));
      const v = await mealVenue();
      await offsetLunch(v, offset);
      at(mondayAt(time));
      const state = await send(v, "GET", `/api/menu-state?zoneId=${v.barra}`);
      expect(state.status).toBe(200);
      expect(state.body).toMatchObject({
        service: { open, periodName: open ? "Lunch" : null },
        menus: expect.arrayContaining([
          expect.objectContaining({
            menuId: v.menus.Almuerzo,
            versionId: v.versions.Almuerzo,
            orderable,
            sendable,
          }),
        ]),
      });
      const offers = await send(v, "GET", `/api/service-zones/${v.barra}/offers`);
      expect(offers.status).toBe(200);
      expect(offers.body).toMatchObject({
        menus: expect.arrayContaining([
          expect.objectContaining({ id: v.menus.Almuerzo, orderable, sendable }),
        ]),
      });
    },
  );

  it.each(["13:50", "17:00"])(
    "accepts Lunch only during its period at %s, preserving its published price",
    async (time) => {
      at(mondayAt(time));
      const v = await mealVenue();
      const held = await park(v, v.sala, v.tostada.almuerzo, v.versions.Almuerzo);
      if (time === "17:00") {
        expect(held).toMatchObject({
          status: 400,
          body: {
            error: {
              code: "menu_period.not_running",
              params: {
                departmentId: v.restaurant,
                menuId: v.menus.Almuerzo,
              },
            },
          },
        });
        expect(await withTransaction(suite.db, (tx) => linesOf(tx, held.id))).toEqual([]);
        return;
      }
      expect(held.status).toBe(200);
      expect(await withTransaction(suite.db, (tx) => linesOf(tx, held.id))).toMatchObject([
        { unitPriceGross: 400, menuName: "Almuerzo", menuVersionId: v.versions.Almuerzo },
      ]);
    },
  );

  it("refuses a Dinner line before Dinner starts and writes no order", async () => {
    at(mondayAt("13:00"));
    const v = await mealVenue();
    const held = await park(v, v.sala, v.tostada.desayunos, v.versions.Desayunos);
    expect(held).toMatchObject({
      status: 400,
      body: {
        error: {
          code: "menu_period.not_running",
          params: { departmentId: v.restaurant, menuId: v.menus.Desayunos },
        },
      },
    });
    expect(
      await suite.db
        .select({ id: workingOrders.id })
        .from(workingOrders)
        .where(eq(workingOrders.id, held.id)),
    ).toEqual([]);
    expect(await withTransaction(suite.db, (tx) => linesOf(tx, held.id))).toEqual([]);
  });

  it.each([
    ["2026-10-05T13:00:00+02:00", "Desayunos", "desayunos", [0, 1, 2, 3, 4, 5, 6]],
    ["2026-10-04T13:00:00+02:00", "Almuerzo", "almuerzo", [1, 2, 3, 4, 5, 6]],
    ["2026-10-05T14:00:00+02:00", "Almuerzo", "almuerzo", [1]],
    ["2026-10-05T17:00:00+02:00", "Almuerzo", "almuerzo", [1]],
    ["2026-10-05T19:00:00+02:00", "Almuerzo", "almuerzo", [1]],
  ] as const)("at %s refuses %s outside its own period", async (instant, menu, item, weekdays) => {
    at(new Date(instant));
    const v = await mealVenue(weekdays);
    const held = await park(v, v.sala, v.tostada[item], v.versions[menu]);
    expect(held).toMatchObject({
      status: 400,
      body: {
        error: {
          code: "menu_period.not_running",
          params: { departmentId: v.restaurant, menuId: v.menus[menu] },
        },
      },
    });
    expect(
      await suite.db
        .select({ id: workingOrders.id })
        .from(workingOrders)
        .where(eq(workingOrders.id, held.id)),
    ).toEqual([]);
    expect(await withTransaction(suite.db, (tx) => linesOf(tx, held.id))).toEqual([]);
  });

  it("accepts a stored Lunch quantity increase while Lunch runs, keeping its id and price", async () => {
    at(mondayAt("13:50"));
    const v = await mealVenue();
    const held = await park(v, v.sala, v.tostada.almuerzo);
    expect(held.status).toBe(200);
    const before = await withTransaction(suite.db, (tx) => linesOf(tx, held.id));
    at(mondayAt("13:55"));
    expect((await editMealLine(v, held.id, { quantity: "2" })).status).toBe(200);
    expect(await withTransaction(suite.db, (tx) => linesOf(tx, held.id))).toEqual(before);
    const rows = await suite.db
      .select({ quantity: workingOrderLines.quantity })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, held.id));
    expect(rows).toEqual([{ quantity: 2000 }]);
  });

  it.each(["14:00", "14:05", "19:05"])(
    "refuses a stored Lunch quantity increase at %s without changing the order",
    async (time) => {
      at(mondayAt("13:50"));
      const v = await mealVenue();
      const held = await park(v, v.sala, v.tostada.almuerzo);
      expect(held.status).toBe(200);
      const before = await send(v, "GET", `/api/working-orders/${held.id}`);
      at(mondayAt(time));
      expect(await editMealLine(v, held.id, { quantity: "2" })).toEqual({
        status: 400,
        body: {
          error: {
            code: "menu_period.not_running",
            params: { departmentId: v.restaurant, menuId: v.menus.Almuerzo },
          },
        },
      });
      expect(await send(v, "GET", `/api/working-orders/${held.id}`)).toEqual(before);
    },
  );

  it("edits a stored Lunch note after Lunch ends, without repricing the dish", async () => {
    at(mondayAt("13:50"));
    const v = await mealVenue();
    const held = await park(v, v.sala, v.tostada.almuerzo);
    expect(held.status).toBe(200);
    const before = await withTransaction(suite.db, (tx) => linesOf(tx, held.id));
    at(mondayAt("15:00"));
    expect((await editMealLine(v, held.id, { note: "No salt" })).status).toBe(200);
    expect(await withTransaction(suite.db, (tx) => linesOf(tx, held.id))).toEqual(before);
    const rows = await suite.db
      .select({ note: workingOrderLines.note })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, held.id));
    expect(rows).toEqual([{ note: "No salt" }]);
  });

  it("refuses a new line on a business day when no period has run", async () => {
    at(new Date("2026-10-04T13:00:00+02:00"));
    const v = await mealVenue();
    expect(await park(v, v.sala, v.tostada.almuerzo)).toMatchObject({
      status: 400,
      body: {
        error: {
          code: "menu_period.not_running",
          params: { departmentId: v.restaurant, menuId: v.menus.Almuerzo },
        },
      },
    });
  });

  it("uses one service resolution for repeated new lines", async () => {
    at(mondayAt("13:00"));
    const v = await mealVenue();
    const resolve = vi.spyOn(VENUE_SERVICE, "resolveDepartmentService");
    try {
      const id = randomUUID();
      expect(
        (
          await send(v, "POST", "/api/working-orders", {
            id,
            zoneId: v.sala,
            lines: [1, 2, 3].map(() => ({ menuItemId: v.tostada.almuerzo, quantity: "1" })),
          })
        ).status,
      ).toBe(200);
      expect(resolve).toHaveBeenCalledTimes(1);
      expect(resolve.mock.calls[0]![2]).toBe(v.restaurant);
      expect(
        (await withTransaction(suite.db, (tx) => linesOf(tx, id))).map(
          (line) => line.unitPriceGross,
        ),
      ).toEqual([400, 400, 400]);
    } finally {
      resolve.mockRestore();
    }
  });

  it("refuses a future-period fresh line appended to a stored order without changing it", async () => {
    at(mondayAt("13:00"));
    const v = await mealVenue();
    const held = await park(v, v.sala, v.tostada.almuerzo);
    expect(held.status).toBe(200);
    const before = await send(v, "GET", `/api/working-orders/${held.id}`);
    const order = before.body as {
      revision: number;
      lines: { workingOrderLineId: string; menuItemId: string; quantity: string }[];
    };
    expect(
      await send(v, "PUT", `/api/working-orders/${held.id}`, {
        revision: order.revision,
        lines: [
          ...order.lines.map(({ workingOrderLineId, menuItemId, quantity }) => ({
            workingOrderLineId,
            menuItemId,
            quantity,
          })),
          { menuItemId: v.tostada.desayunos, quantity: "1" },
        ],
      }),
    ).toEqual({
      status: 400,
      body: {
        error: {
          code: "menu_period.not_running",
          params: { departmentId: v.restaurant, menuId: v.menus.Desayunos },
        },
      },
    });
    expect(await send(v, "GET", `/api/working-orders/${held.id}`)).toEqual(before);
  });

  it("refuses a future-period direct sale before storing an order", async () => {
    at(mondayAt("13:00"));
    const v = await mealVenue();
    const id = randomUUID();
    expect(
      await send(v, "POST", "/api/sales", {
        id,
        zoneId: v.sala,
        lines: [{ menuItemId: v.tostada.desayunos, quantity: "1" }],
        tender: { method: "cash", amount: "5.00" },
      }),
    ).toEqual({
      status: 400,
      body: {
        error: {
          code: "menu_period.not_running",
          params: { departmentId: v.restaurant, menuId: v.menus.Desayunos },
        },
      },
    });
    expect(
      await suite.db
        .select({ id: workingOrders.id })
        .from(workingOrders)
        .where(eq(workingOrders.id, id)),
    ).toEqual([]);
  });

  it("keeps Lunch quantity decreases and notes editable when its timetable is cleared", async () => {
    at(mondayAt("13:50"));
    const v = await mealVenue();
    const held = await park(v, v.sala, v.tostada.almuerzo);
    expect(held.status).toBe(200);
    expect((await editMealLine(v, held.id, { quantity: "2" })).status).toBe(200);
    const before = await withTransaction(suite.db, (tx) => linesOf(tx, held.id));
    await withTransaction(suite.db, (tx) =>
      replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, slots: [] })),
        MONDAY_10_00,
      ),
    );
    at(mondayAt("15:00"));
    expect((await editMealLine(v, held.id, { quantity: "1", note: "No salt" })).status).toBe(200);
    expect(await withTransaction(suite.db, (tx) => linesOf(tx, held.id))).toEqual(before);
    expect(
      await suite.db
        .select({ quantity: workingOrderLines.quantity, note: workingOrderLines.note })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, held.id)),
    ).toEqual([{ quantity: 1000, note: "No salt" }]);
  });

  it.each(["13:00", "17:00"])("gates a period's staff menu at %s", async (time) => {
    at(mondayAt(time));
    const v = await mealVenue();
    const read = await send(v, "GET", `/api/service-zones/${v.sala}/offers`);
    const offers = read.body.offers as { id: string; menuId: string }[];
    const water = offers.find((offer) => offer.menuId === v.menus.Bebidas)!;
    const held = await park(v, v.sala, water.id);
    if (time === "17:00") {
      expect(held).toMatchObject({
        status: 400,
        body: {
          error: {
            code: "menu_period.not_running",
            params: {
              departmentId: v.restaurant,
              menuId: v.menus.Bebidas,
            },
          },
        },
      });
      expect(await withTransaction(suite.db, (tx) => linesOf(tx, held.id))).toEqual([]);
      return;
    }
    expect(held.status).toBe(200);
    expect(await withTransaction(suite.db, (tx) => linesOf(tx, held.id))).toMatchObject([
      { menuName: "Bebidas", unitPriceGross: 200 },
    ]);
  });

  it("accepts all period menus when the location clock cannot be read", async () => {
    at(mondayAt("13:00"));
    const v = await mealVenue();
    await suite.db
      .update(locations)
      .set({ timeZone: "Unreadable/Zone" })
      .where(eq(locations.id, v.cfg.locationId));
    const held = await park(v, v.sala, v.tostada.desayunos);
    expect(held.status).toBe(200);
    expect(await withTransaction(suite.db, (tx) => linesOf(tx, held.id))).toMatchObject([
      { menuName: "Desayunos", unitPriceGross: 250 },
    ]);
  });

  it.each(["fired", "adjusted"] as const)(
    "refuses more of a %s Lunch line after Lunch ends",
    async (kind) => {
      at(mondayAt("13:50"));
      const v = await mealVenue();
      let id: string;
      let path: string;
      if (kind === "fired") {
        await suite.db
          .update(departments)
          .set({ defaultServiceMode: "table_tab" })
          .where(eq(departments.id, v.restaurant));
        const { id: tableId } = await withTransaction(suite.db, (tx) =>
          createTable(tx, v.cfg, { label: "Fired meal table", zoneId: v.sala }),
        );
        const seated = await send(v, "POST", `/api/tables/${tableId}/seat`, { guestCount: 2 });
        expect(seated.status).toBe(200);
        const { partyId, tabId, revision } = seated.body as {
          partyId: string;
          tabId: string;
          revision: number;
        };
        const saved = await send(v, "PUT", `/api/parties/${partyId}/drafts`, {
          draftId: null,
          revision: 0,
          lines: [{ menuItemId: v.tostada.almuerzo, quantity: "1" }],
        });
        expect(saved.status).toBe(200);
        const draft = saved.body as { id: string; revision: number; lines: { id: string }[] };
        const sent = await send(v, "POST", `/api/parties/${partyId}/drafts/${draft.id}/submit`, {
          submissionId: randomUUID(),
          draftRevision: draft.revision,
          expectedPartyRevision: revision,
          groups: [{ lineIds: draft.lines.map((line) => line.id), release: "fire" }],
        });
        expect(sent.status).toBe(200);
        id = tabId;
        path = `/api/working-orders/${id}/lines`;
        expect(
          await suite.db
            .select({ sentAt: workingOrderLines.sentAt })
            .from(workingOrderLines)
            .where(eq(workingOrderLines.workingOrderId, id)),
        ).toEqual([{ sentAt: mondayAt("13:50").toISOString() }]);
      } else {
        const held = await park(v, v.sala, v.tostada.almuerzo);
        expect(held.status).toBe(200);
        id = held.id;
        await suite.db
          .update(workingOrderLines)
          .set({ listUnitPriceGross: 400 })
          .where(eq(workingOrderLines.workingOrderId, id));
        path = `/api/working-orders/${id}`;
      }
      const before = await send(v, "GET", path);
      expect(before.status).toBe(200);
      at(mondayAt("14:05"));
      expect(
        await send(v, "PUT", `/api/working-orders/${id}/lines/1`, {
          revision: before.body.revision,
          quantity: "2",
        }),
      ).toEqual({
        status: 400,
        body: {
          error: {
            code: "menu_period.not_running",
            params: { departmentId: v.restaurant, menuId: v.menus.Almuerzo },
          },
        },
      });
      expect(await send(v, "GET", path)).toEqual(before);
    },
  );

  it.each(["lunch", "dinner"] as const)(
    "retains a %s draft after Lunch ends and gates its submission",
    async (meal) => {
      at(mondayAt("13:50"));
      const v = await mealVenue();
      await suite.db
        .update(departments)
        .set({ defaultServiceMode: "table_tab" })
        .where(eq(departments.id, v.restaurant));
      const { id: tableId } = await withTransaction(suite.db, (tx) =>
        createTable(tx, v.cfg, { label: "Meal table", zoneId: v.sala }),
      );
      const seated = await send(v, "POST", `/api/tables/${tableId}/seat`, { guestCount: 2 });
      expect(seated.status).toBe(200);
      const { partyId, tabId } = seated.body as { partyId: string; tabId: string };
      const menuItemId = meal === "lunch" ? v.tostada.almuerzo : v.tostada.desayunos;
      const saved = await send(v, "PUT", `/api/parties/${partyId}/drafts`, {
        draftId: null,
        revision: 0,
        lines: [{ menuItemId, quantity: "1" }],
      });
      expect(saved.status).toBe(200);
      const draft = saved.body as { id: string; revision: number; lines: { id: string }[] };
      at(mondayAt("17:00"));
      const read = await send(v, "GET", `/api/parties/${partyId}/drafts`);
      expect(read.status).toBe(200);
      expect(read.body).toEqual({ drafts: [saved.body] });
      expect(saved.body).toMatchObject({
        lines: [{ menuItemId, quantity: "1.000", unavailable: false }],
      });
      const [party] = await suite.db
        .select({ revision: parties.revision })
        .from(parties)
        .where(eq(parties.id, partyId));
      const submitted = await send(v, "POST", `/api/parties/${partyId}/drafts/${draft.id}/submit`, {
        submissionId: randomUUID(),
        draftRevision: draft.revision,
        expectedPartyRevision: party!.revision,
        groups: [{ lineIds: draft.lines.map((line) => line.id), release: "fire" }],
      });
      expect(submitted).toEqual({
        status: 400,
        body: {
          error: {
            code: "menu_period.not_running",
            params: {
              departmentId: v.restaurant,
              menuId: v.menus[meal === "lunch" ? "Almuerzo" : "Desayunos"],
            },
          },
        },
      });
      expect(await send(v, "GET", `/api/parties/${partyId}/drafts`)).toEqual(read);
      expect(await withTransaction(suite.db, (tx) => linesOf(tx, tabId))).toEqual([]);
    },
  );

  it("adds an extra to a stored Lunch dish after all its periods are cleared", async () => {
    at(mondayAt("13:50"));
    const v = await mealVenue();
    const read = await send(v, "GET", `/api/service-zones/${v.sala}/offers`);
    const dish = (read.body.offers as { id: string; productId: string }[]).find(
      (offer) => offer.id === v.tostada.almuerzo,
    )!;
    const { extraId, listId } = await withTransaction(suite.db, async (tx) => {
      const extra = await createProduct(tx, {
        catalogueId: v.menus.Almuerzo,
        categoryId: null,
        name: "Butter",
        pricingUnit: "each",
        unitPrice: "0.50",
        vatClass: "general",
      });
      const list = await createExtraList(
        tx,
        {
          name: "Spreads",
          customerName: null,
          kitchenName: null,
          minPicks: 0,
          maxPicks: 1,
          active: true,
          items: [{ productId: extra.id, maxQuantity: 1, preselected: false, price: "0.50" }],
        },
        LOCALE,
      );
      await writeProductModifiers(tx, dish.productId, [{ kind: "extras", id: list.id }]);
      await publishWorkingMenu(tx, v.menus.Almuerzo);
      return { extraId: extra.id, listId: list.id };
    });
    const held = await park(v, v.sala, v.tostada.almuerzo);
    expect(held.status).toBe(200);
    const before = await withTransaction(suite.db, (tx) => linesOf(tx, held.id));
    await withTransaction(suite.db, (tx) =>
      replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, slots: [] })),
        MONDAY_10_00,
      ),
    );
    at(mondayAt("15:00"));
    expect(
      (
        await send(v, "PUT", `/api/working-orders/${held.id}/lines/1`, {
          revision: 0,
          extras: [{ listId, picks: [{ productId: extraId, quantity: 1 }] }],
        })
      ).status,
    ).toBe(200);
    const after = await suite.db
      .select({
        id: workingOrderLines.id,
        parentLineId: workingOrderLines.parentLineId,
        productId: workingOrderLines.productId,
        unitPriceGross: workingOrderLines.unitPriceGross,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, held.id));
    expect(after).toEqual(
      expect.arrayContaining([
        { id: before[0]!.id, parentLineId: null, productId: dish.productId, unitPriceGross: 400 },
        {
          id: expect.any(String),
          parentLineId: before[0]!.id,
          productId: extraId,
          unitPriceGross: 50,
        },
      ]),
    );
    expect(after).toHaveLength(2);
  });

  it("previews routing of an unchanged stored line when its periods have been cleared", async () => {
    at(mondayAt("13:50"));
    const v = await mealVenue();
    const held = await park(v, v.sala, v.tostada.almuerzo);
    expect(held.status).toBe(200);
    const [line] = await withTransaction(suite.db, (tx) => linesOf(tx, held.id));
    await withTransaction(suite.db, (tx) =>
      replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, slots: [] })),
        MONDAY_10_00,
      ),
    );
    at(mondayAt("15:00"));
    const before = await send(v, "GET", `/api/working-orders/${held.id}`);
    expect(
      await send(v, "POST", "/api/dead-ends/sale", {
        workingOrderId: held.id,
        step: "edit",
        lines: [{ workingOrderLineId: line!.id, menuItemId: v.tostada.almuerzo, quantity: "1" }],
      }),
    ).toMatchObject({ status: 200, body: { sends: true, deadEnds: [] } });
    expect(await send(v, "GET", `/api/working-orders/${held.id}`)).toEqual(before);
  });

  it("keeps the zone refusal for an item on no period's menu", async () => {
    at(mondayAt("13:00"));
    const v = await mealVenue();
    expect(await park(v, v.sala, v.bocadillo)).toMatchObject({
      status: 400,
      body: {
        error: {
          code: "service_zone.offer_not_allowed",
          params: { zoneId: v.sala, menuItemId: v.bocadillo },
        },
      },
    });
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
    expect(await defaultMenu(v, `?zoneId=${v.barra}`)).toBe(v.menus.Desayunos);
    expect(await defaultMenu(v, `?zoneId=${v.sala}`)).toBe(v.menus.Desayunos);
    vi.setSystemTime(MONDAY_12_30);
    expect(await defaultMenu(v, `?zoneId=${v.barra}`)).toBe(v.menus.Almuerzo);
  });

  it("names the starting zone's default when no zone is asked for", async () => {
    const v = await setupVenue({ timetable: true });
    at(MONDAY_10_00);
    expect(await defaultMenu(v, "")).toBe(v.menus.Desayunos);
  });
});

describe("menu-state follows department service periods", () => {
  const setupPeriods = async () => {
    const v = await setupVenue({ timetable: true });
    await withTransaction(suite.db, async (tx) => {
      const lunch = await saveMenuPeriod(tx, v.cfg, v.restaurant, {
        name: "Lunch",
        menuId: v.menus.Almuerzo,
        staffMenuIds: [v.menus.Bebidas],
      });
      const afternoon = await saveMenuPeriod(tx, v.cfg, v.restaurant, {
        name: "Afternoon",
        menuId: v.menus["Café"],
        staffMenuIds: [],
      });
      const night = await saveMenuPeriod(tx, v.cfg, v.restaurant, {
        name: "Night",
        menuId: v.menus.Desayunos,
        staffMenuIds: [],
      });
      await replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots: [
            slot(lunch.id, "12:00", "14:00"),
            slot(afternoon.id, "14:00", "19:00"),
            slot(night.id, "21:00", "03:00"),
          ],
        })),
        MONDAY_10_00,
      );
    });
    return v;
  };

  it.each([
    ["2026-10-09T11:59:00Z", "Lunch", "Almuerzo"],
    ["2026-10-09T12:00:00Z", "Afternoon", "Café"],
    ["2026-10-10T00:30:00Z", "Night", "Desayunos"],
  ] as const)("reports the running department period at %s", async (instant, periodName, menu) => {
    const v = await setupPeriods();
    at(new Date(instant));
    for (const query of ["", `?zoneId=${v.barra}`, `?zoneId=${v.sala}`]) {
      const answer = await send(v, "GET", `/api/menu-state${query}`);
      expect(answer.status).toBe(200);
      expect(answer.body).toMatchObject({
        defaultMenuId: v.menus[menu],
        service: { open: true, periodName },
        menus: expect.arrayContaining([
          { menuId: v.menus[menu], versionId: v.versions[menu], orderable: true, sendable: true },
        ]),
        unavailable: { products: [], optionLabels: [] },
      });
    }
  });

  it("reports a closed department without choosing an all-day default", async () => {
    const v = await setupPeriods();
    at(new Date("2026-10-09T18:00:00Z"));
    const answer = await send(v, "GET", `/api/menu-state?zoneId=${v.barra}`);
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({
      defaultMenuId: null,
      service: { open: false, zoneOpen: true, periodName: null },
    });
    expect(answer.body.menus).toEqual([
      { menuId: v.menus["Café"], versionId: v.versions["Café"], orderable: false, sendable: false },
      {
        menuId: v.menus.Almuerzo,
        versionId: v.versions.Almuerzo,
        orderable: false,
        sendable: false,
      },
      {
        menuId: v.menus.Desayunos,
        versionId: v.versions.Desayunos,
        orderable: false,
        sendable: false,
      },
      { menuId: v.menus.Bebidas, versionId: v.versions.Bebidas, orderable: false, sendable: false },
    ]);
  });
  it.each([
    ["2026-10-09T11:59:00Z", "Almuerzo", "Bebidas", "Lunch"],
    ["2026-10-09T12:00:00Z", "Café", null, "Afternoon"],
  ] as const)(
    "never falls back to another period after %s loses its customer menu",
    async (instant, inactive, fallback, periodName) => {
      const v = await setupPeriods();
      await withTransaction(suite.db, (tx) => deactivateCatalogue(tx, v.menus[inactive]));
      at(new Date(instant));
      const answer = await send(v, "GET", `/api/menu-state?zoneId=${v.sala}`);
      expect(answer.status).toBe(200);
      expect(answer.body).toMatchObject({
        defaultMenuId: fallback === null ? null : v.menus[fallback],
        service: { open: true, periodName },
      });
    },
  );

  it("reports open service when the location clock cannot be read", async () => {
    const v = await setupPeriods();
    await suite.db
      .update(locations)
      .set({ timeZone: "not/a-zone" })
      .where(eq(locations.id, v.cfg.locationId));
    at(new Date("2026-10-09T18:00:00Z"));
    const answer = await send(v, "GET", `/api/menu-state?zoneId=${v.sala}`);
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({
      defaultMenuId: null,
      service: { open: true, zoneOpen: true, periodName: null },
    });
  });
});
