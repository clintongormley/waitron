import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { deviceProfiles, workingOrders, withTransaction } from "@waitron/db";
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
  deleteMenuPeriod,
  menuPeriods,
  replaceMenuWeek,
  saveMenuPeriod,
  seasons,
  setProfileServiceAccess,
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

const LOCALE = "es-ES";
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

/** 00:15 on Sunday 1 December 2030 in Madrid (UTC+1): business day Saturday 30 November, Autumn. */
const SUNDAY_00_15 = new Date("2030-11-30T23:15:00Z");
const SATURDAY = 6;

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
      throw new Error("till-api.seasons.test: anchor() is not used");
    },
    currentAnchor: () => null,
  };
  backend = new VerifactuBackend({
    clock,
    db: suite.db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () =>
      Promise.reject(new Error("till-api.seasons.test: resolveClient is never called")),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

let nifCounter = 0;
const nextNif = () => nifWithControlLetter(72_000_000 + ++nifCounter);

/** Autumn's Saturday runs Dinner (Cena) 20:00–02:00; Winter's Saturday runs Late bar (Copas). */
async function seasonVenue() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(SUNDAY_00_15);
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
          dayCutover: "06:00",
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
      await createDepartment(tx, cfg, { name: "Restaurant", orderStart: "counter" })
    ).id;
    const initialPeriods = await tx
      .select({ id: menuPeriods.id })
      .from(menuPeriods)
      .where(eq(menuPeriods.departmentId, restaurant));
    await replaceMenuWeek(
      tx,
      cfg,
      restaurant,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, slots: [] })),
      SUNDAY_00_15,
      0,
    );
    for (const period of initialPeriods) await deleteMenuPeriod(tx, cfg, period.id);
    const sala = (await createServiceZone(tx, cfg, { name: "Sala", departmentId: restaurant })).id;
    const dish = async (menuName: string, name: string) => {
      const menuId = (await createCatalogue(tx, { name: menuName })).id;
      const product = await createProduct(tx, {
        catalogueId: menuId,
        categoryId: null,
        name,
        pricingUnit: "each",
        unitPrice: "12.00",
        vatClass: "general",
      });
      const itemId = (await addProductToMenu(tx, { menuId, productId: product.id })).id;
      return { menuId, itemId, versionId: await publishWorkingMenu(tx, menuId) };
    };
    const cena = await dish("Cena", "Solomillo");
    const copas = await dish("Copas", "Gin tonic");
    const period = async (name: string, menuId: string) =>
      (await saveMenuPeriod(tx, cfg, restaurant, { name, menuId, staffMenuIds: [] }, 0)).id;
    const dinner = await period("Dinner", cena.menuId);
    const lateBar = await period("Late bar", copas.menuId);
    const seasonId = async (name: string) =>
      (
        await tx
          .select({ id: seasons.id, name: seasons.name })
          .from(seasons)
          .where(eq(seasons.locationId, cfg.locationId))
      ).find((season) => season.name === name)!.id;
    const saturday = (periodId: string) =>
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        slots: weekday === SATURDAY ? [{ periodId, startsAt: "20:00", endsAt: "02:00" }] : [],
      }));
    await replaceMenuWeek(tx, cfg, restaurant, saturday(dinner), SUNDAY_00_15, 0, {
      seasonId: await seasonId("Autumn"),
    });
    await replaceMenuWeek(tx, cfg, restaurant, saturday(lateBar), SUNDAY_00_15, 0, {
      seasonId: await seasonId("Winter"),
    });
    const [person] = await tx
      .insert(persons)
      .values({ displayName: "Ana", pinHash: hashPin("5555"), role: "staff" })
      .returning({ id: persons.id });
    return { restaurant, sala, cena, copas, personId: person!.id };
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
      startingZoneId: seeded.sala,
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
    app,
    cookie: `${SESSION_COOKIE}=${session.token}; ${DEVICE_COOKIE}=${device.deviceId}.${device.token}`,
    ...seeded,
  };
}
type Venue = Awaited<ReturnType<typeof seasonVenue>>;

async function send(v: Venue, method: string, path: string, body?: object) {
  const response = await v.app.request(path, {
    method,
    headers: { "content-type": "application/json", cookie: v.cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown>,
  };
}

const park = async (v: Venue, dish: { itemId: string; versionId: string }) => {
  const id = randomUUID();
  const answer = await send(v, "POST", "/api/working-orders", {
    id,
    zoneId: v.sala,
    lines: [{ menuItemId: dish.itemId, quantity: "1", menuVersionId: dish.versionId }],
  });
  return { ...answer, id };
};

const stored = (id: string) =>
  suite.db.select({ id: workingOrders.id }).from(workingOrders).where(eq(workingOrders.id, id));

describe("the till sells the business day's season", () => {
  it("accepts a dish from Autumn's Dinner at 00:15 on Sunday 1 December 2030", async () => {
    const v = await seasonVenue();
    const parked = await park(v, v.cena);
    expect(parked.status).toBe(200);
    expect(await stored(parked.id)).toEqual([{ id: parked.id }]);
  });

  it("refuses a dish only Winter's Late bar offers, and writes no order", async () => {
    const v = await seasonVenue();
    const parked = await park(v, v.copas);
    expect(parked).toMatchObject({
      status: 400,
      body: {
        error: {
          code: "menu_period.not_running",
          params: { departmentId: v.restaurant, menuId: v.copas.menuId },
        },
      },
    });
    expect(await stored(parked.id)).toEqual([]);
  });

  it("names Dinner in the menu state", async () => {
    const v = await seasonVenue();
    const answer = await send(v, "GET", `/api/menu-state?zoneId=${v.sala}`);
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({
      defaultMenuId: v.cena.menuId,
      service: { open: true, periodName: "Dinner" },
    });
  });
});
