import { randomUUID } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { adjustments } from "@waitron/adjustments";
import {
  lineServiceCancellations,
  parties,
  printJobs,
  sales,
  tenders,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { applyAdjustment } from "./adjustments-apply.js";
import { readBillEditState } from "./bill-editing.js";
import { markServed } from "./working-order.js";
import {
  billWith,
  inTx,
  provisionAdjustmentVenue,
  takeawayRates,
  type AdjustmentVenue,
  type RoundLine,
} from "./testing/adjustment-venue.js";
import { cashPayment, send } from "./testing/bill-venue.js";
import { cancelItemHttp } from "./testing/cancel-line.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import "./errors.js";

// O4 (plan 2026-11-19-adviser-goodwill-corrective §4.3.1): a free item holding a share of the price
// paid comes back, with Refund, only together with the last paid dish of its bill.
let venue: AdjustmentVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionAdjustmentVenue(db);
  },
});

interface Ticket {
  partyId: string;
  billId: string;
  saleId: string;
  tenderId: string;
  /** Each dish line's id and line number, in line order. */
  dishes: { id: string; lineNo: number; name: string }[];
}

/** A paid ticket of `lines`, the Water comped; takeaway (Salad and Soup 4%, Water 21%) unless
 * eaten here. Nothing is served. */
async function ticket(lines: RoundLine[], dining: "takeaway" | "here" = "takeaway") {
  if (dining === "takeaway") await takeawayRates(venue, { Salad: "4.00", Water: "21.00" });
  const { partyId, billId } = await billWith(
    venue,
    lines,
    dining === "takeaway" ? { dining: "takeaway" } : {},
  );
  const rows = await venue.db
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      name: workingOrderLines.name,
      parent: workingOrderLines.parentLineId,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId))
    .orderBy(asc(workingOrderLines.lineNo));
  const dishes = rows.filter((row) => row.parent === null);
  const water = dishes.find((row) => row.name === "Water")!;
  await inTx(venue, async (tx) => {
    const [order] = await tx
      .select({ revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, billId));
    await applyAdjustment(
      tx,
      venue.cfg,
      {
        admission: testTradingAdmission(),
        orderId: billId,
        expectedEdit: await readBillEditState(tx, billId),
        submissionId: randomUUID(),
        expectedRevision: order!.revision,
        lineId: water.id,
        action: "comp",
        reasonId: venue.reasonId.house,
        note: null,
        operatorId: venue.staffId,
      },
      venue.venueLocale,
    );
  });
  const paid = await cashPayment(venue, venue.cookie.staff, billId, "100.00");
  expect(paid.status, JSON.stringify(paid.json)).toBe(200);
  const [sale] = await venue.db.select().from(sales).where(eq(sales.workingOrderId, billId));
  const [tender] = await venue.db.select().from(tenders).where(eq(tenders.saleId, sale!.id));
  return {
    partyId,
    billId,
    saleId: sale!.id,
    tenderId: tender!.id,
    dishes: dishes.map(({ id, lineNo, name }) => ({ id, lineNo, name })),
  } satisfies Ticket;
}

function dish(t: Ticket, name: string, nth = 0) {
  return t.dishes.filter((row) => row.name === name)[nth]!;
}

/** Cancel and keep the charge, with the Refund tick unless `refund` is false. */
function cancel(
  t: Ticket,
  line: { lineNo: number },
  options: { refund?: boolean; withFree?: string[]; quantity?: string } = {},
) {
  return cancelItemHttp(
    venue.db,
    venue.app,
    venue.cookie.manager,
    t.billId,
    line.lineNo,
    options.quantity,
    {
      outcome: "keep_charge",
      reasonId: venue.reasonId.houseVoid,
      ...(options.refund === false ? {} : { refundHandoff: true }),
      ...(options.withFree === undefined ? {} : { withFree: options.withFree }),
    },
  );
}

/** The cancellation read the Cancel item window opens with. */
async function consent(t: Ticket, line: { id: string }) {
  const answer = await send(
    venue.app,
    venue.cookie.manager,
    "GET",
    `/api/parties/${t.partyId}/lines/${line.id}/cancellation`,
  );
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
  return answer.json;
}

async function serve(t: Ticket, line: { id: string }) {
  await inTx(venue, async (tx) => {
    const [party] = await tx.select().from(parties).where(eq(parties.id, t.partyId));
    await markServed(tx, venue.cfg, t.partyId, [{ lineId: line.id, quantity: "1" }], {
      expectedPartyRevision: party!.revision,
      submissionId: randomUUID(),
      operatorId: venue.staffId,
    });
  });
}

/** What a cancel writes: its cancel records, the service cancellations and the kitchen's print jobs. */
async function written(t: Ticket) {
  return {
    cancels: (
      await venue.db.select().from(adjustments).where(eq(adjustments.workingOrderId, t.billId))
    )
      .filter((row) => row.action === "cancel")
      .map((row) => ({ lineId: row.lineId, refundValue: row.refundValue })),
    cancellations: await venue.db
      .select({
        lineId: lineServiceCancellations.lineId,
        quantity: lineServiceCancellations.quantity,
      })
      .from(lineServiceCancellations)
      .where(
        inArray(
          lineServiceCancellations.lineId,
          t.dishes.map((row) => row.id),
        ),
      ),
    jobs: (await venue.db.select({ id: printJobs.id }).from(printJobs)).length,
  };
}

async function refused(
  t: Ticket,
  attempt: () => Promise<{ status: number; json: Record<string, unknown> }>,
  reason: string,
) {
  const before = await written(t);
  const answer = await attempt();
  expect(answer.status, JSON.stringify(answer.json)).toBe(409);
  expect(answer.json).toMatchObject({ code: "tab.free_item_with_dish", params: { reason } });
  expect(await written(t)).toEqual(before);
}

const SALAD_AND_WATER: RoundLine[] = [{ name: "Salad" }, { name: "Water" }];

describe("a free item holding a share comes back with the last paid dish", () => {
  it("brings the water back with the salad and hands back the €10.00 paid (the owner's case)", async () => {
    const t = await ticket(SALAD_AND_WATER);
    const salad = dish(t, "Salad");
    const water = dish(t, "Water");

    expect(await consent(t, salad)).toMatchObject({
      refundValue: { quantity: "1.000", gross: "8.33" },
      withFree: [{ lineId: water.id, name: "Water", quantity: "1.000", refundValue: "1.67" }],
    });
    expect(await consent(t, water)).toMatchObject({ givenFree: true });

    const jobsBefore = (await written(t)).jobs;
    const answer = await cancel(t, salad, { withFree: [water.id] });
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const after = await written(t);
    expect(after.cancels).toEqual([
      { lineId: salad.id, refundValue: 833 },
      { lineId: water.id, refundValue: 167 },
    ]);
    expect(after.cancellations.sort((a, b) => a.lineId.localeCompare(b.lineId))).toEqual(
      [
        { lineId: salad.id, quantity: 1000 },
        { lineId: water.id, quantity: 1000 },
      ].sort((a, b) => a.lineId.localeCompare(b.lineId)),
    );
    expect(after.jobs).toBeGreaterThan(jobsBefore);
    const rows = await venue.db
      .select({ id: adjustments.id, lineId: adjustments.lineId, action: adjustments.action })
      .from(adjustments)
      .where(eq(adjustments.workingOrderId, t.billId));
    const idOf = (lineId: string) =>
      rows.find((row) => row.lineId === lineId && row.action === "cancel")!.id;
    expect((answer.json as { refundLinks: unknown }).refundLinks).toEqual([
      { lineId: salad.id, adjustmentId: idOf(salad.id) },
      { lineId: water.id, adjustmentId: idOf(water.id) },
    ]);

    const refund = await send(
      venue.app,
      venue.cookie.manager,
      "POST",
      `/api/transactions/${t.saleId}/refunds`,
      {
        submissionId: randomUUID(),
        tenderId: t.tenderId,
        appliedAmount: "10.00",
        tipAmount: "0.00",
        reason: "Brought back",
        cancellationIds: [idOf(salad.id), idOf(water.id)],
      },
    );
    expect(refund.status, JSON.stringify(refund.json)).toBe(200);
  });

  it("refuses the salad's Cancel and refund that leaves the water out", async () => {
    const t = await ticket(SALAD_AND_WATER);
    await refused(t, () => cancel(t, dish(t, "Salad")), "not_listed");
  });

  it("refuses the water's own Cancel and refund, cancels it without Refund, and then the salad goes alone", async () => {
    const t = await ticket(SALAD_AND_WATER);
    const salad = dish(t, "Salad");
    const water = dish(t, "Water");
    await refused(t, () => cancel(t, water), "free_item");

    const plain = await cancel(t, water, { refund: false });
    expect(plain.status, JSON.stringify(plain.json)).toBe(200);
    expect(plain.json).not.toHaveProperty("refundLinks");

    const last = await cancel(t, salad);
    expect(last.status, JSON.stringify(last.json)).toBe(200);
    expect((await written(t)).cancels).toEqual([
      { lineId: water.id, refundValue: null },
      { lineId: salad.id, refundValue: 833 },
    ]);
  });

  it("refuses the salad's Cancel and refund once the water was served", async () => {
    const t = await ticket(SALAD_AND_WATER);
    const water = dish(t, "Water");
    await serve(t, water);
    await refused(t, () => cancel(t, dish(t, "Salad"), { withFree: [water.id] }), "served");
    await refused(t, () => cancel(t, dish(t, "Salad")), "served");
  });

  it("refuses a free item listed with a dish that is not the last paid one", async () => {
    await takeawayRates(venue, { Soup: "4.00" });
    const t = await ticket([{ name: "Salad" }, { name: "Soup" }, { name: "Water" }]);
    await refused(
      t,
      () => cancel(t, dish(t, "Salad"), { withFree: [dish(t, "Water").id] }),
      "not_listed",
    );
  });

  it("with several paid dishes, sends the water back with the last of them", async () => {
    await takeawayRates(venue, { Soup: "4.00" });
    const t = await ticket([{ name: "Salad" }, { name: "Soup" }, { name: "Water" }]);
    const salad = dish(t, "Salad");
    const soup = dish(t, "Soup");
    const water = dish(t, "Water");
    expect(await consent(t, salad)).not.toHaveProperty("withFree");

    const first = await cancel(t, salad);
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    expect(await consent(t, soup)).toMatchObject({
      withFree: [{ lineId: water.id, refundValue: "1.78" }],
    });
    const last = await cancel(t, soup, { withFree: [water.id] });
    expect(last.status, JSON.stringify(last.json)).toBe(200);
    expect((await written(t)).cancels).toEqual([
      { lineId: salad.id, refundValue: 889 },
      { lineId: soup.id, refundValue: 533 },
      { lineId: water.id, refundValue: 178 },
    ]);
  });

  it("keeps the water while a served paid dish stays", async () => {
    await takeawayRates(venue, { Soup: "4.00" });
    const t = await ticket([{ name: "Salad" }, { name: "Soup" }, { name: "Water" }]);
    const soup = dish(t, "Soup");
    await serve(t, dish(t, "Salad"));
    expect(await consent(t, soup)).not.toHaveProperty("withFree");
    const answer = await cancel(t, soup);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect((await written(t)).cancels).toEqual([{ lineId: soup.id, refundValue: 533 }]);
  });

  it("gives part of the last paid dish its own share, the water staying", async () => {
    const t = await ticket([{ name: "Salad", quantity: "2" }, { name: "Water" }]);
    const salad = dish(t, "Salad");
    const answer = await cancel(t, salad, { quantity: "1" });
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const cancels = (await written(t)).cancels;
    expect(cancels).toHaveLength(1);
    expect(cancels[0]!.lineId).toBe(salad.id);
  });

  it("leaves a ticket eaten here, whose water filed €0, as it was", async () => {
    const t = await ticket(SALAD_AND_WATER, "here");
    const salad = dish(t, "Salad");
    expect(await consent(t, salad)).not.toHaveProperty("withFree");
    expect(await consent(t, dish(t, "Water"))).not.toHaveProperty("givenFree");
    const answer = await cancel(t, salad);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect((await written(t)).cancels).toEqual([{ lineId: salad.id, refundValue: 1000 }]);
  });
});
