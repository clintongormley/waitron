import { and, eq, isNotNull } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { locationId as brandLocationId } from "@waitron/shared";
import type { Transaction } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { OPEN_PARENT_REFUSAL, TRANSITION_REFUSAL } from "../trigger-refusals.js";
import { captureError, pgErrorMessage } from "../testing/errors.js";
import { seedNode } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { catalogues, products } from "./catalogue.js";
import { workingOrderLines, workingOrders } from "./orders.js";
import { locations, tenants, tills } from "./tenants.js";

// This suite asserts the `working_orders_enforce_transition` trigger's behaviour.
//
// The refusals are now the trigger's own `RAISE(ABORT, …)` text rather than PostgreSQL's `P0001`.
// The text is what SQLite reports and nothing else — no table, no column, no constraint name — so
// it is compared by EQUALITY against the literal the migration owns
// (`packages/db/src/trigger-refusals.ts`).

const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TILL_A1 = "aaaaaaaa-1111-4000-8000-000000000001";
const AT = "2026-07-20T19:20:30+00:00";
// Café solo / Cafè sol is this package's placeholder line description (orders.test.ts,
// sales.test.ts, park-retrieve.test.ts): both literals pass english-only.ts's SPANISH_WORDS guard,
// and they match LOCATION_A's configured invoice_locales (es, ca) so check_locales lets the draft
// line reach require_open_parent — the trigger this suite's composition-freeze case exercises.
const DESCRIPTIONS_A = { es: "Café solo", ca: "Cafè sol" };

// Captured at seed time — the ids the inserts below need as foreign-key targets.
let nodeA = "";
let productA = "";
// working_orders carries no UNIQUE on order_number in this slice (the allocator owns distinctness),
// but a fresh number per order keeps each fixture independent of the others.
let nextOrderNumber = 1;

/** A moment, as this schema stores one. */
const now = (): string => new Date().toISOString();

describe("working_orders state machine (enforce_transition)", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.db, fn);
  }

  // The Drizzle builder rather than raw SQL throughout: `id` and `opened_at` are `$defaultFn`
  // columns applied CLIENT-side, so a raw `insert` reaches neither and the row is refused NOT NULL
  // before any trigger under test fires.
  async function open(): Promise<string> {
    const orderNumber = nextOrderNumber++;
    const [row] = await suite.db
      .insert(workingOrders)
      .values({
        tillId: TILL_A1,
        nodeId: nodeA,
        orderNumber,
        status: "open",
        openedAt: AT,
      })
      .returning({ id: workingOrders.id });
    return row!.id;
  }

  /** A valid draft line while the parent is open. unit_price_gross is NOT NULL since 0030. */
  function insertLine(orderId: string, lineNo: number): Promise<unknown> {
    return inTx((tx) =>
      tx.insert(workingOrderLines).values({
        workingOrderId: orderId,
        lineNo,
        productId: productA,
        name: "Café solo",
        descriptions: DESCRIPTIONS_A,
        quantity: 1000,
        unitPrice: 100,
        unitPriceGross: 110,
        vatRate: 1000,
        lineTotal: 100,
      }),
    );
  }

  async function statusOf(id: string): Promise<string> {
    const [row] = await inTx((tx) =>
      tx
        .select({ status: workingOrders.status })
        .from(workingOrders)
        .where(eq(workingOrders.id, id)),
    );
    return row!.status;
  }

  beforeAll(async () => {
    const db = suite.db;
    await db
      .insert(tenants)
      .values([{ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
    await db.insert(locations).values([
      {
        id: LOCATION_A,
        name: "Fixture Location A",
        invoiceLocales: ["es", "ca"],
        operationDescription: "Hostelería",
      },
    ]);
    await db.insert(tills).values([{ id: TILL_A1, locationId: LOCATION_A, name: "A1" }]);
    nodeA = await seedNode(db, brandLocationId(LOCATION_A));
    const [catalogue] = await db
      .insert(catalogues)
      .values({ name: "Deli" })
      .returning({ id: catalogues.id });
    const [product] = await db
      .insert(products)
      .values({
        catalogueId: catalogue!.id,
        name: "Café solo",
        pricingUnit: "each",
        unitPrice: 100,
        vatClass: "general",
      })
      .returning({ id: products.id });
    productA = product!.id;
  });

  it("permits open → placed, placed → settled, and open → open (label edit)", async () => {
    const id = await open();
    // open → open: a label edit keeps status open. 'Table 4' rather than the design's `Mesa 4` —
    // `mesa` is in english-only.ts's SPANISH_WORDS, which scans string literals in this file too.
    await inTx((tx) =>
      tx.update(workingOrders).set({ label: "Table 4" }).where(eq(workingOrders.id, id)),
    );
    // open → placed: placing (composition now frozen).
    await inTx((tx) =>
      tx.update(workingOrders).set({ status: "placed" }).where(eq(workingOrders.id, id)),
    );
    // placed → settled: collect. settled_at satisfies the settled_at biconditional.
    await inTx((tx) =>
      tx
        .update(workingOrders)
        .set({ status: "settled", settledAt: now() })
        .where(eq(workingOrders.id, id)),
    );
    expect(await statusOf(id)).toBe("settled");
  });

  it("permits open → placed → abandoned", async () => {
    const id = await open();
    await inTx((tx) =>
      tx.update(workingOrders).set({ status: "placed" }).where(eq(workingOrders.id, id)),
    );
    // placed → abandoned: cancel. settled_at stays null, so the biconditional holds.
    await inTx((tx) =>
      tx.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, id)),
    );
    expect(await statusOf(id)).toBe("abandoned");
  });

  it("permits open → settled directly (the Mode-P walk-up, never entering placed)", async () => {
    // The #60 cash-sale path (design §3, §5): a walk-up order settles in one instant without ever
    // being placed. open → settled is an allowed edge in its own right.
    const id = await open();
    await inTx((tx) =>
      tx
        .update(workingOrders)
        .set({ status: "settled", settledAt: now() })
        .where(eq(workingOrders.id, id)),
    );
    expect(await statusOf(id)).toBe("settled");
  });

  it("rejects every transition out of settled/abandoned", async () => {
    const id = await open();
    await inTx((tx) =>
      tx
        .update(workingOrders)
        .set({ status: "settled", settledAt: now() })
        .where(eq(workingOrders.id, id)),
    );
    // The status flip AND the settled_at reset both satisfy the settled_at biconditional, so the
    // ONLY thing that can reject this is the trigger treating settled as terminal.
    const e1 = await captureError(() =>
      inTx((tx) =>
        tx
          .update(workingOrders)
          .set({ status: "abandoned", settledAt: null })
          .where(eq(workingOrders.id, id)),
      ),
    );
    expect(pgErrorMessage(e1)).toBe(TRANSITION_REFUSAL);

    // Even a non-status column change on an abandoned row is rejected — the trigger keys on the OLD
    // status, not on whether status itself moved.
    const id2 = await open();
    await inTx((tx) =>
      tx.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, id2)),
    );
    const e2 = await captureError(() =>
      inTx((tx) => tx.update(workingOrders).set({ label: "x" }).where(eq(workingOrders.id, id2))),
    );
    expect(pgErrorMessage(e2)).toBe(TRANSITION_REFUSAL);
  });

  it("permits a collected_at NULL→non-null stamp on a settled order (the Mode-P handover marker, 0056)", async () => {
    // A Mode-P walk-up settles BEFORE it is fired, so its order-level `collected_at` handover marker
    // (KDS-1 §3e) can only be written by a settled → settled UPDATE — the ONE relaxation the
    // trigger carries. Nothing else about the settled row changes.
    const id = await open();
    await inTx((tx) =>
      tx
        .update(workingOrders)
        .set({ status: "settled", settledAt: now() })
        .where(eq(workingOrders.id, id)),
    );
    await inTx((tx) =>
      tx.update(workingOrders).set({ collectedAt: now() }).where(eq(workingOrders.id, id)),
    );
    const [row] = await inTx((tx) =>
      tx
        .select({ id: workingOrders.id })
        .from(workingOrders)
        .where(and(eq(workingOrders.id, id), isNotNull(workingOrders.collectedAt))),
    );
    expect(row?.id).toBe(id);
  });

  it("rejects any OTHER change to a settled order, and a re-stamp of an already-collected one (0056 keeps the settled-state freeze)", async () => {
    // The relaxation permits the collected_at stamp and NOTHING ELSE — every other working_orders
    // column is pinned. Each rejection below is the trigger's own raise.
    const id = await open();
    await inTx((tx) =>
      tx
        .update(workingOrders)
        .set({ status: "settled", settledAt: now() })
        .where(eq(workingOrders.id, id)),
    );
    // A settled-row change that ALSO touches another column (label) is rejected even though
    // collected_at is going NULL→non-null — the pinned label no longer matches, so no allowed
    // branch applies. This is the defence in depth: the fiscal-relevant identity and `settled_at`
    // fields stay frozen.
    const eLabel = await captureError(() =>
      inTx((tx) =>
        tx
          .update(workingOrders)
          .set({ collectedAt: now(), label: "x" })
          .where(eq(workingOrders.id, id)),
      ),
    );
    expect(pgErrorMessage(eLabel)).toBe(TRANSITION_REFUSAL);
    // A settled → settled UPDATE that is NOT a collected_at stamp (a bare settled_at edit) is
    // rejected — the relaxation requires collected_at itself to go NULL→non-null.
    const eSettledAt = await captureError(() =>
      inTx((tx) =>
        tx.update(workingOrders).set({ settledAt: now() }).where(eq(workingOrders.id, id)),
      ),
    );
    expect(pgErrorMessage(eSettledAt)).toBe(TRANSITION_REFUSAL);

    // Now legitimately stamp the handover marker (NULL→non-null) — allowed.
    await inTx((tx) =>
      tx.update(workingOrders).set({ collectedAt: now() }).where(eq(workingOrders.id, id)),
    );
    // A re-stamp of an already-collected order (collected_at non-null → non-null) is rejected: the
    // branch's guard is that the old collected_at is null, so a second collect matches no allowed
    // branch.
    const eRecollect = await captureError(() =>
      inTx((tx) =>
        tx.update(workingOrders).set({ collectedAt: now() }).where(eq(workingOrders.id, id)),
      ),
    );
    expect(pgErrorMessage(eRecollect)).toBe(TRANSITION_REFUSAL);
  });

  it("rejects placed → open and a non-status update of a placed row (the row-level freeze)", async () => {
    const id = await open();
    await inTx((tx) =>
      tx.update(workingOrders).set({ status: "placed" }).where(eq(workingOrders.id, id)),
    );
    // No un-placing.
    const e1 = await captureError(() =>
      inTx((tx) =>
        tx.update(workingOrders).set({ status: "open" }).where(eq(workingOrders.id, id)),
      ),
    );
    expect(pgErrorMessage(e1)).toBe(TRANSITION_REFUSAL);
    // A label edit on a placed row is rejected too — this IS the composition freeze at the row
    // level, since placed → placed is not an allowed edge.
    const e2 = await captureError(() =>
      inTx((tx) =>
        tx.update(workingOrders).set({ label: "late label" }).where(eq(workingOrders.id, id)),
      ),
    );
    expect(pgErrorMessage(e2)).toBe(TRANSITION_REFUSAL);
  });

  it("rejects a line write on a placed order (composition freeze via require_open_parent)", async () => {
    const id = await open();
    await insertLine(id, 1); // valid while open — the positive control for the rejections below
    await inTx((tx) =>
      tx.update(workingOrders).set({ status: "placed" }).where(eq(workingOrders.id, id)),
    );
    const eIns = await captureError(() => insertLine(id, 2));
    expect(pgErrorMessage(eIns)).toBe(OPEN_PARENT_REFUSAL);
    const eDel = await captureError(() =>
      inTx((tx) =>
        tx
          .delete(workingOrderLines)
          .where(and(eq(workingOrderLines.workingOrderId, id), eq(workingOrderLines.lineNo, 1))),
      ),
    );
    expect(pgErrorMessage(eDel)).toBe(OPEN_PARENT_REFUSAL);
  });
});
