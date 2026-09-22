import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
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
import { asAppUser, withTransaction } from "@waitron/db";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  rawCentsToDecimal,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import type { TillConfig } from "./till-config.js";
import { createTable } from "./tables.js";
import { openTab, transferLines } from "./working-order.js";
import { payWorkingOrder } from "./till-sale.js";
import "./errors.js";

/**
 * H2 after a partial transfer: each tab files its own single fiscal record, at its own locked price.
 *
 * ## The case this file LOST, and what covers it now — nothing
 *
 * It held a second case: two reverse-orientation `transferLines` over the SAME pair of tabs, on two
 * PostgreSQL backends, never raising `40P01`. Its subject was the ascending-id lock order —
 * `transferLines` took `working_orders` rows in `[from, to].sort()` order, so a reverse pair could
 * not form a deadlock cycle. It was proven load-bearing by deletion: dropping the `.sort()` made all
 * twelve looped iterations deadlock.
 *
 * **That case is deleted and NOTHING replaces it.** There are no row locks left to order — every
 * `select … for update` in `working-order.ts` is gone — and no second connection to stage the pair
 * on: one venue file, one write transaction at a time
 * (`assertAnchoredTabOpen` in `apps/server/src/working-order.ts` carries the chain). The
 * proof-by-deletion belongs to the shape of the code it was taken against, and that shape is gone
 * (CLAUDE.md §4). The `.sort()` in `transferLines` survives for a smaller effect stated on the
 * function itself.
 *
 * **Also lost, and not replaced:** the deployment role. The writes below used to run after
 * `set local role app_user` on a non-superuser connection, so the H2 record's grants were
 * exercised; `asAppUser` is an empty body now (`packages/db/src/testing/roles.ts`).
 *
 * ## Why the surviving case stays here rather than moving
 *
 * The sibling `apps/server/src/transfer-lines.test.ts` never pays a tab, so it cannot see whether a
 * transferred café double-files. This is the only case that transfers and then settles both tabs.
 *
 * ## The surviving case is RED, and it is the PRODUCT that is broken
 *
 * Measured here 2026-09-22 on Node v26.7.0: paying a tab throws
 * `TypeError: desglose.map is not a function` at
 * `packages/fiscal-verifactu/src/backend.ts:360`, reached from `readReceiptIssuer`
 * (`apps/server/src/receipt-issuer.ts:12`) inside `fileImmediateSale`
 * (`apps/server/src/till-sale.ts:752`). `filedReceiptFor` reads the alta with
 * `tx.execute(sql`select * from registros_facturacion …`)`, and `execute` is
 * `prepare(…).all()` on the raw driver (`packages/store/src/node-sqlite-adapter.ts`), so no
 * drizzle column mapping runs — `desglose` is a `json()` column
 * (`packages/fiscal-verifactu/src/schema/registros.ts:98`) and comes back as the stored TEXT.
 * Nothing in this file can fix that, and editing the case to accept it would hide a live path: this
 * is the receipt every immediate sale prints. Same class as the drainer's raw
 * `facturas_sustituidas` read already recorded in the branch ledger.
 */
const LOCALE = "es-ES";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

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
      throw new Error("transfer-lines: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

// This counter was here because tenants accumulated for the life of the shared PostgreSQL
// container. They do not now: the suite gets its own database file and the per-test reset empties
// `tenants` (`packages/db/src/testing/venue-db.ts`). It is kept because a distinct NIF per call
// costs nothing and no assertion here reads its value.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(60_000_000 + nifCounter).padStart(8, "0")}K`;
}

function tillConfigFromVenue(venue: VenueResult): TillConfig {
  return {
    tillId: brandTillId(venue.tillId),
    nodeId: brandNodeId(venue.nodeId),
    // planVenue emits the standard series first, then the rectificative one.
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    // No integrated card terminal for this transfer suite.
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
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );

  const cfg = tillConfigFromVenue(venue);
  const available = await withTransaction(suite.db, async (tx) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, { name: "Delicatessen" });
    const bebidas = await createCategory(tx, { name: { [LOCALE]: "Bebidas" } });
    await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      name: "Café",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      name: "Agua",
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, venue.locationId, cat.id);
    return (await listAvailableProducts(tx, cfg.locationId)).products;
  });
  const cafe = available.find((p) => p.name === "Café")!;
  const agua = available.find((p) => p.name === "Agua")!;
  return { cfg, available, cafe, agua };
}

/**
 * A fresh venue with two open tabs, each on its own dining table, each holding café×4. Returns the tab
 * (working_order) ids to transfer between. Both tabs share the one tenant `cfg`, so they are the SAME-pair
 * the concurrency and H2 tests race/pay.
 */
async function setupTwoTabs(): Promise<{
  cfg: TillConfig;
  tabA: string;
  tabB: string;
  cafe: AvailableProduct;
}> {
  const { cfg, cafe } = await setupVenue();
  const { tabA, tabB } = await withTransaction(suite.db, async (tx) => {
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

/** How many `sales` rows reference this working order. */
async function saleCount(workingOrderId: string): Promise<number> {
  const { rows } = await suite.db.execute<{ count: string }>(sql`
    select cast(count(*) as text) as count from sales where working_order_id = ${workingOrderId}
  `);
  return Number(rows[0]!.count);
}

/** How many chained `registros_facturacion` rows exist for this working order's sale. */
async function registroCount(workingOrderId: string): Promise<number> {
  const { rows } = await suite.db.execute<{ count: string }>(sql`
    select cast(count(*) as text) as count
    from registros_facturacion r
    join sales s on s.id = r.sale_id
    where s.working_order_id = ${workingOrderId}
  `);
  return Number(rows[0]!.count);
}

/**
 * The IMMUTABLE filed `sales.total` for this working order's sale. The witness that each tab files
 * at its OWN locked composition, not a re-price at pay.
 */
async function filedSaleTotal(workingOrderId: string): Promise<string> {
  // `sales.total` counts whole cents, read raw and converted by `rawCentsToDecimal`; the helper
  // returns the AMOUNT, so its callers' assertions read the same decimal literals they always did.
  const { rows } = await suite.db.execute<{ total: string }>(sql`
    select cast(total as text) as total from sales where working_order_id = ${workingOrderId}
  `);
  return rawCentsToDecimal(rows[0]!.total);
}

beforeAll(() => {
  clock = systemClock();
  backend = new VerifactuBackend({
    clock,
    db: suite.db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () =>
      Promise.reject(new Error("transfer-lines: resolveClient must never be called by recordSale")),
  });
});

describe("H2 — after a partial transfer, each tab files its OWN single registro (no double-file, no re-price)", () => {
  it("transfer 1 café A→B, then pay BOTH tabs → exactly one sale + one registro each, at the locked price", async () => {
    const { cfg, tabA, tabB } = await setupTwoTabs(); // A: café×4, B: café×4
    await withTransaction(suite.db, async (tx) => {
      await asAppUser(tx);
      await transferLines(tx, cfg, tabA, tabB, [{ lineNo: 1, quantity: "1" }]); // A→B: 1 café (partial split)
    });

    // A now holds café×3; B holds café×4 + café×1. Pay each via the UNCHANGED payWorkingOrder path
    // (`lines: []` files from the stored locked lines). tender 20.00 comfortably covers each total.
    const deps = { db: suite.db, backend, clock };
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
