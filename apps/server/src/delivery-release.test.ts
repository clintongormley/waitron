import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { captureError, TRANSITION_REFUSAL, triggerRaised, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { releaseDeliveries } from "./delivery-release.js";
import { orderTableLabel } from "./kitchen-print.js";
import { listOrders } from "./orders-list.js";
import { readReceiptOrder } from "./receipt-order.js";
import {
  billRow,
  inTx,
  OPERATOR,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { collectOrder, payWorkingOrder } from "./till-sale.js";
import { abandonHeldOrder, createOpenOrder, handOverOrder, placeOrder } from "./working-order.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

/**
 * A counter order of one Burger delivered to `tableId`, paid in cash; paying fires the dish. The
 * order takes the delivery table's zone, so the table must sit in a prepay zone.
 */
async function settledDelivery(v: PartyVenue, tableId: string): Promise<string> {
  const id = randomUUID();
  await inTx(v, (tx) =>
    createOpenOrder(tx, v.cfg, id, [{ menuItemId: v.counterItem("Burger"), quantity: "1" }], null, {
      deliveryTableId: tableId,
      zoneId: v.counter.zoneId,
    }),
  );
  await payWorkingOrder({ db: v.db, backend: v.backend, clock: v.clock }, v.cfg, {
    id,
    lines: [],
    tender: { method: "cash", amount: "12.00" },
  });
  return id;
}

/** A table in the counter zone. */
function deliveryTable(v: PartyVenue, label: string): Promise<string> {
  return v.table(label, v.counter.zoneId);
}

describe("releaseDeliveries", () => {
  it("lets go of the table on a settled, collected order and keeps its name", async () => {
    const v = await setupPartyVenue(suite.db);
    const t4 = await deliveryTable(v, "Terrace 4");
    const id = await settledDelivery(v, t4);
    await inTx(v, (tx) => handOverOrder(tx, v.cfg, id));

    await inTx(v, (tx) => releaseDeliveries(tx, t4, "Terrace 4"));

    const row = await billRow(v, id);
    expect(row.status).toBe("settled");
    expect(row.collectedAt).not.toBeNull();
    expect(row.deliveryTableId).toBeNull();
    expect(row.deliveryTableLabel).toBe("Terrace 4");
  });

  it("lets go of the table on a settled order never collected, and on an abandoned one", async () => {
    const v = await setupPartyVenue(suite.db);
    const t5 = await deliveryTable(v, "Terrace 5");
    const settled = await settledDelivery(v, t5);
    const abandoned = randomUUID();
    await inTx(v, (tx) =>
      createOpenOrder(
        tx,
        v.cfg,
        abandoned,
        [{ menuItemId: v.counterItem("Agua"), quantity: "1" }],
        null,
        { deliveryTableId: t5, zoneId: v.counter.zoneId },
      ),
    );
    await abandonHeldOrder({ db: v.db }, v.cfg, abandoned);
    const elsewhere = await settledDelivery(v, await deliveryTable(v, "Terrace 6"));

    await inTx(v, (tx) => releaseDeliveries(tx, t5, "Terrace 5"));

    const never = await billRow(v, settled);
    expect(never).toMatchObject({
      status: "settled",
      collectedAt: null,
      deliveryTableId: null,
      deliveryTableLabel: "Terrace 5",
    });
    expect(await billRow(v, abandoned)).toMatchObject({
      status: "abandoned",
      deliveryTableId: null,
      deliveryTableLabel: "Terrace 5",
    });
    expect((await billRow(v, elsewhere)).deliveryTableLabel).toBeNull();
  });

  it.each([
    ["the name alone", "delivery_table_label = 'X'"],
    ["the link without a name", "delivery_table_id = null"],
    [
      "the release with another column",
      "delivery_table_id = null, delivery_table_label = 'X', order_number = 99",
    ],
    [
      "the handover stamp with the name",
      "collected_at = '2026-10-10T12:00:00.000Z', delivery_table_label = 'X'",
    ],
  ])("refuses %s on a settled order", async (_name, set) => {
    const v = await setupPartyVenue(suite.db);
    const id = await settledDelivery(v, await deliveryTable(v, `T-${randomUUID().slice(0, 8)}`));

    const refusal = await captureError(() =>
      withTransaction(v.db, (tx) =>
        tx.run(sql.raw(`update working_orders set ${set} where id = '${id}'`)),
      ),
    );

    expect(triggerRaised(refusal, TRANSITION_REFUSAL)).toBe(true);
    const row = await billRow(v, id);
    expect(row.deliveryTableId).not.toBeNull();
    expect(row.deliveryTableLabel).toBeNull();
  });
});

describe("an order whose delivery table was let go", () => {
  it("is still listed at the table, not as a counter order", async () => {
    const v = await setupPartyVenue(suite.db);
    const t4 = await deliveryTable(v, "Terrace 4");
    const id = await settledDelivery(v, t4);
    await inTx(v, (tx) => handOverOrder(tx, v.cfg, id));

    await inTx(v, (tx) => releaseDeliveries(tx, t4, "Terrace 4"));

    const page = await inTx(v, (tx) =>
      listOrders(tx, { status: "all", dates: "any", credited: false, limit: 50, scope: "all" }),
    );
    expect(page.rows.find((order) => order.id === id)).toMatchObject({
      tables: ["Terrace 4"],
      counter: false,
    });
  });

  it("is named after the table on kitchen paper and its receipt, and keeps the name once paid", async () => {
    const v = await setupPartyVenue(suite.db);
    await inTx(v, async (tx) => {
      await tx.execute(sql`
        update zone_sale_policies set paid_when = 'ticket_then_pay'
        where zone_id = ${v.counter.zoneId}`);
    });
    const t7 = await deliveryTable(v, "Terrace 7");
    const id = randomUUID();
    await inTx(v, (tx) =>
      createOpenOrder(
        tx,
        v.cfg,
        id,
        [{ menuItemId: v.counterItem("Burger"), quantity: "1" }],
        null,
        {
          deliveryTableId: t7,
          zoneId: v.counter.zoneId,
        },
      ),
    );
    const deps = { db: v.db, backend: v.backend, clock: v.clock };
    await placeOrder(deps, v.cfg, id, OPERATOR);
    await inTx(v, (tx) => handOverOrder(tx, v.cfg, id));
    await inTx(v, (tx) => releaseDeliveries(tx, t7, "Terrace 7"));

    expect(await inTx(v, (tx) => orderTableLabel(tx, v.cfg, id))).toBe("Terrace 7");
    expect((await inTx(v, (tx) => readReceiptOrder(tx, v.cfg, id))).orderLabel).toBe("Terrace 7");

    await collectOrder(deps, v.cfg, { id, lines: [], tender: { method: "cash", amount: "12.00" } });

    expect(await billRow(v, id)).toMatchObject({
      status: "settled",
      deliveryTableId: null,
      label: "Terrace 7",
    });
  });
});
