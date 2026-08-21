import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  asAppUser,
  captureError,
  pgErrorCode,
  ticketItems,
  withTenant,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
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
  addTabRound,
  advanceTicket,
  advanceTicketItem,
  createOpenOrder,
  fireLines,
  getHeldOrder,
  listHeldOrders,
  listStationQueue,
  openTab,
  parkOrder,
  placeOrder,
  sendToPrep,
  updateHeldOrder,
} from "./working-order.js";
import { createStation, setCategoryStation, setProductStation } from "./kitchen.js";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
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
  /** The catalogue assigned to this venue's location — where the KDS routing tests add more products. */
  catalogueId: string;
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
async function setupVenue(orderFlow: TillConfig["orderFlow"] = "prepay"): Promise<SeededVenue> {
  const tenantId = await seedTenant(db);
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Barra', array[${LOCALE}], 'Venta en establecimiento') returning id`);
  const locationId = loc.rows[0]!.id;
  const till = await db.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name)
    values (${tenantId}, ${locationId}, 'Caja 1') returning id`);
  const nodeId = await seedNode(db, tenantId, brandLocationId(locationId));

  const { cafeId, aguaId, catalogueId } = await withTenant(db, tenantId, async (tx) => {
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
    return { cafeId: cafe.id, aguaId: agua.id, catalogueId: cat.id };
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
    // No integrated card terminal; these park routes never read it.
    cardProvider: "none",
    tipsEnabled: false,
    // Defaults to prepay (park/list/retrieve/update/abandon don't dispatch on the mode); the KDS fire
    // tests pass "ticket_then_pay" so placeOrder takes the non-fiscal placing path.
    orderFlow,
  };
  return { cfg, cafeId, aguaId, catalogueId };
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

  it("replays the existing order on a re-sent park, creating no second order", async () => {
    // PGlite (a single backend) is correct here: this is a SEQUENTIAL lost-response retry — the first
    // park commits, then the re-sent park with the SAME client-minted id collides against that already-
    // committed row on the SAME backend. It is NOT concurrency (two backends racing, which would need a
    // real non-superuser role to serialise): one connection replaying its own committed write is exactly
    // what a single backend proves. The CONCURRENT park backstop — two backends racing the same id — is
    // proven separately against real Postgres in `working-order.rls.test.ts` ("parkOrder concurrent replay").
    const { cfg, cafeId } = await setupVenue();
    const id = randomUUID();
    const lines = [{ productId: cafeId, quantity: "2" }];

    const first = await parkOrder({ db }, cfg, { id, lines, label: "John" });
    expect(first.orderNumber).toBe(1);

    // The re-sent park (a lost-response retry) REPLAYS the committed order rather than PK-colliding into
    // an opaque 500 — same id, same allocated number, nothing new filed.
    const replay = await parkOrder({ db }, cfg, { id, lines, label: "John" });
    expect(replay).toEqual({ id, orderNumber: 1 });

    // Exactly ONE order and ONE line survive: the replay re-inserted neither the order nor its lines.
    const orders = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(orders).toHaveLength(1);
    const woLines = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    expect(woLines).toHaveLength(1);
  });

  it("replays the ORIGINAL order when a re-sent park carries a DIFFERENT basket (id is the idempotency key)", async () => {
    // The replay is keyed on the id ALONE and files nothing, so a re-park whose lines DIFFER from the
    // committed order does NOT update it — the original composition survives and the differing basket is
    // discarded. This is deliberate idempotency (the id is the key, exactly like pay's replay), and it is
    // WHY the till must route a retrieved-and-EDITED order's re-hold through `updateWorkingOrder`, not a
    // re-park: re-parking an edit would silently drop it (see `#onParkOrder` / `#syncIfDirty` in apps/till).
    const { cfg, cafeId, aguaId } = await setupVenue();
    const id = randomUUID();

    const first = await parkOrder({ db }, cfg, {
      id,
      lines: [{ productId: cafeId, quantity: "1" }],
    });
    expect(first.orderNumber).toBe(1);

    // Re-park the SAME id with a different product and quantity. It replays the original, unchanged.
    const replay = await parkOrder({ db }, cfg, {
      id,
      lines: [{ productId: aguaId, quantity: "5" }],
    });
    expect(replay).toEqual({ id, orderNumber: 1 });

    // The one surviving line is the ORIGINAL Café line — the re-park's Agua line was never inserted.
    const woLines = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    expect(woLines).toHaveLength(1);
    expect(woLines[0]).toMatchObject({ productId: cafeId, quantity: "1.000" });
  });

  it("re-throws when the colliding id is no longer an open order", async () => {
    // A CHARACTERIZATION test: its external behaviour (a rejection) is UNCHANGED by this fix, so it is
    // not RED. It is proven to guard the new not-open branch BY DELETION (CLAUDE.md §4): replacing that
    // branch's `throw error` with a fabricated `return { id: req.id, orderNumber: -1 }` makes this test
    // FAIL (done, then restored) — confirming the assertion exercises the branch, not something else.
    const { cfg, cafeId } = await setupVenue();
    const id = randomUUID();
    const lines = [{ productId: cafeId, quantity: "1" }];

    await parkOrder({ db }, cfg, { id, lines });
    // Abandon it: `abandonHeldOrder` is a conditional open→abandoned UPDATE, so the row PERSISTS (status
    // 'abandoned'), not a delete — a re-park's id still PK-collides, but the committed row is no longer open.
    await abandonHeldOrder({ db }, cfg, id);

    // The re-park collides on the committed (now abandoned) row. Not being `open`, it is NOT a replayable
    // held order, so the ORIGINAL raw 23505 is re-thrown rather than a result fabricated. The SQLSTATE is
    // read via `pgErrorCode` (not `.rejects.toMatchObject({ code })`) because Drizzle wraps the pg error in
    // a `DrizzleQueryError` whose own `.code` is undefined and PGlite nests the real code under `.cause` —
    // the same normalisation `record-void.test.ts` makes for this identical assertion shape.
    const error = await captureError(() => parkOrder({ db }, cfg, { id, lines }));
    expect(pgErrorCode(error)).toBe("23505");

    // The failed re-park did not resurrect the abandoned row.
    const [wo] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(wo!.status).toBe("abandoned");
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

/**
 * Insert a lineless OPEN order on a SECOND node under the SAME tenant + location, and return its id.
 * RLS is tenant-scoped, so it does NOT hide this row from `cfg`'s node — only `node_id = cfg.nodeId`
 * does. The by-id held-order lookups must fail closed on it, exactly as `listHeldOrders` omits it
 * (its `node scope, not just RLS` sibling). Inserted directly as superuser: the row only has to EXIST
 * to be wrongly returned/edited/abandoned when the node filter is missing (prove-by-deletion target).
 */
async function seedForeignNodeOrder(cfg: TillConfig): Promise<string> {
  const id = randomUUID();
  const otherNode = await seedNode(db, cfg.tenantId, cfg.locationId);
  await db.execute(sql`
    insert into working_orders (id, tenant_id, till_id, node_id, order_number, status)
    values (${id}, ${cfg.tenantId}, ${cfg.tillId}, ${otherNode}, 1, 'open')`);
  return id;
}

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

  it("throws working_order.not_found for an open order on ANOTHER node of the same tenant — node scope, not just RLS", async () => {
    const { cfg } = await setupVenue();
    const foreign = await seedForeignNodeOrder(cfg);

    // RLS (tenant-scoped) does NOT hide a same-tenant order parked on another node; only
    // `node_id = cfg.nodeId` does. Without that filter `getHeldOrder` returns the foreign order instead
    // of throwing (prove the guard by deletion, CLAUDE.md §4).
    await expect(getHeldOrder({ db }, cfg, foreign)).rejects.toMatchObject({
      code: "working_order.not_found",
      params: { workingOrderId: foreign },
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

  it("throws working_order.not_open for an open order on ANOTHER node of the same tenant — node scope, not just RLS", async () => {
    const { cfg, cafeId } = await setupVenue();
    const foreign = await seedForeignNodeOrder(cfg);

    // Without the node filter the foreign order is found open and its lines are rewritten — a cross-node
    // misattribution. The node filter fails it closed BEFORE any line is touched (prove by deletion, §4).
    await expect(
      updateHeldOrder({ db }, cfg, foreign, { lines: [{ productId: cafeId, quantity: "1" }] }),
    ).rejects.toMatchObject({
      code: "working_order.not_open",
      params: { workingOrderId: foreign },
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

  it("throws working_order.not_open for an open order on ANOTHER node of the same tenant — node scope, not just RLS", async () => {
    const { cfg } = await setupVenue();
    const foreign = await seedForeignNodeOrder(cfg);

    // Without the node filter the conditional UPDATE matches the foreign open order and abandons it — a
    // cross-node discard. The node filter makes it match no row and fail closed (prove by deletion, §4).
    await expect(abandonHeldOrder({ db }, cfg, foreign)).rejects.toMatchObject({
      code: "working_order.not_open",
      params: { workingOrderId: foreign },
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// KDS-1 Task 3 — fire → ticket items. `fireLines` resolves `product ?? category ?? default` and
// SNAPSHOTS the station onto each ticket item; the three fire points (placeOrder, sendToPrep, and a
// tab's round-send via addTabRound) funnel through it. PGlite proves the resolver, the snapshot rule
// and the no-default refusal — plain SQL a single backend proves; RLS/node isolation of `ticket_items`
// is real-Postgres's job (packages/db `ticket-items.rls.test.ts`). Every write runs through
// `withTenant` + `asAppUser`, so the tenant scope and grants are exercised, not bypassed.
// ---------------------------------------------------------------------------------------------------

/** The accountable operator a placing amendment is attributed to (a fixed fixture uuid — only ever
 *  stored, never joined; mirrors working-order.rls.test.ts's OPERATOR). */
const OPERATOR = "0000ffff-2222-4000-8000-0000000000aa";

/** A trusted-clock stub: placeOrder reads only `now()` for its amendment's wall-clock. */
const stubClock = {
  now: () => ({ instant: new Date(), offsetMinutes: 0 }),
} as unknown as TrustedClock;

/** A fiscal-backend stub — never touched on the non-`invoice_first` placing paths these tests exercise. */
const stubBackend = {} as unknown as FiscalBackend;

/** A basket line for a product at quantity 1 — the shape createOpenOrder/fireLines consume. */
const line = (productId: string) => ({ productId, quantity: "1" });

/** Create a sellable product in the venue's catalogue, optionally with a category and/or a station
 *  override; returns its id. Descriptions match the location's single locale so `check_locales` passes. */
async function makeProduct(
  tx: Transaction,
  cfg: TillConfig,
  catalogueId: string,
  route: { categoryId?: string; stationId?: string },
): Promise<string> {
  const { id } = await createProduct(tx, {
    catalogueId,
    categoryId: route.categoryId ?? null,
    descriptions: { [LOCALE]: `P-${randomUUID().slice(0, 8)}` },
    pricingUnit: "each",
    unitPrice: "1.50",
    vatClass: "general",
  });
  if (route.stationId !== undefined) {
    await setProductStation(tx, cfg, id, route.stationId);
  }
  return id;
}

/** Insert an active dining table in the venue and return its id (for the openTab → addTabRound path). */
async function makeTable(tx: Transaction, cfg: TillConfig): Promise<string> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    insert into dining_tables (tenant_id, location_id, label)
    values (${cfg.tenantId}, ${cfg.locationId}, ${`T-${randomUUID().slice(0, 8)}`}) returning id`);
  return rows[0]!.id;
}

/** Open a fresh working order carrying `lines` and FIRE it — the same read-lines → fireLines sequence
 *  placeOrder/sendToPrep run, isolated onto the caller's tx so the resolver + snapshot can be asserted
 *  without the fiscal machinery. Returns the order's id. */
async function placeOrderWith(
  tx: Transaction,
  cfg: TillConfig,
  lines: { productId: string; quantity: string }[],
): Promise<{ id: string }> {
  const id = randomUUID();
  await createOpenOrder(tx, cfg, id, lines, null);
  const fired = await tx
    .select({ id: workingOrderLines.id, productId: workingOrderLines.productId })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, id))
    .orderBy(workingOrderLines.lineNo);
  await fireLines(tx, cfg, id, fired);
  return { id };
}

/** The order's ticket items joined back to each line's product, for asserting where each line routed. */
async function ticketItemsFor(
  tx: Transaction,
  orderId: string,
): Promise<{ productId: string; stationId: string; state: string }[]> {
  return tx
    .select({
      productId: workingOrderLines.productId,
      stationId: ticketItems.stationId,
      state: ticketItems.state,
    })
    .from(ticketItems)
    .innerJoin(
      workingOrderLines,
      and(
        eq(ticketItems.workingOrderLineId, workingOrderLines.id),
        eq(ticketItems.tenantId, workingOrderLines.tenantId),
      ),
    )
    .where(eq(ticketItems.workingOrderId, orderId));
}

const byProduct = (
  items: { productId: string; stationId: string; state: string }[],
  productId: string,
) => items.find((i) => i.productId === productId)!;

describe("fireLines (KDS-1 routing resolver + snapshot)", () => {
  it("routes product > category > default and snapshots the station at fire time", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const barra = await createStation(tx, cfg, { name: "Barra" });
      const drinks = await createCategory(tx, { name: "Copas" });
      await setCategoryStation(tx, cfg, drinks.id, barra.id);
      const cana = await makeProduct(tx, cfg, catalogueId, { categoryId: drinks.id }); // → barra (category)
      const cafe = await makeProduct(tx, cfg, catalogueId, {
        categoryId: drinks.id,
        stationId: cocina.id,
      }); // → cocina (the product override wins over its category default)

      const { id: orderId } = await placeOrderWith(tx, cfg, [line(cana), line(cafe)]);
      const items = await ticketItemsFor(tx, orderId);
      expect(byProduct(items, cana).stationId).toBe(barra.id);
      expect(byProduct(items, cafe).stationId).toBe(cocina.id);
      expect(items.every((i) => i.state === "queued")).toBe(true);

      // Re-route the category AFTER firing. The already-fired item is SNAPSHOTTED, so it does NOT move —
      // the load-bearing rule (re-categorising a product later never reroutes food already sent).
      await setCategoryStation(tx, cfg, drinks.id, cocina.id);
      const after = await ticketItemsFor(tx, orderId);
      expect(byProduct(after, cana).stationId).toBe(barra.id);
    });
  });

  it("refuses to fire when the location has no default station (station.no_default)", async () => {
    const { cfg, catalogueId } = await setupVenue(); // no default station created
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const uncategorised = await makeProduct(tx, cfg, catalogueId, {}); // no product/category route
      await expect(placeOrderWith(tx, cfg, [line(uncategorised)])).rejects.toMatchObject({
        code: "station.no_default",
        params: { locationId: cfg.locationId },
      });
    });
  });

  it("addTabRound fires the appended round's lines to the resolved station (the tab round-send)", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const cafe = await makeProduct(tx, cfg, catalogueId, {});
      const tableId = await makeTable(tx, cfg);
      const { tabId } = await openTab(tx, cfg, { tableId });

      await addTabRound(tx, cfg, tabId, [line(cafe)]);

      const items = await ticketItemsFor(tx, tabId);
      expect(items).toHaveLength(1);
      expect(items[0]!.stationId).toBe(cocina.id);
      expect(items[0]!.state).toBe("queued");
    });
  });
});

describe("placeOrder / sendToPrep fire ticket items", () => {
  it("placeOrder fires one ticket item per line to the resolved station (Mode T)", async () => {
    const { cfg, catalogueId } = await setupVenue("ticket_then_pay");
    const { cocinaId, cafe } = await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const p = await makeProduct(tx, cfg, catalogueId, {});
      return { cocinaId: cocina.id, cafe: p };
    });

    const id = randomUUID();
    await parkOrder({ db }, cfg, { id, lines: [line(cafe)] });
    await placeOrder({ db, backend: stubBackend, clock: stubClock }, cfg, id, OPERATOR);

    const items = await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return ticketItemsFor(tx, id);
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.stationId).toBe(cocinaId);
    expect(items[0]!.state).toBe("queued");
  });

  it("sendToPrep refuses an order that is not settled (working_order.not_settled)", async () => {
    const { cfg, cafeId } = await setupVenue();
    const id = randomUUID();
    // An OPEN (parked, never settled) order is ineligible — Mode P's pickup fires only a settled order.
    await parkOrder({ db }, cfg, { id, lines: [{ productId: cafeId, quantity: "1" }] });
    await expect(sendToPrep({ db }, cfg, id)).rejects.toMatchObject({
      code: "working_order.not_settled",
      params: { workingOrderId: id },
    });
  });
});

// KDS-1 Task 4 — bump (advance) + per-station queue read. `advanceTicketItem` is the per-line
// conditional-UPDATE state machine (queued → preparing → ready, illegal moves refused via an empty
// `returning` → `ticket.invalid_transition`); `advanceTicket` bumps every not-yet-`to` line of one
// order at one station together; `listStationQueue` groups a station's items by order, dropping
// collected and abandoned orders. PGlite proves the transition logic, the whole-ticket fan-out and the
// grouping/exclusion filters — plain SQL a single backend proves; the RLS/tenant-isolation + node
// scoping are real-Postgres's job (working-order.rls.test.ts). Every write runs through
// `withTenant` + `asAppUser`, so grants and RLS are in force, not bypassed.
// ---------------------------------------------------------------------------------------------------

/** The order's ticket items joined to their line, in line_no order — each item's id (the bump target),
 *  line and current state, so a test can address item[0]/item[1] deterministically. */
async function ticketItemRows(
  tx: Transaction,
  orderId: string,
): Promise<{ id: string; lineNo: number; state: string }[]> {
  return tx
    .select({ id: ticketItems.id, lineNo: workingOrderLines.lineNo, state: ticketItems.state })
    .from(ticketItems)
    .innerJoin(
      workingOrderLines,
      and(
        eq(ticketItems.workingOrderLineId, workingOrderLines.id),
        eq(ticketItems.tenantId, workingOrderLines.tenantId),
      ),
    )
    .where(eq(ticketItems.workingOrderId, orderId))
    .orderBy(workingOrderLines.lineNo);
}

describe("advanceTicketItem / advanceTicket / listStationQueue (bump + queue)", () => {
  it("bumps a line queued→preparing→ready, refuses illegal moves, and whole-ticket bumps together", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const cafe = await makeProduct(tx, cfg, catalogueId, {});
      const agua = await makeProduct(tx, cfg, catalogueId, {});
      const { id: orderId } = await placeOrderWith(tx, cfg, [line(cafe), line(agua)]); // both → Cocina, queued

      const items = await ticketItemRows(tx, orderId);
      expect(items.map((i) => i.state)).toEqual(["queued", "queued"]);

      // Per-line bump: item[0] walks queued → preparing → ready.
      await advanceTicketItem(tx, cfg, items[0]!.id, "preparing");
      await advanceTicketItem(tx, cfg, items[0]!.id, "ready");

      // Backwards (ready → preparing) is refused via the empty `returning` — the state predicate no
      // longer matches — naming the offending ticket item.
      await expect(advanceTicketItem(tx, cfg, items[0]!.id, "preparing")).rejects.toMatchObject({
        code: "ticket.invalid_transition",
        params: { ticketItemId: items[0]!.id },
      });

      // Whole-ticket bump advances only the still-queued item[1] (item[0], already `ready`, is left
      // alone — it is no longer at the `queued` predecessor).
      await advanceTicket(tx, cfg, orderId, cocina.id, "preparing");

      const queue = await listStationQueue(tx, cfg, cocina.id);
      const group = queue.find((g) => g.orderId === orderId)!;
      expect(group.items).toHaveLength(2);
      expect(group.items.map((i) => i.state).sort()).toEqual(["preparing", "ready"]);

      // A second whole-ticket bump to `ready` advances the now-preparing item[1]; item[0] (already
      // `ready`) is skipped — the bulk UPDATE matches only the `preparing` predecessor.
      await advanceTicket(tx, cfg, orderId, cocina.id, "ready");
      const readied = await listStationQueue(tx, cfg, cocina.id);
      expect(readied.find((g) => g.orderId === orderId)!.items.map((i) => i.state)).toEqual([
        "ready",
        "ready",
      ]);
    });
  });

  it("advanceTicketItem refuses a skip (queued→ready), to='queued', and a nonexistent item", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const cafe = await makeProduct(tx, cfg, catalogueId, {});
      const { id: orderId } = await placeOrderWith(tx, cfg, [line(cafe)]);
      const [item] = await ticketItemRows(tx, orderId);

      // Skipping preparing (queued → ready) matches no row — `ready`'s only legal predecessor is
      // `preparing` — so the empty `returning` refuses it.
      await expect(advanceTicketItem(tx, cfg, item!.id, "ready")).rejects.toMatchObject({
        code: "ticket.invalid_transition",
        params: { ticketItemId: item!.id },
      });
      // No state legally advances INTO queued — refused before any query.
      await expect(advanceTicketItem(tx, cfg, item!.id, "queued")).rejects.toMatchObject({
        code: "ticket.invalid_transition",
      });
      // An absent id (or another tenant's, RLS-hidden) matches no row — the same fail-closed code.
      const missing = randomUUID();
      await expect(advanceTicketItem(tx, cfg, missing, "preparing")).rejects.toMatchObject({
        code: "ticket.invalid_transition",
        params: { ticketItemId: missing },
      });
      // The refusals changed nothing.
      const [after] = await ticketItemRows(tx, orderId);
      expect(after!.state).toBe("queued");
    });
  });

  it("listStationQueue groups a station's items by order oldest-first, dropping collected and abandoned orders", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const barra = await createStation(tx, cfg, { name: "Barra" });
      const cafe = await makeProduct(tx, cfg, catalogueId, {});
      const copa = await makeProduct(tx, cfg, catalogueId, { stationId: barra.id });

      // Order 1 → Cocina (two lines), then order 2 → Cocina (one line) + one line to Barra.
      const { id: order1 } = await placeOrderWith(tx, cfg, [line(cafe), line(cafe)]);
      const { id: order2 } = await placeOrderWith(tx, cfg, [line(cafe), line(copa)]);

      const cocinaQueue = await listStationQueue(tx, cfg, cocina.id);
      // Two groups, oldest order first; order 1 has two Cocina lines, order 2 has one (its copa went
      // to Barra, so it is NOT in this station's group).
      expect(cocinaQueue.map((g) => g.orderId)).toEqual([order1, order2]);
      expect(cocinaQueue[0]!.items).toHaveLength(2);
      expect(cocinaQueue[1]!.items).toHaveLength(1);
      // The Barra station sees only order 2's copa line.
      const barraQueue = await listStationQueue(tx, cfg, barra.id);
      expect(barraQueue.map((g) => g.orderId)).toEqual([order2]);
      expect(barraQueue[0]!.items).toHaveLength(1);

      // Collecting order 1 (handover marker) drops it from the station queue.
      await tx
        .update(workingOrders)
        .set({ collectedAt: sql`now()` })
        .where(eq(workingOrders.id, order1));
      expect((await listStationQueue(tx, cfg, cocina.id)).map((g) => g.orderId)).toEqual([order2]);

      // Abandoning order 2 drops it too — the queue is empty at Cocina.
      await tx
        .update(workingOrders)
        .set({ status: "abandoned" })
        .where(eq(workingOrders.id, order2));
      expect(await listStationQueue(tx, cfg, cocina.id)).toEqual([]);
    });
  });
});
