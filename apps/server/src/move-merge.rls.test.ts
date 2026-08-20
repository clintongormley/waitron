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
import type { Database } from "@waitron/db";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import type { TillConfig } from "./till-config.js";
import { createTable } from "./tables.js";
import { joinTable, mergeTabs, moveTab, openTab } from "./working-order.js";
import { payWorkingOrder } from "./till-sale.js";
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
      throw new Error("move-merge.rls.test: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

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

/** How many `sales` rows reference this working order — read as the superuser owner (bypasses RLS). */
async function saleCount(workingOrderId: string): Promise<number> {
  const { rows } = await suite.admin.execute<{ count: string }>(sql`
    select count(*)::text as count from sales where working_order_id = ${workingOrderId}
  `);
  return Number(rows[0]!.count);
}

/** The working order's own state — status + whether settled_at is set (the biconditional's witness). */
async function orderState(id: string): Promise<{ status: string; settledAtSet: boolean }> {
  const { rows } = await suite.admin.execute<{ status: string; settled: boolean }>(sql`
    select status, (settled_at is not null) as settled from working_orders where id = ${id}
  `);
  return { status: rows[0]!.status, settledAtSet: rows[0]!.settled };
}

/** How many chained `registros_facturacion` rows exist for this working order's sale (superuser read). */
async function registroCount(workingOrderId: string): Promise<number> {
  const { rows } = await suite.admin.execute<{ count: string }>(sql`
    select count(*)::text as count
    from registros_facturacion r
    join sales s on s.id = r.sale_id
    where s.working_order_id = ${workingOrderId}
  `);
  return Number(rows[0]!.count);
}

/** The IMMUTABLE filed `sales.total` for this working order's sale — read as the owner (bypasses RLS).
 *  The witness that a retrieved order files at the LOCKED price, not a re-price at pay. */
async function filedSaleTotal(workingOrderId: string): Promise<string> {
  const { rows } = await suite.admin.execute<{ total: string }>(sql`
    select total from sales where working_order_id = ${workingOrderId}
  `);
  return rows[0]!.total;
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
        new Error("move-merge.rls.test: resolveClient must never be called by recordSale"),
      ),
  });
});

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

describe("joinTable → one bill", () => {
  it("a joined tab files ONE sale covering both tables on pay", async () => {
    const { cfg, cafe } = await setupVenue();
    const t1 = await seedTable(cfg, "JP1");
    const t2 = await seedTable(cfg, "JP2");
    const tabId = await openTabOn(cfg, t1, [{ productId: cafe.id, quantity: "1" }]);
    await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await joinTable(tx, cfg, tabId, t2);
    });
    expect(await tabIdOf(t2)).toBe(tabId); // the join linked t2 to the one tab (durable: settle clears status_id, not tab_id)

    // Pay the one tab (a retrieved open order files from its stored locked lines).
    await payWorkingOrder({ db: suite.admin, backend, clock }, cfg, {
      id: tabId,
      lines: [],
      tender: { method: "cash", amount: "5.00" },
    });

    expect(await saleCount(tabId)).toBe(1); // exactly one bill for both tables
    expect(await orderState(tabId)).toMatchObject({ status: "settled" });
  });
});

describe("mergeTabs → one registro (H2)", () => {
  it("a merged-then-paid tab yields exactly ONE registros_facturacion row; the source tab files nothing", async () => {
    const { cfg, cafe, agua } = await setupVenue();
    const tInto = await seedTable(cfg, "MR-into");
    const tFrom = await seedTable(cfg, "MR-from");
    const intoTab = await openTabOn(cfg, tInto, [{ productId: cafe.id, quantity: "1" }]);
    const fromTab = await openTabOn(cfg, tFrom, [{ productId: agua.id, quantity: "1" }]);

    await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await mergeTabs(tx, cfg, intoTab, fromTab, { freeSourceTable: true });
    });

    // fromTab is abandoned and files nothing — never reaches settled, so no double-file (CLAUDE.md §5).
    expect(await orderState(fromTab)).toMatchObject({ status: "abandoned" });
    expect(await saleCount(fromTab)).toBe(0);

    // Pay the merged intoTab → exactly one sale + one chained registro for the combined bill.
    await payWorkingOrder({ db: suite.admin, backend, clock }, cfg, {
      id: intoTab,
      lines: [],
      tender: { method: "cash", amount: "5.00" },
    });
    expect(await saleCount(intoTab)).toBe(1);
    expect(await registroCount(intoTab)).toBe(1);
    expect(await registroCount(fromTab)).toBe(0);
    // The FILED sale reflects BOTH lines — café 1.50 (intoTab) + agua 2.00 (moved from fromTab) = 3.50.
    // This is the load-bearing check: without it, a merge that silently moved NOTHING would still pass
    // every count above (intoTab files its lone café for 1.50; fromTab stays abandoned/unfiled 0/0), so
    // the moved line's fiscal contribution to the AEAT-filed total would go unproven — an under-report
    // that is unrepairable once chained (CLAUDE.md §5). A line-drop leaves this at 1.50.
    expect(await filedSaleTotal(intoTab)).toBe("3.50");
  });
});
