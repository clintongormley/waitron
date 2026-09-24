import { and, eq, isNotNull } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { locationId as brandLocationId } from "@waitron/shared";
import type { Transaction } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { OPEN_PARENT_REFUSAL, TRANSITION_REFUSAL } from "../trigger-refusals.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { seedNode } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { catalogues, products } from "./catalogue.js";
import { workingOrderLines, workingOrders } from "./orders.js";
import { locations, tenants, tills } from "./tenants.js";

// A trigger's refusal carries its `RAISE(ABORT, …)` text and nothing else — no table, no column,
// no constraint name — so it is compared by EQUALITY against the literal the migration owns
// (`packages/db/src/trigger-refusals.ts`).

const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TILL_A1 = "aaaaaaaa-1111-4000-8000-000000000001";
const AT = "2026-07-20T19:20:30+00:00";
// Matches LOCATION_A's invoice_locales (es, ca), so check_locales lets the draft line reach
// require_open_parent — the trigger this suite's composition-freeze case exercises.
const DESCRIPTIONS_A = { es: "Café solo", ca: "Cafè sol" };

let nodeA = "";
let productA = "";
let nextOrderNumber = 1;

/** A moment, as this schema stores one. */
const now = (): string => new Date().toISOString();

describe("working_orders state machine (enforce_transition)", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.db, fn);
  }

  // The Drizzle builder rather than raw SQL: `id` is a `$defaultFn` column applied CLIENT-side,
  // so a raw insert is refused NOT NULL before any trigger under test fires.
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

  /** A valid draft line while the parent is open. */
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
    // open → open. Not a Spanish label: english-only.ts's SPANISH_WORDS scans string literals in
    // this file too.
    await inTx((tx) =>
      tx.update(workingOrders).set({ label: "Table 4" }).where(eq(workingOrders.id, id)),
    );
    await inTx((tx) =>
      tx.update(workingOrders).set({ status: "placed" }).where(eq(workingOrders.id, id)),
    );
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
    await inTx((tx) =>
      tx.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, id)),
    );
    expect(await statusOf(id)).toBe("abandoned");
  });

  it("permits open → settled directly (the Mode-P walk-up, never entering placed)", async () => {
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
    expect(engineErrorMessage(e1)).toBe(TRANSITION_REFUSAL);

    // Even a non-status column change on an abandoned row is rejected — the trigger keys on the OLD
    // status, not on whether status itself moved.
    const id2 = await open();
    await inTx((tx) =>
      tx.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, id2)),
    );
    const e2 = await captureError(() =>
      inTx((tx) => tx.update(workingOrders).set({ label: "x" }).where(eq(workingOrders.id, id2))),
    );
    expect(engineErrorMessage(e2)).toBe(TRANSITION_REFUSAL);
  });

  it("permits a collected_at NULL→non-null stamp on a settled order (the Mode-P handover marker, 0056)", async () => {
    // A walk-up settles BEFORE it is fired, so its `collected_at` handover marker can only be
    // written by a settled → settled UPDATE — the ONE relaxation the trigger carries.
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
    // The relaxation permits the collected_at stamp and NOTHING ELSE.
    const id = await open();
    await inTx((tx) =>
      tx
        .update(workingOrders)
        .set({ status: "settled", settledAt: now() })
        .where(eq(workingOrders.id, id)),
    );
    // Rejected even though collected_at is going NULL→non-null: the label is pinned too.
    const eLabel = await captureError(() =>
      inTx((tx) =>
        tx
          .update(workingOrders)
          .set({ collectedAt: now(), label: "x" })
          .where(eq(workingOrders.id, id)),
      ),
    );
    expect(engineErrorMessage(eLabel)).toBe(TRANSITION_REFUSAL);
    // A bare settled_at edit: the relaxation requires collected_at itself to go NULL→non-null.
    const eSettledAt = await captureError(() =>
      inTx((tx) =>
        tx.update(workingOrders).set({ settledAt: now() }).where(eq(workingOrders.id, id)),
      ),
    );
    expect(engineErrorMessage(eSettledAt)).toBe(TRANSITION_REFUSAL);

    await inTx((tx) =>
      tx.update(workingOrders).set({ collectedAt: now() }).where(eq(workingOrders.id, id)),
    );
    // A re-stamp of an already-collected order: the relaxation requires the old collected_at null.
    const eRecollect = await captureError(() =>
      inTx((tx) =>
        tx.update(workingOrders).set({ collectedAt: now() }).where(eq(workingOrders.id, id)),
      ),
    );
    expect(engineErrorMessage(eRecollect)).toBe(TRANSITION_REFUSAL);
  });

  it("rejects placed → open and a non-status update of a placed row (the row-level freeze)", async () => {
    const id = await open();
    await inTx((tx) =>
      tx.update(workingOrders).set({ status: "placed" }).where(eq(workingOrders.id, id)),
    );
    const e1 = await captureError(() =>
      inTx((tx) =>
        tx.update(workingOrders).set({ status: "open" }).where(eq(workingOrders.id, id)),
      ),
    );
    expect(engineErrorMessage(e1)).toBe(TRANSITION_REFUSAL);
    // placed → placed is not an allowed edge, so a label edit is refused too.
    const e2 = await captureError(() =>
      inTx((tx) =>
        tx.update(workingOrders).set({ label: "late label" }).where(eq(workingOrders.id, id)),
      ),
    );
    expect(engineErrorMessage(e2)).toBe(TRANSITION_REFUSAL);
  });

  it("rejects a line write on a placed order (composition freeze via require_open_parent)", async () => {
    const id = await open();
    await insertLine(id, 1); // valid while open — the positive control for the rejections below
    await inTx((tx) =>
      tx.update(workingOrders).set({ status: "placed" }).where(eq(workingOrders.id, id)),
    );
    const eIns = await captureError(() => insertLine(id, 2));
    expect(engineErrorMessage(eIns)).toBe(OPEN_PARENT_REFUSAL);
    const eDel = await captureError(() =>
      inTx((tx) =>
        tx
          .delete(workingOrderLines)
          .where(and(eq(workingOrderLines.workingOrderId, id), eq(workingOrderLines.lineNo, 1))),
      ),
    );
    expect(engineErrorMessage(eDel)).toBe(OPEN_PARENT_REFUSAL);
  });
});
