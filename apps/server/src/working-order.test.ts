import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  asAppUser,
  captureError,
  optionGroupItems,
  optionGroups,
  pgErrorCode,
  productOptionGroups,
  ticketItems,
  withTenant,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { AllergenMap, Database, Doneness, Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  applyDietDerivation,
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
  listAvailableProducts,
  priceBasket,
} from "@waitron/catalogue";
import * as catalogue from "@waitron/catalogue";
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
  bumpCourseReady,
  createOpenOrder,
  fireCourse,
  fireLines,
  getHeldOrder,
  listExpoQueue,
  listHeldOrders,
  listStationQueue,
  markCourseAway,
  markLineServed,
  openTab,
  parkOrder,
  placeOrder,
  sendToPrep,
  updateHeldOrder,
  voidTabLine,
} from "./working-order.js";
import type { TicketState } from "./working-order.js";
import {
  createCourse,
  createStation,
  deactivateCourse,
  deactivateStation,
  setCategoryStation,
  setProductCourse,
  setProductStation,
} from "./kitchen.js";
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
    const { products: available } = await listAvailableProducts(tx, cfg.locationId);
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
  // `note`/`doneness` are the per-line KDS customisation (spec §2/§3, NON-FISCAL) — `createOpenOrder`
  // validates + persists them on the parent dish line, and `fireLines` snapshots them onto the ticket.
  lines: {
    productId: string;
    quantity: string;
    options?: { optionGroupItemId: string }[];
    note?: string;
    doneness?: Doneness;
  }[],
): Promise<{ id: string }> {
  const id = randomUUID();
  await createOpenOrder(tx, cfg, id, lines, null);
  const fired = await tx
    .select({
      id: workingOrderLines.id,
      productId: workingOrderLines.productId,
      courseId: workingOrderLines.courseId,
      parentLineId: workingOrderLines.parentLineId,
      note: workingOrderLines.note,
      doneness: workingOrderLines.doneness,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, id))
    .orderBy(workingOrderLines.lineNo);
  await fireLines(tx, cfg, id, fired);
  return { id };
}

/** Attach a fresh single-item option group to `productId` and return the option-item id — the shape a
 *  line's `options: [{ optionGroupItemId }]` selects, for the modifier sub-item tests. */
async function addOption(
  tx: Transaction,
  productId: string,
  name: string,
  // The allergen OVERLAY this option carries as served (Task 8): the codes it adds and the codes it
  // removes. Omitted for a plain option (the modifier sub-item tests), so both columns stay null.
  // `addOrigins`/`removeOrigins` are the DIET twin (Task 5): the dietary origins the option adds and
  // removes, folded into the dish's as-served diet.
  overlay?: {
    add?: AllergenMap;
    remove?: string[];
    addOrigins?: string[];
    removeOrigins?: string[];
  },
): Promise<string> {
  const [group] = await tx
    .insert(optionGroups)
    .values({
      tenantId: sql`current_tenant_id()`,
      name: { [LOCALE]: `${name} group` },
      minSelect: 0,
      maxSelect: 1,
      required: false,
      sort: 0,
    })
    .returning({ id: optionGroups.id });
  const [item] = await tx
    .insert(optionGroupItems)
    .values({
      tenantId: sql`current_tenant_id()`,
      groupId: group!.id,
      name: { [LOCALE]: name },
      priceDelta: "0.50",
      vatClass: "reduced",
      sort: 0,
      addAllergens: overlay?.add ?? null,
      removeAllergens: overlay?.remove ?? null,
      addOrigins: overlay?.addOrigins ?? null,
      removeOrigins: overlay?.removeOrigins ?? null,
    })
    .returning({ id: optionGroupItems.id });
  await tx.insert(productOptionGroups).values({
    tenantId: sql`current_tenant_id()`,
    productId,
    groupId: group!.id,
    sort: 0,
  });
  return item!.id;
}

/** The order's ticket items joined back to each line's product, for asserting where each line routed. */
async function ticketItemsFor(
  tx: Transaction,
  orderId: string,
): Promise<{ productId: string | null; stationId: string; state: string }[]> {
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
  items: { productId: string | null; stationId: string; state: string }[],
  productId: string,
) => items.find((i) => i.productId === productId)!;

describe("createOpenOrder empty-basket skips the full catalogue read (perf)", () => {
  afterEach(() => vi.restoreAllMocks());

  // A lineless order (every splitOffCheck, a lineless openTab, unjoin's new tab) has nothing to resolve
  // or price, so priceOrderLines must NOT issue the full listAvailableProducts scan. Behaviour alone
  // can't distinguish this (an empty basket yields an empty order either way), so SPY the catalogue read
  // and assert it is skipped for [] and taken for a real line. Proven by deletion: remove the early
  // return in priceOrderLines and the empty-lines case calls the spy → this test fails.
  it("does NOT call listAvailableProducts for an empty basket", async () => {
    const { cfg } = await setupVenue();
    const spy = vi.spyOn(catalogue, "listAvailableProducts");
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await createOpenOrder(tx, cfg, randomUUID(), [], null);
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("DOES call listAvailableProducts for a non-empty basket (negative control)", async () => {
    const { cfg, cafeId } = await setupVenue();
    const spy = vi.spyOn(catalogue, "listAvailableProducts");
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await createOpenOrder(tx, cfg, randomUUID(), [line(cafeId)], null);
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

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

  it("snapshots the line note + doneness at fire, and a later draft edit never moves the fired ticket (NON-FISCAL, spec §2/§3)", async () => {
    // The note/doneness counterpart of "Re-route the category AFTER firing" above: a fired ticket_items
    // row is a SNAPSHOT (like station_id/course_id), so editing the working_order_line afterwards must
    // NOT rewrite food already sent to the pass. Task 2's tabs.test.ts already pins that fire CAPTURES
    // the values; this pins that they stay FROZEN against a later edit — the immutability half.
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const p = await makeProduct(tx, cfg, catalogueId, {});
      const { id: orderId } = await placeOrderWith(tx, cfg, [
        { productId: p, quantity: "1", note: "sin cebolla", doneness: "medium_rare" },
      ]);

      // Fire snapshotted the parent line's note/doneness onto the ticket item.
      const [before] = await tx
        .select({ note: ticketItems.note, doneness: ticketItems.doneness })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, orderId));
      expect(before).toMatchObject({ note: "sin cebolla", doneness: "medium_rare" });

      // Edit the DRAFT working_order_line AFTER firing.
      await tx
        .update(workingOrderLines)
        .set({ note: "con cebolla", doneness: "well_done" })
        .where(eq(workingOrderLines.workingOrderId, orderId));

      // Self-contained guard (mirrors verify.test.ts's entorno test): confirm the DRAFT actually
      // changed, so the ticket_items assertion below cannot pass merely because the update no-op'd.
      const [draft] = await tx
        .select({ note: workingOrderLines.note, doneness: workingOrderLines.doneness })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, orderId));
      expect(draft).toMatchObject({ note: "con cebolla", doneness: "well_done" });

      // The already-fired ticket is UNCHANGED — the snapshot did not move.
      const [after] = await tx
        .select({ note: ticketItems.note, doneness: ticketItems.doneness })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, orderId));
      expect(after).toMatchObject({ note: "sin cebolla", doneness: "medium_rare" });
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

  it("refuses to fire when the only default station has been DEACTIVATED (station.no_default)", async () => {
    // `deactivateStation` sets `active=false` but leaves `is_default=true`, so the venue keeps a
    // default row that is no longer a live routing target. The fallback query must filter `active=true`,
    // else it resolves the dead station and food routes to a queue the till/station display (active-only)
    // never surface — silently dropped. With the filter it resolves no default and fires fail loud.
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      await deactivateStation(tx, cfg, cocina.id);
      const uncategorised = await makeProduct(tx, cfg, catalogueId, {}); // no product/category route
      await expect(placeOrderWith(tx, cfg, [line(uncategorised)])).rejects.toMatchObject({
        code: "station.no_default",
        params: { locationId: cfg.locationId },
      });
    });
  });

  it("a re-fire of an already-fired line is refused ticket.already_fired, not a raw 23505", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const orderId = await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const p = await makeProduct(tx, cfg, catalogueId, {});
      const { id } = await placeOrderWith(tx, cfg, [line(p)]);
      return id;
    });
    // A SECOND fire of the same lines collides on `ticket_items`' per-line
    // `(tenant_id, working_order_line_id)` unique. `fireLines` maps that 23505 to the domain code
    // (naming the order) rather than leaking the raw constraint error as an opaque 500. The re-fire runs
    // in its OWN transaction so the 23505 poisons that one and the mapped AppError rolls it back cleanly.
    await expect(
      withTenant(db, cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        const fired = await tx
          .select({
            id: workingOrderLines.id,
            productId: workingOrderLines.productId,
            courseId: workingOrderLines.courseId,
            parentLineId: workingOrderLines.parentLineId,
            note: workingOrderLines.note,
            doneness: workingOrderLines.doneness,
          })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, orderId));
        await fireLines(tx, cfg, orderId, fired);
      }),
    ).rejects.toMatchObject({
      code: "ticket.already_fired",
      params: { workingOrderId: orderId },
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

  it("advanceTicketItem refuses a garbage or missing `to` with the same code, not a raw TypeError", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const cafe = await makeProduct(tx, cfg, catalogueId, {});
      const { id: orderId } = await placeOrderWith(tx, cfg, [line(cafe)]);
      const [item] = await ticketItemRows(tx, orderId);

      // A garbage `to` — not a key of TICKET_TRANSITIONS. The till route casts `body.to as TicketState`
      // with no route-level screen, so this is reachable at runtime despite the narrower static type;
      // this is the till-api.ts route comment's claim, exercised directly at the verb.
      await expect(
        advanceTicketItem(tx, cfg, item!.id, "garbage" as unknown as TicketState),
      ).rejects.toMatchObject({
        code: "ticket.invalid_transition",
        params: { ticketItemId: item!.id },
      });
      // A missing `to` — an absent JSON field reaches here as `undefined` the same way.
      await expect(
        advanceTicketItem(tx, cfg, item!.id, undefined as unknown as TicketState),
      ).rejects.toMatchObject({
        code: "ticket.invalid_transition",
        params: { ticketItemId: item!.id },
      });

      // Neither refusal changed the item's state.
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

  it("carries each line's snapshotted description + quantity, items ordered by line_no", async () => {
    const { cfg, cafeId, aguaId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      // Line 1 → 2× Café, line 2 → 3× Agua, both routed to the default station.
      const { id: orderId } = await placeOrderWith(tx, cfg, [
        { productId: cafeId, quantity: "2" },
        { productId: aguaId, quantity: "3" },
      ]);

      const [group] = await listStationQueue(tx, cfg, cocina.id);
      expect(group!.orderId).toBe(orderId);
      expect(group!.items).toHaveLength(2);
      // Items in line_no order, each carrying the line's snapshotted dish description + quantity
      // (numeric(12,3) read back as "2.000"/"3.000") — what the kitchen display turns into "2× Café".
      expect(group!.items[0]).toMatchObject({
        descriptions: { [LOCALE]: "Café" },
        quantity: "2.000",
      });
      expect(group!.items[1]).toMatchObject({
        descriptions: { [LOCALE]: "Agua" },
        quantity: "3.000",
      });
    });
  });

  it("attaches a parent's selected options as modifier sub-items on listStationQueue and listExpoQueue", async () => {
    const { cfg, cafeId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      // Café with TWO selected options — each a child modifier line, never its own ticket item.
      const grande = await addOption(tx, cafeId, "Grande");
      const avena = await addOption(tx, cafeId, "Leche avena");
      const { id: orderId } = await placeOrderWith(tx, cfg, [
        {
          productId: cafeId,
          quantity: "1",
          options: [{ optionGroupItemId: grande }, { optionGroupItemId: avena }],
        },
      ]);

      // The station queue: ONE item (the parent dish), carrying both options as modifier sub-items, in
      // selection (line_no) order — localised client-side via each modifier's descriptions map.
      const [group] = await listStationQueue(tx, cfg, cocina.id);
      expect(group!.orderId).toBe(orderId);
      expect(group!.items).toHaveLength(1);
      expect(group!.items[0]!.modifiers).toEqual([
        { descriptions: { [LOCALE]: "Grande" } },
        { descriptions: { [LOCALE]: "Leche avena" } },
      ]);

      // The expo queue attaches the same modifier sub-items to its item.
      const expo = await listExpoQueue(tx, cfg);
      const expoItem = expo[0]!.courses[0]!.items[0]!;
      expect(expoItem.modifiers).toEqual([
        { descriptions: { [LOCALE]: "Grande" } },
        { descriptions: { [LOCALE]: "Leche avena" } },
      ]);
    });
  });

  // Order-line customisation (spec §2/§3, Task 5): the station/expo reads surface the SNAPSHOTTED
  // per-line `note`/`doneness` so the cook sees them. Read off `ticket_items` (the snapshot frozen at
  // fire), never the live line — a later draft edit must not change what the kitchen already sees.
  it("surfaces a fired line's snapshotted note + doneness on listStationQueue and listExpoQueue", async () => {
    const { cfg, cafeId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const { id: orderId } = await placeOrderWith(tx, cfg, [
        { productId: cafeId, quantity: "1", note: "sin cebolla", doneness: "medium_rare" },
      ]);

      const [group] = await listStationQueue(tx, cfg, cocina.id);
      expect(group!.orderId).toBe(orderId);
      expect(group!.items).toHaveLength(1);
      expect(group!.items[0]!.note).toBe("sin cebolla");
      expect(group!.items[0]!.doneness).toBe("medium_rare");

      const expo = await listExpoQueue(tx, cfg);
      const expoItem = expo[0]!.courses[0]!.items[0]!;
      expect(expoItem.note).toBe("sin cebolla");
      expect(expoItem.doneness).toBe("medium_rare");

      // A later DRAFT edit of the parent line does NOT move the fired snapshot the kitchen reads.
      const [parent] = await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(
          and(
            eq(workingOrderLines.workingOrderId, orderId),
            isNull(workingOrderLines.parentLineId),
          ),
        );
      await tx
        .update(workingOrderLines)
        .set({ note: "con cebolla", doneness: "well_done" })
        .where(eq(workingOrderLines.id, parent!.id));
      const [afterEdit] = await listStationQueue(tx, cfg, cocina.id);
      expect(afterEdit!.items[0]!.note).toBe("sin cebolla");
      expect(afterEdit!.items[0]!.doneness).toBe("medium_rare");
    });
  });

  // A plain line (no note, no doneness) surfaces both as null — the belt-and-braces default so a cook
  // never sees a phantom instruction, and a plain fixture reads exactly as before this task.
  it("surfaces null note + doneness for a plain fired line", async () => {
    const { cfg, cafeId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      await placeOrderWith(tx, cfg, [{ productId: cafeId, quantity: "1" }]);

      const [group] = await listStationQueue(tx, cfg, cocina.id);
      expect(group!.items[0]!.note).toBeNull();
      expect(group!.items[0]!.doneness).toBeNull();
      const expo = await listExpoQueue(tx, cfg);
      expect(expo[0]!.courses[0]!.items[0]!.note).toBeNull();
      expect(expo[0]!.courses[0]!.items[0]!.doneness).toBeNull();
    });
  });

  // Task 8 (modifier↔allergen) — the KDS station/expo reads attach the AS-SERVED allergen profile per
  // fired dish line: the parent product's published allergens folded with its selected options'
  // overlays (Cautious — a `remove` strips a code, an `add` merges one), plus `removed` (the base
  // codes the options subtracted) for the "swap made this safe" chip. Display-only; no fiscal path.
  it("attaches an as-served profile with the removed allergen dropped", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      // A gluten burger with a gluten-free-bun swap: base `{gluten: contains}`, the option removes it.
      const burger = await createProduct(tx, {
        catalogueId,
        categoryId: null,
        descriptions: { [LOCALE]: "Hamburguesa" },
        pricingUnit: "each",
        unitPrice: "9.00",
        vatClass: "general",
        allergens: { gluten: { presence: "contains" } },
      });
      const gfBun = await addOption(tx, burger.id, "Pan sin gluten", { remove: ["gluten"] });
      const { id: orderId } = await placeOrderWith(tx, cfg, [
        { productId: burger.id, quantity: "1", options: [{ optionGroupItemId: gfBun }] },
      ]);
      // The parent dish line (parentLineId IS NULL) — the key the queue item is attached under.
      const [parent] = await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(
          and(
            eq(workingOrderLines.workingOrderId, orderId),
            sql`${workingOrderLines.parentLineId} is null`,
          ),
        );
      const parentLineId = parent!.id;

      const queue = await listStationQueue(tx, cfg, cocina.id);
      const item = queue
        .flatMap((g) => g.items)
        .find((i) => i.workingOrderLineId === parentLineId)!;
      expect(item.asServed.allergens).toEqual({});
      expect(item.asServed.pending).toBe(false);
      expect(item.removed).toEqual(["gluten"]);

      // The expo read attaches the same profile to its item.
      const expoItem = (await listExpoQueue(tx, cfg))[0]!.courses[0]!.items[0]!;
      expect(expoItem.asServed.allergens).toEqual({});
      expect(expoItem.asServed.pending).toBe(false);
      expect(expoItem.removed).toEqual(["gluten"]);
    });
  });

  // A dish whose OWN allergens are unreviewed (products.allergens NULL) stays `pending` — a remove
  // cannot subtract from an unknown base, so `removed` is empty and only always-safe adds would show.
  it("marks the as-served profile pending when the dish's base allergens are unreviewed", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const dish = await makeProduct(tx, cfg, catalogueId, {}); // no allergens → published NULL
      const opt = await addOption(tx, dish, "Extra", { remove: ["gluten"] });
      await placeOrderWith(tx, cfg, [
        { productId: dish, quantity: "1", options: [{ optionGroupItemId: opt }] },
      ]);
      const item = (await listStationQueue(tx, cfg, cocina.id))[0]!.items[0]!;
      expect(item.asServed.pending).toBe(true);
      expect(item.asServed.allergens).toEqual({});
      expect(item.removed).toEqual([]);
    });
  });

  // A PLAIN, modifier-less dish whose base is unreviewed (products.allergens NULL, NO options at all)
  // still gets an as-served profile attached to its parent line — the server errs safe and marks the
  // plate `pending` so the KDS shows it unverified. (Divergence from the till, which SUPPRESSES the row
  // for this same case — pinned in basket.test.ts. Kept as-is: the KDS is deliberately the cautious one.)
  it("attaches a pending profile to a plain, modifier-less unreviewed dish (KDS errs safe)", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const dish = await makeProduct(tx, cfg, catalogueId, {}); // no allergens → published NULL
      await placeOrderWith(tx, cfg, [line(dish)]); // no options at all
      const item = (await listStationQueue(tx, cfg, cocina.id))[0]!.items[0]!;
      expect(item.modifiers).toEqual([]);
      expect(item.asServed.pending).toBe(true);
      expect(item.asServed.allergens).toEqual({});
      expect(item.removed).toEqual([]);
      // The expo read attaches the same pending profile to its item.
      const expoItem = (await listExpoQueue(tx, cfg))[0]!.courses[0]!.items[0]!;
      expect(expoItem.modifiers).toEqual([]);
      expect(expoItem.asServed.pending).toBe(true);
      expect(expoItem.asServed.allergens).toEqual({});
      expect(expoItem.removed).toEqual([]);
    });
  });

  // An option that ADDS an allergen merges it into the served profile (over-declaring is the safe
  // direction), leaving the reviewed base non-pending and `removed` empty.
  it("attaches an added allergen from the option overlay", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const dish = await createProduct(tx, {
        catalogueId,
        categoryId: null,
        descriptions: { [LOCALE]: "Ensalada" },
        pricingUnit: "each",
        unitPrice: "7.00",
        vatClass: "general",
        allergens: { gluten: { presence: "contains" } },
      });
      const nuts = await addOption(tx, dish.id, "Con nueces", {
        add: { nuts: { presence: "contains" } },
      });
      await placeOrderWith(tx, cfg, [
        { productId: dish.id, quantity: "1", options: [{ optionGroupItemId: nuts }] },
      ]);
      const item = (await listStationQueue(tx, cfg, cocina.id))[0]!.items[0]!;
      expect(item.asServed.allergens).toEqual({
        gluten: { presence: "contains" },
        nuts: { presence: "contains" },
      });
      expect(item.asServed.pending).toBe(false);
      expect(item.removed).toEqual([]);
    });
  });

  // Task 5 — the DIET twin of the as-served allergen fold. A creamy dish (dairy origin ⇒ not vegan)
  // with a dairy-free swap that REMOVES the only dairy origin reads vegan as served, on both the
  // station queue and the expo pass. The safe direction is respected: the remove is applied over a
  // NON-pending derivation, so the "yes" is honest (a remove over a pending base stays "unknown").
  it("attaches an as-served diet profile with the removed origin making the dish vegan", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const dish = await createProduct(tx, {
        catalogueId,
        categoryId: null,
        descriptions: { [LOCALE]: "Crema" },
        pricingUnit: "each",
        unitPrice: "6.00",
        vatClass: "general",
      });
      // Recipe-derived: the only origin is dairy (reviewed, not pending) ⇒ vegetarian but not vegan.
      await applyDietDerivation(tx, dish.id, { origins: ["dairy"], pending: false });
      const dairyFree = await addOption(tx, dish.id, "Sin lácteos", { removeOrigins: ["dairy"] });
      const { id: orderId } = await placeOrderWith(tx, cfg, [
        { productId: dish.id, quantity: "1", options: [{ optionGroupItemId: dairyFree }] },
      ]);
      const [parent] = await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(
          and(
            eq(workingOrderLines.workingOrderId, orderId),
            sql`${workingOrderLines.parentLineId} is null`,
          ),
        );
      const parentLineId = parent!.id;

      // Station queue carries the as-served diet — the removed dairy origin makes the plate vegan.
      const queue = await listStationQueue(tx, cfg, cocina.id);
      const item = queue
        .flatMap((g) => g.items)
        .find((i) => i.workingOrderLineId === parentLineId)!;
      expect(item.asServedDiet).toEqual({ vegan: "yes", vegetarian: "yes", contains: [] });

      // The expo read attaches the same profile.
      const expoItem = (await listExpoQueue(tx, cfg))[0]!.courses[0]!.items[0]!;
      expect(expoItem.asServedDiet!.vegan).toBe("yes");
      expect(expoItem.asServedDiet).toEqual({ vegan: "yes", vegetarian: "yes", contains: [] });
    });
  });

  // Task 5 — the CAUTIOUS negative control. A dish with NO recipe (null `diet_derivation`) must NOT
  // read a positive vegan/vegetarian: the fold defaults a null derivation to empty-but-PENDING, so the
  // as-served vegan/vegetarian read "unknown" on BOTH reads. An unreviewed plate asserts no diet claim.
  it("reads an as-served diet of unknown for a no-recipe dish (cautious posture)", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const dish = await makeProduct(tx, cfg, catalogueId, {}); // no recipe → null diet_derivation
      await placeOrderWith(tx, cfg, [line(dish)]);

      const item = (await listStationQueue(tx, cfg, cocina.id))[0]!.items[0]!;
      expect(item.asServedDiet).toEqual({ vegan: "unknown", vegetarian: "unknown", contains: [] });

      const expoItem = (await listExpoQueue(tx, cfg))[0]!.courses[0]!.items[0]!;
      expect(expoItem.asServedDiet).toEqual({
        vegan: "unknown",
        vegetarian: "unknown",
        contains: [],
      });
    });
  });

  // KDS order-timing alerts (design §3/§6/§11) — the group carries the station's thresholds (Controller
  // Ruling A), each item its own age band classified against them on the DB clock.
  it("bands each item by the station's thresholds and carries them on the group", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true }); // 5/10/15 defaults
      const cafe = await makeProduct(tx, cfg, catalogueId, {});
      const agua = await makeProduct(tx, cfg, catalogueId, {});
      const { id: orderId } = await placeOrderWith(tx, cfg, [line(cafe), line(agua)]);
      const items = await ticketItemRows(tx, orderId);

      // Backdate item[0] past the station's default overdue threshold (10) but under forgotten (15);
      // item[1] stays fresh.
      await tx.execute(
        sql`update ticket_items set queued_at = now() - interval '12 minutes' where id = ${items[0]!.id}`,
      );

      const [group] = await listStationQueue(tx, cfg, cocina.id);
      expect(group!.thresholds).toEqual({
        warmAfterMinutes: 5,
        overdueAfterMinutes: 10,
        forgottenAfterMinutes: 15,
      });
      const backdated = group!.items.find((i) => i.id === items[0]!.id)!;
      const fresh = group!.items.find((i) => i.id === items[1]!.id)!;
      expect(backdated.band).toBe("overdue");
      expect(fresh.band).toBe("fresh");
      // Each item carries its OWN queued_at (not just the group's oldest-line anchor) — the widget's
      // TickingClock re-derives the band from this plus the group's thresholds between refreshes.
      expect(typeof backdated.queuedAt).toBe("string");
      expect(typeof fresh.queuedAt).toBe("string");
      expect(backdated.queuedAt).not.toBe(fresh.queuedAt);
    });
  });
});

// KDS-2 Task 4 — hold-and-fire. `fireLines` now snapshots each line's `course_id` and decides
// fired-vs-held: an item fires (`fired_at = now()`) when its course is the order's EARLIEST (min
// display_order, a null course treated as earliest) OR is already fired for the order; otherwise it is
// HELD (`fired_at NULL`). `fireCourse` releases a held course's items; `advanceTicketItem` refuses a
// held item (`ticket.item_held`). PGlite proves the auto-fire arithmetic, the held-advance refusal and
// `fireCourse`'s idempotency — plain SQL a single backend proves, with no privilege or concurrency
// dimension (RLS/node isolation of `ticket_items` is real-Postgres's job, packages/db). Every write
// runs through `withTenant` + `asAppUser`, so grants and RLS are in force, not bypassed.
// ---------------------------------------------------------------------------------------------------

/** The order's ticket items joined to their line, carrying the fields the hold-and-fire tests read:
 *  the item id (the bump target), its product (to key by line), its snapshotted course and — the
 *  load-bearing one — `fired_at` (NULL = held). */
async function courseItemsFor(
  tx: Transaction,
  orderId: string,
): Promise<
  {
    id: string;
    productId: string | null;
    courseId: string | null;
    firedAt: string | null;
    // KDS-3: the pass's dispatch marker (`null` = not away), read by the expo-verb tests.
    awayAt: string | null;
    state: string;
  }[]
> {
  return tx
    .select({
      id: ticketItems.id,
      productId: workingOrderLines.productId,
      courseId: ticketItems.courseId,
      firedAt: ticketItems.firedAt,
      awayAt: ticketItems.awayAt,
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

const byLine = <T extends { productId: string | null }>(items: T[], productId: string): T =>
  items.find((i) => i.productId === productId)!;

describe("fireCourse / hold-and-fire (KDS-2 auto-fire-first + held-item advance guard)", () => {
  it("auto-fires the earliest course, holds later ones, and fireCourse releases a held course", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const pri = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      const soup = await makeProduct(tx, cfg, catalogueId, {});
      const steak = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, soup, ent.id);
      await setProductCourse(tx, cfg, steak, pri.id);

      const { id: orderId } = await placeOrderWith(tx, cfg, [line(soup), line(steak)]);
      const items = await courseItemsFor(tx, orderId);
      expect(byLine(items, soup).firedAt).not.toBeNull(); // earliest course auto-fired
      expect(byLine(items, steak).firedAt).toBeNull(); // later course held

      // A held item cannot advance — the kitchen must not bump food it has not been told to start.
      await expect(
        advanceTicketItem(tx, cfg, byLine(items, steak).id, "preparing"),
      ).rejects.toMatchObject({ code: "ticket.item_held" });

      // Firing the held course releases its items.
      await fireCourse(tx, cfg, orderId, pri.id);
      const afterFire = await courseItemsFor(tx, orderId);
      expect(byLine(afterFire, steak).firedAt).not.toBeNull();

      // Now advancing the (now fired) steak is allowed.
      await advanceTicketItem(tx, cfg, byLine(afterFire, steak).id, "preparing");
      const advanced = await courseItemsFor(tx, orderId);
      expect(byLine(advanced, steak).state).toBe("preparing");
    });
  });

  it("a null-course line fires immediately (treated as earliest) even while a real later course is held", async () => {
    // §2b: a null course_id has no display_order and fires immediately. Proven alongside a genuine
    // coursed hold: the loose (courseless) line fires at once while the later Principales line waits.
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const pri = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      const loose = await makeProduct(tx, cfg, catalogueId, {}); // no course → null
      const starter = await makeProduct(tx, cfg, catalogueId, {});
      const main = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, starter, ent.id);
      await setProductCourse(tx, cfg, main, pri.id);

      const { id: orderId } = await placeOrderWith(tx, cfg, [
        line(loose),
        line(starter),
        line(main),
      ]);
      const items = await courseItemsFor(tx, orderId);
      expect(byLine(items, loose).firedAt).not.toBeNull(); // null course fires immediately
      expect(byLine(items, starter).firedAt).not.toBeNull(); // earliest real course fires
      expect(byLine(items, main).firedAt).toBeNull(); // later course held
    });
  });

  it("fireCourse is idempotent — re-firing an already-fired course leaves its timestamps untouched", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const pri = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      const starter = await makeProduct(tx, cfg, catalogueId, {});
      const main = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, starter, ent.id);
      await setProductCourse(tx, cfg, main, pri.id);

      const { id: orderId } = await placeOrderWith(tx, cfg, [line(starter), line(main)]);

      // The earliest course (Entrantes) auto-fired; re-firing it must NOT restamp — its WHERE
      // (`fired_at IS NULL`) matches nothing already-fired.
      const beforeEnt = byLine(await courseItemsFor(tx, orderId), starter).firedAt;
      await fireCourse(tx, cfg, orderId, ent.id);
      expect(byLine(await courseItemsFor(tx, orderId), starter).firedAt).toBe(beforeEnt);

      // Fire the held course, capture its stamp, then fire it AGAIN — the second call is a no-op.
      await fireCourse(tx, cfg, orderId, pri.id);
      const firstStamp = byLine(await courseItemsFor(tx, orderId), main).firedAt;
      expect(firstStamp).not.toBeNull();
      await fireCourse(tx, cfg, orderId, pri.id);
      expect(byLine(await courseItemsFor(tx, orderId), main).firedAt).toBe(firstStamp);
    });
  });

  it("across tab rounds: a later round holds a late course, and joins one already fired for the order", async () => {
    // The incremental tab path (addTabRound fires round by round), where the fired-vs-held decision is
    // taken over the WHOLE order, not just the current round. Two behaviours a single-round place cannot
    // reach: (1) a later round of ONLY a late course stays held — decided by the courses of PRIOR rounds,
    // not the round in hand (without them the round would see itself as the sole, hence earliest, course
    // and wrongly auto-fire); (2) a later item of a course already fired for the order joins it and fires
    // immediately, even when that course is NOT the earliest.
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const pri = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      const post = await createCourse(tx, cfg, { name: "Postres", displayOrder: 2 });
      const starter = await makeProduct(tx, cfg, catalogueId, {});
      const main = await makeProduct(tx, cfg, catalogueId, {});
      const dessert = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, starter, ent.id);
      await setProductCourse(tx, cfg, main, pri.id);
      await setProductCourse(tx, cfg, dessert, post.id);
      const tableId = await makeTable(tx, cfg);
      const { tabId } = await openTab(tx, cfg, { tableId });

      // Round 1: starter (Entrantes, earliest) auto-fires; main (Principales) is held.
      await addTabRound(tx, cfg, tabId, [line(starter), line(main)]);
      let items = await courseItemsFor(tx, tabId);
      expect(byLine(items, starter).firedAt).not.toBeNull();
      expect(byLine(items, main).firedAt).toBeNull();

      // Round 2: dessert (Postres) ALONE. It is NOT the order's earliest (Entrantes from round 1 is), so
      // it stays held — decisive proof the earliest is taken over prior rounds, not this batch (a
      // batch-only min would make Postres its own earliest and fire it).
      await addTabRound(tx, cfg, tabId, [line(dessert)]);
      items = await courseItemsFor(tx, tabId);
      expect(byLine(items, dessert).firedAt).toBeNull();

      // Release Principales explicitly — now fired for the order though it is not the earliest course.
      await fireCourse(tx, cfg, tabId, pri.id);
      expect(byLine(await courseItemsFor(tx, tabId), main).firedAt).not.toBeNull();

      // Round 3: another main. Principales is already fired for this order, so this new item joins the
      // fired course and fires at once — the `firedCourseIds` branch, isolated (Principales is not the
      // earliest). Dessert (Postres, still unfired) remains held.
      await addTabRound(tx, cfg, tabId, [line(main)]);
      items = await courseItemsFor(tx, tabId);
      const mains = items.filter((i) => i.productId === main);
      expect(mains).toHaveLength(2);
      expect(mains.every((i) => i.firedAt !== null)).toBe(true);
      expect(byLine(items, dessert).firedAt).toBeNull();
    });
  });

  it("advanceTicket (whole-ticket bump) advances fired items and SKIPS held ones", async () => {
    // §5a: the bulk bump acts only on fired items — a mixed ticket's fired line advances while its held
    // line stays put (no throw, unlike the per-line verb). Both items sit at the same (default) station,
    // so the whole-ticket sweep addresses both; only the fired one is in the match.
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const pri = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      const starter = await makeProduct(tx, cfg, catalogueId, {});
      const main = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, starter, ent.id);
      await setProductCourse(tx, cfg, main, pri.id);

      const { id: orderId } = await placeOrderWith(tx, cfg, [line(starter), line(main)]);
      const before = await courseItemsFor(tx, orderId);
      expect(byLine(before, starter).firedAt).not.toBeNull(); // Entrantes auto-fired
      expect(byLine(before, main).firedAt).toBeNull(); // Principales held

      // Whole-ticket bump to preparing: the fired starter advances; the held main is skipped.
      await advanceTicket(tx, cfg, orderId, cocina.id, "preparing");

      const after = await courseItemsFor(tx, orderId);
      expect(byLine(after, starter).state).toBe("preparing"); // fired item advanced
      expect(byLine(after, main).state).toBe("queued"); // held item untouched
      expect(byLine(after, main).firedAt).toBeNull(); // and still held
    });
  });

  it("releases a HELD course's items even after the course is DEACTIVATED (A2: existence, not liveness)", async () => {
    // The deactivated-course edge: a course deactivated WHILE it holds items must still be fireable, or
    // its held items are stranded (can't fire, can't advance). `fireCourse` now requires only that the
    // course EXISTS in this venue (active OR inactive) — the items already carry the `course_id` snapshot
    // — so the release works; the former `requireLiveCourse` gate threw `course.not_found` here forever.
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const pri = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      const starter = await makeProduct(tx, cfg, catalogueId, {});
      const main = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, starter, ent.id);
      await setProductCourse(tx, cfg, main, pri.id);

      const { id: orderId } = await placeOrderWith(tx, cfg, [line(starter), line(main)]);
      expect(byLine(await courseItemsFor(tx, orderId), main).firedAt).toBeNull(); // Principales held

      await deactivateCourse(tx, cfg, pri.id);
      await fireCourse(tx, cfg, orderId, pri.id);
      expect(byLine(await courseItemsFor(tx, orderId), main).firedAt).not.toBeNull(); // released
    });
  });

  it("fireCourse rejects an unknown course with course.not_found", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const cafe = await makeProduct(tx, cfg, catalogueId, {});
      const { id: orderId } = await placeOrderWith(tx, cfg, [line(cafe)]);

      const missing = randomUUID();
      await expect(fireCourse(tx, cfg, orderId, missing)).rejects.toMatchObject({
        code: "course.not_found",
        params: { courseId: missing },
      });
    });
  });
});

// KDS-3 Task 2 — the cross-station expo/pass read. `listExpoQueue` aggregates every OPEN order on the
// node (with at least one not-yet-away item), gathers its ticket items ACROSS stations, and groups them
// by course in display_order with per-course fired/away roll-ups. Unlike `listStationQueue` (one
// station, no station name) it joins `kitchen_stations` to label each item's station. PGlite proves the
// join, the collected/abandoned/fully-away exclusions, the course grouping and the roll-ups — plain SQL a
// single backend proves; the node/tenant RLS scoping is real-Postgres's job (working-order.rls.test.ts).
// Every read/write runs through `withTenant` + `asAppUser`, so grants and RLS are in force, not bypassed.
// ---------------------------------------------------------------------------------------------------
describe("listExpoQueue (KDS-3 cross-station expo/pass read)", () => {
  it("aggregates one order's two-station single-course lines into one course with station names, excluding collected/abandoned orders", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const barra = await createStation(tx, cfg, { name: "Barra" });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      // Two products in the SAME course, routed to DIFFERENT stations — the cross-station shape.
      const soup = await makeProduct(tx, cfg, catalogueId, {}); // → Cocina (default)
      const olives = await makeProduct(tx, cfg, catalogueId, { stationId: barra.id }); // → Barra
      await setProductCourse(tx, cfg, soup, ent.id);
      await setProductCourse(tx, cfg, olives, ent.id);

      const { id: orderId } = await placeOrderWith(tx, cfg, [line(soup), line(olives)]);

      const expo = await listExpoQueue(tx, cfg);
      expect(expo).toHaveLength(1);
      const order = expo[0]!;
      expect(order.orderId).toBe(orderId);
      // A single earliest course, both items auto-fired, neither away.
      expect(order.courses).toHaveLength(1);
      const course = order.courses[0]!;
      expect(course.courseId).toBe(ent.id);
      expect(course.courseName).toBe("Entrantes");
      expect(course.displayOrder).toBe(0);
      expect(course.fired).toBe(true);
      expect(course.away).toBe(false);
      // Both lines under the one course, each labelled with its OWN station — the join listStationQueue omits.
      expect(course.items).toHaveLength(2);
      expect(course.items.map((i) => i.stationName).sort()).toEqual(["Barra", "Cocina"]);
      expect(course.items.every((i) => i.state === "queued")).toBe(true);
      expect(course.items.every((i) => i.firedAt !== null)).toBe(true);
      expect(course.items.every((i) => i.awayAt === null)).toBe(true);
      // The display snapshot rides through: `name` is the locale→description map, `qty` the numeric text.
      const soupItem = course.items.find((i) => i.stationName === "Cocina")!;
      // `name` round-trips as the product's locale→description map (makeProduct seeds `P-<uuid>`), not a
      // flattened string — exactly one locale key here, so toEqual pins the whole shape + value.
      expect(soupItem.name).toEqual({ [LOCALE]: expect.stringMatching(/^P-/) });
      expect(typeof soupItem.qty).toBe("string");

      // A COLLECTED order and an ABANDONED order are both excluded, the same two listStationQueue drops.
      const { id: collected } = await placeOrderWith(tx, cfg, [line(soup)]);
      await tx
        .update(workingOrders)
        .set({ collectedAt: sql`now()` })
        .where(eq(workingOrders.id, collected));
      const { id: abandoned } = await placeOrderWith(tx, cfg, [line(soup)]);
      await tx
        .update(workingOrders)
        .set({ status: "abandoned" })
        .where(eq(workingOrders.id, abandoned));

      expect((await listExpoQueue(tx, cfg)).map((o) => o.orderId)).toEqual([orderId]);
    });
  });

  it("groups by course in display_order; a held later course reads fired:false, and the away roll-up follows per course", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const pri = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      const starter = await makeProduct(tx, cfg, catalogueId, {});
      const main = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, starter, ent.id);
      await setProductCourse(tx, cfg, main, pri.id);

      const { id: orderId } = await placeOrderWith(tx, cfg, [line(starter), line(main)]);

      const order = (await listExpoQueue(tx, cfg))[0]!;
      // Courses in display_order: Entrantes (0) then Principales (1).
      expect(order.courses.map((c) => c.courseName)).toEqual(["Entrantes", "Principales"]);
      const [c0, c1] = order.courses;
      expect(c0!.fired).toBe(true); // earliest course auto-fired
      expect(c0!.away).toBe(false);
      expect(c1!.fired).toBe(false); // later course HELD — fired_at null on its item
      expect(c1!.items.every((i) => i.firedAt === null)).toBe(true);

      // Fire the held course, and mark the earliest course AWAY (KDS-3's dispatch marker). The per-course
      // roll-ups follow: Entrantes now `away`, Principales now `fired`; the order stays (main not away).
      await fireCourse(tx, cfg, orderId, pri.id);
      const items = await courseItemsFor(tx, orderId);
      const entItem = items.find((i) => i.courseId === ent.id)!;
      await tx
        .update(ticketItems)
        .set({ awayAt: sql`now()` })
        .where(eq(ticketItems.id, entItem.id));

      const after = await listExpoQueue(tx, cfg);
      expect(after).toHaveLength(1);
      const c0b = after[0]!.courses.find((c) => c.courseId === ent.id)!;
      const c1b = after[0]!.courses.find((c) => c.courseId === pri.id)!;
      expect(c0b.away).toBe(true);
      expect(c0b.items[0]!.awayAt).not.toBeNull();
      expect(c1b.fired).toBe(true); // released
      expect(c1b.away).toBe(false);
    });
  });

  it("drops a FULLY-away order but keeps one that still has a not-yet-away item", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const a = await makeProduct(tx, cfg, catalogueId, {});
      const b = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, a, ent.id);
      await setProductCourse(tx, cfg, b, ent.id);

      const { id: orderId } = await placeOrderWith(tx, cfg, [line(a), line(b)]);
      const items = await courseItemsFor(tx, orderId);

      // One item away → the order stays (a not-yet-away item remains).
      await tx
        .update(ticketItems)
        .set({ awayAt: sql`now()` })
        .where(eq(ticketItems.id, items[0]!.id));
      expect((await listExpoQueue(tx, cfg)).map((o) => o.orderId)).toEqual([orderId]);

      // The last item away → the whole order is fully dispatched and leaves the pass.
      await tx
        .update(ticketItems)
        .set({ awayAt: sql`now()` })
        .where(eq(ticketItems.id, items[1]!.id));
      expect(await listExpoQueue(tx, cfg)).toEqual([]);
    });
  });

  it("surfaces the dining-table label for a tab and omits it for a walk-up; openedMinutes is derived from opened_at", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const cafe = await makeProduct(tx, cfg, catalogueId, {}); // null course → fires immediately

      // A TAB at a known-labelled table: dining_tables.tab_id back-points at the order.
      const { rows } = await tx.execute<{ id: string }>(sql`
        insert into dining_tables (tenant_id, location_id, label)
        values (${cfg.tenantId}, ${cfg.locationId}, 'Mesa 5') returning id`);
      const tableId = rows[0]!.id;
      const { tabId } = await openTab(tx, cfg, { tableId });
      await addTabRound(tx, cfg, tabId, [line(cafe)]);

      // A WALK-UP counter order, no table → tableLabel omitted.
      const { id: walkup } = await placeOrderWith(tx, cfg, [line(cafe)]);

      const expo = await listExpoQueue(tx, cfg);
      const tab = expo.find((o) => o.orderId === tabId)!;
      expect(tab.tableLabel).toBe("Mesa 5");
      expect(tab.openedMinutes).toBeGreaterThanOrEqual(0);
      const walk = expo.find((o) => o.orderId === walkup)!;
      expect(walk.tableLabel).toBeUndefined();
    });
  });

  // KDS order-timing alerts (design §3/§6/§11) — the expo spans stations, so PER-ITEM thresholds
  // (Controller Ruling A) prove the join resolved each item's OWN station, not another's (CLAUDE.md §3's
  // correlated-subquery caution: a wrong join binds to the wrong row silently).
  it("carries each item's own station thresholds/band, and rolls the order up to the worst", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await createStation(tx, cfg, { name: "Cocina", isDefault: true }); // 5/10/15 defaults
      const barra = await createStation(tx, cfg, { name: "Barra" });
      // Distinct thresholds so a per-item mix-up (Barra's item reading Cocina's thresholds, or vice
      // versa) would fail this test rather than passing by coincidence on identical defaults.
      await tx.execute(
        sql`update kitchen_stations set warm_after_minutes = 2, overdue_after_minutes = 4,
            forgotten_after_minutes = 6 where id = ${barra.id}`,
      );
      const soup = await makeProduct(tx, cfg, catalogueId, {}); // → Cocina (default)
      const olives = await makeProduct(tx, cfg, catalogueId, { stationId: barra.id }); // → Barra

      const { id: orderId } = await placeOrderWith(tx, cfg, [line(soup), line(olives)]);
      const items = await courseItemsFor(tx, orderId);
      const soupItem = items.find((i) => i.productId === soup)!;
      const oliveItem = items.find((i) => i.productId === olives)!;

      // Backdate the Barra item past ITS OWN overdue threshold (4) but nowhere near Cocina's (10).
      await tx.execute(
        sql`update ticket_items set queued_at = now() - interval '5 minutes' where id = ${oliveItem.id}`,
      );

      const order = (await listExpoQueue(tx, cfg)).find((o) => o.orderId === orderId)!;
      const outItems = order.courses.flatMap((c) => c.items);
      const soupOut = outItems.find((i) => i.id === soupItem.id)!;
      const oliveOut = outItems.find((i) => i.id === oliveItem.id)!;

      expect(soupOut.thresholds).toEqual({
        warmAfterMinutes: 5,
        overdueAfterMinutes: 10,
        forgottenAfterMinutes: 15,
      });
      expect(soupOut.band).toBe("fresh");
      expect(oliveOut.thresholds).toEqual({
        warmAfterMinutes: 2,
        overdueAfterMinutes: 4,
        forgottenAfterMinutes: 6,
      });
      expect(oliveOut.band).toBe("overdue"); // 5 >= 4 (overdue), < 6 (forgotten)
      expect(typeof oliveOut.queuedAt).toBe("string");
      // Worst-line-wins: the order rolls up to the worse of its two items.
      expect(order.worstBand).toBe("overdue");
    });
  });

  it("drops a served line off the order's worst band (design §3 — ages until it reaches the guest)", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await createStation(tx, cfg, { name: "Cocina", isDefault: true }); // 5/10/15 defaults
      const cafe = await makeProduct(tx, cfg, catalogueId, {});
      const agua = await makeProduct(tx, cfg, catalogueId, {});
      const tableId = await makeTable(tx, cfg);
      // `served_at` is writable only while the parent order is OPEN (design H2, ruling R4), so this
      // needs a tab rather than `placeOrderWith`'s settled/placed order.
      const { tabId } = await openTab(tx, cfg, { tableId });
      await addTabRound(tx, cfg, tabId, [line(cafe), line(agua)]);

      const rows = await ticketItemRows(tx, tabId);
      // Backdate line 1 past overdue (10); line 2 stays fresh.
      await tx.execute(
        sql`update ticket_items set queued_at = now() - interval '12 minutes' where id = ${rows[0]!.id}`,
      );

      let order = (await listExpoQueue(tx, cfg)).find((o) => o.orderId === tabId)!;
      expect(order.worstBand).toBe("overdue");

      // Serve the overdue line — it drops off the clock. Line 2 is still unserved but fresh, so the
      // order's worst band clears.
      await markLineServed(tx, cfg, tabId, rows[0]!.lineNo);
      order = (await listExpoQueue(tx, cfg)).find((o) => o.orderId === tabId)!;
      expect(order.worstBand).toBe("fresh");
    });
  });
});

// KDS-3 Task 3 — the pass's two coordination verbs. `bumpCourseReady` is the whole-course "it's all
// plated" bump: {@link advanceTicket}'s set-based shape keyed on COURSE (order + course_id) not station,
// advancing every FIRED, not-yet-ready item across ALL its stations straight to `ready` (skipping HELD
// items and no-op when none match). `markCourseAway` stamps `away_at = now()` on every READY item of the
// course (dispatch what is plated), gated on the course EXISTING (`requireCourse` → course.not_found),
// idempotent via `away_at IS NULL`. PGlite proves the set-based logic, the held-skip and the ready-only
// dispatch — plain SQL a single backend proves; the RLS/node scoping is real-Postgres's job
// (working-order.rls.test.ts, the folded-in listExpoQueue RLS test). Every write runs through
// `withTenant` + `asAppUser`, so grants and RLS are in force, not bypassed.
// ---------------------------------------------------------------------------------------------------

/** Fire ONE course of an order across TWO stations — two products in the SAME (earliest, so auto-fired)
 *  course routed to DIFFERENT stations, placed so both items fire and sit `queued`. The cross-station
 *  shape `bumpCourseReady` must sweep in one UPDATE (`listStationQueue` would need two reads to see both). */
async function firedCourseAcrossTwoStations(
  tx: Transaction,
  cfg: TillConfig,
  catalogueId: string,
): Promise<{ orderId: string; courseId: string }> {
  await createStation(tx, cfg, { name: "Cocina", isDefault: true });
  const barra = await createStation(tx, cfg, { name: "Barra" });
  const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
  const soup = await makeProduct(tx, cfg, catalogueId, {}); // → Cocina (default)
  const olives = await makeProduct(tx, cfg, catalogueId, { stationId: barra.id }); // → Barra
  await setProductCourse(tx, cfg, soup, ent.id);
  await setProductCourse(tx, cfg, olives, ent.id);
  const { id: orderId } = await placeOrderWith(tx, cfg, [line(soup), line(olives)]);
  return { orderId, courseId: ent.id };
}

describe("bumpCourseReady / markCourseAway (KDS-3 expo/pass coordination verbs)", () => {
  it("bumps a whole course ready across stations, then marks it away", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const { orderId, courseId } = await firedCourseAcrossTwoStations(tx, cfg, catalogueId);

      // Both items start fired + queued, across two stations, under the one course.
      let items = await courseItemsFor(tx, orderId);
      expect(items).toHaveLength(2);
      expect(items.every((i) => i.state === "queued")).toBe(true);
      expect(items.every((i) => i.firedAt !== null)).toBe(true);

      // One set-based bump plates the whole course ready — both stations' items reach `ready`.
      await bumpCourseReady(tx, cfg, orderId, courseId);
      items = await courseItemsFor(tx, orderId);
      expect(items.every((i) => i.state === "ready")).toBe(true);

      // Dispatch the plated course — every ready item goes away.
      await markCourseAway(tx, cfg, orderId, courseId);
      items = await courseItemsFor(tx, orderId);
      expect(items.every((i) => i.awayAt !== null)).toBe(true);
    });
  });

  it("bumpCourseReady skips held items; markCourseAway only aways ready items", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const pri = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      const starter = await makeProduct(tx, cfg, catalogueId, {});
      const main = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, starter, ent.id);
      await setProductCourse(tx, cfg, main, pri.id);
      const { id: orderId } = await placeOrderWith(tx, cfg, [line(starter), line(main)]);

      // Principales is HELD (later course, fired_at null). bumpCourseReady on it advances NOTHING — the
      // `fired_at IS NOT NULL` predicate skips held items (deletion-proof: drop it and the held main bumps
      // to `ready`, failing the `queued` assertion below).
      await bumpCourseReady(tx, cfg, orderId, pri.id);
      let items = await courseItemsFor(tx, orderId);
      expect(byLine(items, main).state).toBe("queued"); // held → skipped
      expect(byLine(items, main).firedAt).toBeNull(); // and still held

      // Entrantes IS fired, so bumping it plates its item straight to `ready` (queued → ready in one step)
      // — the OTHER answer, so the held-skip above is a real measurement, not "nothing ever advances".
      await bumpCourseReady(tx, cfg, orderId, ent.id);
      items = await courseItemsFor(tx, orderId);
      expect(byLine(items, starter).state).toBe("ready");

      // markCourseAway dispatches only PLATED (ready) items: Entrantes' item is ready → away.
      await markCourseAway(tx, cfg, orderId, ent.id);
      items = await courseItemsFor(tx, orderId);
      expect(byLine(items, starter).awayAt).not.toBeNull();

      // Now the ready-only guard: fire Principales (so its main is fired, still `queued`) and dispatch it.
      // The main is fired but NOT ready, so it does NOT go away (deletion-proof: drop `state = 'ready'` and
      // the queued main gets `away_at`, failing the assertion below).
      await fireCourse(tx, cfg, orderId, pri.id);
      await markCourseAway(tx, cfg, orderId, pri.id);
      items = await courseItemsFor(tx, orderId);
      expect(byLine(items, main).state).toBe("queued"); // fired but not plated
      expect(byLine(items, main).awayAt).toBeNull(); // only ready items go away
    });
  });

  it("markCourseAway rejects an unknown course with course.not_found (requireCourse existence check)", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const cafe = await makeProduct(tx, cfg, catalogueId, {});
      const { id: orderId } = await placeOrderWith(tx, cfg, [line(cafe)]);

      const missing = randomUUID();
      await expect(markCourseAway(tx, cfg, orderId, missing)).rejects.toMatchObject({
        code: "course.not_found",
        params: { courseId: missing },
      });
    });
  });

  it("markCourseAway is idempotent (already-away untouched); bumpCourseReady no-ops on an unknown course", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const { orderId, courseId } = await firedCourseAcrossTwoStations(tx, cfg, catalogueId);

      // bumpCourseReady on an UNKNOWN course is a no-op (no throw, no rows) — the bulk-bump convenience,
      // unlike markCourseAway which requires the course. The order's items are untouched.
      await bumpCourseReady(tx, cfg, orderId, randomUUID());
      expect((await courseItemsFor(tx, orderId)).every((i) => i.state === "queued")).toBe(true);

      // Plate then dispatch the course; capture each item's away stamp.
      await bumpCourseReady(tx, cfg, orderId, courseId);
      await markCourseAway(tx, cfg, orderId, courseId);
      const first = new Map((await courseItemsFor(tx, orderId)).map((i) => [i.id, i.awayAt]));
      expect([...first.values()].every((a) => a !== null)).toBe(true);

      // Re-dispatch — the `away_at IS NULL` predicate matches nothing already-away, so no stamp moves.
      await markCourseAway(tx, cfg, orderId, courseId);
      const second = new Map((await courseItemsFor(tx, orderId)).map((i) => [i.id, i.awayAt]));
      for (const [id, away] of first) expect(second.get(id)).toBe(away);
    });
  });
});

// KDS-2 A1 — the per-line `courseId` OVERRIDE is screened at the shared ring-time resolver
// (`priceOrderLines`), the ONE course-write path that formerly skipped `requireLiveCourse`. A crafted
// override — malformed, well-formed-but-unknown, a DIFFERENT venue's course of the same tenant (the
// working_order_lines.course_id FK is tenant-scoped only, not location-scoped), or a deactivated one —
// is a clean `course.not_found` rather than an opaque 500 (22P02/23503) or a silently-accepted
// cross-venue line. The product DEFAULT (`product.course_id`) is an already-valid stored FK and is NOT
// re-screened (that would reject a legitimately-deactivated default). Exercised through `addTabRound`
// (the round path that threads the override today); the screen lives in `priceOrderLines`, so the order
// paths are covered by the SAME code. PGlite: plain SQL + the tenant-consistent FK, no privilege or
// concurrency dimension.
// ---------------------------------------------------------------------------------------------------
describe("voidTabLine modifier cascade (FIX 2)", () => {
  /** Attach a maxSelect≥2 option group whose item allows ×2 to `productId`, returning the first item's
   *  id. A group that ACCEPTS a tally of two AND an item cap of two, so a doubled selection now SUMS to
   *  a per-option quantity of 2 (per-option quantity) rather than being dropped, and is valid. */
  async function addMultiOption(tx: Transaction, productId: string, name: string): Promise<string> {
    const [group] = await tx
      .insert(optionGroups)
      .values({
        tenantId: sql`current_tenant_id()`,
        name: { [LOCALE]: `${name} group` },
        minSelect: 0,
        maxSelect: 2,
        required: false,
        sort: 0,
      })
      .returning({ id: optionGroups.id });
    const [item] = await tx
      .insert(optionGroupItems)
      .values({
        tenantId: sql`current_tenant_id()`,
        groupId: group!.id,
        name: { [LOCALE]: name },
        priceDelta: "0.50",
        vatClass: "reduced",
        maxQuantity: 2,
        sort: 0,
      })
      .returning({ id: optionGroupItems.id });
    await tx.insert(productOptionGroups).values({
      tenantId: sql`current_tenant_id()`,
      productId,
      groupId: group!.id,
      sort: 0,
    });
    return item!.id;
  }

  /** Open an OPEN order with modifier lines and point a fresh table at it → a real tab (`lockOpenTab`
   *  needs the `dining_tables.tab_id` back-pointer). Skips firing, so no station is required. */
  async function openModifierTab(
    tx: Transaction,
    cfg: TillConfig,
    tableId: string,
    lines: { productId: string; quantity: string; options?: { optionGroupItemId: string }[] }[],
  ): Promise<string> {
    const id = randomUUID();
    await createOpenOrder(tx, cfg, id, lines, null);
    await tx.execute(sql`update dining_tables set tab_id = ${id} where id = ${tableId}`);
    return id;
  }

  async function addOption(tx: Transaction, productId: string, name: string): Promise<string> {
    const [group] = await tx
      .insert(optionGroups)
      .values({
        tenantId: sql`current_tenant_id()`,
        name: { [LOCALE]: `${name} group` },
        minSelect: 0,
        maxSelect: 1,
        required: false,
        sort: 0,
      })
      .returning({ id: optionGroups.id });
    const [item] = await tx
      .insert(optionGroupItems)
      .values({
        tenantId: sql`current_tenant_id()`,
        groupId: group!.id,
        name: { [LOCALE]: name },
        priceDelta: "0.50",
        vatClass: "reduced",
        sort: 0,
      })
      .returning({ id: optionGroupItems.id });
    await tx.insert(productOptionGroups).values({
      tenantId: sql`current_tenant_id()`,
      productId,
      groupId: group!.id,
      sort: 0,
    });
    return item!.id;
  }

  it("voiding a PARENT dish removes its modifier children too (no orphan FK 23503)", async () => {
    const { cfg, cafeId, aguaId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const bacon = await addOption(tx, cafeId, "Bacon");
      const tableId = await makeTable(tx, cfg);
      // line 1 = café (parent), line 2 = bacon (child), line 3 = agua (plain).
      const tabId = await openModifierTab(tx, cfg, tableId, [
        { productId: cafeId, quantity: "1", options: [{ optionGroupItemId: bacon }] },
        { productId: aguaId, quantity: "1" },
      ]);
      await voidTabLine(tx, cfg, tabId, 1);
      const remaining = await tx
        .select({
          lineNo: workingOrderLines.lineNo,
          productId: workingOrderLines.productId,
          parentLineId: workingOrderLines.parentLineId,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId))
        .orderBy(workingOrderLines.lineNo);
      // Parent (1) AND its child (2) are gone; only the plain agua line (3) survives.
      expect(remaining.map((r) => r.lineNo)).toEqual([3]);
      expect(remaining[0]!.productId).toBe(aguaId);
    });
  });

  it("voiding a CHILD modifier line removes only that line (its dish stays)", async () => {
    const { cfg, cafeId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const bacon = await addOption(tx, cafeId, "Bacon");
      const tableId = await makeTable(tx, cfg);
      // line 1 = café (parent), line 2 = bacon (child).
      const tabId = await openModifierTab(tx, cfg, tableId, [
        { productId: cafeId, quantity: "1", options: [{ optionGroupItemId: bacon }] },
      ]);
      await voidTabLine(tx, cfg, tabId, 2);
      const remaining = await tx
        .select({
          lineNo: workingOrderLines.lineNo,
          productId: workingOrderLines.productId,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId))
        .orderBy(workingOrderLines.lineNo);
      // Only the child left; the dish is untouched.
      expect(remaining.map((r) => r.lineNo)).toEqual([1]);
      expect(remaining[0]!.productId).toBe(cafeId);
    });
  });

  it("SUMS a repeated optionGroupItemId in one line into ONE child at the summed quantity (per-option quantity)", async () => {
    const { cfg, cafeId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const bacon = await addMultiOption(tx, cafeId, "Bacon"); // maxSelect 2, item maxQuantity 2
      const id = randomUUID();
      await createOpenOrder(
        tx,
        cfg,
        id,
        [
          {
            productId: cafeId,
            quantity: "1",
            // The SAME option named twice on a multi-select group — reachable via a crafted client.
            // Each entry contributes 1, so the summed per-option quantity is 2 (NOT silently dropped).
            options: [{ optionGroupItemId: bacon }, { optionGroupItemId: bacon }],
          },
        ],
        null,
      );
      const lines = await tx
        .select({
          lineNo: workingOrderLines.lineNo,
          parentLineId: workingOrderLines.parentLineId,
          optionGroupItemId: workingOrderLines.optionGroupItemId,
          quantity: workingOrderLines.quantity,
          lineTotal: workingOrderLines.lineTotal,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, id))
        .orderBy(workingOrderLines.lineNo);
      // ONE parent + ONE child — the duplicate SUMS to quantity 2, not two identical children and not
      // one dropped: the child is priced/persisted as 2 (dish ×1 × option ×2), 0.50 × 2 = 1.00 gross.
      expect(lines).toHaveLength(2);
      expect(lines[0]!.parentLineId).toBeNull();
      expect(lines.filter((l) => l.parentLineId !== null)).toHaveLength(1);
      expect(lines[1]!.optionGroupItemId).toBe(bacon);
      expect(lines[1]!.quantity).toBe("2.000");
      expect(lines[1]!.lineTotal).toBe("1.00");
    });
  });
});

describe("priceOrderLines per-option quantity (resolve loop)", () => {
  /** Attach an option group to `productId` with a configurable per-group max_select and per-item
   *  max_quantity; returns the single item's id. `priceDelta` is 0.50 reduced, like the other helpers. */
  async function addQtyOption(
    tx: Transaction,
    productId: string,
    name: string,
    opts: {
      minSelect?: number;
      maxSelect?: number;
      required?: boolean;
      maxQuantity?: number;
    } = {},
  ): Promise<string> {
    const [group] = await tx
      .insert(optionGroups)
      .values({
        tenantId: sql`current_tenant_id()`,
        name: { [LOCALE]: `${name} group` },
        minSelect: opts.minSelect ?? 0,
        maxSelect: opts.maxSelect ?? 1,
        required: opts.required ?? false,
        sort: 0,
      })
      .returning({ id: optionGroups.id });
    const [item] = await tx
      .insert(optionGroupItems)
      .values({
        tenantId: sql`current_tenant_id()`,
        groupId: group!.id,
        name: { [LOCALE]: name },
        priceDelta: "0.50",
        vatClass: "reduced",
        maxQuantity: opts.maxQuantity ?? 1,
        sort: 0,
      })
      .returning({ id: optionGroupItems.id });
    await tx.insert(productOptionGroups).values({
      tenantId: sql`current_tenant_id()`,
      productId,
      groupId: group!.id,
      sort: 0,
    });
    return item!.id;
  }

  /** Attach a group with TWO items (each priceDelta 0.50), configurable max_select/max_quantity;
   *  returns both item ids. For the max_select-tally cases with distinct picks. */
  async function addTwoItemGroup(
    tx: Transaction,
    productId: string,
    opts: { maxSelect?: number; maxQuantity?: number } = {},
  ): Promise<[string, string]> {
    const [group] = await tx
      .insert(optionGroups)
      .values({
        tenantId: sql`current_tenant_id()`,
        name: { [LOCALE]: "Extras group" },
        minSelect: 0,
        maxSelect: opts.maxSelect ?? 2,
        required: false,
        sort: 0,
      })
      .returning({ id: optionGroups.id });
    const rows = await tx
      .insert(optionGroupItems)
      .values([
        {
          tenantId: sql`current_tenant_id()`,
          groupId: group!.id,
          name: { [LOCALE]: "Uno" },
          priceDelta: "0.50",
          vatClass: "reduced",
          maxQuantity: opts.maxQuantity ?? 1,
          sort: 0,
        },
        {
          tenantId: sql`current_tenant_id()`,
          groupId: group!.id,
          name: { [LOCALE]: "Dos" },
          priceDelta: "0.50",
          vatClass: "reduced",
          maxQuantity: opts.maxQuantity ?? 1,
          sort: 1,
        },
      ])
      .returning({ id: optionGroupItems.id });
    await tx.insert(productOptionGroups).values({
      tenantId: sql`current_tenant_id()`,
      productId,
      groupId: group!.id,
      sort: 0,
    });
    return [rows[0]!.id, rows[1]!.id];
  }

  it("prices & persists an option ×2 on a dish ×3 as a child of combined quantity 6, dish unchanged", async () => {
    const { cfg, cafeId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const shot = await addQtyOption(tx, cafeId, "Extra shot", { maxSelect: 5, maxQuantity: 5 });
      const id = randomUUID();
      await createOpenOrder(
        tx,
        cfg,
        id,
        [{ productId: cafeId, quantity: "3", options: [{ optionGroupItemId: shot, quantity: 2 }] }],
        null,
      );
      const lines = await tx
        .select({
          id: workingOrderLines.id,
          productId: workingOrderLines.productId,
          parentLineId: workingOrderLines.parentLineId,
          optionGroupItemId: workingOrderLines.optionGroupItemId,
          quantity: workingOrderLines.quantity,
          unitPriceGross: workingOrderLines.unitPriceGross,
          lineTotal: workingOrderLines.lineTotal,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, id))
        .orderBy(workingOrderLines.lineNo);
      expect(lines).toHaveLength(2);
      // Parent dish row is UNCHANGED: its product, no option link, quantity still 3.
      expect(lines[0]).toMatchObject({
        productId: cafeId,
        parentLineId: null,
        optionGroupItemId: null,
        quantity: "3.000",
      });
      // Child option row: combined 3 × 2 = 6, per-unit gross the bare delta 0.50, total 0.50 × 6 = 3.00.
      expect(lines[1]!.parentLineId).toBe(lines[0]!.id);
      expect(lines[1]!.optionGroupItemId).toBe(shot);
      expect(lines[1]!.quantity).toBe("6.000");
      expect(lines[1]!.unitPriceGross).toBe("0.50");
      expect(lines[1]!.lineTotal).toBe("3.00");
    });
  });

  it("rejects a per-option quantity above the item's max_quantity with quantity_invalid", async () => {
    const { cfg, cafeId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      // Cap 2, but max_select 5 so a tally of 3 does NOT trip above_max first — the quantity cap is what
      // must reject it.
      const shot = await addQtyOption(tx, cafeId, "Extra shot", { maxSelect: 5, maxQuantity: 2 });
      await expect(
        createOpenOrder(
          tx,
          cfg,
          randomUUID(),
          [
            {
              productId: cafeId,
              quantity: "1",
              options: [{ optionGroupItemId: shot, quantity: 3 }],
            },
          ],
          null,
        ),
      ).rejects.toMatchObject({
        code: "options.selection_invalid",
        params: { productId: cafeId, reason: "quantity_invalid" },
      });
    });
  });

  it("rejects a per-option quantity of 0 with quantity_invalid", async () => {
    const { cfg, cafeId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const shot = await addQtyOption(tx, cafeId, "Extra shot", { maxSelect: 5, maxQuantity: 5 });
      await expect(
        createOpenOrder(
          tx,
          cfg,
          randomUUID(),
          [
            {
              productId: cafeId,
              quantity: "1",
              options: [{ optionGroupItemId: shot, quantity: 0 }],
            },
          ],
          null,
        ),
      ).rejects.toMatchObject({
        code: "options.selection_invalid",
        params: { productId: cafeId, reason: "quantity_invalid" },
      });
    });
  });

  it("rejects a non-integer per-option quantity with quantity_invalid", async () => {
    const { cfg, cafeId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const shot = await addQtyOption(tx, cafeId, "Extra shot", { maxSelect: 5, maxQuantity: 5 });
      await expect(
        createOpenOrder(
          tx,
          cfg,
          randomUUID(),
          [
            {
              productId: cafeId,
              quantity: "1",
              options: [{ optionGroupItemId: shot, quantity: 1.5 }],
            },
          ],
          null,
        ),
      ).rejects.toMatchObject({
        code: "options.selection_invalid",
        params: { productId: cafeId, reason: "quantity_invalid" },
      });
    });
  });

  it("rejects an invalid per-entry quantity even when duplicate entries SUM to a valid integer", async () => {
    const { cfg, cafeId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const shot = await addQtyOption(tx, cafeId, "Extra shot", { maxSelect: 5, maxQuantity: 5 });
      // Crafted duplicates whose components are individually invalid (a negative; a fraction) but whose
      // SUM is a valid integer must still be refused — each entry is validated before summing, so an
      // invalid component cannot be washed out by the total.
      for (const options of [
        [
          { optionGroupItemId: shot, quantity: 2 },
          { optionGroupItemId: shot, quantity: -1 },
        ],
        [
          { optionGroupItemId: shot, quantity: 1.5 },
          { optionGroupItemId: shot, quantity: 0.5 },
        ],
      ]) {
        await expect(
          createOpenOrder(
            tx,
            cfg,
            randomUUID(),
            [{ productId: cafeId, quantity: "1", options }],
            null,
          ),
        ).rejects.toMatchObject({
          code: "options.selection_invalid",
          params: { productId: cafeId, reason: "quantity_invalid" },
        });
      }
    });
  });

  it("counts the per-option quantity toward max_select: one item ×3 in a max_select 2 group is above_max", async () => {
    const { cfg, cafeId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      // max_quantity 5 so the ×3 passes the per-option cap; the group's max_select 2 is what the summed
      // tally (3) must exceed — proving the tally is the SUM of quantities, not the distinct-item count.
      const shot = await addQtyOption(tx, cafeId, "Extra shot", { maxSelect: 2, maxQuantity: 5 });
      await expect(
        createOpenOrder(
          tx,
          cfg,
          randomUUID(),
          [
            {
              productId: cafeId,
              quantity: "1",
              options: [{ optionGroupItemId: shot, quantity: 3 }],
            },
          ],
          null,
        ),
      ).rejects.toMatchObject({
        code: "options.selection_invalid",
        params: { productId: cafeId, reason: "above_max" },
      });
    });
  });

  it("two distinct items ×1 each fit max_select 2, but one taken ×2 tips the summed tally to above_max", async () => {
    const { cfg, cafeId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const [uno, dos] = await addTwoItemGroup(tx, cafeId, { maxSelect: 2, maxQuantity: 5 });
      // one ×1 + one ×1 → tally 2 ≤ max_select 2 → OK (two child lines).
      const okId = randomUUID();
      await createOpenOrder(
        tx,
        cfg,
        okId,
        [
          {
            productId: cafeId,
            quantity: "1",
            options: [
              { optionGroupItemId: uno, quantity: 1 },
              { optionGroupItemId: dos, quantity: 1 },
            ],
          },
        ],
        null,
      );
      const okLines = await tx
        .select({ parentLineId: workingOrderLines.parentLineId })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, okId));
      expect(okLines.filter((l) => l.parentLineId !== null)).toHaveLength(2);

      // same two items, but uno ×2 → tally 2 + 1 = 3 > max_select 2 → above_max.
      await expect(
        createOpenOrder(
          tx,
          cfg,
          randomUUID(),
          [
            {
              productId: cafeId,
              quantity: "1",
              options: [
                { optionGroupItemId: uno, quantity: 2 },
                { optionGroupItemId: dos, quantity: 1 },
              ],
            },
          ],
          null,
        ),
      ).rejects.toMatchObject({
        code: "options.selection_invalid",
        params: { productId: cafeId, reason: "above_max" },
      });
    });
  });

  it("omitting quantity behaves exactly as ×1 (regression guard)", async () => {
    const { cfg, cafeId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const shot = await addQtyOption(tx, cafeId, "Extra shot", { maxSelect: 1, maxQuantity: 1 });
      const id = randomUUID();
      await createOpenOrder(
        tx,
        cfg,
        id,
        // No `quantity` on the option — the common case; must behave as ×1.
        [{ productId: cafeId, quantity: "2", options: [{ optionGroupItemId: shot }] }],
        null,
      );
      const lines = await tx
        .select({
          parentLineId: workingOrderLines.parentLineId,
          optionGroupItemId: workingOrderLines.optionGroupItemId,
          quantity: workingOrderLines.quantity,
          lineTotal: workingOrderLines.lineTotal,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, id))
        .orderBy(workingOrderLines.lineNo);
      expect(lines).toHaveLength(2);
      // Child combined = dish ×2 × option ×1 = 2; 0.50 × 2 = 1.00 — identical to a plain single option.
      expect(lines[1]!.optionGroupItemId).toBe(shot);
      expect(lines[1]!.quantity).toBe("2.000");
      expect(lines[1]!.lineTotal).toBe("1.00");
    });
  });
});

describe("priceOrderLines course-override validation (KDS-2 A1)", () => {
  /** Open a fresh empty tab in the venue and return its id — the addTabRound host these cases fire on. */
  async function openEmptyTab(tx: Transaction, cfg: TillConfig): Promise<string> {
    const tableId = await makeTable(tx, cfg);
    const { tabId } = await openTab(tx, cfg, { tableId });
    return tabId;
  }

  it("rejects a malformed (non-uuid) course override with course.not_found", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const cafe = await makeProduct(tx, cfg, catalogueId, {});
      const tabId = await openEmptyTab(tx, cfg);
      await expect(
        addTabRound(tx, cfg, tabId, [{ productId: cafe, quantity: "1", courseId: "not-a-uuid" }]),
      ).rejects.toMatchObject({ code: "course.not_found", params: { courseId: "not-a-uuid" } });
    });
  });

  it("rejects an unknown (well-formed but absent) course override with course.not_found", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const cafe = await makeProduct(tx, cfg, catalogueId, {});
      const tabId = await openEmptyTab(tx, cfg);
      const missing = randomUUID();
      await expect(
        addTabRound(tx, cfg, tabId, [{ productId: cafe, quantity: "1", courseId: missing }]),
      ).rejects.toMatchObject({ code: "course.not_found", params: { courseId: missing } });
    });
  });

  it("rejects a DIFFERENT venue's course of the same tenant with course.not_found", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const cafe = await makeProduct(tx, cfg, catalogueId, {});
      const tabId = await openEmptyTab(tx, cfg);
      // A second venue of the SAME tenant, and a course that lives there. The tenant-consistent FK on
      // working_order_lines.course_id would ACCEPT it (same tenant), but requireLiveCourse is
      // location-scoped, so the cross-venue override is refused — the exact silent-accept bug A1 closes.
      const loc2 = await tx.execute<{ id: string }>(sql`
        insert into locations (tenant_id, name, invoice_locales, operation_description)
        values (${cfg.tenantId}, 'Barra 2', array[${LOCALE}], 'Venta en establecimiento') returning id`);
      const cfg2: TillConfig = { ...cfg, locationId: brandLocationId(loc2.rows[0]!.id) };
      const foreign = await createCourse(tx, cfg2, { name: "Entrantes", displayOrder: 0 });
      await expect(
        addTabRound(tx, cfg, tabId, [{ productId: cafe, quantity: "1", courseId: foreign.id }]),
      ).rejects.toMatchObject({ code: "course.not_found", params: { courseId: foreign.id } });
    });
  });

  it("rejects a DEACTIVATED course override with course.not_found", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const cafe = await makeProduct(tx, cfg, catalogueId, {});
      const tabId = await openEmptyTab(tx, cfg);
      const dead = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      await deactivateCourse(tx, cfg, dead.id);
      await expect(
        addTabRound(tx, cfg, tabId, [{ productId: cafe, quantity: "1", courseId: dead.id }]),
      ).rejects.toMatchObject({ code: "course.not_found", params: { courseId: dead.id } });
    });
  });

  it("accepts a valid active course override and resolves it (the override wins over the product default)", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      // The product DEFAULT differs from the override — proving the override WINS and is snapshotted,
      // and that a legitimate active override is not rejected by the new screen.
      const def = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const override = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      const cafe = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, cafe, def.id);
      const tabId = await openEmptyTab(tx, cfg);
      await addTabRound(tx, cfg, tabId, [
        { productId: cafe, quantity: "1", courseId: override.id },
      ]);
      const items = await courseItemsFor(tx, tabId);
      expect(items).toHaveLength(1);
      expect(items[0]!.courseId).toBe(override.id);
    });
  });
});
