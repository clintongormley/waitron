import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTransaction, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { releaseDeliveries } from "./delivery-release.js";
import { billRow, inTx, setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";
import { createStation } from "./kitchen.js";
import { routeProductTo } from "./testing/zone-offers.js";
import { payWorkingOrder } from "./till-sale.js";
import {
  abandonHeldOrder,
  createOpenOrder,
  fireableLineColumns,
  fireLines,
  handOverOrder,
} from "./working-order.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const TRANSITION_REFUSAL = "working order cannot make that transition";

/** A counter order of one Burger delivered to `tableId`, optionally fired, paid in cash. */
async function settledDelivery(v: PartyVenue, tableId: string, fired = false): Promise<string> {
  const id = randomUUID();
  await inTx(v, async (tx) => {
    await createOpenOrder(
      tx,
      v.cfg,
      id,
      [{ menuItemId: v.counterItem("Burger"), quantity: "1" }],
      null,
      { deliveryTableId: tableId, zoneId: v.counter.zoneId },
    );
    if (fired) {
      const lines = await tx
        .select(fireableLineColumns)
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, id));
      await fireLines(tx, v.cfg, id, lines);
    }
  });
  await payWorkingOrder({ db: v.db, backend: v.backend, clock: v.clock }, v.cfg, {
    id,
    lines: [],
    tender: { method: "cash", amount: "12.00" },
  });
  return id;
}

describe("releaseDeliveries", () => {
  it("lets go of the table on a settled, collected order and keeps its name", async () => {
    const v = await setupPartyVenue(suite.db);
    await inTx(v, async (tx) => {
      const kitchen = (await createStation(tx, v.cfg, { name: "Kitchen" })).id;
      await routeProductTo(tx, v.cfg, v.productId("Burger"), kitchen);
    });
    const t4 = await v.table("Terrace 4");
    const id = await settledDelivery(v, t4, true);
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
    const t5 = await v.table("Terrace 5");
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
    const elsewhere = await settledDelivery(v, await v.table("Terrace 6"));

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
    const id = await settledDelivery(v, await v.table(`T-${randomUUID().slice(0, 8)}`));

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
