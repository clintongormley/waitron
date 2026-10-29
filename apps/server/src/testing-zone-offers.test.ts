import { addTabRound } from "./testing/order-writer-fixture.js";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  locations,
  ticketItems,
  withTransaction,
  workingOrderLines,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedKitchenStation, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  getOrderServiceContext,
  resolveZoneContext,
  listZoneOffers,
  menuPeriods,
  zoneServicePolicies,
} from "@waitron/venue-service";
import { offerMenuThroughZone } from "@waitron/venue-service/testing/zone-menus.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createExtraList,
  addProductToMenu,
  createProduct,
  writeProductModifiers,
} from "@waitron/catalogue";
import { locationId as brandLocationId, nodeId as brandNodeId, jobOrigin } from "@waitron/shared";
import { parkOrder } from "./working-order.js";
import { createStation } from "./kitchen.js";
import { createTable } from "./testing/live-table.js";
import type { OriginConfig } from "./trading-context.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { routeCategoryTo, routeProductTo, offerProducts } from "./testing/zone-offers.js";
import "./errors.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { openPartyTab } from "./testing/serve-line.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

interface Venue {
  cfg: OriginConfig;
  catalogueId: string;
  coffee: string;
  toast: string;
  water: string;
  sugar: string;
  extrasListId: string;
  stations: { kitchen: string; counter: string; pass: string };
}

async function seedVenue(db: Database): Promise<Venue> {
  await seedTenant(db);
  await seedLegacySellingUnits(db);
  const [loc] = await db
    .insert(locations)
    .values({ name: "Barra", invoiceLocales: ["es-ES"], operationDescription: "Retail" })
    .returning({ id: locations.id });
  const locationId = brandLocationId(loc!.id);
  const kitchen = await seedKitchenStation(db, { locationId });
  const cfg: OriginConfig = {
    origin: jobOrigin("dashboard"),
    nodeId: brandNodeId(await seedNode(db, locationId)),
    locationId,
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
  return withTransaction(db, async (tx) => {
    const menu = await createCatalogue(tx, { name: "Carta" });
    await assignCatalogueToLocation(tx, locationId, menu.id);
    const drinks = await createCategory(tx, { name: "Bebidas" });
    const food = await createCategory(tx, { name: "Comida" });
    const product = (name: string, unitPrice: string, categoryId: string | null) =>
      createProduct(tx, {
        catalogueId: menu.id,
        categoryId,
        name,
        pricingUnit: "each",
        unitPrice,
        vatClass: "general",
      });
    const coffee = await product("Café", "1.50", drinks.id);
    const toast = await product("Tostada", "2.00", food.id);
    const water = await product("Agua", "1.20", null);
    const sugar = await product("Azúcar", "0.10", null);
    const counter = await createStation(tx, cfg, { name: "Barra" });
    const pass = await createStation(tx, cfg, { name: "Pase" });
    await routeProductTo(tx, cfg, coffee.id, counter.id);
    await routeCategoryTo(tx, cfg, food.id, pass.id);
    const list = await createExtraList(
      tx,
      {
        name: "Añadidos",
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: null,
        active: true,
        items: [{ productId: sugar.id, maxQuantity: 1, preselected: false, price: "0.20" }],
      },
      "es",
    );
    await writeProductModifiers(tx, coffee.id, [{ kind: "extras", id: list.id }]);
    return {
      cfg,
      catalogueId: menu.id,
      coffee: coffee.id,
      toast: toast.id,
      water: water.id,
      sugar: sugar.id,
      extrasListId: list.id,
      stations: { kitchen, counter: counter.id, pass: pass.id },
    };
  });
}

async function soldLines(db: Database, orderId: string) {
  return db
    .select({
      productId: workingOrderLines.productId,
      unitPriceGross: workingOrderLines.unitPriceGross,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, orderId))
    .orderBy(workingOrderLines.lineNo);
}

async function counts(db: Database) {
  const { rows } = await db.execute<Record<string, number>>(sql`
    select
      (select count(*) from floor_zones) as zones,
      (select count(*) from zone_service_policies) as policies,
      (select count(*) from departments) as departments,
      (select count(*) from catalogues) as menus,
      (select count(*) from menu_periods) as periods,
      (select count(*) from menu_period_staff_menus) as staff_menus,
      (select count(*) from department_days) as timetables,
      (select count(*) from department_day_ranges) as slots,
      (select count(*) from menu_items) as items,
      (select count(*) from product_modifiers where extra_list_id is not null) as extras,
      (select count(*) from routing_cells) as routes`);
  return rows[0]!;
}

describe("offerProducts", () => {
  it("keeps both menus orderable overnight and preserves a customer menu on repeat", async () => {
    const venue = await seedVenue(suite.db);
    const first = await withTransaction(suite.db, async (tx) => {
      await tx
        .update(locations)
        .set({ timeZone: "UTC" })
        .where(eq(locations.id, venue.cfg.locationId));
      const offers = await offerProducts(tx, venue.cfg);
      await addProductToMenu(tx, {
        menuId: venue.catalogueId,
        productId: venue.coffee,
        grossPrice: "2.50",
      });
      await publishWorkingMenu(tx, venue.catalogueId);
      await offerMenuThroughZone(tx, venue.cfg, offers.zoneId, venue.catalogueId, {
        makeDefault: true,
      });
      return offers;
    });
    await withTransaction(suite.db, (tx) => offerProducts(tx, venue.cfg));
    const [savedPeriod] = await suite.db
      .select({ id: menuPeriods.id })
      .from(menuPeriods)
      .innerJoin(
        zoneServicePolicies,
        eq(zoneServicePolicies.departmentId, menuPeriods.departmentId),
      )
      .where(and(eq(zoneServicePolicies.zoneId, first.zoneId), eq(menuPeriods.name, "Always")));
    for (const hour of ["03", "15"]) {
      const served = await withTransaction(suite.db, (tx) =>
        listZoneOffers(tx, venue.cfg, first.zoneId, {
          at: new Date(`2026-10-08T${hour}:00:00Z`),
        }),
      );
      expect(served.defaultMenuId).toBe(venue.catalogueId);
      expect(served.service).toEqual({
        open: true,
        zoneOpen: true,
        periodName: "Always",
        periodOccurrenceKey: expect.any(String),
        zoneKeepOpen: null,
        keepOpen: {
          periodId: savedPeriod!.id,
          periodName: "Always",
          endsAt: "06:00",
          running: true,
        },
      });
      expect(
        served.menus.map(({ id, orderable, audience }) => ({ id, orderable, audience })),
      ).toEqual([
        { id: venue.catalogueId, orderable: true, audience: "customer" },
        { id: first.menuId, orderable: true, audience: "staff" },
      ]);
    }
  });

  it.each([
    { zone: "counter", orderStart: "table", paidWhen: "prepay", expected: "table_tab" },
    { zone: "tables", orderStart: "counter", paidWhen: "prepay", expected: "prepay" },
    {
      zone: "tables",
      orderStart: "counter",
      paidWhen: "ticket_then_pay",
      expected: "ticket_then_pay",
    },
  ] as const)(
    "starts $zone offers as $orderStart with $paidWhen payment timing",
    async ({ zone, orderStart, paidWhen, expected }) => {
      const venue = await seedVenue(suite.db);
      const offers = await withTransaction(suite.db, (tx) =>
        offerProducts(tx, venue.cfg, { zone, orderStart, paidWhen }),
      );
      const id = randomUUID();
      await parkOrder({ db: suite.db }, venue.cfg, {
        id,
        zoneId: offers.zoneId,
        lines: offers.toOfferLines([{ productId: venue.coffee, quantity: "1" }]),
      });
      const context = await withTransaction(suite.db, (tx) =>
        getOrderServiceContext(tx, venue.cfg, id),
      );
      expect(context).toEqual({
        zoneId: offers.zoneId,
        departmentId: expect.any(String),
        serviceMode: expected,
      });
    },
  );

  it("defaults quick-sale offers to prepay without reading the retired till setting", async () => {
    const venue = await seedVenue(suite.db);
    const offers = await withTransaction(suite.db, (tx) => offerProducts(tx, venue.cfg));
    const context = await withTransaction(suite.db, (tx) =>
      resolveZoneContext(tx, venue.cfg, offers.zoneId),
    );
    expect(context.serviceMode).toBe("prepay");
  });

  it.each(["prepay", "ticket_then_pay"] as const)(
    "snapshots explicit %s zone payment timing onto a quick sale",
    async (paidWhen) => {
      const venue = await seedVenue(suite.db);
      const offers = await withTransaction(suite.db, (tx) =>
        offerProducts(tx, venue.cfg, { paidWhen }),
      );
      const id = randomUUID();
      await parkOrder({ db: suite.db }, venue.cfg, {
        id,
        zoneId: offers.zoneId,
        lines: offers.toOfferLines([{ productId: venue.coffee, quantity: "1" }]),
      });
      const context = await withTransaction(suite.db, (tx) =>
        getOrderServiceContext(tx, venue.cfg, id),
      );
      expect(context).toEqual({
        zoneId: offers.zoneId,
        departmentId: expect.any(String),
        serviceMode: paidWhen,
      });
    },
  );

  it("offers each product at the product's own price, even beside a menu that reprices it", async () => {
    const venue = await seedVenue(suite.db);
    const offers = await withTransaction(suite.db, (tx) => offerProducts(tx, venue.cfg));
    await withTransaction(suite.db, async (tx) => {
      await addProductToMenu(tx, {
        menuId: venue.catalogueId,
        productId: venue.coffee,
        grossPrice: "2.50",
      });
      await offerMenuThroughZone(tx, venue.cfg, offers.zoneId, venue.catalogueId);
    });

    const id = randomUUID();
    await parkOrder({ db: suite.db }, venue.cfg, {
      id,
      zoneId: offers.zoneId,
      lines: offers.toOfferLines([
        { productId: venue.coffee, quantity: "1" },
        { productId: venue.water, quantity: "2" },
      ]),
    });
    expect(await soldLines(suite.db, id)).toEqual([
      { productId: venue.coffee, unitPriceGross: 150 },
      { productId: venue.water, unitPriceGross: 120 },
    ]);
  });

  it("publishes a product's extras lists on its offer, so a pick sells", async () => {
    const venue = await seedVenue(suite.db);
    const offers = await withTransaction(suite.db, (tx) => offerProducts(tx, venue.cfg));
    const id = randomUUID();
    await parkOrder({ db: suite.db }, venue.cfg, {
      id,
      zoneId: offers.zoneId,
      lines: offers.toOfferLines([
        {
          productId: venue.coffee,
          quantity: "1",
          extras: [
            { listId: venue.extrasListId, picks: [{ productId: venue.sugar, quantity: 1 }] },
          ],
        },
      ]),
    });
    expect(await soldLines(suite.db, id)).toEqual([
      { productId: venue.coffee, unitPriceGross: 150 },
      { productId: venue.sugar, unitPriceGross: 20 },
    ]);
  });

  it("keeps an explicit counter style separate from a table-tab zone", async () => {
    const venue = await seedVenue(suite.db);
    const context = await withTransaction(suite.db, async (tx) => {
      const counter = await offerProducts(tx, venue.cfg, { orderStart: "counter" });
      const tables = await offerProducts(tx, venue.cfg, { zone: "tables" });
      return {
        counter: await resolveZoneContext(tx, venue.cfg, counter.zoneId),
        tables: await resolveZoneContext(tx, venue.cfg, tables.zoneId),
      };
    });
    expect(context.counter.serviceMode).toBe("prepay");
    expect(context.tables.serviceMode).toBe("table_tab");
    expect(context.tables.zoneId).not.toBe(context.counter.zoneId);
  });

  it("an explicit counter paid-at-collection policy answers ticket_then_pay", async () => {
    const venue = await seedVenue(suite.db);
    const context = await withTransaction(suite.db, async (tx) => {
      const counter = await offerProducts(tx, venue.cfg, {
        orderStart: "counter",
        paidWhen: "ticket_then_pay",
      });
      return resolveZoneContext(tx, venue.cfg, counter.zoneId);
    });
    expect(context.serviceMode).toBe("ticket_then_pay");
  });

  it("fires each line to the station the product, its category or the venue default would pick", async () => {
    const venue = await seedVenue(suite.db);
    const tabId = await withTransaction(suite.db, async (tx) => {
      const offers = await offerProducts(tx, venue.cfg, { zone: "tables" });
      const table = await createTable(tx, venue.cfg, { label: "T1", zoneId: offers.zoneId });
      const { tabId } = await openPartyTab(tx, venue.cfg, { tableId: table.id });
      await addTabRound(
        tx,
        venue.cfg,
        tabId,
        offers.toOfferLines(
          [venue.coffee, venue.toast, venue.water].map((productId) => ({
            productId,
            quantity: "1",
          })),
        ),
      );
      return tabId;
    });
    const fired = await suite.db
      .select({ productId: workingOrderLines.productId, stationId: ticketItems.stationId })
      .from(ticketItems)
      .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
      .where(eq(ticketItems.workingOrderId, tabId))
      .orderBy(workingOrderLines.lineNo);
    expect(fired).toEqual([
      { productId: venue.coffee, stationId: venue.stations.counter },
      { productId: venue.toast, stationId: venue.stations.pass },
      { productId: venue.water, stationId: venue.stations.kitchen },
    ]);
  });

  it("refuses a zoned dish when no rule matches and the default is switched off", async () => {
    const venue = await seedVenue(suite.db);
    await expect(
      withTransaction(suite.db, async (tx) => {
        await tx.execute(
          sql`update kitchen_stations set active = 0 where id = ${venue.stations.kitchen}`,
        );
        const offers = await offerProducts(tx, venue.cfg, { zone: "tables" });
        const table = await createTable(tx, venue.cfg, { label: "T1", zoneId: offers.zoneId });
        const { tabId } = await openPartyTab(tx, venue.cfg, { tableId: table.id });
        await addTabRound(
          tx,
          venue.cfg,
          tabId,
          offers.toOfferLines([{ productId: venue.water, quantity: "1" }]),
        );
      }),
    ).rejects.toMatchObject({ code: "station.no_default" });
  });

  it("is harmless to call twice, and offers a product added between the calls", async () => {
    const venue = await seedVenue(suite.db);
    const first = await withTransaction(suite.db, (tx) => offerProducts(tx, venue.cfg));
    const before = await counts(suite.db);
    const again = await withTransaction(suite.db, (tx) => offerProducts(tx, venue.cfg));
    expect(await counts(suite.db)).toEqual(before);
    expect(again.zoneId).toBe(first.zoneId);
    expect(again.menuId).toBe(first.menuId);
    expect(again.offerFor(venue.coffee)).toBe(first.offerFor(venue.coffee));

    const bread = await withTransaction(suite.db, (tx) =>
      createProduct(tx, {
        catalogueId: venue.catalogueId,
        categoryId: null,
        name: "Pan",
        pricingUnit: "each",
        unitPrice: "0.80",
        vatClass: "reduced",
      }),
    );
    const third = await withTransaction(suite.db, (tx) => offerProducts(tx, venue.cfg));
    const id = randomUUID();
    await parkOrder({ db: suite.db }, venue.cfg, {
      id,
      zoneId: third.zoneId,
      lines: third.toOfferLines([{ productId: bread.id, quantity: "1" }]),
    });
    expect(await soldLines(suite.db, id)).toEqual([{ productId: bread.id, unitPriceGross: 80 }]);
  });

  it("takes an extras list off the offer once the product stops carrying it", async () => {
    const venue = await seedVenue(suite.db);
    await withTransaction(suite.db, (tx) => offerProducts(tx, venue.cfg));
    expect((await counts(suite.db)).extras).toBe(1);
    await withTransaction(suite.db, (tx) => writeProductModifiers(tx, venue.coffee, []));
    await withTransaction(suite.db, (tx) => offerProducts(tx, venue.cfg));
    expect((await counts(suite.db)).extras).toBe(0);
  });

  it("names the product when asked for one it does not offer", async () => {
    const venue = await seedVenue(suite.db);
    const offers = await withTransaction(suite.db, (tx) =>
      offerProducts(tx, venue.cfg, { productIds: [venue.coffee] }),
    );
    expect(() => offers.offerFor(venue.water)).toThrow(venue.water);
    expect(() => offers.toOfferLines([{ productId: venue.water, quantity: "1" }])).toThrow(
      venue.water,
    );
  });
});
