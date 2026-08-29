// Real-Postgres proof of `seedDemoRestaurant` (Phase 2, Task 11): the orchestrator that wires the
// Task 6-10 sub-seeds together — catalogues → floor → staff → media (inside ONE
// `withTenant`/`asAppUser` tx), then the historical sales (its own per-sale tx, OUTSIDE that tx). This
// asserts every sub-seed actually ran: both menus present, the full floor, the staff, ≥1 back-dated
// sale, and a product's `image` rewritten to the content-addressed served name.
//
// Real Postgres (not PGlite): the sub-seeds run under RLS as `app_user` and `seedSales` writes real
// hash-chained preproduction `registros_facturacion` rows through `recordSale` — PGlite's superuser
// connection bypasses the FORCE-RLS/immutability guards and would prove nothing (CLAUDE.md §4). Uses
// the shared `manifest` template, cloned per file via `useTemplateDb`.
//
// Preproduction only: `WAITRON_ENV` is left unset, which `deploymentEnvironment` resolves to
// `preproduction` — the safe default `seedSales` stamps (a wrong `entorno` is unrecoverable, §5).

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { hashPassword, hashPin } from "@waitron/identity";
import { listAccessibleCatalogues, listAvailableProducts } from "@waitron/catalogue";
import { seedDemoRestaurant } from "./seed.js";

const LOCALE = "en-GB";

const suite = useTemplateDb({ template: "manifest" });

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF. A distinct base (90_000_000) keeps this suite's NIFs
// from colliding with seed-catalogue's 50M and seed-sales' 80M ranges on the shared container.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(90_000_000 + nifCounter).padStart(8, "0")}K`;
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
    seriesId: venue.seriesIds[0]!,
    locationId: venue.locationId,
  };
}

describe("seedDemoRestaurant", () => {
  let mediaDir: string;
  const priorMediaDir = process.env.WAITRON_MEDIA_DIR;

  beforeAll(async () => {
    // Point the media step at a throwaway dir, never the repo's dev media store.
    mediaDir = await mkdtemp(join(tmpdir(), "waitron-seed-media-"));
    process.env.WAITRON_MEDIA_DIR = mediaDir;
  });

  afterAll(async () => {
    if (priorMediaDir === undefined) delete process.env.WAITRON_MEDIA_DIR;
    else process.env.WAITRON_MEDIA_DIR = priorMediaDir;
    if (mediaDir !== undefined) await rm(mediaDir, { recursive: true, force: true });
  });

  it("runs every sub-seed: both menus, the floor, the staff, a sale, and content-addressed media", async () => {
    const venue = await provisionVenue();

    // A small horizon so the back-dated sales are cheap but non-empty.
    await seedDemoRestaurant(suite.admin, { venue, locale: LOCALE, salesDays: 2 });

    const read = await withTenant(suite.admin, venue.tenantId, async (tx) => {
      await asAppUser(tx);
      const menus = await listAccessibleCatalogues(tx, venue.locationId);
      const products = await listAvailableProducts(tx, venue.locationId);
      const { rows: tableRows } = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from dining_tables`,
      );
      const { rows: staffRows } = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from persons`,
      );
      const { rows: saleRows } = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from sales`,
      );
      return {
        menus,
        products,
        tables: tableRows[0]!.n,
        staff: staffRows[0]!.n,
        sales: saleRows[0]!.n,
      };
    });

    // Catalogues: both demo menus were seeded (seedCatalogues).
    expect(read.menus.map((m) => m.name).sort()).toEqual(["Casa Delgado", "Menú del Día"]);

    // Floor: the ~16-table demo plan (seedFloor seeds 22).
    expect(read.tables).toBeGreaterThanOrEqual(16);

    // Staff: the demo team (seedStaff seeds 6).
    expect(read.staff).toBeGreaterThanOrEqual(5);

    // Sales: at least one back-dated preproduction sale (seedSales).
    expect(read.sales).toBeGreaterThanOrEqual(1);

    // Products were seeded (feed the sales generator).
    expect(read.products.length).toBeGreaterThan(0);

    // Media: seedMedia rewrote each product's `image` to the served `<sha256hex>.png` name.
    // listAvailableProducts does not project `image`, so read one product's image directly.
    const { rows: imageRows } = await withTenant(suite.admin, venue.tenantId, async (tx) => {
      await asAppUser(tx);
      return tx.execute<{ image: string | null }>(
        sql`select image from products where image is not null limit 1`,
      );
    });
    expect(imageRows.length).toBe(1);
    expect(imageRows[0]!.image).toMatch(/^[0-9a-f]{64}\.png$/);
  });
});
