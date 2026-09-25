import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  locations,
  ticketItems,
  tills,
  withTransaction,
  workingOrderLines,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedKitchenStation, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { allowMenuInZone, resolveZoneContext } from "@waitron/venue-service";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createExtraList,
  addProductToMenu,
  createProduct,
  writeProductModifiers,
} from "@waitron/catalogue";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import { addTabRound, openTab, parkOrder } from "./working-order.js";
import { createStation, setCategoryStation, setProductStation } from "./kitchen.js";
import { createTable } from "./tables.js";
import type { TillConfig } from "./till-config.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { offerProducts } from "./testing/zone-offers.js";
import "./errors.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

interface Venue {
  cfg: TillConfig;
  catalogueId: string;
  cafe: string;
  tostada: string;
  agua: string;
  azucar: string;
  extrasListId: string;
  stations: { cocina: string; barra: string; pase: string };
}

// Three products, one per link of the legacy station chain: café names its own station, the
// tostada's category names one, and the agua has neither, so only the default station can take it.
async function seedVenue(db: Database): Promise<Venue> {
  await seedTenant(db);
  await seedLegacySellingUnits(db);
  const [loc] = await db
    .insert(locations)
    .values({ name: "Barra", invoiceLocales: ["es-ES"], operationDescription: "Retail" })
    .returning({ id: locations.id });
  const locationId = brandLocationId(loc!.id);
  const cocina = await seedKitchenStation(db, { locationId });
  const [till] = await db
    .insert(tills)
    .values({ locationId, name: "Caja 1" })
    .returning({ id: tills.id });
  const cfg: TillConfig = {
    tillId: brandTillId(till!.id),
    nodeId: brandNodeId(await seedNode(db, locationId)),
    seriesId: brandSeriesId(randomUUID()),
    locationId,
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    tipsEnabled: false,
    orderFlow: "ticket_then_pay",
  };
  return withTransaction(db, async (tx) => {
    const carta = await createCatalogue(tx, { name: "Carta" });
    await assignCatalogueToLocation(tx, locationId, carta.id);
    const bebidas = await createCategory(tx, { name: { en: "Bebidas" } });
    const comida = await createCategory(tx, { name: { en: "Comida" } });
    const product = (name: string, unitPrice: string, categoryId: string | null) =>
      createProduct(tx, {
        catalogueId: carta.id,
        categoryId,
        name,
        pricingUnit: "each",
        unitPrice,
        vatClass: "general",
      });
    const cafe = await product("Café", "1.50", bebidas.id);
    const tostada = await product("Tostada", "2.00", comida.id);
    const agua = await product("Agua", "1.20", null);
    const azucar = await product("Azúcar", "0.10", null);
    const barra = await createStation(tx, cfg, { name: "Barra" });
    const pase = await createStation(tx, cfg, { name: "Pase" });
    await setProductStation(tx, cfg, cafe.id, barra.id);
    await setCategoryStation(tx, cfg, comida.id, pase.id);
    const list = await createExtraList(
      tx,
      {
        name: "Añadidos",
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: null,
        active: true,
        items: [{ productId: azucar.id, maxQuantity: 1, preselected: false, price: "0.20" }],
      },
      "es",
    );
    await writeProductModifiers(tx, cafe.id, [{ kind: "extras", id: list.id }]);
    return {
      cfg,
      catalogueId: carta.id,
      cafe: cafe.id,
      tostada: tostada.id,
      agua: agua.id,
      azucar: azucar.id,
      extrasListId: list.id,
      stations: { cocina, barra: barra.id, pase: pase.id },
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
      (select count(*) from zone_menus) as zone_menus,
      (select count(*) from menu_items) as items,
      (select count(*) from menu_item_extra_lists) as extras,
      (select count(*) from preparation_routes) as routes`);
  return rows[0]!;
}

describe("offerProducts", () => {
  it("offers each product at the product's own price, even beside a menu that reprices it", async () => {
    const venue = await seedVenue(suite.db);
    const offers = await withTransaction(suite.db, (tx) => offerProducts(tx, venue.cfg));
    // A menu the suite already has, offering the café dearer in the same zone.
    await withTransaction(suite.db, async (tx) => {
      await addProductToMenu(tx, {
        menuId: venue.catalogueId,
        productId: venue.cafe,
        grossPrice: "2.50",
      });
      await allowMenuInZone(tx, venue.cfg, offers.zoneId, venue.catalogueId);
    });

    const id = randomUUID();
    await parkOrder({ db: suite.db }, venue.cfg, {
      id,
      zoneId: offers.zoneId,
      lines: offers.toOfferLines([
        { productId: venue.cafe, quantity: "1" },
        { productId: venue.agua, quantity: "2" },
      ]),
    });
    expect(await soldLines(suite.db, id)).toEqual([
      { productId: venue.cafe, unitPriceGross: 150 },
      { productId: venue.agua, unitPriceGross: 120 },
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
          productId: venue.cafe,
          quantity: "1",
          extras: [
            { listId: venue.extrasListId, picks: [{ productId: venue.azucar, quantity: 1 }] },
          ],
        },
      ]),
    });
    expect(await soldLines(suite.db, id)).toEqual([
      { productId: venue.cafe, unitPriceGross: 150 },
      { productId: venue.azucar, unitPriceGross: 20 },
    ]);
  });

  it("aligns the counter zone's mode with the till's flow, and a tables zone's with table_tab", async () => {
    const venue = await seedVenue(suite.db);
    const context = await withTransaction(suite.db, async (tx) => {
      const counter = await offerProducts(tx, venue.cfg);
      const tables = await offerProducts(tx, venue.cfg, { zone: "tables" });
      return {
        counter: await resolveZoneContext(tx, venue.cfg, counter.zoneId),
        tables: await resolveZoneContext(tx, venue.cfg, tables.zoneId),
      };
    });
    expect(context.counter.serviceMode).toBe("ticket_then_pay");
    expect(context.tables.serviceMode).toBe("table_tab");
    expect(context.tables.zoneId).not.toBe(context.counter.zoneId);
  });

  it("fires each line to the station the product, its category or the venue default would pick", async () => {
    const venue = await seedVenue(suite.db);
    const tabId = await withTransaction(suite.db, async (tx) => {
      const offers = await offerProducts(tx, venue.cfg, { zone: "tables" });
      const table = await createTable(tx, venue.cfg, { label: "T1", zoneId: offers.zoneId });
      const { tabId } = await openTab(tx, venue.cfg, { tableId: table.id });
      await addTabRound(
        tx,
        venue.cfg,
        tabId,
        offers.toOfferLines(
          [venue.cafe, venue.tostada, venue.agua].map((productId) => ({
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
      { productId: venue.cafe, stationId: venue.stations.barra },
      { productId: venue.tostada, stationId: venue.stations.pase },
      { productId: venue.agua, stationId: venue.stations.cocina },
    ]);
  });

  it("writes no route with routes: none, so a zoned fire has nowhere to go", async () => {
    const venue = await seedVenue(suite.db);
    await expect(
      withTransaction(suite.db, async (tx) => {
        const offers = await offerProducts(tx, venue.cfg, { zone: "tables", routes: "none" });
        const table = await createTable(tx, venue.cfg, { label: "T1", zoneId: offers.zoneId });
        const { tabId } = await openTab(tx, venue.cfg, { tableId: table.id });
        await addTabRound(
          tx,
          venue.cfg,
          tabId,
          offers.toOfferLines([{ productId: venue.agua, quantity: "1" }]),
        );
      }),
    ).rejects.toMatchObject({ code: "route.missing" });
  });

  it("is harmless to call twice, and offers a product added between the calls", async () => {
    const venue = await seedVenue(suite.db);
    const first = await withTransaction(suite.db, (tx) => offerProducts(tx, venue.cfg));
    const before = await counts(suite.db);
    const again = await withTransaction(suite.db, (tx) => offerProducts(tx, venue.cfg));
    expect(await counts(suite.db)).toEqual(before);
    expect(again.zoneId).toBe(first.zoneId);
    expect(again.menuId).toBe(first.menuId);
    expect(again.offerFor(venue.cafe)).toBe(first.offerFor(venue.cafe));

    const pan = await withTransaction(suite.db, (tx) =>
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
      lines: third.toOfferLines([{ productId: pan.id, quantity: "1" }]),
    });
    expect(await soldLines(suite.db, id)).toEqual([{ productId: pan.id, unitPriceGross: 80 }]);
  });

  it("names the product when asked for one it does not offer", async () => {
    const venue = await seedVenue(suite.db);
    const offers = await withTransaction(suite.db, (tx) =>
      offerProducts(tx, venue.cfg, { productIds: [venue.cafe] }),
    );
    expect(() => offers.offerFor(venue.agua)).toThrow(venue.agua);
    expect(() => offers.toOfferLines([{ productId: venue.agua, quantity: "1" }])).toThrow(
      venue.agua,
    );
  });
});
