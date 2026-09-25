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
import { applyVenue, planVenue } from "@waitron/provisioning";
import { ALL_MODULES } from "../../src/modules.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { listAccessibleCatalogues, listAvailableProducts, menuItems } from "@waitron/catalogue";
import { zoneServicePolicies } from "@waitron/venue-service";
import { computeDailyClose } from "@waitron/reporting";
import {
  compareDecimal,
  decimal,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TillConfig } from "../../src/till-config.js";
import { getHeldOrder, parkOrder } from "../../src/working-order.js";
import { MEDIA_FILENAME } from "@waitron/media";
import { readImageBytes } from "@waitron/media";
import { seedDemoRestaurant } from "./seed.js";

import { SEED_INVOICE_LOCALE, type SeedLocale } from "./menu.js";

const LOCALE: SeedLocale = "en";
const DAY_MS = 24 * 60 * 60 * 1000;

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

// One NIF per provisioned venue.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(95_000_000 + nifCounter).padStart(8, "0")}K`;
}

interface Venue {
  tillId: string;
  nodeId: string;
  seriesId: string;
  locationId: string;
}

async function provisionVenue(): Promise<Venue> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Casa Delgado SL",
        location: {
          name: "Sala principal",
          fiscalTerritory: "ES-common",
          invoiceLocales: [SEED_INVOICE_LOCALE[LOCALE]],
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
          pinHash: hashPin("5555"),
          passwordHash: hashPassword("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );
  return {
    tillId: venue.tillId,
    nodeId: venue.nodeId,
    // planVenue emits the standard series first, then the rectificative one.
    seriesId: venue.seriesIds[0]!,
    locationId: venue.locationId,
  };
}

function tillConfigFor(venue: Venue): TillConfig {
  return {
    tillId: brandTillId(venue.tillId),
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesId),
    locationId: brandLocationId(venue.locationId),
    locale: SEED_INVOICE_LOCALE[LOCALE],
    invoiceLocales: [SEED_INVOICE_LOCALE[LOCALE]],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
}

describe("demo seed end-to-end", () => {
  it("seeds a venue whose reports, menus, media, and mixed order all compose", async () => {
    const venue = await provisionVenue();
    const start = Date.now();

    await seedDemoRestaurant(suite.db, { venue, locale: LOCALE, salesDays: 3 });

    const read = await withTransaction(suite.db, async (tx) => {
      const menus = await listAccessibleCatalogues(tx, venue.locationId);
      const { products } = await listAvailableProducts(tx, venue.locationId);
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
      return { menus, products, image: imageRows[0]?.image ?? null, close };
    });

    expect(read.close.vat.byRate.length).toBeGreaterThan(0);
    expect(compareDecimal(read.close.vat.taxTotal, decimal("0.00"))).toBeGreaterThan(0);
    expect(read.close.cash.byTill.length).toBeGreaterThan(0);
    expect(compareDecimal(read.close.cash.tenderTotal, decimal("0.00"))).toBeGreaterThan(0);
    expect(read.close.counts.sales).toBeGreaterThan(0);

    expect(read.menus.map((m) => m.name)).toEqual([
      "Casa Delgado",
      "Deli takeaway",
      "Menú del Día",
    ]);
    expect(read.menus[0]!.isDefault).toBe(true);
    const menuDelDia = read.menus.find((m) => m.name === "Menú del Día")!;
    expect(menuDelDia.isDefault).toBe(false);

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
