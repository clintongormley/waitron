// The whole demo seed, end to end: the reports light up, the menus are accessible, a seeded
// product's `image` resolves to stored bytes, and a working order MIXING a Casa Delgado offer with
// a Menú del Día offer parks and retrieves in the counter zone. `WAITRON_ENV` is left unset, so
// `deploymentEnvironment` resolves to `preproduction` for the seeded sales.

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  listAccessibleCatalogues,
  listAvailableProducts,
  menuItems,
  readLiveDocuments,
  documentOffers,
} from "@waitron/catalogue";
import { zoneServicePolicies } from "@waitron/venue-service";
import { computeDailyClose } from "@waitron/reporting";
import {
  compareDecimal,
  decimal,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  jobOrigin,
  MEDIA_FILENAME,
} from "@waitron/shared";
import type { OriginConfig } from "../../src/till-config.js";
import { getHeldOrder, parkOrder } from "../../src/working-order.js";
import { readImageBytes } from "@waitron/media";
import { getCountryPack } from "@waitron/country-packs";
import { seedDemoRestaurant } from "./seed.js";
import { CASA_DELGADO_ES } from "./data-sets/casa-delgado-es.js";

import { SEED_INVOICE_LOCALE, type SeedLocale } from "./menu.js";
import { createDemoVenueProvisioner } from "./testing/provision-venue.js";

const LOCALE: SeedLocale = "en";
const DAY_MS = 24 * 60 * 60 * 1000;

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const provisionVenue = createDemoVenueProvisioner(() => suite.db, {
  nifBase: 95_000_000,
  invoiceLocale: SEED_INVOICE_LOCALE[LOCALE],
  nifFormat: "calculated",
  adminPin: "5555",
});

interface Venue {
  nodeId: string;
  seriesId: string;
  locationId: string;
}

function tillConfigFor(venue: Venue): OriginConfig {
  return {
    origin: jobOrigin("dashboard"),
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesId),
    locationId: brandLocationId(venue.locationId),
    locale: SEED_INVOICE_LOCALE[LOCALE],
    invoiceLocales: [SEED_INVOICE_LOCALE[LOCALE]],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
}

describe("demo seed end-to-end", () => {
  it("keeps the chicken's existing options when attaching its optional extras", async () => {
    const venue = await provisionVenue();
    await seedDemoRestaurant(suite.db, {
      venue,
      locale: LOCALE,
      salesDays: 0,
      departmentTradingNames: getCountryPack("ES")!.demo!.departmentTradingNames,
      dataSet: {
        ...CASA_DELGADO_ES,
        productOptionLists: [
          {
            productImage: "pollo-asado.png",
            lists: CASA_DELGADO_ES.productOptionLists[0]!.lists,
          },
        ],
      },
    });
    const { products } = await withTransaction(suite.db, (tx) =>
      listAvailableProducts(tx, venue.locationId),
    );
    const chicken = products.find((product) => product.name === "Pollo asado")!;
    expect(chicken.offeredModifiers.map((list) => [list.kind, list.name])).toEqual([
      ["options", "Punto"],
      ["extras", "Guarniciones"],
    ]);
  });

  it("seeds a venue whose reports, menus, media, and mixed order all compose", async () => {
    const venue = await provisionVenue();
    const start = Date.now();

    await seedDemoRestaurant(suite.db, {
      venue,
      locale: LOCALE,
      salesDays: 3,
      departmentTradingNames: getCountryPack("ES")!.demo!.departmentTradingNames,
      dataSet: CASA_DELGADO_ES,
    });

    const paired = await suite.db.execute<{ n: number }>(sql`select count(*) as n from devices`);
    expect(paired.rows[0]!.n).toBe(0);
    const origins = await suite.db.execute<{ source: string; device_id: string | null }>(
      sql`select distinct source, device_id from sales`,
    );
    expect(origins.rows).toEqual([{ source: "demo_seed", device_id: null }]);

    const read = await withTransaction(suite.db, async (tx) => {
      const menus = await listAccessibleCatalogues(tx, venue.locationId);
      const { products } = await listAvailableProducts(tx, venue.locationId);
      const documents = await readLiveDocuments(
        tx,
        menus.map((menu) => menu.id),
      );
      const publishedOffers = [...documents.values()].flatMap(({ document }) =>
        documentOffers(document),
      );
      const { rows: imageRows } = await tx.execute<{ image: string | null }>(
        sql`select image from products where image is not null limit 1`,
      );
      // Business day = yesterday (UTC), which the generator always fills fully and in the past.
      const businessDay = new Date(start - DAY_MS).toISOString().slice(0, 10);
      const close = await computeDailyClose(tx, {
        nodeId: brandNodeId(venue.nodeId),
        businessDay,
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
      });
      return { menus, products, publishedOffers, image: imageRows[0]?.image ?? null, close };
    });

    expect(read.close.vat.byRate.length).toBeGreaterThan(0);
    expect(compareDecimal(read.close.vat.taxTotal, decimal("0.00"))).toBeGreaterThan(0);
    expect(read.close.cash.byOrigin.length).toBeGreaterThan(0);
    expect(compareDecimal(read.close.cash.tenderTotal, decimal("0.00"))).toBeGreaterThan(0);
    expect(read.close.counts.sales).toBeGreaterThan(0);

    expect(read.menus.map((m) => m.name)).toEqual([
      "Casa Delgado",
      "Deli takeaway",
      "Drinks",
      "Menú del Día",
    ]);
    expect(read.menus[0]!.isDefault).toBe(true);
    const menuDelDia = read.menus.find((m) => m.name === "Menú del Día")!;
    expect(menuDelDia.isDefault).toBe(false);

    const chickens = [
      read.products.find((product) => product.name === "Pollo asado")!,
      read.publishedOffers.find((offer) => offer.name === "Pollo asado")!,
    ];
    for (const chicken of chickens) {
      expect(chicken.offeredModifiers).toHaveLength(1);
      expect(chicken.offeredModifiers[0]).toMatchObject({
        kind: "extras",
        name: "Guarniciones",
        customerName: { en: "Choose your sides", es: "Elige tus acompañamientos" },
        kitchenName: "GUARNICIÓN POLLO",
        minPicks: 0,
        maxPicks: 3,
        items: [
          {
            name: "Padrón peppers",
            price: "2.00",
            portion: "1.000",
            maxQuantity: 1,
            preselected: false,
          },
          {
            name: "Mixed salad",
            price: "1.50",
            portion: "1.000",
            maxQuantity: 1,
            preselected: false,
          },
          {
            name: "House bread",
            price: "0.50",
            portion: "1.000",
            maxQuantity: 1,
            preselected: false,
          },
        ],
      });
    }

    const casaProducts = read.products.filter((p) => p.catalogueName === "Casa Delgado");
    const diaProducts = read.products.filter((p) => p.catalogueName === "Menú del Día");
    expect(casaProducts.length).toBeGreaterThan(0);
    expect(diaProducts.length).toBeGreaterThan(0);

    // Pick a product from each menu that nothing on a line MUST answer, so parking it with no
    // selections is valid: an active options list, or an extras list with `minPicks > 0`, must be
    // answered.
    const optionFree = (p: (typeof read.products)[number]): boolean =>
      !p.offeredModifiers.some(
        (entry) => entry.kind === "options" || (entry.kind === "extras" && entry.minPicks > 0),
      );
    const casaProduct = casaProducts.find(optionFree) ?? casaProducts[0]!;
    const diaProduct = diaProducts.find(optionFree) ?? diaProducts[0]!;

    expect(read.image).not.toBeNull();
    expect(read.image!).toMatch(MEDIA_FILENAME);
    const storedImage = await withTransaction(suite.db, async (tx) => {
      return readImageBytes(tx, read.image!);
    });
    expect(storedImage?.contentType).toBe("image/webp");
    expect(storedImage!.bytes.length).toBeGreaterThan(0);

    // The counter zone sells from both menus, so the non-default menu's offer must resolve.
    const cfg = tillConfigFor(venue);
    const { zoneId, casaOffer, diaOffer } = await withTransaction(suite.db, async (tx) => {
      const [counter] = await tx
        .select({ zoneId: zoneServicePolicies.zoneId })
        .from(zoneServicePolicies)
        .where(
          and(
            eq(zoneServicePolicies.locationId, venue.locationId),
            eq(zoneServicePolicies.isCounterDefault, true),
          ),
        );
      const offerOf = async (product: { id: string; catalogueId: string }) => {
        const [item] = await tx
          .select({ id: menuItems.id })
          .from(menuItems)
          .where(
            and(eq(menuItems.menuId, product.catalogueId), eq(menuItems.productId, product.id)),
          );
        return item!.id;
      };
      return {
        zoneId: counter!.zoneId,
        casaOffer: await offerOf(casaProduct),
        diaOffer: await offerOf(diaProduct),
      };
    });
    const orderId = randomUUID();
    const { orderNumber } = await parkOrder({ db: suite.db }, cfg, {
      id: orderId,
      zoneId,
      lines: [
        { menuItemId: casaOffer, quantity: "1" },
        { menuItemId: diaOffer, quantity: "2" },
      ],
      label: "Mesa 4",
    });
    expect(orderNumber).toBeGreaterThan(0);

    const held = await getHeldOrder({ db: suite.db }, cfg, orderId);
    // Both mixed lines survived the round-trip, in order — neither was dropped as unknown.
    expect(held.lines.map((l) => l.productId)).toEqual([casaProduct.id, diaProduct.id]);
    expect(held.lines.map((l) => ("menuItemId" in l ? l.menuItemId : null))).toEqual([
      casaOffer,
      diaOffer,
    ]);
    expect(held.lines[1]!.quantity).toBe("2.000");
  });
});
