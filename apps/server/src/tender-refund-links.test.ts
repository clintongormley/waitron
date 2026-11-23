import { testTradingAdmission } from "./testing/trading-admission.js";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";
import { adjustmentRefunds, adjustments } from "@waitron/adjustments";
import {
  devices,
  deviceProfiles,
  drawerOpens,
  printers,
  parties,
  printJobs,
  saleLines,
  sales,
  refunds,
  tenders,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { previewCorrectionAmounts } from "@waitron/core";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { decimal, saleId as brandSaleId } from "@waitron/shared";
import { setRoutingCell } from "@waitron/venue-service";
import { applyAdjustment } from "./adjustments-apply.js";
import { recordAttendanceFact } from "./attendance-capture.js";
import { readBillEditState } from "./bill-editing.js";
import { createStation } from "./kitchen.js";
import { cancelItem, type CancelItemCommand } from "./line-cancel.js";
import { readCancellationContext } from "./line-cancel-context.js";
import { openInvoiceCorrection, parseInvoiceCorrection } from "./invoice-corrections.js";
import { fingerprint } from "./parties.js";
import { reserveTenderRefund } from "./tender-refund-reservation.js";
import {
  billWith,
  inTx,
  PINS,
  provisionAdjustmentVenue,
  todayLine,
  type AdjustmentVenue,
  type RoundLine,
} from "./testing/adjustment-venue.js";
import { cashPayment, send } from "./testing/bill-venue.js";

import { advanceTicketItem } from "./working-order.js";

let venue: AdjustmentVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionAdjustmentVenue(db);
    await inTx(venue, async (tx) => {
      const station = await createStation(tx, { name: "Extra preparation" });
      await setRoutingCell(
        tx,
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
  const paid = await cashPayment(venue, venue.cookie.staff, b.billId, amount);
  expect(paid.status, JSON.stringify(paid.json)).toBe(200);
  const [sale] = await venue.db.select().from(sales).where(eq(sales.workingOrderId, b.billId));
  const [tender] = await venue.db.select().from(tenders).where(eq(tenders.saleId, sale!.id));
  return { saleId: sale!.id, tenderId: tender!.id };
}

/** A still-charge cancel of `quantity` of the row; `refundHandoff` is the Refund tick. */
async function cancel(
  b: Bill,
  row: { lineId: string; lineIds?: string[] },
  quantity: string,
  refundHandoff: boolean,
  authority?: { requestedBy: string; approvedBy?: string },
) {
  const { lineId, lineIds } = row;
  const answer = await inTx(venue, async (tx) => {
    const [party] = await tx.select().from(parties).where(eq(parties.id, b.partyId));
    const [order] = await tx.select().from(workingOrders).where(eq(workingOrders.id, b.billId));
    const ask: Omit<CancelItemCommand, "admission"> = {
      quantity,
      expectedEdit: await readBillEditState(tx, b.billId),
      outcome: "keep_charge",
      reasonId: venue.reasonId.houseVoid,
      expectedPartyRevision: party!.revision,
      expectedBillRevision: order!.revision,
      expectedContext: await readCancellationContext(tx, b.partyId, lineId, lineIds),
      ...(lineIds === undefined ? {} : { lineIds }),
      submissionId: randomUUID(),
      ...(refundHandoff ? { refundHandoff: true } : {}),
      ...(authority?.approvedBy === undefined ? {} : { refundApprovedBy: authority.approvedBy }),
    };
    return cancelItem(
      tx,
      venue.cfg,
      b.partyId,
      lineId,
      { ...ask, admission: testTradingAdmission() },
      authority?.requestedBy ?? venue.managerId,
    );
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
    .where(eq(adjustmentRefunds.refundId, refundId));
  return rows.map((row) => ({ adjustmentId: row.adjustmentId, amount: row.amount }));
}

async function ledgers() {
  return {
    refunds: await venue.db.select().from(refunds).orderBy(refunds.id),
    links: await venue.db
      .select()
      .from(adjustmentRefunds)
      .orderBy(adjustmentRefunds.refundId, adjustmentRefunds.adjustmentId),
  };
}

async function written() {
  return {
    ...(await ledgers()),
    drawerJobs: (await venue.db.select().from(printJobs)).filter((row) => row.kind === "drawer"),
  };
}

/** Sends `body` and expects `tender.refund_needs_correction`, with no refund, link or drawer job
 * written. */
async function refusedNeedsCorrection(
  paid: { saleId: string; tenderId: string },
  body: object,
  sendIt: (paid: { saleId: string }, body: object) => ReturnType<typeof send> = refund,
) {
  const before = await written();
  const answer = await sendIt(paid, body);
  expect(answer.status, JSON.stringify(answer.json)).toBe(409);
  expect(answer.json).toEqual({
    code: "tender.refund_needs_correction",
    params: { tenderId: paid.tenderId },
  });
  expect(await written()).toEqual(before);
}

/** Has the unpaid bill's invoice name a customer: a full invoice, which Correct invoice refuses. */
async function chooseCustomer(b: Bill) {
  const [taxpayer] = venue.db.all<{ domicile: string | null }>(
    sql`select taxpayer_domicile as domicile from taxpayer`,
  );
  venue.db.run(sql`update taxpayer set taxpayer_domicile = 'Calle Fiscal 8, Madrid'`);
  onTestFinished(() => {
    venue.db.run(sql`update taxpayer set taxpayer_domicile = ${taxpayer!.domicile}`);
  });
  const { editorVersion, draftId, draftRevision } = await inTx(venue, (tx) =>
    readBillEditState(tx, b.billId),
  );
  const [order] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, b.billId));
  const chosen = await send(
    venue.app,
    venue.cookie.manager,
    "PUT",
    `/api/working-orders/${b.billId}/invoice-choice`,
    {
      revision: order!.revision,
      invoiceType: "F1",
      recipient: {
        taxId: "B12345674",
        legalName: "Harbour Foods",
        address: "2 Main Street, 28013 Madrid, Madrid",
        countryCode: "ES",
      },
      expectedEdit: { billId: b.billId, editorVersion, draftId, draftRevision },
    },
  );
  expect(chosen.status, JSON.stringify(chosen.json)).toBe(200);
}

/** A paid table of a Burger (€12.00), a Ham (€24.00) and a Steak (€25.00); Burger then Ham are
 * cancelled with the Refund tick. */
async function twoCancels() {
  const b = await bill([{ name: "Burger" }, { name: "Ham" }, { name: "Steak" }]);
  const paid = await pay(b, "61.00");
  const burger = await cancel(b, await todayLine(venue, b.billId, 1), "1", true);
  const ham = await cancel(b, await todayLine(venue, b.billId, 2), "1", true);
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

  it("a second refund naming the same cancels takes only what they still owe", async () => {
    const { paid, burger, ham } = await twoCancels();
    const first = await refund(paid, refundBody(paid, "30.00", [ham, burger]));
    expect((first.json as { state: string }).state).toBe("completed");
    await refusedNeedsCorrection(paid, refundBody(paid, "20.00", [ham, burger]));
    const second = await refund(paid, refundBody(paid, "6.00", [ham, burger]));
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
        { backend: venue.backend, reading: venue.clock.now() },
      ),
    );
    expect(held.cancelsCanStillTake).toBe("36.00");
    expect(await linksOf(held.refund.id)).toEqual([
      { adjustmentId: ham, amount: 2400 },
      { adjustmentId: burger, amount: 600 },
    ]);
    await venue.db
      .update(refunds)
      .set({ state: "failed", failedAt: new Date().toISOString() })
      .where(eq(refunds.id, held.refund.id));
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
    const one = await cancel(b, await todayLine(venue, b.billId, 1), "1", true);
    const two = await cancel(b, await todayLine(venue, b.billId, 1), "1", true);
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
      const burger = await todayLine(venue, b.billId, 1);
      const comp = await inTx(venue, async (tx) => {
        const [order] = await tx.select().from(workingOrders).where(eq(workingOrders.id, b.billId));
        await applyAdjustment(
          tx,
          venue.cfg,
          {
            admission: testTradingAdmission(),
            expectedEdit: await readBillEditState(tx, b.billId),
            orderId: b.billId,
            expectedRevision: order!.revision,
            ...burger,
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
      await refused(paid, [await cancel(b, await todayLine(venue, b.billId, 1), "1", false)]);
    });

    it("a still-charge cancel made while the bill was unpaid, the bill paid after", async () => {
      const b = await bill([{ name: "Burger" }, { name: "Ham" }], "fire");
      await inTx(venue, async (tx) => {
        const [ticket] = await tx
          .select({ id: ticketItems.id })
          .from(ticketItems)
          .where(eq(ticketItems.workingOrderLineId, b.lineIds[0]!));
        await advanceTicketItem(tx, ticket!.id, "preparing");
      });
      const early = await cancel(b, await todayLine(venue, b.billId, 1), "1", true);
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
      // On portions the drifted extra sets its pizza apart from the other two: a row of its own.
      const id = await cancel(b, { lineId: b.lineIds[0]! }, "1", true);
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

  it("a refund naming no cancels links to the cancels still owed and fingerprints as before", async () => {
    const { paid, burger } = await twoCancels();
    const body = refundBody(paid, "10.00");
    const answer = await refund(paid, body);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const id = (answer.json as { id: string }).id;
    expect(await linksOf(id)).toEqual([{ adjustmentId: burger, amount: 1000 }]);
    const [row] = await venue.db.select().from(refunds).where(eq(refunds.id, id));
    expect(row!.fingerprint).toBe(
      fingerprint({
        saleId: paid.saleId,
        tenderId: paid.tenderId,
        appliedAmount: "10.00",
        tipAmount: "0.00",
        reason: "Dish never served",
        manualConfirmed: false,
      }),
    );
  });
});

const managerPin = () => ({ personId: venue.managerId, pin: PINS.manager });

function staffRefund(paid: { saleId: string }, body: object) {
  return send(
    venue.app,
    venue.cookie.staff,
    "POST",
    `/api/transactions/${paid.saleId}/refunds`,
    body,
  );
}

describe("server-held cancellation approval bounds a linked refund", () => {
  /** A paid table of a Burger (€12.00) and a Steak (€25.00); the Burger is cancelled with the
   * Refund tick. With `tipped`, the table is the Burger alone and its cash tender carries a €1.00
   * tip; with `customer`, its invoice names a customer, which Correct invoice cannot correct. */
  async function oneCancel(tipped = false, customer = false) {
    const b = await bill(tipped ? [{ name: "Burger" }] : [{ name: "Burger" }, { name: "Steak" }]);
    if (customer) await chooseCustomer(b);
    const paid = await pay(b, tipped ? "12.00" : "37.00");
    if (tipped)
      await inTx(venue, async (tx) => {
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
    return { paid, burger: await cancel(b, await todayLine(venue, b.billId, 1), "1", true) };
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

  it("refuses a linked refund €0.01 above its cancels as Correct invoice's money, with or without approval", async () => {
    const { paid, burger } = await oneCancel();
    await refusedNeedsCorrection(paid, refundBody(paid, "12.01", [burger]), staffRefund);
    await refusedNeedsCorrection(
      paid,
      { ...refundBody(paid, "12.01", [burger]), override: managerPin() },
      staffRefund,
    );
  });

  it("refuses a linked refund without new approval above what its cancels owe on an invoice naming a customer", async () => {
    const { paid, burger } = await oneCancel(false, true);
    const first = await staffRefund(paid, refundBody(paid, "6.00", [burger]));
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    expect(await refusedOver(paid, refundBody(paid, "8.00", [burger]))).toBe("6.00");
  });

  it("refuses €8 naming a cancel that owes €6 as Correct invoice's money on a correctable invoice", async () => {
    const { paid, burger } = await oneCancel();
    const first = await staffRefund(paid, refundBody(paid, "6.00", [burger]));
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    await refusedNeedsCorrection(paid, refundBody(paid, "8.00", [burger]), staffRefund);
  });

  it("requires fresh approval for a tip without claiming the applied amount exceeds its cancels", async () => {
    const { paid, burger } = await oneCancel(true);
    const before = await ledgers();
    const answer = await staffRefund(paid, {
      ...refundBody(paid, "12.00", [burger]),
      tipAmount: "1.00",
    });
    expect(answer.status).toBe(403);
    expect(answer.json).toEqual({
      code: "authorization.not_permitted",
      params: { permission: "sale.refund" },
    });
    expect(await ledgers()).toEqual(before);
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
    await refusedNeedsCorrection(paid, refundBody(paid, "7.01", [burger]), staffRefund);
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

  it("retry uses the stored links without a PIN and preserves the original audit", async () => {
    const { paid, burger } = await oneCancel();
    const first = await staffRefund(paid, refundBody(paid, "12.00", [burger]));
    expect(first.status).toBe(200);
    const before = await ledgers();
    const retry = await send(
      venue.app,
      venue.cookie.staff,
      "POST",
      `/api/tender-refunds/${(first.json as { id: string }).id}/retry`,
      {},
    );
    expect(retry.status, JSON.stringify(retry.json)).toBe(200);
    expect(retry.json).toEqual(first.json);
    expect(await ledgers()).toEqual(before);
  });

  it("records the saved approver, not the staff requester, as refund and drawer authority", async () => {
    const [profile] = await venue.db
      .select({ id: deviceProfiles.id, capabilities: deviceProfiles.capabilities })
      .from(devices)
      .innerJoin(deviceProfiles, eq(devices.deviceProfileId, deviceProfiles.id))
      .where(eq(devices.id, venue.deviceId));
    await venue.db
      .update(deviceProfiles)
      .set({ capabilities: [...(profile!.capabilities as string[]), "open-cash-drawer"] })
      .where(eq(deviceProfiles.id, profile!.id));
    await venue.db
      .update(devices)
      .set({ cashDrawerPrinterId: venue.printerId })
      .where(eq(devices.id, venue.deviceId));
    await venue.db
      .update(printers)
      .set({ hasCashDrawer: true })
      .where(eq(printers.id, venue.printerId));
    const b = await bill([{ name: "Burger" }, { name: "Steak" }]);
    const paid = await pay(b, "37.00");
    const burger = await cancel(b, await todayLine(venue, b.billId, 1), "1", true, {
      requestedBy: venue.staffId,
      approvedBy: venue.managerId,
    });
    const answer = await staffRefund(paid, refundBody(paid, "12.00", [burger]));
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const id = (answer.json as { id: string }).id;
    const [row] = await venue.db.select().from(refunds).where(eq(refunds.id, id));
    expect(row).toMatchObject({ requestedBy: venue.staffId, authorizedBy: venue.managerId });
    const [drawer] = await venue.db
      .select()
      .from(drawerOpens)
      .where(eq(drawerOpens.tenderRefundId, id));
    expect(drawer).toMatchObject({
      personId: venue.staffId,
      authorizedBy: venue.managerId,
      viaOverride: true,
    });
  });

  it("requires fresh authority when contributing cancels have different approvers", async () => {
    const b = await bill([{ name: "Burger" }, { name: "Ham" }, { name: "Steak" }]);
    const paid = await pay(b, "61.00");
    const burger = await cancel(b, await todayLine(venue, b.billId, 1), "1", true);
    const ham = await cancel(b, await todayLine(venue, b.billId, 2), "1", true, {
      requestedBy: venue.supervisorId,
    });
    const before = await ledgers();
    const ask = refundBody(paid, "30.00", [burger, ham]);
    const refused = await staffRefund(paid, ask);
    expect(refused.json).toMatchObject({ code: "authorization.not_permitted" });
    expect(await ledgers()).toEqual(before);
    const approved = await staffRefund(paid, { ...ask, override: managerPin() });
    expect(approved.status, JSON.stringify(approved.json)).toBe(200);
    const id = (approved.json as { id: string }).id;
    const replay = await staffRefund(paid, ask);
    expect(replay.json).toMatchObject({ code: "authorization.not_permitted" });
    const retry = await send(
      venue.app,
      venue.cookie.staff,
      "POST",
      `/api/tender-refunds/${id}/retry`,
      {},
    );
    expect(retry.json).toMatchObject({ code: "authorization.not_permitted" });
    expect(await linksOf(id)).toEqual([
      { adjustmentId: burger, amount: 1200 },
      { adjustmentId: ham, amount: 1800 },
    ]);
  });

  it("replay and retry keep independent approval when it differs from the saved cancel approver", async () => {
    const { paid, burger } = await oneCancel();
    const ask = refundBody(paid, "12.00", [burger]);
    const approved = await staffRefund(paid, {
      ...ask,
      override: { personId: venue.supervisorId, pin: PINS.supervisor },
    });
    expect(approved.status, JSON.stringify(approved.json)).toBe(200);
    const id = (approved.json as { id: string }).id;
    const before = await ledgers();
    expect((await staffRefund(paid, ask)).json).toMatchObject({
      code: "authorization.not_permitted",
    });
    expect(
      (await send(venue.app, venue.cookie.staff, "POST", `/api/tender-refunds/${id}/retry`, {}))
        .json,
    ).toMatchObject({ code: "authorization.not_permitted" });
    expect(await ledgers()).toEqual(before);
  });

  it("fresh approval permits no amount above the cancels Correct invoice could give back", async () => {
    const { paid, burger } = await oneCancel();
    await refusedNeedsCorrection(
      paid,
      { ...refundBody(paid, "13.00", [burger]), override: managerPin() },
      staffRefund,
    );
  });

  it.each([true])(
    "fresh approval permits a tip, without granting saved replay authority (tip=%s)",
    async (tip) => {
      const { paid, burger } = await oneCancel(tip);
      const ask = {
        ...refundBody(paid, "12.00", [burger]),
        tipAmount: "1.00",
      };
      const answer = await staffRefund(paid, { ...ask, override: managerPin() });
      expect(answer.status, JSON.stringify(answer.json)).toBe(200);
      const id = (answer.json as { id: string }).id;
      expect(await linksOf(id)).toEqual([{ adjustmentId: burger, amount: 1200 }]);
      const before = await ledgers();
      expect((await staffRefund(paid, ask)).json).toMatchObject({
        code: "authorization.not_permitted",
      });
      const retry = await send(
        venue.app,
        venue.cookie.staff,
        "POST",
        `/api/tender-refunds/${id}/retry`,
        {},
      );
      expect(retry.json).toMatchObject({ code: "authorization.not_permitted" });
      expect(await ledgers()).toEqual(before);
    },
  );

  it("omitting the cancellation IDs grants no saved approval", async () => {
    const { paid } = await oneCancel();
    const before = await ledgers();
    const answer = await staffRefund(paid, refundBody(paid, "12.00"));
    expect(answer.status).toBe(403);
    expect(answer.json).toMatchObject({ code: "authorization.not_permitted" });
    expect(await ledgers()).toEqual(before);
  });

  it("caps a person who holds the refund permission at what Correct invoice would not take", async () => {
    const { paid, burger } = await oneCancel();
    await refusedNeedsCorrection(paid, refundBody(paid, "13.00", [burger]));
    const answer = await refund(paid, refundBody(paid, "12.00", [burger]));
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await linksOf((answer.json as { id: string }).id)).toEqual([
      { adjustmentId: burger, amount: 1200 },
    ]);
  });

  it("accepts the till's amount after an earlier don't-charge cancel", async () => {
    const b = await bill([{ name: "Burger", quantity: "7" }], "fire");
    const row = await todayLine(venue, b.billId, 1);
    await inTx(venue, async (tx) => {
      const [party] = await tx.select().from(parties).where(eq(parties.id, b.partyId));
      const [order] = await tx.select().from(workingOrders).where(eq(workingOrders.id, b.billId));
      await cancelItem(
        tx,
        venue.cfg,
        b.partyId,
        row.lineId,
        {
          admission: testTradingAdmission(),
          quantity: "1",
          expectedEdit: await readBillEditState(tx, b.billId),
          outcome: "remove_charge",
          reasonId: venue.reasonId.houseVoid,
          expectedPartyRevision: party!.revision,
          expectedBillRevision: order!.revision,
          expectedContext: await readCancellationContext(tx, b.partyId, row.lineId, row.lineIds),
          ...(row.lineIds === undefined ? {} : { lineIds: row.lineIds }),
          submissionId: randomUUID(),
        },
        venue.managerId,
      );
    });
    const paid = await pay(b, "72.00");
    const cancelled = await cancel(b, await todayLine(venue, b.billId, 1), "1", true);
    const answer = await staffRefund(paid, refundBody(paid, "12.00", [cancelled]));
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await linksOf((answer.json as { id: string }).id)).toEqual([
      { adjustmentId: cancelled, amount: 1200 },
    ]);
  });
});

describe("a correction's leg", () => {
  it("refuses to name a cancel it could pay back, and is taken without naming it", async () => {
    const { paid, burger } = await twoCancels();
    const saleId = brandSaleId(paid.saleId);
    const lineIds = (
      await venue.db
        .select({ id: saleLines.id })
        .from(saleLines)
        .where(eq(saleLines.saleId, saleId))
    ).map((line) => line.id);
    const expectedSplit = (
      await inTx(venue, (tx) =>
        previewCorrectionAmounts(tx, venue.backend, saleId, venue.cfg.nodeId, {
          gross: decimal("5.00"),
          lineIds,
        }),
      )
    ).vatBreakdown.map(({ rate, base, tax }) => ({ rate, base, tax }));
    const { correction } = await inTx(venue, (tx) =>
      openInvoiceCorrection(
        tx,
        { backend: venue.backend, clock: venue.clock, attendance: recordAttendanceFact },
        venue.cfg,
        saleId,
        parseInvoiceCorrection({
          submissionId: randomUUID(),
          gross: "5.00",
          lineIds,
          reasonId: venue.reasonId.houseVoid,
          expectedSplit,
        }),
        {
          personId: venue.managerId,
          authorization: {
            authorizedBy: venue.managerId,
            permission: "sale.rectify",
            viaOverride: false,
          },
        },
      ),
    );
    const leg = (cancellationIds?: string[]) =>
      inTx(venue, (tx) =>
        reserveTenderRefund(
          tx,
          venue.cfg,
          paid.saleId,
          {
            submissionId: randomUUID(),
            tenderId: paid.tenderId,
            appliedAmount: "5.00",
            tipAmount: "0.00",
            reason: "Dish never served",
            ...(cancellationIds === undefined ? {} : { cancellationIds }),
            invoiceCorrection: { id: correction.id, requestId: randomUUID(), cashRoute: true },
          },
          { requestedBy: venue.managerId, authorizedBy: venue.managerId },
          new Date().toISOString(),
          { backend: venue.backend, reading: venue.clock.now() },
        ),
      );
    const before = await ledgers();

    await expect(leg([burger])).rejects.toMatchObject({
      code: "management.request_invalid",
      params: { field: "cancellationIds" },
    });
    expect(await ledgers()).toEqual(before);
    await expect(leg()).resolves.toMatchObject({ replayed: false });
  });
});

describe("Refund a payment naming no cancels", () => {
  /** A paid table of a Burger (€12.00) and a Steak (€25.00), the Burger cancelled with the Refund
   * tick and €6.00 of it already given back: the cancel owes €6.00. */
  async function owingSix() {
    const b = await bill([{ name: "Burger" }, { name: "Steak" }]);
    const paid = await pay(b, "37.00");
    const burger = await cancel(b, await todayLine(venue, b.billId, 1), "1", true);
    const first = await refund(paid, refundBody(paid, "6.00", [burger]));
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    return { b, paid, burger };
  }

  it("tells the till a hand-keyed card payment may give back what the cancels still owe", async () => {
    const b = await bill([{ name: "Burger" }, { name: "Steak" }]);
    const paid = await send(
      venue.app,
      venue.cookie.staff,
      "POST",
      `/api/working-orders/${b.billId}/payments`,
      {
        submissionId: randomUUID(),
        kind: "share",
        shareOf: 1,
        method: "card",
        entry: "manual",
        applied: "37.00",
        tip: "0.00",
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, b.billId)),
      },
    );
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const [sale] = await venue.db.select().from(sales).where(eq(sales.workingOrderId, b.billId));
    await cancel(b, await todayLine(venue, b.billId, 1), "1", true);
    expect(
      await send(
        venue.app,
        venue.cookie.manager,
        "GET",
        `/api/transactions/${sale!.id}/refundable-tenders`,
      ),
    ).toMatchObject({
      status: 200,
      json: [{ manual: true, appliedRemaining: "37.00", plainRefundLimit: "12.00" }],
    });
  });

  it("is refused on a sale with no cancels, writing nothing", async () => {
    const b = await bill([{ name: "Burger" }, { name: "Steak" }]);
    const paid = await pay(b, "37.00");
    await refusedNeedsCorrection(paid, refundBody(paid, "10.00"));
  });

  it("takes what the cancels still owe, linked to them, refuses more, and a paid-back cancel adds nothing", async () => {
    const { paid, burger } = await owingSix();
    await refusedNeedsCorrection(paid, refundBody(paid, "7.00"));
    const answer = await refund(paid, refundBody(paid, "6.00"));
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await linksOf((answer.json as { id: string }).id)).toEqual([
      { adjustmentId: burger, amount: 600 },
    ]);
    await refusedNeedsCorrection(paid, refundBody(paid, "0.01"));
  });

  it("is taken on an invoice naming a customer", async () => {
    const b = await bill([{ name: "Burger" }, { name: "Steak" }]);
    await chooseCustomer(b);
    const paid = await pay(b, "37.00");
    expect(
      await send(
        venue.app,
        venue.cookie.manager,
        "POST",
        `/api/transactions/${paid.saleId}/corrections/preview`,
        { gross: "1.00" },
      ),
    ).toMatchObject({
      status: 409,
      json: { code: "sale.correction_not_admitted", params: { reason: "not_simplified" } },
    });
    const answer = await refund(paid, refundBody(paid, "10.00"));
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(answer.json).toMatchObject({ state: "completed", appliedAmount: "10.00" });
  });

  it("after Correct invoice gave back part, still takes no more than the cancels owe", async () => {
    const b = await bill([{ name: "Burger" }, { name: "Steak" }]);
    const paid = await pay(b, "37.00");
    const burger = await cancel(b, await todayLine(venue, b.billId, 1), "1", true);
    const manager = (method: "POST", path: string, body: unknown) =>
      send(venue.app, venue.cookie.manager, method, path, body);
    const split = await manager("POST", `/api/transactions/${paid.saleId}/corrections/preview`, {
      gross: "5.00",
    });
    expect(split.status, JSON.stringify(split.json)).toBe(200);
    const opened = await manager("POST", `/api/transactions/${paid.saleId}/corrections`, {
      submissionId: randomUUID(),
      gross: "5.00",
      reasonId: venue.reasonId.houseVoid,
      note: "Cold",
      expectedSplit: (split.json as { vatBreakdown: unknown }).vatBreakdown,
    });
    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
    const correctionId = (opened.json as { correction: { id: string } }).correction.id;
    const given = await manager("POST", `/api/invoice-corrections/${correctionId}/cash`, {
      submissionId: randomUUID(),
      amount: "5.00",
    });
    expect(given).toMatchObject({ status: 200, json: { correction: { state: "filed" } } });

    await refusedNeedsCorrection(paid, refundBody(paid, "12.01"));
    const answer = await refund(paid, refundBody(paid, "12.00"));
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await linksOf((answer.json as { id: string }).id)).toEqual([
      { adjustmentId: burger, amount: 1200 },
    ]);
  });

  it("linked to a cancel, grants no saved authority to a replay or a retry", async () => {
    const b = await bill([{ name: "Burger" }, { name: "Steak" }]);
    const paid = await pay(b, "37.00");
    const burger = await cancel(b, await todayLine(venue, b.billId, 1), "1", true);
    const ask = refundBody(paid, "12.00");
    const approved = await staffRefund(paid, { ...ask, override: managerPin() });
    expect(approved.status, JSON.stringify(approved.json)).toBe(200);
    const id = (approved.json as { id: string }).id;
    expect(await linksOf(id)).toEqual([{ adjustmentId: burger, amount: 1200 }]);
    const before = await written();
    expect((await staffRefund(paid, ask)).json).toMatchObject({
      code: "authorization.not_permitted",
    });
    expect(
      (await send(venue.app, venue.cookie.staff, "POST", `/api/tender-refunds/${id}/retry`, {}))
        .json,
    ).toMatchObject({ code: "authorization.not_permitted" });
    expect(await written()).toEqual(before);
  });
});
