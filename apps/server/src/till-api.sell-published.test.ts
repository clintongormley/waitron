import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  deviceProfiles,
  products,
  saleLines,
  sales,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  addMember,
  addProductToMenu,
  addShortcut,
  addProducts,
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createExtraList,
  createOptionList,
  createHomeLayout,
  createProduct,
  createSection,
  deactivateCatalogue,
  deleteHomeLayout,
  listHomeLayouts,
  menuStatus,
  optionLabels,
  renameHomeLayout,
  requireMenuRoot,
  setDeviceHomeLayout,
  setMenuItemExtraLists,
  updateExtraList,
  updateMenuItem,
  updateProduct,
  updateSection,
  writeProductModifiers,
} from "@waitron/catalogue";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin, loginWithPin, persons } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import { mountTillApi } from "./till-api.js";
import type { TillConfig } from "./till-config.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { SESSION_COOKIE } from "./till-session.js";

// A till sells from each menu's PUBLISHED version, driven over HTTP to a genuine chained record:
// the version a basket asserts, the availability the server overlays, and `/api/menu-state`.
const LOCALE = "es-ES";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

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
      throw new Error("till-api.sell-published.test: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
  backend = new VerifactuBackend({
    clock,
    db: suite.db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () =>
      Promise.reject(new Error("till-api.sell-published.test: resolveClient is never called")),
  });
});

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(70_000_000 + nifCounter).padStart(8, "0")}K`;
}

interface Lunch {
  cfg: TillConfig;
  zoneId: string;
  menuId: string;
  rootId: string;
  app: Hono;
  cookie: string;
  /** The same till session with no device cookie. */
  sessionCookie: string;
  /** The enrolled device's profile. */
  profileId: string;
  lemonade: { productId: string; offerId: string };
  burger: { productId: string; offerId: string };
  /** "Extra lemon", offered at 0.50 by Lemonade's "Lemon" extras list. */
  extraLemon: { productId: string; listId: string };
  /** Burger's "Punto" options list; `poco` is one of its labels. */
  punto: { listId: string; poco: string };
  /** A library section on Lunch holding Flan, which no basket here orders from. */
  postresId: string;
  flanId: string;
}

/**
 * A provisioned venue whose counter zone sells "Lunch": Lemonade (3.00, with an extras list
 * offering Extra lemon at 0.50), Burger (9.00, answering "Punto") and, in its own section, Flan.
 * Lunch is NOT published; `publish` does that.
 */
async function setupLunch(): Promise<Lunch> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Lunch Test SL",
        location: {
          name: "Sala principal",
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
        tillName: "Caja 1",
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
    tillId: brandTillId(venue.tillId),
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
  const seeded = await withTransaction(suite.db, async (tx) => {
    const lunch = await createCatalogue(tx, { name: "Lunch" });
    const category = await createCategory(tx, { name: { [LOCALE]: "Carta" } });
    const product = (name: string, unitPrice: string, vatClass: "general" | "reduced") =>
      createProduct(tx, {
        catalogueId: lunch.id,
        categoryId: category.id,
        name,
        pricingUnit: "each",
        unitPrice,
        vatClass,
      });
    const lemonade = await product("Lemonade", "3.00", "reduced");
    const burger = await product("Burger", "9.00", "general");
    const flan = await product("Flan", "4.00", "general");
    const extraLemon = await product("Extra lemon", "2.00", "reduced");
    const lemon = await createExtraList(
      tx,
      {
        name: "Lemon",
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: null,
        active: true,
        items: [{ productId: extraLemon.id, maxQuantity: 2, preselected: false, price: "0.50" }],
      },
      LOCALE,
    );
    await writeProductModifiers(tx, lemonade.id, [{ kind: "extras", id: lemon.id }]);
    const punto = await createOptionList(
      tx,
      {
        name: "Punto",
        customerName: null,
        kitchenName: null,
        defaultLabelId: null,
        active: true,
        labels: [
          { name: "Poco", customerName: null, kitchenName: null, available: true },
          { name: "Hecho", customerName: null, kitchenName: null, available: true },
        ],
      },
      LOCALE,
    );
    await writeProductModifiers(tx, burger.id, [{ kind: "options", id: punto.id }]);
    await assignCatalogueToLocation(tx, venue.locationId, lunch.id);
    const lemonadeOffer = await addProductToMenu(tx, { menuId: lunch.id, productId: lemonade.id });
    const burgerOffer = await addProductToMenu(tx, { menuId: lunch.id, productId: burger.id });
    await setMenuItemExtraLists(tx, lemonadeOffer.id, [{ listId: lemon.id, items: [] }]);
    const postres = await createSection(tx, { internalName: "Postres" });
    const rootId = await requireMenuRoot(tx, lunch.id);
    await addMember(tx, rootId, { kind: "section", sectionId: postres.id });
    await addProducts(tx, postres.id, [flan.id]);
    const zone = await tx.execute<{ id: string }>(sql`
      select zone_id as id from zone_service_policies
      where location_id = ${cfg.locationId} and is_counter_default`);
    const zoneId = zone.rows[0]!.id;
    await tx.execute(sql`
      insert into zone_menus (zone_id, menu_id) values (${zoneId}, ${lunch.id})`);
    await tx.execute(sql`
      update zone_service_policies set default_menu_id = ${lunch.id} where zone_id = ${zoneId}`);
    await tx.execute(sql`
      insert into preparation_routes (id, location_id, category_id, station_id)
      values (${randomUUID()}, ${cfg.locationId}, ${category.id},
        (select id from kitchen_stations where location_id = ${cfg.locationId} and is_default))`);
    const [person] = await tx
      .insert(persons)
      .values({ displayName: "Cajera", pinHash: hashPin("5555"), role: "staff" })
      .returning({ id: persons.id });
    return {
      zoneId,
      menuId: lunch.id,
      rootId,
      personId: person!.id,
      lemonade: { productId: lemonade.id, offerId: lemonadeOffer.id },
      burger: { productId: burger.id, offerId: burgerOffer.id },
      extraLemon: { productId: extraLemon.id, listId: lemon.id },
      punto: { listId: punto.id, poco: punto.labels[0]!.id },
      postresId: postres.id,
      flanId: flan.id,
    };
  });
  const [profile] = await suite.db
    .insert(deviceProfiles)
    .values({ name: `Till ${randomUUID()}`, formFactor: "till", capabilities: [] })
    .returning({ id: deviceProfiles.id });
  const device = await enrolDeviceForTest(suite.db, cfg, {
    name: `Counter till ${randomUUID()}`,
    profileId: profile!.id,
  });
  const session = await withTransaction(suite.db, (tx) =>
    loginWithPin(tx, { tillId: cfg.tillId, personId: seeded.personId, pin: "5555" }),
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
    sessionCookie: `${SESSION_COOKIE}=${session.token}`,
    profileId: profile!.id,
    ...seeded,
  };
}

const publish = (menuId: string) =>
  withTransaction(suite.db, (tx) => publishWorkingMenu(tx, menuId));

async function send(v: Lunch, method: string, path: string, body?: object): Promise<Response> {
  return v.app.request(path, {
    method,
    headers: { "content-type": "application/json", cookie: v.cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const pay = (v: Lunch, lines: object[]) =>
  send(v, "POST", "/api/sales", {
    zoneId: v.zoneId,
    lines,
    tender: { method: "cash", amount: "50.00" },
  });

const lemonadeLine = (v: Lunch, menuVersionId?: string) => ({
  menuItemId: v.lemonade.offerId,
  quantity: "1",
  ...(menuVersionId === undefined ? {} : { menuVersionId }),
});

async function written(): Promise<{ sales: number; records: number; orders: number }> {
  const rows = await suite.db.execute<{ sales: number; records: number; orders: number }>(sql`
    select
      (select cast(count(*) as integer) from sales) as sales,
      (select cast(count(*) as integer) from registros_facturacion) as records,
      (select cast(count(*) as integer) from working_orders) as orders`);
  return rows.rows[0]!;
}

describe("a basket that spans a publish (Review Focus 2)", () => {
  it("refuses a stale version with nothing written, files the live price, and passes an unrelated republish", async () => {
    const v = await setupLunch();
    const v1 = await publish(v.menuId);
    await withTransaction(suite.db, (tx) =>
      updateMenuItem(tx, v.menuId, v.lemonade.offerId, { grossPrice: "2.50" }),
    );
    const v2 = await publish(v.menuId);

    const before = await written();
    const stale = await pay(v, [lemonadeLine(v, v1)]);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      error: {
        code: "menu.version_changed",
        params: { menus: [{ menuId: v.menuId, liveVersionId: v2 }] },
      },
    });
    expect(await written()).toEqual(before);

    const fresh = await pay(v, [lemonadeLine(v, v2), lemonadeLine(v, v2)]);
    expect(fresh.status).toBe(200);
    const sale = (await fresh.json()) as { total: string; lines: { lineTotal: string }[] };
    expect(sale.total).toBe("5.00");
    const filed = await suite.db
      .select({ menuVersionId: saleLines.menuVersionId, unitPrice: saleLines.unitPrice })
      .from(saleLines)
      .innerJoin(sales, eq(sales.id, saleLines.saleId));
    expect(filed.map((line) => line.menuVersionId)).toEqual([v2, v2]);

    // v3 renames only the section holding Flan, which the basket holds nothing from.
    await withTransaction(suite.db, (tx) =>
      updateSection(tx, v.postresId, { internalName: "Postres de la casa" }),
    );
    const v3 = await publish(v.menuId);
    expect(v3).not.toBe(v2);
    expect((await pay(v, [lemonadeLine(v, v3)])).status).toBe(200);

    // v4 takes Lemonade off Lunch.
    await withTransaction(suite.db, (tx) =>
      updateMenuItem(tx, v.menuId, v.lemonade.offerId, { active: false }),
    );
    const v4 = await publish(v.menuId);
    const removed = await pay(v, [lemonadeLine(v, v4)]);
    expect(removed.status).toBe(400);
    expect(await removed.json()).toMatchObject({
      error: { code: "service_zone.offer_not_allowed" },
    });
    // A till that still holds v3 is told the version moved, so it can find the line removed.
    const behind = await pay(v, [lemonadeLine(v, v3)]);
    expect(behind.status).toBe(409);
    expect(await behind.json()).toMatchObject({
      error: { params: { menus: [{ menuId: v.menuId, liveVersionId: v4 }] } },
    });
  });

  it("prices a line with no asserted version from the live version", async () => {
    const v = await setupLunch();
    await publish(v.menuId);
    await withTransaction(suite.db, (tx) =>
      updateMenuItem(tx, v.menuId, v.lemonade.offerId, { grossPrice: "2.50" }),
    );
    // Unpublished, so still 3.00.
    const unpublished = await pay(v, [lemonadeLine(v)]);
    expect(((await unpublished.json()) as { total: string }).total).toBe("3.00");
    const v2 = await publish(v.menuId);
    const live = await pay(v, [lemonadeLine(v)]);
    expect(((await live.json()) as { total: string }).total).toBe("2.50");
    const [latest] = await suite.db
      .select({ menuVersionId: saleLines.menuVersionId })
      .from(saleLines)
      .innerJoin(sales, eq(sales.id, saleLines.saleId))
      .where(eq(sales.total, 250));
    expect(latest!.menuVersionId).toBe(v2);
  });

  it("looks up a version's menu only for a version that is not live, to name it in the refusal", async () => {
    const v = await setupLunch();
    const v1 = await publish(v.menuId);
    const session = (
      suite.db as unknown as { session: { prepareQuery: (q: { sql: string }) => unknown } }
    ).session;
    const prepared = vi.spyOn(session, "prepareQuery");
    const versionLookups = () =>
      prepared.mock.calls.filter(([query]) =>
        /select "id", "menu_id" from "menu_versions"/.test(query.sql),
      ).length;

    expect((await pay(v, [lemonadeLine(v, v1), lemonadeLine(v, v1)])).status).toBe(200);
    expect(versionLookups()).toBe(0);

    await withTransaction(suite.db, (tx) =>
      updateMenuItem(tx, v.menuId, v.lemonade.offerId, { grossPrice: "2.50" }),
    );
    const v2 = await publish(v.menuId);
    prepared.mockClear();
    const stale = await pay(v, [lemonadeLine(v, v1)]);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      error: {
        code: "menu.version_changed",
        params: { menus: [{ menuId: v.menuId, liveVersionId: v2 }] },
      },
    });
    expect(versionLookups()).toBe(1);
    prepared.mockRestore();
  });

  it("refuses, as a malformed request, a version of no menu, one that is not an id, and another menu's", async () => {
    const v = await setupLunch();
    await publish(v.menuId);
    const brunch = await withTransaction(suite.db, async (tx) => {
      const menu = await createCatalogue(tx, { name: "Brunch" });
      await addProductToMenu(tx, { menuId: menu.id, productId: v.burger.productId });
      await tx.execute(sql`
        insert into zone_menus (zone_id, menu_id, display_order) values (${v.zoneId}, ${menu.id}, 1)`);
      return publishWorkingMenu(tx, menu.id);
    });
    const before = await written();
    for (const menuVersionId of [randomUUID(), "not-an-id", 7, brunch]) {
      const response = await pay(v, [
        { ...lemonadeLine(v), menuVersionId } as ReturnType<typeof lemonadeLine>,
      ]);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "menuVersionId" } },
      });
    }
    expect(await written()).toEqual(before);
  });
});

describe("a menu deactivated after it was published", () => {
  it("is no longer offered, and a sale from it is refused with no sale, fiscal record or order written", async () => {
    const v = await setupLunch();
    const v1 = await publish(v.menuId);
    await withTransaction(suite.db, (tx) => deactivateCatalogue(tx, v.menuId));

    const offers = await send(v, "GET", `/api/service-zones/${v.zoneId}/offers`);
    expect(offers.status).toBe(200);
    expect(await offers.json()).toMatchObject({ defaultMenuId: null, menus: [], offers: [] });

    const before = await written();
    const unversioned = await pay(v, [lemonadeLine(v)]);
    expect(unversioned.status).toBe(400);
    expect(await unversioned.json()).toMatchObject({
      error: { code: "service_zone.offer_not_allowed" },
    });
    const versioned = await pay(v, [lemonadeLine(v, v1)]);
    expect(versioned.status).toBe(409);
    expect(await versioned.json()).toEqual({
      error: {
        code: "menu.version_changed",
        params: { menus: [{ menuId: v.menuId, liveVersionId: null }] },
      },
    });
    expect(await written()).toEqual(before);
  });
});

describe("the extras a line picks are priced from the published version", () => {
  const withLemon = (v: Lunch, menuVersionId?: string) => ({
    ...lemonadeLine(v, menuVersionId),
    extras: [
      { listId: v.extraLemon.listId, picks: [{ productId: v.extraLemon.productId, quantity: 1 }] },
    ],
  });

  it("charges the published price of an extra whose list price changed since", async () => {
    const v = await setupLunch();
    await publish(v.menuId);
    await withTransaction(suite.db, (tx) =>
      updateExtraList(
        tx,
        v.extraLemon.listId,
        {
          name: "Lemon",
          customerName: null,
          kitchenName: null,
          minPicks: 0,
          maxPicks: null,
          active: true,
          items: [
            {
              productId: v.extraLemon.productId,
              maxQuantity: 2,
              preselected: false,
              price: "0.90",
            },
          ],
        },
        LOCALE,
      ),
    );
    const response = await pay(v, [withLemon(v)]);
    expect(response.status).toBe(200);
    // 3.00 + the published 0.50, not the list's new 0.90.
    expect(((await response.json()) as { total: string }).total).toBe("3.50");
  });

  it("refuses an extra made unavailable, or withdrawn from the offer, after publishing", async () => {
    const v = await setupLunch();
    await publish(v.menuId);
    await withTransaction(suite.db, (tx) =>
      updateProduct(tx, v.extraLemon.productId, { available: false }),
    );
    const before = await written();
    const soldOut = await pay(v, [withLemon(v)]);
    expect(soldOut.status).toBe(400);
    expect(await soldOut.json()).toMatchObject({
      error: { code: "extras.invalid", params: { field: "productId" } },
    });
    await withTransaction(suite.db, (tx) =>
      updateProduct(tx, v.extraLemon.productId, { available: true }),
    );
    await withTransaction(suite.db, (tx) =>
      setMenuItemExtraLists(tx, v.lemonade.offerId, [
        {
          listId: v.extraLemon.listId,
          items: [{ productId: v.extraLemon.productId, price: null, available: false }],
        },
      ]),
    );
    const withdrawn = await pay(v, [withLemon(v)]);
    expect(withdrawn.status).toBe(400);
    expect(await withdrawn.json()).toMatchObject({
      error: { code: "extras.invalid", params: { field: "productId" } },
    });
    expect(await written()).toEqual(before);
  });
});

describe("an unavailable product keeps its place and cannot be ordered (Review Focus 5)", () => {
  it("serves it marked, and refuses a line for it product.unavailable", async () => {
    const v = await setupLunch();
    const v1 = await publish(v.menuId);
    await withTransaction(suite.db, (tx) =>
      updateProduct(tx, v.burger.productId, { available: false }),
    );
    const offers = (await (
      await send(v, "GET", `/api/service-zones/${v.zoneId}/offers`)
    ).json()) as {
      offers: { id: string; available: boolean }[];
    };
    const availability = new Map(offers.offers.map((offer) => [offer.id, offer.available]));
    expect(availability.get(v.lemonade.offerId)).toBe(true);
    expect(availability.get(v.burger.offerId)).toBe(false);

    const before = await written();
    const refused = await pay(v, [
      {
        menuItemId: v.burger.offerId,
        quantity: "1",
        menuVersionId: v1,
        options: [{ listId: v.punto.listId, labelId: v.punto.poco }],
      },
    ]);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({
      error: { code: "product.unavailable", params: { productId: v.burger.productId } },
    });
    expect(await written()).toEqual(before);
  });
});

describe("each fact reaches the till at its own moment (Review Focus 1, server half)", () => {
  it("serves the PUBLISHED allergens of a dish and its extra until the menu is republished", async () => {
    const v = await setupLunch();
    await publish(v.menuId);
    const sulphites = { sulphites: { presence: "contains" as const } };
    await suite.db
      .update(products)
      .set({ allergens: sulphites })
      .where(eq(products.id, v.lemonade.productId));
    await suite.db
      .update(products)
      .set({ allergens: sulphites })
      .where(eq(products.id, v.extraLemon.productId));

    const served = async () => {
      const body = (await (
        await send(v, "GET", `/api/service-zones/${v.zoneId}/offers`)
      ).json()) as {
        offers: {
          id: string;
          allergens: unknown;
          offeredModifiers: { kind: string; items?: { addAllergens: unknown }[] }[];
        }[];
      };
      const lemonade = body.offers.find((offer) => offer.id === v.lemonade.offerId)!;
      const extra = lemonade.offeredModifiers.find((entry) => entry.kind === "extras")!.items![0]!;
      return { dish: lemonade.allergens, extra: extra.addAllergens };
    };
    expect(await served()).toEqual({ dish: null, extra: null });
    await publish(v.menuId);
    expect(await served()).toEqual({ dish: sulphites, extra: sulphites });
  });
});

describe("GET /api/menu-state", () => {
  type MenuState = {
    menus: { menuId: string; versionId: string }[];
    unavailable: {
      products: string[];
      optionLabels: string[];
      extraItems: { menuItemId: string; productId: string; extraListId: string }[];
    };
  };
  /** The answer, each menu narrowed to its version: the layout fields have their own cases. */
  const state = async (v: Lunch, query = `?zoneId=${v.zoneId}`): Promise<MenuState> => {
    const response = await send(v, "GET", `/api/menu-state${query}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as MenuState;
    return { ...body, menus: body.menus.map(({ menuId, versionId }) => ({ menuId, versionId })) };
  };
  const nothing = { products: [], optionLabels: [], extraItems: [] };

  it("lists a product made unavailable without moving the version, and clears it when restored", async () => {
    const v = await setupLunch();
    const v1 = await publish(v.menuId);
    expect(await state(v)).toEqual({
      menus: [{ menuId: v.menuId, versionId: v1 }],
      unavailable: nothing,
    });

    const setBurger = (available: boolean) =>
      withTransaction(suite.db, (tx) => updateProduct(tx, v.burger.productId, { available }));
    await setBurger(false);
    expect(await state(v)).toEqual({
      menus: [{ menuId: v.menuId, versionId: v1 }],
      unavailable: { ...nothing, products: [v.burger.productId] },
    });
    const status = await withTransaction(suite.db, (tx) => menuStatus(tx, [v.menuId]));
    expect(status.get(v.menuId)?.state).toBe("current");
    await setBurger(true);
    expect((await state(v)).unavailable).toEqual(nothing);
  });

  it("lists an option label and a per-offer extras item switched off, and clears them", async () => {
    const v = await setupLunch();
    await publish(v.menuId);
    const setPoco = (available: boolean) =>
      suite.db.update(optionLabels).set({ available }).where(eq(optionLabels.id, v.punto.poco));
    const setLemon = (available: boolean) =>
      withTransaction(suite.db, (tx) =>
        setMenuItemExtraLists(tx, v.lemonade.offerId, [
          {
            listId: v.extraLemon.listId,
            items: [{ productId: v.extraLemon.productId, price: null, available }],
          },
        ]),
      );
    await setPoco(false);
    await setLemon(false);
    expect((await state(v)).unavailable).toEqual({
      products: [],
      optionLabels: [v.punto.poco],
      extraItems: [
        {
          menuItemId: v.lemonade.offerId,
          productId: v.extraLemon.productId,
          extraListId: v.extraLemon.listId,
        },
      ],
    });
    await setPoco(true);
    await setLemon(true);
    expect((await state(v)).unavailable).toEqual(nothing);
  });

  it("answers for the default zone when no zone is named, and refuses an unknown zone", async () => {
    const v = await setupLunch();
    const v1 = await publish(v.menuId);
    expect((await state(v, "")).menus).toEqual([{ menuId: v.menuId, versionId: v1 }]);
    const unknown = await send(v, "GET", `/api/menu-state?zoneId=${randomUUID()}`);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: "service_zone.not_found" } });
  });

  it("refuses a request without a till session", async () => {
    const v = await setupLunch();
    await publish(v.menuId);
    const response = await v.app.request(`/api/menu-state?zoneId=${v.zoneId}`);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "session.required" } });
  });
});

describe("the home layout each menu shows the device (D14)", () => {
  type LayoutState = {
    menus: { menuId: string; versionId: string; homeLayoutId: string; layoutFallback: unknown }[];
  };
  const layoutsOf = async (v: Lunch, query = `?zoneId=${v.zoneId}`, cookie = v.cookie) => {
    const response = await v.app.request(`/api/menu-state${query}`, { headers: { cookie } });
    expect(response.status).toBe(200);
    return ((await response.json()) as LayoutState).menus.map(
      ({ menuId, homeLayoutId, layoutFallback }) => ({ menuId, homeLayoutId, layoutFallback }),
    );
  };
  const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, fn);
  const homeOf = async (menuId: string) => (await app((tx) => listHomeLayouts(tx, menuId)))[0]!.id;

  it("keeps showing a chosen layout deleted since the publish, and the default once a republish leaves it out", async () => {
    const v = await setupLunch();
    const counter = (await app((tx) => createHomeLayout(tx, v.menuId, "Counter"))).id;
    await app((tx) => setDeviceHomeLayout(tx, v.profileId, v.menuId, counter));
    await publish(v.menuId);
    const chosen = [{ menuId: v.menuId, homeLayoutId: counter, layoutFallback: null }];
    expect(await layoutsOf(v)).toEqual(chosen);

    await app((tx) => deleteHomeLayout(tx, counter));
    expect(await layoutsOf(v)).toEqual(chosen);

    await publish(v.menuId);
    expect(await layoutsOf(v)).toEqual([
      { menuId: v.menuId, homeLayoutId: await homeOf(v.menuId), layoutFallback: "layout_removed" },
    ]);
  });

  it("shows the default for a chosen layout never published, and a rename changes nothing", async () => {
    const v = await setupLunch();
    await publish(v.menuId);
    const counter = (await app((tx) => createHomeLayout(tx, v.menuId, "Counter"))).id;
    await app((tx) => setDeviceHomeLayout(tx, v.profileId, v.menuId, counter));
    expect(await layoutsOf(v)).toEqual([
      {
        menuId: v.menuId,
        homeLayoutId: await homeOf(v.menuId),
        layoutFallback: "layout_unpublished",
      },
    ]);

    await publish(v.menuId);
    const chosen = [{ menuId: v.menuId, homeLayoutId: counter, layoutFallback: null }];
    expect(await layoutsOf(v)).toEqual(chosen);
    await app((tx) => renameHomeLayout(tx, counter, "Front counter"));
    expect(await layoutsOf(v)).toEqual(chosen);
    await publish(v.menuId);
    expect(await layoutsOf(v)).toEqual(chosen);
  });

  it("resolves each of the zone's menus from its own choice, with or without a zone named", async () => {
    const v = await setupLunch();
    const brunch = await app(async (tx) => {
      const menu = await createCatalogue(tx, { name: "Brunch" });
      await addProductToMenu(tx, { menuId: menu.id, productId: v.burger.productId });
      await tx.execute(sql`
        insert into zone_menus (zone_id, menu_id, display_order) values (${v.zoneId}, ${menu.id}, 1)`);
      return menu.id;
    });
    const counter = (await app((tx) => createHomeLayout(tx, v.menuId, "Counter"))).id;
    const bar = (await app((tx) => createHomeLayout(tx, brunch, "Bar"))).id;
    await app(async (tx) => {
      await setDeviceHomeLayout(tx, v.profileId, v.menuId, counter);
      await setDeviceHomeLayout(tx, v.profileId, brunch, bar);
    });
    await publish(v.menuId);
    await publish(brunch);
    const expected = [
      { menuId: v.menuId, homeLayoutId: counter, layoutFallback: null },
      { menuId: brunch, homeLayoutId: bar, layoutFallback: null },
    ];
    expect(await layoutsOf(v)).toEqual(expected);
    expect(await layoutsOf(v, "")).toEqual(expected);
  });

  it("shows the default to a device whose profile chose nothing, and to a session with no device", async () => {
    const v = await setupLunch();
    await publish(v.menuId);
    const home = [{ menuId: v.menuId, homeLayoutId: await homeOf(v.menuId), layoutFallback: null }];
    expect(await layoutsOf(v)).toEqual(home);
    const counter = (await app((tx) => createHomeLayout(tx, v.menuId, "Counter"))).id;
    await app((tx) => setDeviceHomeLayout(tx, v.profileId, v.menuId, counter));
    await publish(v.menuId);
    expect(await layoutsOf(v, `?zoneId=${v.zoneId}`, v.sessionCookie)).toEqual(home);
    expect(await layoutsOf(v, "", v.sessionCookie)).toEqual(home);
  });

  it("serves each menu's structure, layouts and the device's layout on both offers routes", async () => {
    const v = await setupLunch();
    await app((tx) => updateSection(tx, v.postresId, { names: { [LOCALE]: "Para terminar" } }));
    const counter = (await app((tx) => createHomeLayout(tx, v.menuId, "Counter"))).id;
    await app(async (tx) => {
      await addShortcut(tx, counter, { kind: "section", sectionId: v.postresId });
      await setDeviceHomeLayout(tx, v.profileId, v.menuId, counter);
    });
    const versionId = await publish(v.menuId);
    const home = await homeOf(v.menuId);
    const served = async (path: string, cookie = v.cookie) => {
      const response = await v.app.request(path, { headers: { cookie } });
      expect(response.status).toBe(200);
      return (await response.json()) as {
        menus: unknown[];
        offers: { id: string; productId: string }[];
      };
    };
    const zonePath = `/api/service-zones/${v.zoneId}/offers`;
    const flanOffer = (await served(zonePath)).offers.find(
      (offer) => offer.productId === v.flanId,
    )!.id;
    const lunch = {
      id: v.menuId,
      name: "Lunch",
      isDefault: true,
      versionId,
      structure: {
        members: [
          { kind: "product", menuItemId: v.lemonade.offerId, productId: v.lemonade.productId },
          { kind: "product", menuItemId: v.burger.offerId, productId: v.burger.productId },
          {
            kind: "section",
            sectionId: v.postresId,
            internalName: "Postres",
            names: { [LOCALE]: "Para terminar" },
            image: null,
            color: null,
            members: [{ kind: "product", menuItemId: flanOffer, productId: v.flanId }],
          },
        ],
      },
      homeLayouts: [
        { id: home, name: "Home", tiles: [] },
        { id: counter, name: "Counter", tiles: [{ kind: "section", sectionId: v.postresId }] },
      ],
      defaultHomeLayoutId: home,
      homeLayoutId: counter,
      layoutFallback: null,
    };
    for (const path of [zonePath, "/api/default-service-zone/offers"])
      expect((await served(path)).menus).toEqual([lunch]);
    // Without the device, the same menus show the default layout.
    expect((await served(zonePath, v.sessionCookie)).menus).toEqual([
      { ...lunch, homeLayoutId: home },
    ]);
  });
});
