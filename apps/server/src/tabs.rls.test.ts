import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
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
import { addTabRound, openTab } from "./working-order.js";
import { startRealPostgres } from "./testing/postgres.js";
import "./errors.js";

// Real Postgres, not PGlite — mandatory for THIS suite (CLAUDE.md §4). The per-table `FOR UPDATE`
// concurrency guard is exactly what PGlite CANNOT show: it runs every connection as a superuser and
// serialises every query onto ONE backend, so a "two concurrent openTabs" test there is a FALSE pass,
// not a weak one. The race below opens its own backend via `suite.pg.connect()`, and
// `startRealPostgres` THROWS rather than skipping when Docker is absent, so a vanished suite fails
// loudly instead of reporting a green that proves nothing.
//
// This scaffolding (`useRealPostgres` `suite`, `nextNif`, `tillConfigFromVenue`, `setupVenue`) is
// verb-agnostic (owner-read SQL + venue setup), a sibling of `working-order.rls.test.ts`. Each task
// adds only the verb imports and owner-read helpers IT uses — this task imports `openTab` +
// `createTable` and reads `open` working-order counts; Tasks 5/7/8 extend it.
const LOCALE = "es-ES";

const suite = useRealPostgres({ start: startRealPostgres, timeoutMs: 180_000 });

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
    // No integrated card terminal for these working-order RLS suites.
    cardProvider: "none",
    tipsEnabled: false,
    orderFlow: "prepay",
  };
}

interface SeededVenue {
  cfg: TillConfig;
  /** "Café" — each, 1.50 gross, general(21%). */
  cafe: AvailableProduct;
  /** "Agua" — each, 2.00 gross, general(21%). Same rate as café, so a two-line basket has one VAT group. */
  agua: AvailableProduct;
}

/**
 * Stand up a fresh chained venue + registered SIF (as the owner), then seed a catalogue as the app
 * role and read back two `each`/general(21%) products. Each test gets its OWN tenant so its counts are
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
  return { cfg, cafe, agua };
}

/** Seed one active dining table in the venue as the app role; returns its id. */
async function seedTable(cfg: TillConfig, label: string): Promise<string> {
  return withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const { id } = await createTable(tx, cfg, { label });
    return id;
  });
}

/** How many OPEN working orders exist for the tenant — owner read (bypasses RLS). With the per-table
 *  FOR UPDATE lock, a race yields exactly ONE (the loser refuses BEFORE creating its order); without the
 *  lock, both create one → 2, and the table's single tab_id points at only one, orphaning the other. */
async function openOrderCount(cfg: TillConfig): Promise<number> {
  const { rows } = await suite.admin.execute<{ n: string }>(
    sql`select count(*)::text as n from working_orders where tenant_id = ${cfg.tenantId} and status = 'open'`,
  );
  return Number(rows[0]!.n);
}

describe("openTab concurrency (one open tab per table; the per-table lock IS the guard)", () => {
  it("two backends racing to open a tab on the SAME table → exactly one wins, the other gets tab.already_open", async () => {
    const { cfg, cafe } = await setupVenue();
    const tableId = await seedTable(cfg, "Race-1");

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

      const attempt = (d: Database) =>
        withTenant(d, cfg.tenantId, async (tx) => {
          await asAppUser(tx);
          return openTab(tx, cfg, { tableId, lines: [{ productId: cafe.id, quantity: "1" }] });
        });

      const results = await Promise.allSettled([attempt(connA), attempt(connB)]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: "tab.already_open",
        params: { tableId },
      });
      // The corruption observable: exactly ONE open working order exists. Without the lock both would be
      // created (the loser reads a stale tab_id=null) → 2, one orphaned by the single tab_id column.
      expect(await openOrderCount(cfg)).toBe(1);
    } finally {
      await Promise.all([connA.close(), connB.close()]);
    }
  });
});

describe("addTabRound concurrency (distinct line_no under load)", () => {
  const ROUNDS = 10;
  it("N backends appending one line each to ONE tab all land with distinct contiguous line_nos", async () => {
    const { cfg, cafe } = await setupVenue();
    const tableId = await seedTable(cfg, "Race-2");
    // Open the tab EMPTY (no initial round) so the appended line_nos are exactly 1..N.
    const { tabId } = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return openTab(tx, cfg, { tableId });
    });

    const dbs = await Promise.all(Array.from({ length: ROUNDS }, () => suite.pg.connect()));
    try {
      const pids = await Promise.all(
        dbs.map((d) =>
          d
            .execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)
            .then((r) => r.rows[0]!.pid),
        ),
      );
      expect(new Set(pids).size).toBe(ROUNDS); // distinct backends — the race is real.

      await Promise.all(
        dbs.map((d) =>
          withTenant(d, cfg.tenantId, async (tx) => {
            await asAppUser(tx);
            return addTabRound(tx, cfg, tabId, [{ productId: cafe.id, quantity: "1" }]);
          }),
        ),
      );

      const { rows } = await suite.admin.execute<{ line_no: number }>(
        sql`select line_no from working_order_lines where working_order_id = ${tabId} order by line_no`,
      );
      expect(rows.map((r) => r.line_no)).toEqual(Array.from({ length: ROUNDS }, (_, i) => i + 1));
    } finally {
      await Promise.all(dbs.map((d) => d.close()));
    }
  });
});
