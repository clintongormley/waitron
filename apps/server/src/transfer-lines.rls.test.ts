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
import { ALL_MODULES } from "./modules.js";
import type { TillConfig } from "./till-config.js";
import { createTable } from "./tables.js";
import { openTab, transferLines } from "./working-order.js";
import { payWorkingOrder } from "./till-sale.js";
import "./errors.js";

// Real Postgres, not PGlite — mandatory for THIS suite (CLAUDE.md §4). All three properties under test
// are exactly what PGlite CANNOT show: (1) two backends racing `transferLines` on the SAME pair of tabs
// serialise on the ascending-id `working_orders` FOR UPDATE lock — PGlite serialises every query onto ONE
// backend, so the race never happens (a FALSE pass, proven by the distinct-pid assertion); (2) a
// cross-tenant transfer is refused because FORCE ROW LEVEL SECURITY hides the foreign tab from the app
// role — PGlite connects as a superuser and bypasses RLS; (3) the H2 per-tab fiscal receipt is written by
// the app role under RLS. Each racing backend opens its own via `suite.pg.connect()`, and the shared
// container globalSetup (`testing/global-setup.ts`) THROWS its `dockerRequired` message rather than
// skipping when Docker is absent, so a vanished suite fails loudly instead of a green that proves nothing.
// `transferLines` locks `working_orders` ONLY (`lockOpenTab`'s `dining_tables` read is UNLOCKED), so — unlike
// the mergeTabs↔pay path in move-merge.rls.test.ts — it has no `dining_tables`↔`working_orders` deadlock
// class; the concurrency hazard here is transfer-vs-transfer, covered below.
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
      throw new Error("transfer-lines.rls.test: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique, so
// each provisioned venue needs its own NIF — the same shape `move-merge.rls.test.ts` uses.
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
    // No integrated card terminal for these transfer RLS suites.
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
 * Stand up a fresh chained venue + registered SIF (as the owner), then seed a catalogue as the app role
 * and read back two `each`/general(21%) products. Each test gets its OWN tenant so its state is
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
    await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      descriptions: { [LOCALE]: "Agua" },
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, venue.locationId, cat.id);
    return (await listAvailableProducts(tx, cfg.locationId)).products;
  });
  const cafe = available.find((p) => p.descriptions[LOCALE] === "Café")!;
  const agua = available.find((p) => p.descriptions[LOCALE] === "Agua")!;
  return { cfg, available, cafe, agua };
}

/**
 * A fresh venue with two open tabs, each on its own dining table, each holding café×4. Returns the tab
 * (working_order) ids to transfer between. Both tabs share the one tenant `cfg`, so they are the SAME-pair
 * the concurrency and H2 tests race/pay; the cross-tenant test calls this twice for two distinct tenants.
 */
async function setupTwoTabs(): Promise<{
  cfg: TillConfig;
  tabA: string;
  tabB: string;
  cafe: AvailableProduct;
}> {
  const { cfg, cafe } = await setupVenue();
  const { tabA, tabB } = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const a = await createTable(tx, cfg, { label: "A" });
    const b = await createTable(tx, cfg, { label: "B" });
    const ta = await openTab(tx, cfg, {
      tableId: a.id,
      lines: [{ productId: cafe.id, quantity: "4" }],
    });
    const tb = await openTab(tx, cfg, {
      tableId: b.id,
      lines: [{ productId: cafe.id, quantity: "4" }],
    });
    return { tabA: ta.tabId, tabB: tb.tabId };
  });
  return { cfg, tabA, tabB, cafe };
}

/** The working order's own state — status + whether settled_at is set — owner read (bypasses RLS). */
async function orderState(id: string): Promise<{ status: string; settledAtSet: boolean }> {
  const { rows } = await suite.admin.execute<{ status: string; settled: boolean }>(sql`
    select status, (settled_at is not null) as settled from working_orders where id = ${id}
  `);
  return { status: rows[0]!.status, settledAtSet: rows[0]!.settled };
}

/** A tab's lines as { lineNo, quantity } in line_no order — owner read (bypasses RLS). The witness that a
 *  refused transfer moved nothing: the source keeps its full quantity and the dest gains no line. */
async function tabLineSummary(tabId: string): Promise<{ lineNo: number; quantity: string }[]> {
  const { rows } = await suite.admin.execute<{ line_no: number; quantity: string }>(sql`
    select line_no, quantity from working_order_lines where working_order_id = ${tabId} order by line_no
  `);
  return rows.map((r) => ({ lineNo: r.line_no, quantity: r.quantity }));
}

/** How many `sales` rows reference this working order — read as the superuser owner (bypasses RLS). */
async function saleCount(workingOrderId: string): Promise<number> {
  const { rows } = await suite.admin.execute<{ count: string }>(sql`
    select count(*)::text as count from sales where working_order_id = ${workingOrderId}
  `);
  return Number(rows[0]!.count);
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

/** The IMMUTABLE filed `sales.total` for this working order's sale — read as the owner (bypasses RLS). The
 *  witness that each tab files at its OWN locked composition, not a re-price at pay. */
async function filedSaleTotal(workingOrderId: string): Promise<string> {
  const { rows } = await suite.admin.execute<{ total: string }>(sql`
    select total from sales where working_order_id = ${workingOrderId}
  `);
  return rows[0]!.total;
}

/** True if `e` (or its cause) is a PostgreSQL deadlock (40P01). Ported from move-merge.rls.test.ts. */
function isDeadlock(e: unknown): boolean {
  const code =
    (e as { code?: string; cause?: { code?: string } })?.code ??
    (e as { cause?: { code?: string } })?.cause?.code;
  return code === "40P01";
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
        new Error("transfer-lines.rls.test: resolveClient must never be called by recordSale"),
      ),
  });
});

describe("concurrent transferLines on the same pair serialise (ascending-id lock order — no deadlock)", () => {
  it("two reverse-orientation transfers over the SAME two tabs → NO 40P01; both fulfilled (one waits)", async () => {
    const { cfg, tabA, tabB } = await setupTwoTabs();
    const [connA, connB] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
    try {
      const pids = await Promise.all(
        [connA, connB].map((d) =>
          d
            .execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)
            .then((r) => r.rows[0]!.pid),
        ),
      );
      expect(new Set(pids).size).toBe(2); // distinct backends — on PGlite these collapse (a false pass).

      const runOn = (d: Database, from: string, to: string) =>
        withTenant(d, cfg.tenantId, async (tx) => {
          await asAppUser(tx);
          await transferLines(tx, cfg, from, to, [{ lineNo: 1, quantity: "1" }]);
        });

      // A→B and B→A racing. transferLines locks `[from, to].sort()` — min(id) then max(id) — so BOTH
      // backends take the two `working_orders` rows in the SAME order; neither can hold one while waiting
      // on the other in the reverse order, so the deadlock cycle cannot form. One backend simply waits on
      // the lowest-id row's FOR UPDATE lock until the other commits, then proceeds.
      //
      // PROVEN LOAD-BEARING BY DELETION (receipt in task-6-report.md, NOT committed): dropping the
      // `.sort()` in transferLines so each locks in transfer DIRECTION made this exact reverse-orientation
      // pair raise `40P01 deadlock detected` on `lockOpenTab`'s `working_orders ... for update` in all 12
      // looped iterations (connA holds A waiting on B while connB holds B waiting on A); restoring the sort
      // returns it to the green below. A GREEN with the sort in place is meaningless without that RED
      // control (CLAUDE.md §1).
      const results = await Promise.allSettled([
        runOn(connA, tabA, tabB),
        runOn(connB, tabB, tabA),
      ]);
      for (const r of results) {
        if (r.status === "rejected") expect(isDeadlock(r.reason)).toBe(false);
        expect(r.status).toBe("fulfilled"); // no 40P01; the serialised loser waited, it did not error
      }
    } finally {
      await Promise.all([connA.close(), connB.close()]);
    }
  });
});

describe("transferLines cross-tenant isolation (FORCE RLS hides the foreign tab; the policy is the guard)", () => {
  it("a transfer under tenant A naming tenant B's tab is refused tab.not_open; neither tab moves a line", async () => {
    const { cfg: tenantA, tabA } = await setupTwoTabs();
    const { tabA: foreignTab } = await setupTwoTabs(); // a wholly separate venue + tenant (tenant B)

    // Under tenant A's scope, tenant B's tab is RLS-hidden → transferLines' `lockOpenTab` finds no
    // `working_orders` row for it → `tab.not_open` (naming the foreign id), before any line moves.
    // Isolation here is STRUCTURAL: transferLines carries NO explicit tenant predicate to delete —
    // `lockOpenTab` reads `working_orders WHERE id = tabId`, and FORCE ROW LEVEL SECURITY is what hides the
    // foreign row (the same finding move-merge.rls.test.ts records for mergeTabs). PGlite (superuser,
    // RLS-bypassing) could not show this.
    await expect(
      withTenant(suite.admin, tenantA.tenantId, async (tx) => {
        await asAppUser(tx);
        await transferLines(tx, tenantA, tabA, foreignTab, [{ lineNo: 1, quantity: "1" }]);
      }),
    ).rejects.toMatchObject({ code: "tab.not_open", params: { tabId: foreignTab } });

    // Neither tab moved a line: tenant A's source still holds café×4 on line 1 (no split), and tenant B's
    // destination is still open holding its original café×4 with no appended line — the transfer threw at
    // the lock loop, before any read or write of lines, and filed nothing.
    expect(await tabLineSummary(tabA)).toEqual([{ lineNo: 1, quantity: "4.000" }]);
    expect(await orderState(foreignTab)).toMatchObject({ status: "open" });
    expect(await tabLineSummary(foreignTab)).toEqual([{ lineNo: 1, quantity: "4.000" }]);
    expect(await saleCount(foreignTab)).toBe(0);

    // Prove the RLS POLICY predicate is the guard (deletion-proof, BOTH directions on one backend): under
    // tenant A the foreign row is HIDDEN (count 0); neutralising `working_orders`' isolation policy to
    // `true` inside a ROLLED-BACK transaction makes it APPEAR (count 1) — so the predicate, not mere table
    // access, hid it. The `alter policy` runs as the owner (superuser), before dropping to `app_user`.
    // Rolled back, so the policy is restored and no rows move. Same idiom as
    // packages/db/src/append-order-amendment.rls.test.ts:318-340.
    const conn = await suite.pg.connect();
    try {
      await conn.execute(sql`begin`);
      // Hidden under the real predicate, as tenant A's app_user.
      await conn.execute(sql`set local role app_user`);
      await conn.execute(sql`select set_config('app.tenant_id', ${tenantA.tenantId}, true)`);
      const hidden = await conn.execute<{ n: number }>(
        sql`select count(*)::int as n from working_orders where id = ${foreignTab}`,
      );
      expect(hidden.rows[0]!.n).toBe(0);
      // Neutralise the predicate as the owner, then read again as tenant A's app_user: it appears.
      await conn.execute(sql`reset role`);
      await conn.execute(
        sql`alter policy working_orders_tenant_isolation on working_orders using (true) with check (true)`,
      );
      await conn.execute(sql`set local role app_user`);
      const visible = await conn.execute<{ n: number }>(
        sql`select count(*)::int as n from working_orders where id = ${foreignTab}`,
      );
      expect(visible.rows[0]!.n).toBe(1); // the predicate was the guard: drop it and the foreign row appears
    } finally {
      await conn.execute(sql`rollback`);
      await conn.close();
    }
  });
});

describe("H2 — after a partial transfer, each tab files its OWN single registro (no double-file, no re-price)", () => {
  it("transfer 1 café A→B, then pay BOTH tabs → exactly one sale + one registro each, at the locked price", async () => {
    const { cfg, tabA, tabB } = await setupTwoTabs(); // A: café×4, B: café×4
    await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await transferLines(tx, cfg, tabA, tabB, [{ lineNo: 1, quantity: "1" }]); // A→B: 1 café (partial split)
    });

    // A now holds café×3; B holds café×4 + café×1. Pay each via the UNCHANGED payWorkingOrder path
    // (`lines: []` files from the stored locked lines). tender 20.00 comfortably covers each total.
    const deps = { db: suite.admin, backend, clock };
    const paidA = await payWorkingOrder(deps, cfg, {
      id: tabA,
      lines: [],
      tender: { method: "cash", amount: "20.00" },
    });
    const paidB = await payWorkingOrder(deps, cfg, {
      id: tabB,
      lines: [],
      tender: { method: "cash", amount: "20.00" },
    });

    // Each tab files EXACTLY one sale + one chained registro — no café double-files (every café lives on
    // exactly one tab after the split), the H2 invariant the transfer must preserve.
    expect(await saleCount(tabA)).toBe(1);
    expect(await saleCount(tabB)).toBe(1);
    expect(await registroCount(tabA)).toBe(1);
    expect(await registroCount(tabB)).toBe(1);

    // Filed at the LOCKED café price (1.50), never re-priced by the transfer: A = 3 × 1.50, B = 5 × 1.50.
    // Read back from the IMMUTABLE `sales.total` too, not only the returned object (CLAUDE.md §5).
    expect(paidA.total).toBe("4.50"); // 3 × 1.50
    expect(paidB.total).toBe("7.50"); // (4 + 1) × 1.50
    expect(await filedSaleTotal(tabA)).toBe("4.50");
    expect(await filedSaleTotal(tabB)).toBe("7.50");
  });
});
