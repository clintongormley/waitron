import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
  listAvailableProducts,
} from "@waitron/catalogue";
import type { AvailableProduct } from "@waitron/catalogue";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import { asAppUser, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { createTable } from "./tables.js";
import { moveTab, openTab } from "./working-order.js";
import "./errors.js";

// Real Postgres, not PGlite — mandatory for THIS suite (CLAUDE.md §4). The concurrency property under
// test — two backends racing to move different tabs onto ONE free table, the loser serialising on the
// target `dining_tables` FOR UPDATE lock and surfacing `table.occupied` — is exactly what PGlite CANNOT
// show: it serialises every query onto ONE backend, so the race never happens (a FALSE pass, proven by
// the distinct-pid assertion below). Each racing backend opens its own via `suite.pg.connect()`, and the
// shared-container globalSetup (`testing/global-setup.ts`) THROWS its `dockerRequired` message rather
// than skipping when Docker is absent, so a vanished suite fails loudly instead of a green that proves
// nothing. The `manifest` template already carries the full CORE schema (dining_tables,
// table_service_statuses, the reset trigger) plus the cluster roles — nothing is migrated here.
const LOCALE = "es-ES";

const suite = useTemplateDb({ template: "manifest" });

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF — the same shape `working-order.rls.test.ts` uses.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(60_000_000 + nifCounter).padStart(8, "0")}K`;
}

function tillConfigFromVenue(venue: VenueResult): TillConfig {
  return {
    tenantId: brandTenantId(venue.tenantId),
    tillId: brandTillId(venue.tillId),
    nodeId: brandNodeId(venue.nodeId),
    // planVenue emits the standard series first, then the rectificative one.
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    // No integrated card terminal for these move/merge RLS suites.
    cardProvider: "none",
    tipsEnabled: false,
    orderFlow: "prepay",
  };
}

interface SeededVenue {
  cfg: TillConfig;
  available: AvailableProduct[];
  /** "Café" — each, 1.50 gross, general(21%). */
  cafe: AvailableProduct;
  /** "Agua" — each, 2.00 gross, general(21%). Same rate as café, so a two-line basket has one VAT group. */
  agua: AvailableProduct;
}

/**
 * Stand up a fresh chained venue + registered SIF (as the owner), then seed a catalogue as the app
 * role and read back two `each`/general(21%) products. Each test gets its OWN tenant so its state is
 * order-independent (CLAUDE.md §4).
 */
async function setupVenue(): Promise<SeededVenue> {
  const venue = await applyVenue(
    planVenue({
      country: "ES",
      taxId: nextNif(),
      legalName: "Deli Test SL",
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
      },
    }),
    { db: suite.admin },
  );

  const cfg = tillConfigFromVenue(venue);
  const available = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, { name: "Delicatessen" });
    const bebidas = await createCategory(tx, { name: "Bebidas" });
    await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      descriptions: { [LOCALE]: "Café" },
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      descriptions: { [LOCALE]: "Agua" },
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, venue.locationId, cat.id);
    return listAvailableProducts(tx, cfg.locationId);
  });
  const cafe = available.find((p) => p.descriptions[LOCALE] === "Café")!;
  const agua = available.find((p) => p.descriptions[LOCALE] === "Agua")!;
  return { cfg, available, cafe, agua };
}

/** Seed one active dining table in the venue as the app role; returns its id. */
async function seedTable(cfg: TillConfig, label: string): Promise<string> {
  return withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return createTable(tx, cfg, { label }).then((r) => r.id);
  });
}

/** Open a tab on a table as the app role; returns its tab (working_order) id. */
async function openTabOn(
  cfg: TillConfig,
  tableId: string,
  lines: { productId: string; quantity: string }[],
): Promise<string> {
  return withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return openTab(tx, cfg, { tableId, lines }).then((r) => r.tabId);
  });
}

/** The dining table's current tab_id — owner read (bypasses RLS). */
async function tabIdOf(tableId: string): Promise<string | null> {
  const { rows } = await suite.admin.execute<{ tab_id: string | null }>(
    sql`select tab_id from dining_tables where id = ${tableId}`,
  );
  return rows[0]!.tab_id;
}

describe("moveTab concurrency (the target FOR UPDATE lock IS the guard)", () => {
  it("two backends racing to move DIFFERENT tabs onto the SAME free table → one wins, the other gets table.occupied", async () => {
    const { cfg, cafe } = await setupVenue();
    const srcA = await seedTable(cfg, "RA");
    const srcB = await seedTable(cfg, "RB");
    const target = await seedTable(cfg, "RT");
    const tabA = await openTabOn(cfg, srcA, [{ productId: cafe.id, quantity: "1" }]);
    const tabB = await openTabOn(cfg, srcB, [{ productId: cafe.id, quantity: "1" }]);

    const [connA, connB] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
    try {
      const pids = await Promise.all(
        [connA, connB].map((d) =>
          d
            .execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)
            .then((r) => r.rows[0]!.pid),
        ),
      );
      expect(new Set(pids).size).toBe(2); // distinct backends — on PGlite these collapse (false pass).

      const attempt = (d: Database, tabId: string) =>
        withTenant(d, cfg.tenantId, async (tx) => {
          await asAppUser(tx);
          return moveTab(tx, cfg, tabId, target);
        });

      const results = await Promise.allSettled([attempt(connA, tabA), attempt(connB, tabB)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.filter((r) => r.status === "rejected");
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: "table.occupied",
        params: { tableId: target },
      });
      // Exactly one of the two tabs now covers the target; the other's source is untouched.
      expect(await tabIdOf(target)).not.toBeNull();
    } finally {
      await Promise.all([connA.close(), connB.close()]);
    }
  });
});
