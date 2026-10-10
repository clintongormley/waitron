import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { releaseDeliveries } from "./delivery-release.js";
import { billRow, inTx, setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";
import { payWorkingOrder } from "./till-sale.js";
import { abandonHeldOrder, createOpenOrder, handOverOrder } from "./working-order.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const TRANSITION_REFUSAL = "working order cannot make that transition";

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

    let refusal: { cause?: { message?: string } } | undefined;
    try {
      await withTransaction(v.db, (tx) =>
        tx.run(sql.raw(`update working_orders set ${set} where id = '${id}'`)),
      );
    } catch (error) {
      refusal = error as typeof refusal;
    }

    expect(refusal?.cause?.message).toContain(TRANSITION_REFUSAL);
    const row = await billRow(v, id);
    expect(row.deliveryTableId).not.toBeNull();
    expect(row.deliveryTableLabel).toBeNull();
  });
});
