import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "./client.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { orderDiningLocked, ordersDiningLocked } from "./order-dining.js";
import { billPayments } from "./schema/bill-payments.js";
import { kitchenStations } from "./schema/kitchen-stations.js";
import { products } from "./schema/menus.js";
import { workingOrderLines, workingOrders } from "./schema/orders.js";
import { sales } from "./schema/sales.js";
import { invoiceSeries } from "./schema/series.js";
import { ticketItems } from "./schema/ticket-items.js";
import { withTransaction } from "./tenancy.js";
import { captureError, engineErrorMessage } from "./testing/errors.js";
import { seedDevice, seedNode, seedPerson, seedVenue } from "./testing/seed.js";
import { useVenueDb } from "./testing/venue-db.js";
import {
  DINING_FIXED_REFUSAL,
  OPEN_PARENT_REFUSAL,
  TRANSITION_REFUSAL,
} from "./trigger-refusals.js";

const AT = "2026-07-20T19:20:30+00:00";
const DESCRIPTIONS = { es: "Cola", ca: "Cola" };

let nodeId = "";
let deviceId = "";
let productId = "";
let stationId = "";
let nextOrderNumber = 1;
let nextSeries = 1;

interface Order {
  orderId: string;
  lineId: string;
}

/** One way an order can stand when someone tries to change how it is sold. */
interface SetUp {
  name: string;
  arrange: (tx: Transaction, order: Order) => Promise<unknown>;
  /** What `working_orders_dining_fixed` (or the transition guard) answers; `null` = allowed. */
  refusal: string | null;
  locked: "sent" | "paid" | null;
}

function payment(state: "pending" | "received" | "failed"): SetUp["arrange"] {
  return (tx, { orderId }) =>
    tx.insert(billPayments).values({
      workingOrderId: orderId,
      submissionId: `submission-${orderId}`,
      fingerprint: "fp",
      kind: "contribution",
      method: "card",
      applied: 1000,
      state,
      requestedBy: "person",
      source: "device",
      deviceId,
      receivedAt: state === "received" ? AT : null,
      failedAt: state === "failed" ? AT : null,
    });
}

const SET_UPS: SetUp[] = [
  { name: "a fresh open order", arrange: async () => {}, refusal: null, locked: null },
  {
    name: "one line sent to the kitchen",
    arrange: (tx, { lineId }) =>
      tx.update(workingOrderLines).set({ sentAt: AT }).where(eq(workingOrderLines.id, lineId)),
    refusal: DINING_FIXED_REFUSAL,
    locked: "sent",
  },
  {
    // A round of later-course dishes gets ticket items and no `sent_at`.
    name: "a ticket item and no sent_at",
    arrange: (tx, { lineId }) =>
      tx.insert(ticketItems).values({ workingOrderLineId: lineId, stationId }),
    refusal: DINING_FIXED_REFUSAL,
    locked: "sent",
  },
  {
    name: "a payment attempt started",
    arrange: (tx, { orderId }) =>
      tx.update(workingOrders).set({ paymentAttemptAt: AT }).where(eq(workingOrders.id, orderId)),
    refusal: DINING_FIXED_REFUSAL,
    locked: "paid",
  },
  {
    name: "a pending payment",
    arrange: payment("pending"),
    refusal: DINING_FIXED_REFUSAL,
    locked: "paid",
  },
  {
    name: "a received payment",
    arrange: payment("received"),
    refusal: DINING_FIXED_REFUSAL,
    locked: "paid",
  },
  { name: "a failed payment", arrange: payment("failed"), refusal: null, locked: null },
  {
    name: "a sent line and a received payment",
    arrange: async (tx, order) => {
      await tx
        .update(workingOrderLines)
        .set({ sentAt: AT })
        .where(eq(workingOrderLines.id, order.lineId));
      await payment("received")(tx, order);
    },
    refusal: DINING_FIXED_REFUSAL,
    locked: "sent",
  },
  {
    name: "a sale filed for the order",
    arrange: async (tx, { orderId }) => {
      const [series] = await tx
        .insert(invoiceSeries)
        .values({ nodeId, code: `D${nextSeries++}`, purpose: "full" })
        .returning({ id: invoiceSeries.id });
      await tx.insert(sales).values({
        source: "device",
        deviceId,
        nodeId,
        seriesId: series!.id,
        invoiceNumber: 1,
        issuedAt: AT,
        issuedOffsetMinutes: 0,
        total: 0,
        vatBreakdown: [],
        locale: "es",
        invoiceLocales: ["es"],
        fiscalBackend: "verifactu",
        fiscalState: "recorded",
        workingOrderId: orderId,
      });
    },
    refusal: DINING_FIXED_REFUSAL,
    locked: "paid",
  },
  {
    // The transition guard answers first: `dining` is one of the columns a placed order holds.
    name: "a placed order",
    arrange: (tx, { orderId }) =>
      tx.update(workingOrders).set({ status: "placed" }).where(eq(workingOrders.id, orderId)),
    refusal: TRANSITION_REFUSAL,
    locked: "sent",
  },
];

describe("an order's way of selling, once the kitchen has it or money is taken", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.db, fn);
  }

  async function openOrder(): Promise<Order> {
    return inTx(async (tx) => {
      const [order] = await tx
        .insert(workingOrders)
        .values({
          source: "device",
          deviceId,
          nodeId,
          orderNumber: nextOrderNumber++,
          openedAt: AT,
          dining: "eat_in",
        })
        .returning({ id: workingOrders.id });
      const [line] = await tx
        .insert(workingOrderLines)
        .values({
          workingOrderId: order!.id,
          lineNo: 1,
          productId,
          name: "Cola",
          descriptions: DESCRIPTIONS,
          quantity: 1000,
          unitPriceGross: 180,
          vatClass: "reduced",
          takeawayVatClass: "general",
          lineTotal: 180,
        })
        .returning({ id: workingOrderLines.id });
      return { orderId: order!.id, lineId: line!.id };
    });
  }

  beforeAll(async () => {
    const db = suite.db;
    await seedVenue(db, { invoiceLocales: ["es", "ca"] });
    await seedPerson(db, { id: "person" });
    nodeId = await seedNode(db);
    ({ deviceId } = await seedDevice(db));
    const [product] = await db
      .insert(products)
      .values({ name: "Cola", unitPrice: 180, vatClass: "reduced" })
      .returning({ id: products.id });
    productId = product!.id;
    const [station] = await db
      .insert(kitchenStations)
      .values({ name: "Bar" })
      .returning({ id: kitchenStations.id });
    stationId = station!.id;
  });

  it.each(SET_UPS)("$name: refusal $refusal, locked $locked", async (setUp) => {
    const order = await openOrder();
    await inTx((tx) => setUp.arrange(tx, order));

    expect(await inTx((tx) => orderDiningLocked(tx, order.orderId))).toBe(setUp.locked);

    const refusal = await inTx((tx) =>
      tx
        .update(workingOrders)
        .set({ dining: "takeaway" })
        .where(eq(workingOrders.id, order.orderId)),
    ).then(
      () => null,
      (error: unknown) => engineErrorMessage(error),
    );
    expect(refusal).toBe(setUp.refusal);
    const [row] = await inTx((tx) =>
      tx
        .select({ dining: workingOrders.dining })
        .from(workingOrders)
        .where(eq(workingOrders.id, order.orderId)),
    );
    expect(row!.dining).toBe(setUp.refusal === null ? "takeaway" : "eat_in");
  });

  it("lets a locked order write `dining` back to the value it already holds", async () => {
    const order = await openOrder();
    await inTx((tx) =>
      tx
        .update(workingOrderLines)
        .set({ sentAt: AT })
        .where(eq(workingOrderLines.id, order.lineId)),
    );
    await inTx((tx) =>
      tx
        .update(workingOrders)
        .set({ dining: "eat_in", label: "Table 2" })
        .where(eq(workingOrders.id, order.orderId)),
    );
  });

  it("answers null for an order that does not exist", async () => {
    expect(await inTx((tx) => orderDiningLocked(tx, "no-such-order"))).toBeNull();
  });

  it("answers several orders in one read, each by its own lines and payments", async () => {
    const free = await openOrder();
    const sent = await openOrder();
    const paid = await openOrder();
    await inTx(async (tx) => {
      await tx
        .update(workingOrderLines)
        .set({ sentAt: AT })
        .where(eq(workingOrderLines.id, sent.lineId));
      await tx
        .update(workingOrders)
        .set({ paymentAttemptAt: AT })
        .where(eq(workingOrders.id, paid.orderId));
    });
    const locks = await inTx((tx) =>
      ordersDiningLocked(tx, [free.orderId, sent.orderId, paid.orderId, "no-such-order"]),
    );
    expect([...locks].sort()).toEqual(
      [
        [sent.orderId, "sent"],
        [paid.orderId, "paid"],
      ].sort(),
    );
    expect(await inTx((tx) => ordersDiningLocked(tx, []))).toEqual(new Map());
  });

  it("refuses a placed order's line changing its takeaway class, as it refuses its served class", async () => {
    const order = await openOrder();
    await inTx((tx) =>
      tx.update(workingOrders).set({ status: "placed" }).where(eq(workingOrders.id, order.orderId)),
    );
    const byLine = eq(workingOrderLines.id, order.lineId);
    // Each write reaches one of the trigger's exceptions for a placed order (served, regrouped,
    // first sent) and adds a class change to it.
    for (const exception of [
      { servedQuantity: 1000 },
      { groupId: null },
      { sentAt: AT },
    ] as const) {
      for (const change of [{ vatClass: "general" }, { takeawayVatClass: "reduced" }] as const) {
        const error = await captureError(() =>
          inTx((tx) =>
            tx
              .update(workingOrderLines)
              .set({ ...exception, ...change })
              .where(byLine),
          ),
        );
        expect(engineErrorMessage(error), JSON.stringify({ exception, change })).toBe(
          OPEN_PARENT_REFUSAL,
        );
      }
    }
    // The accepting control: the first exception alone still goes through.
    await inTx((tx) => tx.update(workingOrderLines).set({ servedQuantity: 1000 }).where(byLine));
  });
});
