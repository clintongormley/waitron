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
  listAvailableProducts,
  priceBasket,
} from "@waitron/catalogue";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import {
  abandonHeldOrder,
  getHeldOrder,
  listHeldOrders,
  parkOrder,
  updateHeldOrder,
} from "./working-order.js";
import "./errors.js";

// PGlite, not real Postgres: this suite proves the WRITE behaviour of `parkOrder` — the working-order
// state machine (an OPEN row plus its lines), the refuse-empty/refuse-unknown guards, and that the
// database's own FK + trigger constraints (the composite node/product FKs, `require_open_parent`, the
// `check_locales` trigger) hold on the rows it inserts — AND the READ behaviour of `listHeldOrders`
// (the sum/count aggregate, the open-status and node filters, the ordering) and `getHeldOrder` (the
// open-only lookup and its `working_order.not_found`). All of that is plain SQL a single backend
// proves; none of it needs a genuine non-superuser role — RLS/cross-tenant isolation and the per-node
// concurrency of `allocateOrderNumber` are proven against real Postgres in Task 7's `*.rls.test.ts`.
// Every read and write still runs through `withTenant` + `asAppUser` (as `app_user`, so RLS is in
// force even here) exactly as production does, so the tenant scope and the `check_locales` trigger
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
    // 1.50 gross each × 2 = 3.00 gross. `line_total` on this DRAFT is the GROSS 3.00 (the
    // customer-facing total the held list shows), NOT the net base 2.48 the FILED sale line carries;
    // `unit_price` stays the net unit 1.24 and `vat_rate` 21%. numeric(12,3) reads "2" back as "2.000".
    expect(lines[0]).toMatchObject({
      productId: cafeId,
      lineNo: 1,
      quantity: "2.000",
      descriptions: { [LOCALE]: "Café" },
      unitPrice: "1.24",
      vatRate: "21.00",
      lineTotal: "3.00",
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

/**
 * Read a working order and its lines back RAW (superuser, no tenant scope), for computing what
 * `listHeldOrders`/`getHeldOrder` should independently return. `openedAt` is the actual persisted
 * value, so a `toEqual` on the list carries every field rather than an `objectContaining` that would
 * let an unasserted key slip through (CLAUDE.md §4).
 */
async function readOrder(id: string): Promise<{
  openedAt: string;
  lineTotals: string[];
}> {
  const [wo] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
  const lines = await db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, id))
    .orderBy(workingOrderLines.lineNo);
  return { openedAt: wo!.openedAt, lineTotals: lines.map((l) => l.lineTotal) };
}

/**
 * The GROSS (VAT-inclusive) basket total the operator saw for `lines` — computed the SAME way the
 * server prices a basket (`listAvailableProducts` → `priceBasket`), then take its `.total`. This is
 * the number every other surface shows (the basket grand total, the printed ticket), and the
 * invariant a held-orders `total` MUST equal EXACTLY (Important review finding). Derived independently
 * of the persisted `line_total` column, so a held total computed from the NET base — the bug — fails
 * against it (2 × 1.50 gross is 3.00 here, not the net 2.48 the fiscal line carries).
 */
async function grossBasketTotal(
  cfg: TillConfig,
  lines: { productId: string; quantity: string }[],
): Promise<string> {
  return withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const available = await listAvailableProducts(tx, cfg.locationId);
    const byId = new Map(available.map((p) => [p.id, p]));
    const items = lines.map((l) => ({ product: byId.get(l.productId)!, quantity: l.quantity }));
    return priceBasket(items).total;
  });
}

/** Drive a parked order to a terminal status by UPDATE, the transition the enforce trigger allows. */
async function setStatus(id: string, status: "settled" | "abandoned"): Promise<void> {
  await withTenant(db, testTenant, async (tx) => {
    await asAppUser(tx);
    // `settled` demands a settled_at (working_orders_settled_at_ck is a biconditional); `abandoned`
    // demands it stay NULL. The BEFORE UPDATE enforce_transition trigger permits open→either.
    if (status === "settled") {
      await tx.execute(
        sql`update working_orders set status = 'settled', settled_at = now() where id = ${id}`,
      );
    } else {
      await tx.execute(sql`update working_orders set status = 'abandoned' where id = ${id}`);
    }
  });
}

// `setStatus` needs the tenant of the venue it is acting on; each test assigns this before using it.
let testTenant: string;

describe("listHeldOrders", () => {
  it("lists the node's open orders with itemCount, GROSS total and label, ordered by number", async () => {
    const { cfg, cafeId, aguaId } = await setupVenue();
    testTenant = cfg.tenantId;
    const idA = randomUUID();
    const idB = randomUUID();

    // A: a single line (itemCount 1). B: two lines (itemCount 2) and NO label (the null branch). A is
    // parked first, so its per-node number is 1 and B's is 2 — the order the list must come back in.
    const linesA = [{ productId: cafeId, quantity: "2" }];
    const linesB = [
      { productId: cafeId, quantity: "1" },
      { productId: aguaId, quantity: "3" },
    ];
    await parkOrder({ db }, cfg, { id: idA, lines: linesA, label: "Mesa 4" });
    await parkOrder({ db }, cfg, { id: idB, lines: linesB });

    // The Important review finding: the held `total` is the GROSS (VAT-inclusive) basket total the
    // operator saw — `priceBasket(sameItems).total`, computed independently of the persisted column —
    // NOT the summed net base. A: 1.50 × 2 = 3.00 gross (the old bug showed the net 2.48); B: 1.50 +
    // 6.00 = 7.50. Both asserted as literals AND against the pricer, so the test fails if the held
    // total ever reverts to net (2.48 ≠ 3.00) or if the pricer itself drifts.
    const grossA = await grossBasketTotal(cfg, linesA);
    const grossB = await grossBasketTotal(cfg, linesB);
    expect(grossA).toBe("3.00");
    expect(grossB).toBe("7.50");

    const a = await readOrder(idA);
    const b = await readOrder(idB);

    const held = await listHeldOrders({ db }, cfg);
    expect(held).toEqual([
      {
        id: idA,
        orderNumber: 1,
        label: "Mesa 4",
        itemCount: 1,
        total: grossA,
        openedAt: a.openedAt,
      },
      { id: idB, orderNumber: 2, label: null, itemCount: 2, total: grossB, openedAt: b.openedAt },
    ]);
  });

  it("omits settled and abandoned orders — the status filter is the only reason they are gone", async () => {
    const { cfg, cafeId } = await setupVenue();
    testTenant = cfg.tenantId;
    const openId = randomUUID();
    const abandonedId = randomUUID();
    const settledId = randomUUID();

    // All three are parked identically (same node, real lines), so the ONLY thing separating the
    // listed one from the other two is status — not a missing node_id or an empty basket.
    for (const id of [openId, abandonedId, settledId]) {
      await parkOrder({ db }, cfg, { id, lines: [{ productId: cafeId, quantity: "1" }] });
    }
    await setStatus(abandonedId, "abandoned");
    await setStatus(settledId, "settled");

    const held = await listHeldOrders({ db }, cfg);
    expect(held.map((o) => o.id)).toEqual([openId]);
  });

  it("excludes an open order on ANOTHER node of the same tenant — node scope, not just RLS", async () => {
    const { cfg, cafeId } = await setupVenue();
    const mine = randomUUID();
    await parkOrder({ db }, cfg, { id: mine, lines: [{ productId: cafeId, quantity: "1" }] });

    // A second node under the SAME tenant with its own open order. RLS is tenant-scoped, so it does
    // NOT hide this row — only `node_id = cfg.nodeId` does. Removing that filter makes this order
    // appear and fails the assertion (CLAUDE.md §4, prove the guard by deletion). Inserted directly
    // (no lines) as superuser: this row only has to EXIST to be wrongly listed.
    const otherNode = await seedNode(db, cfg.tenantId, cfg.locationId);
    await db.execute(sql`
      insert into working_orders (tenant_id, till_id, node_id, order_number, status)
      values (${cfg.tenantId}, ${cfg.tillId}, ${otherNode}, 1, 'open')`);

    const held = await listHeldOrders({ db }, cfg);
    expect(held.map((o) => o.id)).toEqual([mine]);
  });
});

describe("getHeldOrder", () => {
  it("returns the open order's product/quantity lines, ordered by lineNo", async () => {
    const { cfg, cafeId, aguaId } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      label: "Mesa 7",
      lines: [
        { productId: cafeId, quantity: "1" },
        { productId: aguaId, quantity: "3" },
      ],
    });

    const order = await getHeldOrder({ db }, cfg, id);
    // Only product_id + quantity per line (the basket-rebuild inputs), in lineNo order. numeric(12,3)
    // reads the quantities back as "1.000"/"3.000".
    expect(order).toEqual({
      id,
      orderNumber: 1,
      label: "Mesa 7",
      lines: [
        { productId: cafeId, quantity: "1.000" },
        { productId: aguaId, quantity: "3.000" },
      ],
    });
  });

  it("throws working_order.not_found for an unknown id", async () => {
    const { cfg } = await setupVenue();
    const missing = randomUUID();
    await expect(getHeldOrder({ db }, cfg, missing)).rejects.toMatchObject({
      code: "working_order.not_found",
      params: { workingOrderId: missing },
    });
  });

  it("throws working_order.not_found for a settled (non-open) order — closed is not retrievable", async () => {
    const { cfg, cafeId } = await setupVenue();
    testTenant = cfg.tenantId;
    const id = randomUUID();
    await parkOrder({ db }, cfg, { id, lines: [{ productId: cafeId, quantity: "1" }] });
    await setStatus(id, "settled");

    await expect(getHeldOrder({ db }, cfg, id)).rejects.toMatchObject({
      code: "working_order.not_found",
      params: { workingOrderId: id },
    });
  });
});

describe("updateHeldOrder", () => {
  it("replaces the lines, re-prices the total and updates the label, leaving the order row otherwise unchanged", async () => {
    const { cfg, cafeId, aguaId } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      lines: [{ productId: cafeId, quantity: "2" }],
      label: "Mesa 4",
    });
    const [beforeSummary] = await listHeldOrders({ db }, cfg);

    // A fresh basket in a deliberately different order (agua first) — proving the per-line product_id
    // zip is re-applied, the line_no is re-numbered from 1, and the total is re-priced authoritatively.
    const newLines = [
      { productId: aguaId, quantity: "1" },
      { productId: cafeId, quantity: "1" },
    ];
    await updateHeldOrder({ db }, cfg, id, { lines: newLines, label: "Mesa 7" });

    // order_number / node_id / till_id / tenant_id are untouched; only the label changed and the
    // status stays open (the update ran over the enforce_transition trigger, not around it).
    const [wo] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(wo).toMatchObject({
      status: "open",
      label: "Mesa 7",
      orderNumber: 1,
      nodeId: cfg.nodeId,
      tillId: cfg.tillId,
      tenantId: cfg.tenantId,
      settledAt: null,
    });

    // The old café line is gone; the two new lines carry the new products, re-numbered from 1.
    const lines = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ lineNo: 1, productId: aguaId });
    expect(lines[1]).toMatchObject({ lineNo: 2, productId: cafeId });

    // Re-priced: the new total differs from the parked one AND equals the GROSS basket total for the
    // replaced lines (`priceBasket(newLines).total`, computed independently of the persisted column) —
    // agua 2.00 + café 1.50 = 3.50 gross, where the parked cafe×2 was 3.00. Asserting against the
    // gross pricer (not the summed line_total column) is what fails if the held total reverts to net.
    const grossAfter = await grossBasketTotal(cfg, newLines);
    expect(grossAfter).toBe("3.50");
    const [afterSummary] = await listHeldOrders({ db }, cfg);
    expect(afterSummary!.itemCount).toBe(2);
    expect(afterSummary!.total).not.toBe(beforeSummary!.total);
    expect(afterSummary!.total).toBe(grossAfter);
  });

  it("clears the label to null when the update omits one — the whole request is the new state", async () => {
    const { cfg, cafeId, aguaId } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      lines: [{ productId: cafeId, quantity: "1" }],
      label: "Mesa 4",
    });

    // No label on the update: a label is part of the order's state, so omitting it clears the
    // parked "Mesa 4" rather than leaving it in place.
    await updateHeldOrder({ db }, cfg, id, { lines: [{ productId: aguaId, quantity: "1" }] });

    const [wo] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(wo!.label).toBeNull();
  });

  it("refuses an empty basket (sale.empty_basket) and an unknown product (sale.unknown_product), leaving the parked lines untouched", async () => {
    const { cfg, cafeId } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      lines: [{ productId: cafeId, quantity: "2" }],
      label: "Mesa 4",
    });
    const before = await readOrder(id);
    const UUID_NOT_IN_CAT = "00000000-0000-0000-0000-000000000000";

    await expect(updateHeldOrder({ db }, cfg, id, { lines: [] })).rejects.toMatchObject({
      code: "sale.empty_basket",
    });
    await expect(
      updateHeldOrder({ db }, cfg, id, { lines: [{ productId: UUID_NOT_IN_CAT, quantity: "1" }] }),
    ).rejects.toMatchObject({
      code: "sale.unknown_product",
      params: { productId: UUID_NOT_IN_CAT },
    });

    // Both refusals happen before any line is deleted, so the parked order still holds its one
    // original café line unchanged.
    const after = await readOrder(id);
    expect(after.lineTotals).toEqual(before.lineTotals);
    const lines = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ productId: cafeId, lineNo: 1 });
  });

  it("throws working_order.not_open on a settled order — a closed order can no longer be edited", async () => {
    const { cfg, cafeId } = await setupVenue();
    testTenant = cfg.tenantId;
    const id = randomUUID();
    await parkOrder({ db }, cfg, { id, lines: [{ productId: cafeId, quantity: "1" }] });
    await setStatus(id, "settled");

    await expect(
      updateHeldOrder({ db }, cfg, id, { lines: [{ productId: cafeId, quantity: "2" }] }),
    ).rejects.toMatchObject({
      code: "working_order.not_open",
      params: { workingOrderId: id },
    });
  });

  it("throws working_order.not_open for an absent id", async () => {
    const { cfg, cafeId } = await setupVenue();
    const missing = randomUUID();

    await expect(
      updateHeldOrder({ db }, cfg, missing, { lines: [{ productId: cafeId, quantity: "1" }] }),
    ).rejects.toMatchObject({
      code: "working_order.not_open",
      params: { workingOrderId: missing },
    });
  });
});

describe("abandonHeldOrder", () => {
  it("flips an open order to abandoned and drops it from the held list, leaving settled_at null", async () => {
    const { cfg, cafeId } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db }, cfg, { id, lines: [{ productId: cafeId, quantity: "1" }] });
    expect((await listHeldOrders({ db }, cfg)).map((o) => o.id)).toEqual([id]);

    await abandonHeldOrder({ db }, cfg, id);

    const [wo] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    // abandoned is terminal and carries NO settled_at (the settled_at biconditional): only `settled`
    // may set it. The held list, filtered to status = 'open', no longer shows the order.
    expect(wo).toMatchObject({ status: "abandoned", settledAt: null });
    expect(await listHeldOrders({ db }, cfg)).toEqual([]);
  });

  it("throws working_order.not_open on an already-abandoned order", async () => {
    const { cfg, cafeId } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db }, cfg, { id, lines: [{ productId: cafeId, quantity: "1" }] });
    await abandonHeldOrder({ db }, cfg, id);

    await expect(abandonHeldOrder({ db }, cfg, id)).rejects.toMatchObject({
      code: "working_order.not_open",
      params: { workingOrderId: id },
    });
  });

  it("throws working_order.not_open on a settled order and on an absent id", async () => {
    const { cfg, cafeId } = await setupVenue();
    testTenant = cfg.tenantId;
    const id = randomUUID();
    await parkOrder({ db }, cfg, { id, lines: [{ productId: cafeId, quantity: "1" }] });
    await setStatus(id, "settled");

    await expect(abandonHeldOrder({ db }, cfg, id)).rejects.toMatchObject({
      code: "working_order.not_open",
      params: { workingOrderId: id },
    });

    const missing = randomUUID();
    await expect(abandonHeldOrder({ db }, cfg, missing)).rejects.toMatchObject({
      code: "working_order.not_open",
      params: { workingOrderId: missing },
    });
  });
});
