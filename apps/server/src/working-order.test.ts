import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  asAppUser,
  withTenant,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { parkOrder } from "./working-order.js";
import "./errors.js";

// PGlite, not real Postgres: this suite proves the WRITE behaviour of `parkOrder` — the working-order
// state machine (an OPEN row plus its lines), the refuse-empty/refuse-unknown guards, and that the
// database's own FK + trigger constraints (the composite node/product FKs, `require_open_parent`, the
// `check_locales` trigger) hold on the rows it inserts. None of that needs a genuine non-superuser
// role: RLS/cross-tenant isolation and the per-node concurrency of `allocateOrderNumber` are proven
// against real Postgres in Task 7's `*.rls.test.ts`. The insert still runs through `withTenant` +
// `asAppUser` exactly as production does, so the tenant-scoped inserts and the `check_locales` trigger
// (which reads the location under the caller's own scope) are exercised, not bypassed.
const LOCALE = "es-ES";

const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

let db: Database;

beforeAll(() => {
  db = suite.db;
});

interface SeededVenue {
  cfg: TillConfig;
  /** The `each`-priced "Café" product (VAT general/21%, category "Bebidas"). */
  cafeId: string;
  /** A second `each` product with NO category, so its priced line carries `category: null`. */
  aguaId: string;
}

/**
 * Stand up a fresh tenant + location + till + node and a catalogue with two products, all keyed to
 * `LOCALE` so the `working_order_lines_check_locales` trigger (descriptions must hold EXACTLY the
 * location's `invoice_locales`) is satisfied. Each test gets its OWN tenant + node, so the order
 * number `allocateOrderNumber` issues is that test's own — always 1 on the first park — and the suite
 * is order-independent (CLAUDE.md §4).
 */
async function setupVenue(): Promise<SeededVenue> {
  const tenantId = await seedTenant(db);
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Barra', array[${LOCALE}], 'Venta en establecimiento') returning id`);
  const locationId = loc.rows[0]!.id;
  const till = await db.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name)
    values (${tenantId}, ${locationId}, 'Caja 1') returning id`);
  const nodeId = await seedNode(db, tenantId, brandLocationId(locationId));

  const { cafeId, aguaId } = await withTenant(db, tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, { name: "Carta" });
    const bebidas = await createCategory(tx, { name: "Bebidas" });
    const cafe = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      descriptions: { [LOCALE]: "Café" },
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    // Deliberately category-less: `listAvailableProducts` resolves its `category` to NULL (LEFT JOIN),
    // so its priced line snapshots `category: null` — the other side of `parkOrder`'s `?? null`.
    const agua = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: null,
      descriptions: { [LOCALE]: "Agua" },
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, locationId, cat.id);
    return { cafeId: cafe.id, aguaId: agua.id };
  });

  const cfg: TillConfig = {
    tenantId,
    tillId: brandTillId(till.rows[0]!.id),
    nodeId: brandNodeId(nodeId),
    // `parkOrder` reads neither series nor locale/invoiceLocales; fresh values keep the shape whole.
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
  };
  return { cfg, cafeId, aguaId };
}

describe("parkOrder", () => {
  it("parks an open working order with number 1 and its priced lines", async () => {
    const { cfg, cafeId } = await setupVenue();
    const id = randomUUID();

    const { orderNumber } = await parkOrder({ db }, cfg, {
      id,
      lines: [{ productId: cafeId, quantity: "2" }],
      label: "John",
    });
    expect(orderNumber).toBe(1);

    const [wo] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(wo).toMatchObject({
      status: "open",
      label: "John",
      orderNumber: 1,
      nodeId: cfg.nodeId,
      tillId: cfg.tillId,
      tenantId: cfg.tenantId,
      settledAt: null,
    });

    const lines = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    expect(lines).toHaveLength(1);
    // The line carries its product FK + quantity AND the full display snapshot priceBasket produced:
    // 1.50 gross each × 2 = 3.00 gross; at 21% the difference-method base is 2.48 and the net unit
    // 1.24. numeric(12,3) reads "2" back as "2.000".
    expect(lines[0]).toMatchObject({
      productId: cafeId,
      lineNo: 1,
      quantity: "2.000",
      descriptions: { [LOCALE]: "Café" },
      unitPrice: "1.24",
      vatRate: "21.00",
      lineTotal: "2.48",
      category: "Bebidas",
    });
  });

  it("parks a multi-line order without a label, snapshotting a category-less line as null", async () => {
    const { cfg, cafeId, aguaId } = await setupVenue();
    const id = randomUUID();

    const { orderNumber } = await parkOrder({ db }, cfg, {
      id,
      // Two lines in a deliberate order, so the per-line product_id zip (line i ← req.lines[i]) is
      // proven for more than index 0.
      lines: [
        { productId: cafeId, quantity: "1" },
        { productId: aguaId, quantity: "3" },
      ],
    });
    // A fresh tenant/node, so this park's own first allocation is 1.
    expect(orderNumber).toBe(1);

    const [wo] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(wo!.label).toBeNull();

    const lines = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ lineNo: 1, productId: cafeId, category: "Bebidas" });
    expect(lines[1]).toMatchObject({ lineNo: 2, productId: aguaId, quantity: "3.000" });
    // The category-less product's line snapshots NULL, the other branch of `?? null`.
    expect(lines[1]!.category).toBeNull();
  });

  it("refuses an empty basket (sale.empty_basket) and an unknown product (sale.unknown_product)", async () => {
    const { cfg, cafeId } = await setupVenue();
    const UUID_NOT_IN_CAT = "00000000-0000-0000-0000-000000000000";

    await expect(parkOrder({ db }, cfg, { id: randomUUID(), lines: [] })).rejects.toMatchObject({
      code: "sale.empty_basket",
    });

    await expect(
      parkOrder({ db }, cfg, {
        id: randomUUID(),
        lines: [{ productId: UUID_NOT_IN_CAT, quantity: "1" }],
      }),
    ).rejects.toMatchObject({
      code: "sale.unknown_product",
      params: { productId: UUID_NOT_IN_CAT },
    });

    // The unknown-product refusal aborts the whole transaction: even the good line beside it leaves
    // no working order behind (the refuse-empty guard runs before the tx; the unknown guard inside it).
    await expect(
      parkOrder({ db }, cfg, {
        id: randomUUID(),
        lines: [
          { productId: cafeId, quantity: "1" },
          { productId: UUID_NOT_IN_CAT, quantity: "1" },
        ],
      }),
    ).rejects.toMatchObject({ code: "sale.unknown_product" });
    const parked = await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return tx.select().from(workingOrders).where(eq(workingOrders.tenantId, cfg.tenantId));
    });
    expect(parked).toHaveLength(0);
  });
});
