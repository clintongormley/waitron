import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { adjustmentRefunds, adjustments } from "@waitron/adjustments";
import {
  parties,
  sales,
  tenderRefunds,
  tenders,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setRoutingCell } from "@waitron/venue-service";
import { applyAdjustment } from "./adjustments-apply.js";
import { readBillEditState } from "./bill-editing.js";
import { createStation } from "./kitchen.js";
import { cancelItem, type CancelItemAsk } from "./line-cancel.js";
import { readCancellationContext } from "./line-cancel-context.js";
import { fingerprint } from "./parties.js";
import { reserveTenderRefund } from "./tender-refund-reservation.js";
import {
  billWith,
  inTx,
  PINS,
  provisionAdjustmentVenue,
  type AdjustmentVenue,
  type RoundLine,
} from "./testing/adjustment-venue.js";
import { send } from "./testing/bill-venue.js";
import { payWorkingOrder } from "./testing/whole-payment-fixture.js";
import { advanceTicketItem } from "./working-order.js";

let venue: AdjustmentVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionAdjustmentVenue(db);
    await inTx(venue, async (tx) => {
      const station = await createStation(tx, venue.cfg, { name: "Extra preparation" });
      await setRoutingCell(
        tx,
        venue.cfg,
        { row: { kind: "product", productId: venue.olivesId }, zoneId: null },
        { kind: "station", stationId: station.id },
      );
    });
  },
});

interface Bill {
  partyId: string;
  billId: string;
  lineIds: string[];
}

async function bill(lines: RoundLine[], release: "fire" | "hold" = "hold"): Promise<Bill> {
  const order = await billWith(venue, lines, { release });
  const rows = await venue.db
    .select({ id: workingOrderLines.id, parent: workingOrderLines.parentLineId })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, order.billId))
    .orderBy(workingOrderLines.lineNo);
  return { ...order, lineIds: rows.filter((row) => row.parent === null).map((row) => row.id) };
}

async function pay(b: Bill, amount: string) {
  await payWorkingOrder({ db: venue.db, backend: venue.backend, clock: venue.clock }, venue.cfg, {
    id: b.billId,
    tender: { method: "cash", amount },
    lines: [],
  });
  const [sale] = await venue.db.select().from(sales).where(eq(sales.workingOrderId, b.billId));
  const [tender] = await venue.db.select().from(tenders).where(eq(tenders.saleId, sale!.id));
  return { saleId: sale!.id, tenderId: tender!.id };
}

/** A still-charge cancel of `quantity` of the line; `refundHandoff` is the Refund tick. */
async function cancel(b: Bill, lineId: string, quantity: string, refundHandoff: boolean) {
  const answer = await inTx(venue, async (tx) => {
    const [party] = await tx.select().from(parties).where(eq(parties.id, b.partyId));
    const [order] = await tx.select().from(workingOrders).where(eq(workingOrders.id, b.billId));
    const ask: CancelItemAsk = {
      quantity,
      expectedEdit: await readBillEditState(tx, b.billId),
      outcome: "keep_charge",
      reasonId: venue.reasonId.houseVoid,
      expectedPartyRevision: party!.revision,
      expectedBillRevision: order!.revision,
      expectedContext: await readCancellationContext(tx, b.partyId, lineId),
      submissionId: randomUUID(),
      ...(refundHandoff ? { refundHandoff: true } : {}),
    };
    return cancelItem(tx, venue.cfg, b.partyId, lineId, ask, venue.managerId);
  });
  const linked = answer.refundLinks?.[0]?.adjustmentId;
  if (linked !== undefined) return linked;
  const rows = await venue.db.select().from(adjustments).where(eq(adjustments.lineId, lineId));
  return rows.filter((row) => row.action === "cancel").at(-1)!.id;
}

function refundBody(
  paid: { tenderId: string },
  appliedAmount: string,
  cancellationIds?: unknown,
  submissionId = randomUUID(),
) {
  return {
    submissionId,
    tenderId: paid.tenderId,
    appliedAmount,
    tipAmount: "0.00",
    reason: "Dish never served",
    cashConfirmed: true,
    ...(cancellationIds === undefined ? {} : { cancellationIds }),
  };
}

function refund(paid: { saleId: string }, body: unknown) {
  return send(
    venue.app,
    venue.cookie.manager,
    "POST",
    `/api/transactions/${paid.saleId}/refunds`,
    body,
  );
}

async function linksOf(refundId: string) {
  const rows = await venue.db
    .select()
    .from(adjustmentRefunds)
    .where(eq(adjustmentRefunds.tenderRefundId, refundId));
  return rows.map((row) => ({ adjustmentId: row.adjustmentId, amount: row.amount }));
}

async function ledgers() {
  return {
    refunds: await venue.db.select().from(tenderRefunds).orderBy(tenderRefunds.id),
    links: await venue.db
      .select()
      .from(adjustmentRefunds)
      .orderBy(adjustmentRefunds.tenderRefundId, adjustmentRefunds.adjustmentId),
  };
}

/** A paid table of a Burger (€12.00), a Ham (€24.00) and a Steak (€25.00); Burger then Ham are
 * cancelled with the Refund tick. */
async function twoCancels() {
  const b = await bill([{ name: "Burger" }, { name: "Ham" }, { name: "Steak" }]);
  const paid = await pay(b, "61.00");
  const burger = await cancel(b, b.lineIds[0]!, "1", true);
  const ham = await cancel(b, b.lineIds[1]!, "1", true);
  return { b, paid, burger, ham };
}

describe("a refund names the cancels it pays back", () => {
  it("splits a refund across the cancels it names, in the order sent", async () => {
    const { paid, burger, ham } = await twoCancels();
    const answer = await refund(paid, refundBody(paid, "30.00", [ham, burger]));
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const id = (answer.json as { id: string }).id;
    expect(await linksOf(id)).toEqual([
      { adjustmentId: ham, amount: 2400 },
      { adjustmentId: burger, amount: 600 },
    ]);
  });

  it("a second refund naming the same cancels links only what is left", async () => {
    const { paid, burger, ham } = await twoCancels();
    const first = await refund(paid, refundBody(paid, "30.00", [ham, burger]));
    expect((first.json as { state: string }).state).toBe("completed");
    const second = await refund(paid, refundBody(paid, "20.00", [ham, burger]));
    expect(second.status, JSON.stringify(second.json)).toBe(200);
    expect(await linksOf((second.json as { id: string }).id)).toEqual([
      { adjustmentId: burger, amount: 600 },
    ]);
  });

  it("a failed refund frees what it held", async () => {
    const { paid, burger, ham } = await twoCancels();
    const held = await inTx(venue, async (tx) =>
      reserveTenderRefund(
        tx,
        venue.cfg,
        paid.saleId,
        { ...refundBody(paid, "30.00"), cancellationIds: [ham, burger] },
        { requestedBy: venue.managerId, authorizedBy: venue.managerId },
        new Date().toISOString(),
      ),
    );
    expect(held.cancelsCanStillTake).toBe("36.00");
    expect(await linksOf(held.refund.id)).toEqual([
      { adjustmentId: ham, amount: 2400 },
      { adjustmentId: burger, amount: 600 },
    ]);
    await venue.db
      .update(tenderRefunds)
      .set({ state: "failed", failedAt: new Date().toISOString() })
      .where(eq(tenderRefunds.id, held.refund.id));
    const answer = await refund(paid, refundBody(paid, "36.00", [burger, ham]));
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await linksOf((answer.json as { id: string }).id)).toEqual([
      { adjustmentId: burger, amount: 1200 },
      { adjustmentId: ham, amount: 2400 },
    ]);
  });

  it("caps part-cancels of one line by what the till showed", async () => {
    const b = await bill([{ name: "Burger", quantity: "3" }]);
    const paid = await pay(b, "36.00");
    const one = await cancel(b, b.lineIds[0]!, "1", true);
    const two = await cancel(b, b.lineIds[0]!, "1", true);
    const caps = await venue.db
      .select({ id: adjustments.id, refundValue: adjustments.refundValue })
      .from(adjustments)
      .where(eq(adjustments.lineId, b.lineIds[0]!));
    expect(Object.fromEntries(caps.map((row) => [row.id, row.refundValue]))).toEqual({
      [one]: 1200,
      [two]: 1200,
    });
    const answer = await refund(paid, refundBody(paid, "20.00", [one, two]));
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await linksOf((answer.json as { id: string }).id)).toEqual([
      { adjustmentId: one, amount: 1200 },
      { adjustmentId: two, amount: 800 },
    ]);
  });

  describe("refuses cancels the refund cannot name", () => {
    async function refused(paid: { saleId: string; tenderId: string }, ids: unknown) {
      const before = await ledgers();
      const answer = await refund(paid, refundBody(paid, "5.00", ids));
      expect(answer.status, JSON.stringify(answer.json)).toBe(400);
      expect(answer.json).toEqual({
        code: "management.request_invalid",
        params: { field: "cancellationIds" },
      });
      expect(await ledgers()).toEqual(before);
    }

    it("a cancel of another sale", async () => {
      const { paid } = await twoCancels();
      const other = await twoCancels();
      await refused(paid, [other.burger]);
    });

    it("a comp row", async () => {
      const b = await bill([{ name: "Burger" }, { name: "Ham" }]);
      const comp = await inTx(venue, async (tx) => {
        const [order] = await tx.select().from(workingOrders).where(eq(workingOrders.id, b.billId));
        await applyAdjustment(
          tx,
          venue.cfg,
          {
            expectedEdit: await readBillEditState(tx, b.billId),
            orderId: b.billId,
            expectedRevision: order!.revision,
            lineId: b.lineIds[0]!,
            reasonId: venue.reasonId.house,
            action: "comp",
            note: null,
            operatorId: venue.staffId,
            submissionId: randomUUID(),
          },
          venue.cfg.locale,
        );
        const [row] = await tx
          .select({ id: adjustments.id })
          .from(adjustments)
          .where(eq(adjustments.lineId, b.lineIds[0]!));
        return row!.id;
      });
      const paid = await pay(b, "24.00");
      await refused(paid, [comp]);
    });

    it("a paid-bill cancel with nothing ticked", async () => {
      const b = await bill([{ name: "Burger" }, { name: "Ham" }]);
      const paid = await pay(b, "36.00");
      await refused(paid, [await cancel(b, b.lineIds[0]!, "1", false)]);
    });

    it("a still-charge cancel made while the bill was unpaid, the bill paid after", async () => {
      const b = await bill([{ name: "Burger" }, { name: "Ham" }], "fire");
      await inTx(venue, async (tx) => {
        const [ticket] = await tx
          .select({ id: ticketItems.id })
          .from(ticketItems)
          .where(eq(ticketItems.workingOrderLineId, b.lineIds[0]!));
        await advanceTicketItem(tx, venue.cfg, ticket!.id, "preparing");
      });
      const early = await cancel(b, b.lineIds[0]!, "1", true);
      const [row] = await venue.db.select().from(adjustments).where(eq(adjustments.id, early));
      expect(row).toMatchObject({ chargeKept: true, refundHandoff: false });
      const paid = await pay(b, "36.00");
      await refused(paid, [early]);
    });

    it("an unknown id", async () => {
      const { paid, burger } = await twoCancels();
      await refused(paid, [burger, randomUUID()]);
    });

    it("a repeated id", async () => {
      const { paid, burger } = await twoCancels();
      await refused(paid, [burger, burger.toUpperCase()]);
    });

    it.each([
      ["not a list", "x"],
      ["an empty list", []],
      ["not a UUID", ["not-a-uuid"]],
      ["more than 100", Array.from({ length: 101 }, () => randomUUID())],
    ])("a malformed list (%s)", async (_label, ids) => {
      const { paid } = await twoCancels();
      await refused(paid, ids);
    });

    it("a cancel whose line has no filed value", async () => {
      const b = await bill([{ name: "Pizza", quantity: "3", olives: 2 }]);
      const paid = await pay(b, "36.00");
      const [extra] = await venue.db
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.parentLineId, b.lineIds[0]!));
      await inTx(venue, async (tx) => {
        // The stored copy drifting from the filed sale stands in for any line the sale cannot value.
        const name = "working_order_lines_require_open_parent_update";
        const [trigger] = tx.all<{ sql: string }>(
          sql`select sql from sqlite_master where type = 'trigger' and name = ${name}`,
        );
        tx.run(sql.raw(`drop trigger ${name}`));
        await tx
          .update(workingOrderLines)
          .set({ quantity: 5000 })
          .where(eq(workingOrderLines.id, extra!.id));
        tx.run(sql.raw(trigger!.sql));
      });
      const id = await cancel(b, b.lineIds[0]!, "1", true);
      const [row] = await venue.db.select().from(adjustments).where(eq(adjustments.id, id));
      expect(row).toMatchObject({ refundHandoff: true, refundValue: null });
      await refused(paid, [id]);
    });
  });

  it("accepts an upper-case id as the same cancel", async () => {
    const { paid, burger } = await twoCancels();
    const answer = await refund(paid, refundBody(paid, "5.00", [burger.toUpperCase()]));
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await linksOf((answer.json as { id: string }).id)).toEqual([
      { adjustmentId: burger, amount: 500 },
    ]);
  });

  it("replays a linked refund without linking twice", async () => {
    const { paid, burger, ham } = await twoCancels();
    const body = refundBody(paid, "30.00", [ham, burger]);
    const first = await refund(paid, body);
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    const before = await ledgers();
    const again = await refund(paid, body);
    expect(again.json).toEqual(first.json);
    expect(await ledgers()).toEqual(before);
  });

  it("replays the same submission naming the same cancels in another order", async () => {
    const { paid, burger, ham } = await twoCancels();
    const submissionId = randomUUID();
    const first = await refund(paid, refundBody(paid, "30.00", [ham, burger], submissionId));
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    const before = await ledgers();
    const again = await refund(paid, refundBody(paid, "30.00", [burger, ham], submissionId));
    expect(again.json).toEqual(first.json);
    expect(await ledgers()).toEqual(before);
  });

  it("refuses the same submission with other cancels as reused", async () => {
    const { paid, burger, ham } = await twoCancels();
    const submissionId = randomUUID();
    const first = await refund(paid, refundBody(paid, "10.00", [ham], submissionId));
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    const before = await ledgers();
    const again = await refund(paid, refundBody(paid, "10.00", [ham, burger], submissionId));
    expect(again.status).toBe(409);
    expect(again.json).toMatchObject({ code: "submission.id_reused" });
    expect(await ledgers()).toEqual(before);
  });

  it("a refund naming no cancels links nothing and fingerprints as before", async () => {
    const { paid } = await twoCancels();
    const body = refundBody(paid, "10.00");
    const answer = await refund(paid, body);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const id = (answer.json as { id: string }).id;
    expect(await linksOf(id)).toEqual([]);
    const [row] = await venue.db.select().from(tenderRefunds).where(eq(tenderRefunds.id, id));
    expect(row!.fingerprint).toBe(
      fingerprint({
        saleId: paid.saleId,
        tenderId: paid.tenderId,
        appliedAmount: "10.00",
        tipAmount: "0.00",
        reason: "Dish never served",
        cashConfirmed: true,
        manualConfirmed: false,
      }),
    );
  });
});

describe("a PIN-approved linked refund cannot exceed its cancels", () => {
  const managerPin = () => ({ personId: venue.managerId, pin: PINS.manager });

  function staffRefund(paid: { saleId: string }, body: object) {
    return send(venue.app, venue.cookie.staff, "POST", `/api/transactions/${paid.saleId}/refunds`, {
      ...body,
      override: managerPin(),
    });
  }

  /** A paid table of a Burger (€12.00) and a Steak (€25.00); the Burger is cancelled with the
   * Refund tick. With `tipped`, the table is the Burger alone and its cash tender carries a €1.00
   * tip. */
  async function oneCancel(tipped = false) {
    const b = await bill(tipped ? [{ name: "Burger" }] : [{ name: "Burger" }, { name: "Steak" }]);
    const paid = await pay(b, tipped ? "12.00" : "37.00");
    if (tipped)
      await inTx(venue, async (tx) => {
        // A till takes a tip only on a connected card; a tip on this cash tender stands in for it.
        const triggers = tx.all<{ name: string; sql: string }>(
          sql`select name, sql from sqlite_master where type = 'trigger' and tbl_name = 'tenders'`,
        );
        for (const trigger of triggers) tx.run(sql.raw(`drop trigger ${trigger.name}`));
        await tx
          .update(tenders)
          .set({ amount: 1300, tipAmount: 100, cashTendered: 1300 })
          .where(eq(tenders.id, paid.tenderId));
        for (const trigger of triggers) tx.run(sql.raw(trigger.sql));
      });
    return { paid, burger: await cancel(b, b.lineIds[0]!, "1", true) };
  }

  async function refusedOver(paid: { saleId: string; tenderId: string }, body: object) {
    const before = await ledgers();
    const answer = await staffRefund(paid, body);
    expect(answer.status, JSON.stringify(answer.json)).toBe(409);
    expect(answer.json).toEqual({
      code: "tender.refund_exceeds_cancelled",
      params: { tenderId: paid.tenderId, cancelled: expect.any(String) },
    });
    expect(await ledgers()).toEqual(before);
    return (answer.json as { params: { cancelled: string } }).params.cancelled;
  }

  it("refuses a PIN-approved linked refund €0.01 above its cancels", async () => {
    const { paid, burger } = await oneCancel();
    expect(await refusedOver(paid, refundBody(paid, "12.01", [burger]))).toBe("12.00");
  });

  it("and one with a tip", async () => {
    const { paid, burger } = await oneCancel(true);
    expect(
      await refusedOver(paid, { ...refundBody(paid, "12.00", [burger]), tipAmount: "1.00" }),
    ).toBe("12.00");
  });

  it("reserves and links one at its cancels' value", async () => {
    const { paid, burger } = await oneCancel();
    const answer = await staffRefund(paid, refundBody(paid, "12.00", [burger]));
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await linksOf((answer.json as { id: string }).id)).toEqual([
      { adjustmentId: burger, amount: 1200 },
    ]);
  });

  it("refuses a second one over what the first left", async () => {
    const { paid, burger } = await oneCancel();
    const first = await staffRefund(paid, refundBody(paid, "5.00", [burger]));
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    expect(await refusedOver(paid, refundBody(paid, "7.01", [burger]))).toBe("7.00");
    const second = await staffRefund(paid, refundBody(paid, "7.00", [burger]));
    expect(second.status, JSON.stringify(second.json)).toBe(200);
    expect(await linksOf((second.json as { id: string }).id)).toEqual([
      { adjustmentId: burger, amount: 700 },
    ]);
  });

  it("replays one it accepted", async () => {
    const { paid, burger } = await oneCancel();
    const body = refundBody(paid, "12.00", [burger]);
    const first = await staffRefund(paid, body);
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    const before = await ledgers();
    const again = await staffRefund(paid, body);
    expect(again.status, JSON.stringify(again.json)).toBe(200);
    expect(again.json).toEqual(first.json);
    expect(await ledgers()).toEqual(before);
  });

  it("does not cap a person who holds the refund permission", async () => {
    const { paid, burger } = await oneCancel();
    const answer = await refund(paid, refundBody(paid, "13.00", [burger]));
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await linksOf((answer.json as { id: string }).id)).toEqual([
      { adjustmentId: burger, amount: 1200 },
    ]);
  });

  it("accepts the till's amount after an earlier don't-charge cancel", async () => {
    const b = await bill([{ name: "Burger", quantity: "7" }], "fire");
    await inTx(venue, async (tx) => {
      const [party] = await tx.select().from(parties).where(eq(parties.id, b.partyId));
      const [order] = await tx.select().from(workingOrders).where(eq(workingOrders.id, b.billId));
      await cancelItem(
        tx,
        venue.cfg,
        b.partyId,
        b.lineIds[0]!,
        {
          quantity: "1",
          expectedEdit: await readBillEditState(tx, b.billId),
          outcome: "remove_charge",
          reasonId: venue.reasonId.houseVoid,
          expectedPartyRevision: party!.revision,
          expectedBillRevision: order!.revision,
          expectedContext: await readCancellationContext(tx, b.partyId, b.lineIds[0]!),
          submissionId: randomUUID(),
        },
        venue.managerId,
      );
    });
    const paid = await pay(b, "72.00");
    const cancelled = await cancel(b, b.lineIds[0]!, "1", true);
    const answer = await staffRefund(paid, refundBody(paid, "12.00", [cancelled]));
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await linksOf((answer.json as { id: string }).id)).toEqual([
      { adjustmentId: cancelled, amount: 1200 },
    ]);
  });
});
