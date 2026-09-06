import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
  listAvailableProducts,
} from "@waitron/catalogue";
import type { AvailableProduct } from "@waitron/catalogue";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import { asAppUser, withTenant } from "@waitron/db";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import type { TillConfig } from "./till-config.js";
import { createTable } from "./tables.js";
import { joinTable, openTab, unjoinTable } from "./working-order.js";
import { payWorkingOrder } from "./till-sale.js";
import "./errors.js";

// Real Postgres, not PGlite — mandatory for THIS suite (CLAUDE.md §4). The property under test is a
// lock-order DEADLOCK-SAFETY guarantee between `unjoinTable` and the sale/settle path: both touch a
// joined tab's `working_orders` row AND its `dining_tables` row (pay via the 0050
// `working_orders_clear_table_status` settle trigger, which UPDATEs `dining_tables WHERE tab_id = X`).
// Acquiring them in the SAME class order (working_orders FIRST, then dining_tables) is what stops the two
// cross-locking into a 40P01. PGlite CANNOT show this — it serialises every query onto ONE backend, so
// the two never contend (a FALSE pass, proven by the distinct-pid assertion below). Each racing backend
// opens its own via `suite.pg.connect()`, and the shared-container globalSetup
// (`testing/global-setup.ts`) THROWS its `dockerRequired` message rather than skipping when Docker is
// absent, so a vanished suite fails loudly. The `manifest` template already carries the full CORE schema
// (dining_tables, table_service_statuses, the 0050 settle trigger) plus the cluster roles — nothing is
// migrated here. Shape mirrors move-merge.rls.test.ts's merge/pay deadlock-safety test.
const LOCALE = "es-ES";

const suite = useTemplateDb({ template: "manifest" });

let backend: FiscalBackend;
let clock: TrustedClock;

/** The system wall clock, reported confident/anchored — the identical stub `till-sale.test.ts` uses. */
function systemClock(): TrustedClock {
  return {
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
      throw new Error("split-bill.rls.test: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF — the same shape move-merge.rls.test.ts uses.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(61_000_000 + nifCounter).padStart(8, "0")}K`;
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
    cardProvider: "none",
    tipsEnabled: false,
    orderFlow: "prepay",
  };
}

interface SeededVenue {
  cfg: TillConfig;
  /** "Café" — each, 1.50 gross, general(21%). */
  cafe: AvailableProduct;
}

/**
 * Stand up a fresh chained venue + registered SIF (as the owner), then seed a catalogue as the app role
 * and read back a single `each`/general(21%) product. Each test gets its OWN tenant so its state is
 * order-independent (CLAUDE.md §4).
 */
async function setupVenue(): Promise<SeededVenue> {
  const venue = await applyVenue(
    planVenue(
      {
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
      },
      ALL_MODULES,
    ),
    { db: suite.admin, modules: ALL_MODULES },
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
    await assignCatalogueToLocation(tx, venue.locationId, cat.id);
    return (await listAvailableProducts(tx, cfg.locationId)).products;
  });
  const cafe = available.find((p) => p.descriptions[LOCALE] === "Café")!;
  return { cfg, cafe };
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

/** Join a second table to an existing tab as the app role. */
async function joinTableOn(cfg: TillConfig, tabId: string, tableId: string): Promise<void> {
  await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    await joinTable(tx, cfg, tabId, tableId);
  });
}

/** The dining table's current tab_id — owner read (bypasses RLS). */
async function tabIdOf(tableId: string): Promise<string | null> {
  const { rows } = await suite.admin.execute<{ tab_id: string | null }>(
    sql`select tab_id from dining_tables where id = ${tableId}`,
  );
  return rows[0]!.tab_id;
}

/** How many `sales` rows reference this working order — read as the superuser owner (bypasses RLS). */
async function saleCount(workingOrderId: string): Promise<number> {
  const { rows } = await suite.admin.execute<{ count: string }>(sql`
    select count(*)::text as count from sales where working_order_id = ${workingOrderId}
  `);
  return Number(rows[0]!.count);
}

/** The working order's own status — read as the owner (bypasses RLS). */
async function orderStatus(id: string): Promise<string> {
  const { rows } = await suite.admin.execute<{ status: string }>(
    sql`select status from working_orders where id = ${id}`,
  );
  return rows[0]!.status;
}

beforeAll(() => {
  clock = systemClock();
  backend = new VerifactuBackend({
    clock,
    db: suite.admin,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () =>
      Promise.reject(
        new Error("split-bill.rls.test: resolveClient must never be called by recordSale"),
      ),
  });
});

/** True if `e` (or its cause) is a PostgreSQL deadlock (40P01). */
function isDeadlock(e: unknown): boolean {
  const code =
    (e as { code?: string; cause?: { code?: string } })?.code ??
    (e as { cause?: { code?: string } })?.cause?.code;
  return code === "40P01";
}

describe("unjoinTable concurrency (working_orders-first lock order matches the sale path)", () => {
  it("unjoinTable(freeing a joined table) racing payWorkingOrder settling the tab → NO 40P01; pay is never the deadlock victim", async () => {
    // The MATERIAL deadlock the reorder fixes (finish-branch Finding A). unjoinTable(tabId=X, tableB) and
    // payWorkingOrder(X) both touch X's working_orders row AND tableB's dining_tables row — pay via the
    // 0050 settle trigger (UPDATE dining_tables WHERE tab_id = X). Pay locks working_orders(X) then
    // dining_tables(tableB); unjoinTable now locks working_orders FIRST then dining_tables — the SAME
    // order — so the two cannot cross-lock and 40P01. The OLD dining_tables-first order crossed the sale
    // path and deadlocked; that RED result is proven by deletion in the finish-fix report. Here we ship
    // the fixed order and assert it is clean, on two DISTINCT backends (PGlite would collapse them). The
    // race is looped: the deadlock in the OLD order is timing-dependent per run (either op can win the
    // working_orders lock first), so a loop is what makes the by-deletion RED reliable, and it only
    // strengthens the no-deadlock GREEN.
    const { cfg, cafe } = await setupVenue();
    const iterations = 6;
    for (let i = 0; i < iterations; i++) {
      const tableA = await seedTable(cfg, `UP-A-${i}`);
      const tableB = await seedTable(cfg, `UP-B-${i}`);
      const tabId = await openTabOn(cfg, tableA, [{ productId: cafe.id, quantity: "1" }]);
      await joinTableOn(cfg, tabId, tableB); // both tables now point at the one tab

      const [connUnjoin, connPay] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
      try {
        const pids = await Promise.all(
          [connUnjoin, connPay].map((d) =>
            d
              .execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)
              .then((r) => r.rows[0]!.pid),
          ),
        );
        expect(new Set(pids).size).toBe(2); // distinct backends — on PGlite these collapse (false pass).

        // Free tableB (no transfers): the without-items branch, which locks working_orders(X) then
        // dining_tables(tableB) then UPDATEs dining_tables(tableB) — the cleanest two-lock cross.
        const doUnjoin = withTenant(connUnjoin, cfg.tenantId, async (tx) => {
          await asAppUser(tx);
          return unjoinTable(tx, cfg, tabId, tableB);
        });
        const doPay = payWorkingOrder({ db: connPay, backend, clock }, cfg, {
          id: tabId,
          lines: [],
          tender: { method: "cash", amount: "5.00" },
        });
        const [unjoinRes, payRes] = await Promise.allSettled([doUnjoin, doPay]);

        // No 40P01 in either outcome — the fixed lock order prevents the cross-lock entirely.
        for (const r of [unjoinRes, payRes]) {
          if (r.status === "rejected") expect(isDeadlock(r.reason)).toBe(false);
        }
        // Pay is NEVER aborted: unjoinTable never settles or abandons X (it only repoints/frees tableB or
        // mints a fresh side tab), so X stays open whether pay wins or loses the working_orders(X) lock —
        // pay always settles it exactly once (CLAUDE.md §5: nothing may transiently abort a sale).
        expect(payRes.status).toBe("fulfilled");
        expect(await orderStatus(tabId)).toBe("settled");
        expect(await saleCount(tabId)).toBe(1);

        // Which op won the working_orders(X) lock is non-deterministic; both orderings are correct:
        //  - unjoin won: it freed tableB BEFORE pay settled, so tableB.tab_id is now NULL.
        //  - pay won:    X was already settled when unjoin acquired working_orders(X), so unjoin is
        //    refused tab.not_open (naming X) and tableB keeps its STALE tab_id (the settle trigger clears
        //    status_id, never tab_id — openTab documents the stale-pointer state).
        if (unjoinRes.status === "fulfilled") {
          expect(unjoinRes.value).toEqual({});
          expect(await tabIdOf(tableB)).toBeNull();
        } else {
          expect(unjoinRes.reason).toMatchObject({ code: "tab.not_open", params: { tabId } });
          expect(await tabIdOf(tableB)).toBe(tabId);
        }
      } finally {
        await Promise.all([connUnjoin.close(), connPay.close()]);
      }
    }
  });
});
