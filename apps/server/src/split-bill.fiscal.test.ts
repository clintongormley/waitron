import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { asAppUser, saleLines, sales, withTenant, workingOrderLines } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import { VerifactuBackend, registrosFacturacion } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
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
import { openTab, splitOffCheck } from "./working-order.js";
import { payWorkingOrder } from "./till-sale.js";
import type { TillSaleResult } from "./till-sale.js";

// Real Postgres, NOT PGlite: the whole point is genuine chained fiscal records written by the app
// role under RLS — PGlite bypasses RLS and cannot prove the deployment role files them (CLAUDE.md §4).
// Each test gets its OWN tenant, so the registros_facturacion count is order-independent. Mirrors the
// `till-sale.test.ts` fixture (its systemClock/nextNif/tillConfigFromVenue/setupVenue + VerifactuBackend
// wiring), extended to seed one dining table and return an `asApp` helper (withTenant + asAppUser).
const LOCALE = "es-ES";

const suite = useTemplateDb({ template: "manifest" });

let backend: FiscalBackend;
let clock: TrustedClock;

/**
 * The wall clock at the moment this process runs, reported as already confident and anchored — the
 * identical stub shape `till-sale.test.ts`/`catalogue-demo.ts` document. `recordSale` reads `now()`
 * once and touches neither `anchor` nor `currentAnchor`.
 */
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
      throw new Error("split-bill.fiscal.test: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF — the same shape `till-sale.test.ts`'s `nextNif` uses.
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
    cardProvider: "none",
    tipsEnabled: false,
    orderFlow: "prepay",
  };
}

interface Seeded {
  cfg: TillConfig;
  /** "Agua" — each, 1.50 gross, general(21%). */
  aguaId: string;
  /** "Jamón" — WEIGHT, 24.90/kg gross, reduced(10%). */
  jamonId: string;
  tableId: string;
}

/**
 * Stand up a fresh chained venue + registered SIF (as the owner), then seed the two-product catalogue
 * and one dining table as the app role. Each test gets its OWN tenant so the `registros_facturacion`
 * count is that test's alone, order-independent (CLAUDE.md §4).
 */
async function setupVenue(): Promise<Seeded> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Deli Split SL",
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
  const seeded = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, { name: "Delicatessen" });
    const comida = await createCategory(tx, { name: "Comida" });
    const bebidas = await createCategory(tx, { name: "Bebidas" });
    const jamon = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: comida.id,
      descriptions: { [LOCALE]: "Jamón cortado" },
      pricingUnit: "weight",
      unitPrice: "24.90",
      vatClass: "reduced",
    });
    const agua = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      descriptions: { [LOCALE]: "Agua mineral" },
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, venue.locationId, cat.id);
    const t1 = await createTable(tx, cfg, { label: "T1" });
    return { aguaId: agua.id, jamonId: jamon.id, tableId: t1.id };
  });
  return { cfg, ...seeded };
}

/** Run `fn` on a fresh app-scoped transaction (RLS in force, `app_user` role), like production. */
function asApp<T>(cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

interface ThreeChecks {
  /** The emptied ORIGIN tab (line 1 wholly moved by check C, line 2 by check A). */
  tabId: string;
  /** Check A = 1 agua + the whole jamón (MIXED VAT); B = 1 agua; C = 1 agua. */
  a: string;
  b: string;
  c: string;
  /** The paid results, in pay order — Task 2 asserts on these; Task 3 ignores them. */
  rA: TillSaleResult;
  rB: TillSaleResult;
  rC: TillSaleResult;
}

/**
 * Open the mixed-VAT origin tab (3× agua @21%, 0.300 kg jamón @10%), carve it into the three checks
 * design §3 describes (A = 1 agua + whole jamón; B = 1 agua; C = 1 agua, which empties line 1 with a
 * whole move), and pay all three via the EXISTING `payWorkingOrder`. Shared by BOTH tests so the split
 * shape is defined once (DRY): Task 2 proves the filings, Task 3 proves the partition/conservation.
 */
async function splitIntoThreeChecks(
  seeded: Seeded,
  deps: Parameters<typeof payWorkingOrder>[0],
): Promise<ThreeChecks> {
  const { cfg, aguaId, jamonId, tableId } = seeded;
  const { tabId } = await asApp(cfg, (tx) =>
    openTab(tx, cfg, {
      tableId,
      lines: [
        { productId: aguaId, quantity: "3" },
        { productId: jamonId, quantity: "0.300" },
      ],
    }),
  );
  const { checkId: a } = await asApp(cfg, (tx) =>
    splitOffCheck(tx, cfg, tabId, [{ lineNo: 1, quantity: "1" }, { lineNo: 2 }]),
  );
  const { checkId: b } = await asApp(cfg, (tx) =>
    splitOffCheck(tx, cfg, tabId, [{ lineNo: 1, quantity: "1" }]),
  );
  const { checkId: c } = await asApp(cfg, (tx) => splitOffCheck(tx, cfg, tabId, [{ lineNo: 1 }]));

  // Pay all three via the EXISTING payWorkingOrder (no new verb). A check is a retrieved order, so
  // req.lines is ignored — it files from its stored locked lines.
  const rA = await payWorkingOrder(deps, cfg, {
    id: a,
    tender: { method: "cash", amount: "10.00" },
    lines: [],
  });
  const rB = await payWorkingOrder(deps, cfg, {
    id: b,
    tender: { method: "cash", amount: "2.00" },
    lines: [],
  });
  const rC = await payWorkingOrder(deps, cfg, {
    id: c,
    tender: { method: "cash", amount: "2.00" },
    lines: [],
  });
  return { tabId, a, b, c, rA, rB, rC };
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
        new Error("split-bill.fiscal.test: resolveClient must never be called by recordSale"),
      ),
  });
});

// Parse a check's invoice sequence number (the N in "A/N").
function seqOf(result: TillSaleResult): number {
  const m = /^A\/(\d+)$/.exec(result.invoiceNumber);
  if (m === null) throw new Error(`unexpected invoice number ${result.invoiceNumber}`);
  return Number(m[1]);
}

describe("split-bill: pay each check files its own registro", () => {
  it("splits a mixed-VAT tab into 3 checks; paying all files EXACTLY 3 registros with contiguous numbers", async () => {
    const seeded = await setupVenue();
    const { cfg } = seeded;
    const deps = { db: suite.admin, backend, clock };

    // Origin tab (3× agua @21%, 0.300 kg jamón @10%) carved into 3 checks (design §3 "the 4 working
    // orders = 3 checks + emptied origin") — A = 1 agua + whole jamón (MIXED VAT); B, C = 1 agua each,
    // C emptying line 1 with a whole move — and all three paid. Shared with the partition test below.
    const { a, b, c, rA, rB, rC } = await splitIntoThreeChecks(seeded, deps);

    // Negative control (run, then removed): a 4th `payWorkingOrder` for the emptied origin `tabId`
    // THREW `sale.empty_basket` — `priceStoredOrder` refuses an order with no stored lines — so the
    // origin can never file a registro and the count-of-3 assertion is load-bearing (design §3: the
    // emptied origin is abandoned in Task 3, it files nothing).

    // (1) EXACTLY THREE registros_facturacion for this tenant — one per check, none from the origin.
    const rows = await asApp(cfg, (tx) => tx.select().from(registrosFacturacion));
    expect(rows.length).toBe(3);

    // (2) Contiguous invoice numbers from the tab's series (fresh series ⇒ 1,2,3 in pay order).
    const seqs = [seqOf(rA), seqOf(rB), seqOf(rC)].sort((x, y) => x - y);
    expect(seqs).toEqual([seqs[0], seqs[0]! + 1, seqs[0]! + 2]);
    expect(rA.invoiceNumber).toMatch(/^A\/\d+$/);

    // (3) Per-check TOTALS = the gross sum of that check's OWN items (the retail line totals).
    expect(rA.total).toBe("8.97"); // 1×1.50 + round(0.300×24.90)=7.47
    expect(rB.total).toBe("1.50");
    expect(rC.total).toBe("1.50");

    // (4) Coherent per-check DESGLOSE — each invoice's breakdown corresponds to its OWN items:
    //   - A carries BOTH rates (21% agua + 10% jamón); B and C carry only 21%.
    //   - Each check's Σ(base+tax) == its own total (self-consistent, no aggregate bill to reconcile —
    //     a per-check cent of difference-method rounding is not an error, design §4).
    // The exact base/tax cents are the difference-method figures priceLockedLines computes — PROVEN by
    // the real filing below (read off the RED run, CLAUDE.md §1), never hand-derived from the plan. The
    // load-bearing checks are the RATE SET and the Σ==total identity.
    expect(new Set(rA.vatBreakdown.map((v) => v.rate))).toEqual(new Set(["21.00", "10.00"]));
    expect(new Set(rB.vatBreakdown.map((v) => v.rate))).toEqual(new Set(["21.00"]));
    expect(new Set(rC.vatBreakdown.map((v) => v.rate))).toEqual(new Set(["21.00"]));
    for (const r of [rA, rB, rC]) {
      const sum = r.vatBreakdown.reduce((acc, v) => acc + Number(v.base) + Number(v.tax), 0);
      expect(sum.toFixed(2)).toBe(r.total);
    }
    // Exact desgloses, difference-method (base = round(gross/(1+rate)), tax = gross − base):
    //   A agua  1.50 / 1.21 → 1.24 base, 0.26 tax
    //   A jamón 7.47 / 1.10 → 6.79 base, 0.68 tax
    //   B / C agua 1.50 → 1.24 base, 0.26 tax
    expect(rA.vatBreakdown).toEqual([
      { rate: "10.00", base: "6.79", tax: "0.68" }, // 0.300 kg jamón (whole line moved first)
      { rate: "21.00", base: "1.24", tax: "0.26" }, // 1 agua
    ]);
    expect(rB.vatBreakdown).toEqual([{ rate: "21.00", base: "1.24", tax: "0.26" }]);
    expect(rC.vatBreakdown).toEqual([{ rate: "21.00", base: "1.24", tax: "0.26" }]);

    // (5) Each registro is tied to its OWN check via sales.working_order_id (the idempotency key).
    const filedFor = await asApp(cfg, (tx) =>
      tx.select({ workingOrderId: sales.workingOrderId }).from(sales),
    );
    expect(new Set(filedFor.map((s) => s.workingOrderId))).toEqual(new Set([a, b, c]));
  });

  it("partitions the items — every unit filed on exactly ONE check, quantity conserved, origin emptied", async () => {
    const seeded = await setupVenue();
    const { cfg } = seeded;
    const deps = { db: suite.admin, backend, clock };

    // Same 3-check split as above (DRY): A = 1 agua + whole jamón; B = 1 agua; C = 1 agua.
    const { tabId, a } = await splitIntoThreeChecks(seeded, deps);

    const { originLines, filed, filedForOrigin } = await asApp(cfg, async (tx) => {
      // The emptied origin: 0 working_order_lines, and it files NOTHING (never paid → no sales row).
      const originLines = await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId));
      // Every filed sale_line across the 3 checks, joined to its sale via sales.id = sale_lines.sale_id,
      // tagged with the check it belongs to (sales.working_order_id). sale_lines SNAPSHOTS values and
      // carries NO product_id (packages/db/src/schema/sales.ts) — so partition by vat_rate (the single
      // 10% jamón line vs the three 21% agua lines), never by product. These are the REAL filed rows,
      // not a recompute of the inputs.
      const filed = await tx
        .select({
          workingOrderId: sales.workingOrderId,
          vatRate: saleLines.vatRate,
          quantity: saleLines.quantity,
        })
        .from(saleLines)
        .innerJoin(sales, eq(sales.id, saleLines.saleId));
      const filedForOrigin = await tx
        .select({ id: sales.id })
        .from(sales)
        .where(eq(sales.workingOrderId, tabId));
      return { originLines, filed, filedForOrigin };
    });

    // The origin is emptied and files nothing (design §4 "no double-file; the remainder shares no item").
    expect(originLines).toEqual([]);
    expect(filedForOrigin).toEqual([]);

    // CONSERVATION: summing the filed quantities per RATE across the 3 checks == the original basket.
    const filed21 = filed.filter((f) => f.vatRate === "21.00");
    const filed10 = filed.filter((f) => f.vatRate === "10.00");
    const totalAgua = filed21.reduce((n, f) => n + Number(f.quantity), 0);
    const totalJamon = filed10.reduce((n, f) => n + Number(f.quantity), 0);
    expect(totalAgua).toBe(3); // 1 + 1 + 1, no unit created or destroyed
    expect(totalJamon.toFixed(3)).toBe("0.300"); // moved whole to check A

    // PARTITION: the 10%-rate (jamón) quantity appears on EXACTLY ONE check (no double-file).
    const checksWith10 = new Set(filed10.map((f) => f.workingOrderId));
    expect(checksWith10).toEqual(new Set([a]));

    // Negative control (run once, then restored — brief Step 3): to over-allocate the aguas without
    // the split aborting on an emptied line, the origin was temporarily opened with 4 aguas and check
    // B took `quantity: "2"` (with a covering 10.00 tender), so the three checks filed 1 + 2 + 1 = 4.
    // `totalAgua` came back 4 and this test FAILED at `expect(totalAgua).toBe(3)` with
    // `expected 4 to be 3` (line ~360), proving the conservation sum catches a double-file / re-price.
    // All three edits were reverted; the test is green as written.
  });

  it("paying a check twice files exactly ONE registro (sale-idempotency replay)", async () => {
    const { cfg, aguaId, tableId } = await setupVenue();
    const deps = { db: suite.admin, backend, clock };
    // Open a 2× agua tab and carve ONE agua onto a detached check — the working order under proof.
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: aguaId, quantity: "2" }] }),
    );
    const { checkId } = await asApp(cfg, (tx) =>
      splitOffCheck(tx, cfg, tabId, [{ lineNo: 1, quantity: "1" }]),
    );

    // Pay the SAME check twice (a lost-response retry), SEQUENTIALLY. A check is a working order (it
    // already has a `working_orders` row), so the second pay locks it `FOR UPDATE`, sees `settled`, and
    // `payWorkingOrder` returns the EXISTING ticket (till-sale.ts ~line 290) — a replay, not a second
    // filing. The #61 `sales_working_order_id_key` UNIQUE (tenant_id, working_order_id) is the
    // CONCURRENCY backstop for the shape that has no pre-existing row to lock (till-sale.ts ~line 356);
    // this sequential retry never reaches it. The whole point of the split-bill split is that a check
    // gets the same settled-status replay as any tab.
    const first = await payWorkingOrder(deps, cfg, {
      id: checkId,
      tender: { method: "cash", amount: "2.00" },
      lines: [],
    });
    const second = await payWorkingOrder(deps, cfg, {
      id: checkId,
      tender: { method: "cash", amount: "2.00" },
      lines: [],
    });

    // The retry returns the SAME invoice number + total — the original ticket re-derived, not a new file.
    expect(second.invoiceNumber).toBe(first.invoiceNumber);
    expect(second.total).toBe(first.total);

    // The unrepairable double-file this key exists to prevent: EXACTLY ONE registro is tied to the check
    // via sales.working_order_id, after two pays. Read as the app role under RLS.
    // PROVEN LOAD-BEARING (this run): the count is 1, not 2 — the second pay filed nothing. The witness
    // that the replay is real is `second.invoiceNumber === first.invoiceNumber`: a genuine second filing
    // would draw the NEXT series number (A/2), so an off idempotency key would show BOTH as a differing
    // invoice number AND as `forCheck.length === 2` here (the sibling `working-order.rls.test.ts` idempotent
    // -replay test proves the same key by deletion — reverting it double-files).
    const forCheck = await asApp(cfg, (tx) =>
      tx
        .select({ id: registrosFacturacion.id })
        .from(registrosFacturacion)
        .innerJoin(sales, eq(sales.id, registrosFacturacion.saleId))
        .where(eq(sales.workingOrderId, checkId)),
    );
    expect(forCheck.length).toBe(1);
  });
});

// A split cannot cross a tenant boundary. `splitOffCheck`'s origin read is `working_orders WHERE id =
// fromTabId` (the base .from() table, NO explicit tenant predicate), so isolation here is STRUCTURAL:
// FORCE ROW LEVEL SECURITY hides the foreign tab and the read finds nothing → `tab.not_open`,
// fail-closed. PGlite (superuser, RLS-bypassing) could not show this. Mirrors the landed sibling
// `transfer-lines.rls.test.ts`'s "cross-tenant isolation" describe verbatim in shape — including its
// exact `alter policy … using (true) with check (true)` deletion-proof dance.
describe("split-bill cross-tenant isolation (FORCE RLS hides the foreign tab; the policy is the guard)", () => {
  it("a cross-tenant split is impossible — RLS hides the other tenant's tab (fail-closed)", async () => {
    const owner = await setupVenue(); // tenant X, with an open tab
    const other = await setupVenue(); // tenant Y (its own venue/cfg)
    const { tabId } = await asApp(owner.cfg, (tx) =>
      openTab(tx, owner.cfg, {
        tableId: owner.tableId,
        lines: [{ productId: owner.aguaId, quantity: "2" }],
      }),
    );

    // As tenant Y, X's tabId is RLS-hidden → `splitOffCheck`'s origin read finds no `working_orders`
    // row → `tab.not_open` (naming the foreign id), before any check is minted or line moved.
    await expect(
      asApp(other.cfg, (tx) => splitOffCheck(tx, other.cfg, tabId, [{ lineNo: 1, quantity: "1" }])),
    ).rejects.toMatchObject({ code: "tab.not_open", params: { tabId } });

    // Positive control: the OWNER can split the same tab (same op, same tab, only the tenant differs —
    // both empty would prove nothing, CLAUDE.md §1).
    const { checkId } = await asApp(owner.cfg, (tx) =>
      splitOffCheck(tx, owner.cfg, tabId, [{ lineNo: 1, quantity: "1" }]),
    );
    expect(checkId).toBeDefined();

    // Prove the RLS POLICY predicate is the guard (deletion-proof, BOTH directions on one backend): under
    // tenant Y the owner's row is HIDDEN (count 0); neutralising `working_orders`' isolation policy to
    // `true` inside a ROLLED-BACK transaction makes it APPEAR (count 1) — so the predicate, not mere table
    // access, hid it. The `alter policy` runs as the owner (superuser), before dropping to `app_user`.
    // Rolled back, so the policy is restored and no rows move. Copied verbatim in shape from
    // transfer-lines.rls.test.ts:344-367 (itself the append-order-amendment.rls.test.ts idiom).
    const conn = await suite.pg.connect();
    try {
      await conn.execute(sql`begin`);
      // Hidden under the real predicate, as tenant Y's app_user.
      await conn.execute(sql`set local role app_user`);
      await conn.execute(sql`select set_config('app.tenant_id', ${other.cfg.tenantId}, true)`);
      const hidden = await conn.execute<{ n: number }>(
        sql`select count(*)::int as n from working_orders where id = ${tabId}`,
      );
      expect(hidden.rows[0]!.n).toBe(0);
      // Neutralise the predicate as the owner, then read again as tenant Y's app_user: it appears.
      await conn.execute(sql`reset role`);
      await conn.execute(
        sql`alter policy working_orders_tenant_isolation on working_orders using (true) with check (true)`,
      );
      await conn.execute(sql`set local role app_user`);
      const visible = await conn.execute<{ n: number }>(
        sql`select count(*)::int as n from working_orders where id = ${tabId}`,
      );
      expect(visible.rows[0]!.n).toBe(1); // the predicate was the guard: drop it and the foreign row appears
    } finally {
      await conn.execute(sql`rollback`);
      await conn.close();
    }
  });
});
