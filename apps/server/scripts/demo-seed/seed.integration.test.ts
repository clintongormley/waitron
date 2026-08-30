// End-to-end proof of the whole demo seed (Phase 2, Task 12): migrate → provision a chained venue →
// `seedDemoRestaurant`, then assert the pieces Tasks 1-11 built actually COMPOSE — the reports light
// up, both menus are accessible, products come from both catalogues, a seeded product's `image`
// resolves to a real file in the media store, and a working order MIXING a Casa Delgado item with a
// Menú del Día item parks and retrieves without `sale.unknown_product`. That last assertion is the
// end-to-end proof of Phase 1's union-reprice: `parkOrder` re-prices the basket against the
// location's WHOLE accessible catalogue set, so a line drawn from a non-default menu must resolve.
//
// Real Postgres (not PGlite): the sub-seeds run under RLS as `app_user`, `seedSales` writes real
// hash-chained preproduction `registros_facturacion` rows through `recordSale`, and `parkOrder`
// re-prices under the tenant GUC — PGlite's superuser connection bypasses the FORCE-RLS/immutability
// guards and would prove none of it (CLAUDE.md §4). Cloned per file from the shared `manifest`
// template via `useTemplateDb`.
//
// Preproduction only: `WAITRON_ENV` is left unset, which `deploymentEnvironment` resolves to
// `preproduction` — the safe default `seedSales` stamps (a wrong `entorno` is unrecoverable, §5).
//
// Media: `WAITRON_MEDIA_DIR` is repointed at a throwaway `mkdtemp` dir for the whole suite and torn
// down in `afterAll`, so the seed's ~44 content-addressed PNGs never touch the repo's dev media store.

import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { hashPassword, hashPin } from "@waitron/identity";
import { listAccessibleCatalogues, listAvailableProducts } from "@waitron/catalogue";
import { computeDailyClose } from "@waitron/reporting";
import {
  compareDecimal,
  decimal,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TillConfig } from "../../src/till-config.js";
import { getHeldOrder, parkOrder } from "../../src/working-order.js";
import { MEDIA_FILENAME } from "../../src/media-api.js";
import { seedDemoRestaurant } from "./seed.js";

const LOCALE = "en-GB";
const DAY_MS = 24 * 60 * 60 * 1000;

const suite = useTemplateDb({ template: "manifest" });

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF. A distinct base (95_000_000) keeps this suite's NIFs
// from colliding with seed.test's 90M, seed-sales' 80M and seed-catalogue's 50M ranges.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(95_000_000 + nifCounter).padStart(8, "0")}K`;
}

interface Venue {
  tenantId: string;
  tillId: string;
  nodeId: string;
  seriesId: string;
  locationId: string;
}

/** Provision a fresh chained venue (as the owner) and return the ids the orchestrator needs. */
async function provisionVenue(): Promise<Venue> {
  const venue = await applyVenue(
    planVenue({
      country: "ES",
      taxId: nextNif(),
      legalName: "Casa Delgado SL",
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
        pinHash: hashPin("5555"),
        passwordHash: hashPassword("dashPass123"),
      },
    }),
    { db: suite.admin },
  );
  return {
    tenantId: venue.tenantId,
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
    tenantId: brandTenantId(venue.tenantId),
    tillId: brandTillId(venue.tillId),
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesId),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    // The park/retrieve path reads neither a card provider nor tips; fresh safe values keep the shape whole.
    cardProvider: "none",
    tipsEnabled: false,
    orderFlow: "prepay",
  };
}

describe("demo seed end-to-end", () => {
  let mediaDir: string;
  const priorMediaDir = process.env.WAITRON_MEDIA_DIR;

  beforeAll(async () => {
    // Point the media step at a throwaway dir, never the repo's dev media store.
    mediaDir = await mkdtemp(join(tmpdir(), "waitron-seed-int-media-"));
    process.env.WAITRON_MEDIA_DIR = mediaDir;
  });

  afterAll(async () => {
    if (priorMediaDir === undefined) delete process.env.WAITRON_MEDIA_DIR;
    else process.env.WAITRON_MEDIA_DIR = priorMediaDir;
    if (mediaDir !== undefined) await rm(mediaDir, { recursive: true, force: true });
  });

  it("seeds a venue whose reports, both menus, media, and mixed order all compose", async () => {
    const venue = await provisionVenue();
    const start = Date.now();

    // A small horizon so the back-dated sales are cheap but non-empty (fills yesterday fully).
    await seedDemoRestaurant(suite.admin, { venue, locale: LOCALE, salesDays: 3 });

    // --- Read the seeded catalogue set and a business day's close in one tenant/app_user scope. ---
    const read = await withTenant(suite.admin, brandTenantId(venue.tenantId), async (tx) => {
      await asAppUser(tx);
      const menus = await listAccessibleCatalogues(tx, venue.locationId);
      const products = await listAvailableProducts(tx, venue.locationId);
      const { rows: imageRows } = await tx.execute<{ image: string | null }>(
        sql`select image from products where image is not null limit 1`,
      );
      // Business day = yesterday (UTC), which the generator always fills fully and in the past.
      const businessDay = new Date(start - DAY_MS).toISOString().slice(0, 10);
      const close = await computeDailyClose(tx, {
        tenantId: brandTenantId(venue.tenantId),
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

    // (2) Catalogues: both demo menus are accessible, Casa Delgado sorts FIRST and is the default.
    expect(read.menus.map((m) => m.name)).toEqual(["Casa Delgado", "Menú del Día"]);
    expect(read.menus[0]!.isDefault).toBe(true);
    const menuDelDia = read.menus.find((m) => m.name === "Menú del Día")!;
    expect(menuDelDia.isDefault).toBe(false);

    // (3) Products come from BOTH catalogues (the union read — each row tagged with its menu).
    const casaProducts = read.products.filter((p) => p.catalogueName === "Casa Delgado");
    const diaProducts = read.products.filter((p) => p.catalogueName === "Menú del Día");
    expect(casaProducts.length).toBeGreaterThan(0);
    expect(diaProducts.length).toBeGreaterThan(0);

    // (4) Media: a sampled product's `image` is a content-addressed name that BOTH matches the served
    // filename shape AND resolves to a real file in the temp media dir the seed wrote to.
    expect(read.image).not.toBeNull();
    expect(read.image!).toMatch(MEDIA_FILENAME);
    const fileStat = await stat(join(mediaDir, read.image!));
    expect(fileStat.isFile()).toBe(true);
    expect(fileStat.size).toBeGreaterThan(0);

    // (5) A working order MIXING a Casa Delgado item and a Menú del Día item parks and retrieves
    // WITHOUT `sale.unknown_product` — the end-to-end proof of Phase 1's union-reprice. `parkOrder`
    // re-prices the basket against the location's whole accessible set, so a non-default-menu line
    // must resolve. (`parkOrder` throws `sale.unknown_product` for any line it cannot price.)
    const cfg = tillConfigFor(venue);
    const orderId = randomUUID();
    const { orderNumber } = await parkOrder({ db: suite.admin }, cfg, {
      id: orderId,
      lines: [
        { productId: casaProducts[0]!.id, quantity: "1" },
        { productId: diaProducts[0]!.id, quantity: "2" },
      ],
      label: "Mesa 4",
    });
    expect(orderNumber).toBeGreaterThan(0);

    const held = await getHeldOrder({ db: suite.admin }, cfg, orderId);
    // Both mixed lines survived the round-trip, in order — neither was dropped as unknown.
    expect(held.lines.map((l) => l.productId)).toEqual([casaProducts[0]!.id, diaProducts[0]!.id]);
    expect(held.lines[1]!.quantity).toBe("2.000");
  });
});
