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
import { joinTable, mergeTabs, openTab } from "./working-order.js";
import { payWorkingOrder } from "./till-sale.js";
import "./errors.js";

/**
 * Joining and merging tabs, through to what gets FILED — on the engine the box now runs.
 *
 * Named `move-merge.filing.test.ts` because paying is what separates it from its sibling: every case
 * here drives `payWorkingOrder` through a real `VerifactuBackend`, and
 * `grep -n 'payWorkingOrder\|VerifactuBackend' apps/server/src/move-merge.test.ts` prints nothing
 * (exit 1, run 2026-09-22), so the sibling can only see what the join/merge verbs write to
 * `working_orders`, never the record a settle files.
 *
 * ## The four cases this file LOST, and what covers them now
 *
 * It held seven cases; four of them staged two PostgreSQL backends through `suite.pg.connect()` and
 * asserted `pg_backend_pid()` was distinct. **There is no second connection to stage them on**: one
 * venue file, one write transaction at a time, which is wider than any row lock those cases were
 * written against — every `select … for update` in `working-order.ts` is gone, `mergeTabs`'s
 * four-lock class order with it (`assertAnchoredTabOpen` in `apps/server/src/working-order.ts`
 * carries the chain and the receipt). Deleted:
 *
 * 1. **Two movers racing onto one free table**, the loser getting `table.occupied`. The REFUSAL is
 *    covered sequentially by `move-merge.test.ts`, "refuses a target that already has an OPEN tab
 *    (table.occupied)" (it appears once for `moveTab` and once for `joinTable`); the RACE is not.
 * 2. **`mergeTabs(into=X)` racing `payWorkingOrder(X)` with no `40P01` and pay never the victim.**
 * 3. **Two reverse-orientation merges over the same two tabs**, the loser getting `tab.not_open` —
 *    the refusal survives in `move-merge.test.ts`, "refuses when either tab is not open
 *    (tab.not_open)".
 * 4. **The inverted-lock-order control that deliberately DID deadlock**, which existed only to show
 *    2's hazard was real.
 *
 * **LOST and replaced by nothing: the lock-ORDER guarantee between `mergeTabs` and
 * `payWorkingOrder`** — that a merge and a settle on the same tab cannot cross-lock. Nothing covers
 * it and nothing here can, because the pair of holders it ordered no longer exists.
 *
 * **Also lost, and not replaced:** the deployment role. These writes ran after `set local role
 * app_user` on a non-superuser connection; `asAppUser` is an empty body now
 * (`packages/db/src/testing/roles.ts`), so nothing checks that role's grants are part of any
 * refusal below.
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
      throw new Error("move-merge.filing.test: anchor() is not used by recordSale");
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
    // No integrated card terminal for these move/merge suites.
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

/** Seed one active dining table in the venue as the app role; returns its id. */
async function seedTable(cfg: TillConfig, label: string): Promise<string> {
  return withTransaction(suite.db, async (tx) => {
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
  return withTransaction(suite.db, async (tx) => {
    await asAppUser(tx);
    return openTab(tx, cfg, { tableId, lines }).then((r) => r.tabId);
  });
}

/** The dining table's current tab_id. */
async function tabIdOf(tableId: string): Promise<string | null> {
  const { rows } = await suite.db.execute<{ tab_id: string | null }>(
    sql`select tab_id from dining_tables where id = ${tableId}`,
  );
  return rows[0]!.tab_id;
}

/** How many `sales` rows reference this working order. */
async function saleCount(workingOrderId: string): Promise<number> {
  const { rows } = await suite.db.execute<{ count: string }>(sql`
    select cast(count(*) as text) as count from sales where working_order_id = ${workingOrderId}
  `);
  return Number(rows[0]!.count);
}

/**
 * The working order's own state.
 *
 * It used to project `settled_at is not null` beside the status, for the deleted merge-vs-pay race.
 * No case left here reads it, and a raw read of that projection returns 1/0 rather than a boolean
 * on this engine, so it would be an unasserted value in the wrong shape.
 */
async function orderState(id: string): Promise<{ status: string }> {
  const { rows } = await suite.db.execute<{ status: string }>(
    sql`select status from working_orders where id = ${id}`,
  );
  return { status: rows[0]!.status };
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
 * The IMMUTABLE filed `sales.total` for this working order's sale. The witness that a retrieved
 * order files at the LOCKED price, not a re-price at pay.
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
      Promise.reject(
        new Error("move-merge.filing.test: resolveClient must never be called by recordSale"),
      ),
  });
});

describe("joinTable → one bill", () => {
  it("a joined tab files ONE sale covering both tables on pay", async () => {
    const { cfg, cafe } = await setupVenue();
    const t1 = await seedTable(cfg, "JP1");
    const t2 = await seedTable(cfg, "JP2");
    const tabId = await openTabOn(cfg, t1, [{ productId: cafe.id, quantity: "1" }]);
    await withTransaction(suite.db, async (tx) => {
      await asAppUser(tx);
      await joinTable(tx, cfg, tabId, t2);
    });
    expect(await tabIdOf(t2)).toBe(tabId); // the join linked t2 to the one tab (durable: settle clears status_id, not tab_id)

    // Pay the one tab (a retrieved open order files from its stored locked lines).
    await payWorkingOrder({ db: suite.db, backend, clock }, cfg, {
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

    await withTransaction(suite.db, async (tx) => {
      await asAppUser(tx);
      await mergeTabs(tx, cfg, intoTab, fromTab, { freeSourceTable: true });
    });

    // fromTab is abandoned and files nothing — never reaches settled, so no double-file (CLAUDE.md §5).
    expect(await orderState(fromTab)).toMatchObject({ status: "abandoned" });
    expect(await saleCount(fromTab)).toBe(0);

    // Pay the merged intoTab → exactly one sale + one chained registro for the combined bill.
    await payWorkingOrder({ db: suite.db, backend, clock }, cfg, {
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

describe("mergeTabs join → one bill covering both tables", () => {
  it("a join-merged tab files ONE sale covering the combined lines; both tables still point at intoTab", async () => {
    const { cfg, cafe, agua } = await setupVenue();
    const tInto = await seedTable(cfg, "JMP-into");
    const tFrom = await seedTable(cfg, "JMP-from");
    const intoTab = await openTabOn(cfg, tInto, [{ productId: cafe.id, quantity: "1" }]);
    const fromTab = await openTabOn(cfg, tFrom, [{ productId: agua.id, quantity: "1" }]);

    await withTransaction(suite.db, async (tx) => {
      await asAppUser(tx);
      await mergeTabs(tx, cfg, intoTab, fromTab, { freeSourceTable: false });
    });
    expect(await tabIdOf(tFrom)).toBe(intoTab);

    await payWorkingOrder({ db: suite.db, backend, clock }, cfg, {
      id: intoTab,
      lines: [],
      tender: { method: "cash", amount: "5.00" },
    });
    expect(await saleCount(intoTab)).toBe(1); // one bill for both tables
    expect(await saleCount(fromTab)).toBe(0); // the abandoned source files nothing
  });
});
