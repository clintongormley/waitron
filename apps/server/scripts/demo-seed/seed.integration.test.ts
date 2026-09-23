// End-to-end proof of the whole demo seed (Phase 2, Task 12): migrate → provision a chained venue →
// `seedDemoRestaurant`, then assert the pieces Tasks 1-11 built actually COMPOSE — the reports light
// up, both menus are accessible, products come from both catalogues, a seeded product's `image`
// resolves to database image bytes, and a working order MIXING a Casa Delgado item with a
// Menú del Día item parks and retrieves without `sale.unknown_product`. That last assertion is the
// end-to-end proof of Phase 1's union-reprice: `parkOrder` re-prices the basket against the
// location's WHOLE accessible catalogue set, so a line drawn from a non-default menu must resolve.
//
// SQLite has no roles, and every call below runs on the one handle. Nothing now checks who
// may write any seeded table. `seedSales` still writes real hash-chained preproduction
// `registros_facturacion` rows through `recordSale`, and the append-only triggers `useVenueDb`
// installs still fire.
//
// Preproduction only: `WAITRON_ENV` is left unset, which `deploymentEnvironment` resolves to
// `preproduction` — the safe default `seedSales` stamps (a wrong `entorno` is unrecoverable, §5).
//
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { ALL_MODULES } from "../../src/modules.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { listAccessibleCatalogues, listAvailableProducts } from "@waitron/catalogue";
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

// One NIF per provisioned venue. `useVenueDb`'s per-test reset empties every data table, so the
// counter no longer keeps two tests apart; it keeps two `provisionVenue` calls within a test apart.
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

/** Provision a fresh chained venue (as the owner) and return the ids the orchestrator needs. */
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

/** The till dependency bundle for the park/retrieve path — the same shape `boot.ts` assembles. */
function tillConfigFor(venue: Venue): TillConfig {
  return {
    tillId: brandTillId(venue.tillId),
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesId),
    locationId: brandLocationId(venue.locationId),
    // Fiscal config takes the FULL tag the bare content locale files under (feature B).
    locale: SEED_INVOICE_LOCALE[LOCALE],
    invoiceLocales: [SEED_INVOICE_LOCALE[LOCALE]],
    // The park/retrieve path reads neither a card provider nor tips; fresh safe values keep the shape whole.
    tipsEnabled: false,
    orderFlow: "prepay",
  };
}

describe("demo seed end-to-end", () => {
  it("seeds a venue whose reports, menus, media, and mixed order all compose", async () => {
    const venue = await provisionVenue();
    const start = Date.now();

    // A small horizon so the back-dated sales are cheap but non-empty (fills yesterday fully).
    await seedDemoRestaurant(suite.db, { venue, locale: LOCALE, salesDays: 3 });

    // --- Read the seeded catalogue set and a business day's close in one transaction. ---
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

    // (1) Reporting: the VAT summary, cash-up and their counts are all NON-EMPTY for a seeded day.
    expect(read.close.vat.byRate.length).toBeGreaterThan(0);
    expect(compareDecimal(read.close.vat.taxTotal, decimal("0.00"))).toBeGreaterThan(0);
    expect(read.close.cash.byTill.length).toBeGreaterThan(0);
    expect(compareDecimal(read.close.cash.tenderTotal, decimal("0.00"))).toBeGreaterThan(0);
    expect(read.close.counts.sales).toBeGreaterThan(0);

    // (2) Catalogues: all demo menus are accessible, Casa Delgado sorts FIRST and is the default.
    expect(read.menus.map((m) => m.name)).toEqual([
      "Casa Delgado",
      "Deli takeaway",
      "Menú del Día",
    ]);
    expect(read.menus[0]!.isDefault).toBe(true);
    const menuDelDia = read.menus.find((m) => m.name === "Menú del Día")!;
    expect(menuDelDia.isDefault).toBe(false);

    // (3) Products come from BOTH catalogues (the union read — each row tagged with its menu).
    const casaProducts = read.products.filter((p) => p.catalogueName === "Casa Delgado");
    const diaProducts = read.products.filter((p) => p.catalogueName === "Menú del Día");
    expect(casaProducts.length).toBeGreaterThan(0);
    expect(diaProducts.length).toBeGreaterThan(0);

    // Pick a product from each menu that has nothing a line MUST answer, so parking it with no
    // selections is valid. Products sort by `(created_at, id)` and the seed inserts them in one
    // burst, so `created_at` ties and the random-uuid `id` breaks the tie — which product sorts
    // first varies run to run. An ACTIVE options list must be answered
    // (`validateOptionSelections`, packages/catalogue/src/option-contract.ts, throws
    // `options.label_required` for one that is not), and an extras list with `minPicks > 0` must be
    // too, so a product offering either is skipped; any other proves the same cross-menu
    // union-reprice.
    const optionFree = (p: (typeof read.products)[number]): boolean =>
      !p.offeredModifiers.some(
        (entry) => entry.kind === "options" || (entry.kind === "extras" && entry.minPicks > 0),
      );
    const casaProduct = casaProducts.find(optionFree) ?? casaProducts[0]!;
    const diaProduct = diaProducts.find(optionFree) ?? diaProducts[0]!;

    // (4) Media: a sampled product's `image` is a content-addressed name that BOTH matches the served
    // filename shape AND resolves to image bytes in the database.
    expect(read.image).not.toBeNull();
    expect(read.image!).toMatch(MEDIA_FILENAME);
    const storedImage = await withTransaction(suite.db, async (tx) => {
      return readImageBytes(tx, read.image!);
    });
    expect(storedImage?.contentType).toBe("image/webp");
    expect(storedImage!.bytes.length).toBeGreaterThan(0);

    // (5) A working order MIXING a Casa Delgado item and a Menú del Día item parks and retrieves
    // WITHOUT `sale.unknown_product` — the end-to-end proof of Phase 1's union-reprice. `parkOrder`
    // re-prices the basket against the location's whole accessible set, so a non-default-menu line
    // must resolve. (`parkOrder` throws `sale.unknown_product` for any line it cannot price.)
    const cfg = tillConfigFor(venue);
    const orderId = randomUUID();
    const { orderNumber } = await parkOrder({ db: suite.db }, cfg, {
      id: orderId,
      lines: [
        { productId: casaProduct.id, quantity: "1" },
        { productId: diaProduct.id, quantity: "2" },
      ],
      label: "Mesa 4",
    });
    expect(orderNumber).toBeGreaterThan(0);

    const held = await getHeldOrder({ db: suite.db }, cfg, orderId);
    // Both mixed lines survived the round-trip, in order — neither was dropped as unknown.
    expect(held.lines.map((l) => l.productId)).toEqual([casaProduct.id, diaProduct.id]);
    expect(held.lines[1]!.quantity).toBe("2.000");
  });
});
