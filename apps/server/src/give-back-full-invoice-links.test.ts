import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { createAdjustmentReason, listAdjustmentReasons } from "@waitron/adjustments";
import { taxpayer } from "@waitron/db";
import {
  createCategory,
  createExtraList,
  createProduct,
  writeProductModifiers,
} from "@waitron/menu";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { correctiveRecordsOf } from "@waitron/fiscal-verifactu/test/invoice-records.js";
import {
  heldFromSending,
  refusedByAeat,
} from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { GiveBackRequest } from "./give-back-plan.js";
import type { GiveBackLine, GiveBackView } from "./give-back-read.js";
import { createTable } from "./testing/live-table.js";
import { openPartyTab } from "./testing/serve-line.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { REASONS } from "./testing/adjustment-venue.js";
import { writeGroupedLines } from "./testing/grouped-counter-order.js";
import * as fixture from "./testing/full-invoice-give-back.js";
import { ask, r1, type Part } from "./testing/full-invoice-give-back.js";
import { inTx, provisionBillVenue, send, tabWith, type BillVenue } from "./testing/bill-venue.js";

let venue: BillVenue;
let reasonId: string;
let voidReasonId: string;
let adminCookie: string;
/** A Paella (€18.50) offering an Aioli (€3.00) from its extras list, and a Cheesecake (€6.50). */
let withExtra: {
  offers: ZoneOffers;
  paella: string;
  cheesecake: string;
  aioli: string;
  sauces: string;
};

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await inTx(venue, async (tx) => {
      await tx.update(taxpayer).set({ taxpayerDomicile: "Calle Fiscal 8, Madrid" });
      reasonId = (await listAdjustmentReasons(tx))[0]!.id;
      voidReasonId = (await createAdjustmentReason(tx, REASONS.houseVoid)).id;
      adminCookie = await fixture.adminTillCookie(tx, venue);
      withExtra = await paellaWithAioli(tx);
    });
  },
});

async function paellaWithAioli(tx: Parameters<typeof createCategory>[0]) {
  const category = await createCategory(tx, { name: "Rice" });
  const product = (name: string, customer: string, unitPrice: string) =>
    createProduct(tx, {
      categoryId: category.id,
      name,
      customerName: { es: customer },
      kitchenName: name.toUpperCase(),
      pricingUnit: "each",
      unitPrice,
    });
  const paella = (await product("Paella", "Paella valenciana", "18.50")).id;
  const cheesecake = (await product("Cheesecake", "Tarta de queso", "6.50")).id;
  const aioli = (await product("Aioli", "Garlic mayonnaise", "3.00")).id;
  const sauces = (
    await createExtraList(
      tx,
      {
        name: "Sauces",
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: 1,
        active: true,
        items: [{ productId: aioli, maxQuantity: 1, preselected: false, price: "3.00" }],
      },
      "es-ES",
    )
  ).id;
  await writeProductModifiers(tx, paella, [{ kind: "extras", id: sauces }]);
  const offers = await offerProducts(tx, { zone: "tables", productIds: [paella, cheesecake] });
  return { offers, paella, cheesecake, aioli, sauces };
}

const supervisor = () => ({ personId: venue.adminId, pin: "1234" });

/** A full invoice for `dishes`, in order, paid in `parts`. */
async function fullInvoiceOf(dishes: string[], ...parts: Part[]) {
  const billId = await tabWith(venue, ...dishes);
  await fixture.chooseFullInvoice(venue, billId);
  for (const part of parts) await fixture.payPart(venue, billId, part);
  return { billId, saleId: await fixture.saleOf(venue, billId) };
}

/** A full invoice for two Croquettes on one line (€20.00) and an Octopus (€20.00), paid in cash. */
async function croquettesOnOneLine() {
  const billId = await inTx(venue, async (tx) => {
    const table = await createTable(tx, {
      label: `M-${randomUUID().slice(0, 8)}`,
      zoneId: venue.zoneId,
    });
    const { tabId } = await openPartyTab(tx, venue.cfg, { tableId: table.id });
    await writeGroupedLines(tx, venue.cfg, tabId, [
      { menuItemId: venue.offerFor("Croquettes"), quantity: "2" },
      { menuItemId: venue.offerFor("Octopus"), quantity: "1" },
    ]);
    return tabId;
  });
  await fixture.chooseFullInvoice(venue, billId);
  await fixture.payPart(venue, billId, { cash: "40.00" });
  return { billId, saleId: await fixture.saleOf(venue, billId) };
}

const cancel = (billId: string, lineNo: number) =>
  fixture.refundableCancelFor(venue, billId, lineNo, voidReasonId);

async function readView(saleId: string, cookie = adminCookie): Promise<GiveBackView> {
  const read = await send(venue.app, cookie, "GET", `/api/transactions/${saleId}/give-back`);
  expect(read.status, JSON.stringify(read.json)).toBe(200);
  return read.json as unknown as GiveBackView;
}

/** The line filed at `gross`, as the window reads it. */
async function lineOf(saleId: string, gross: string): Promise<GiveBackLine> {
  return (await readView(saleId)).lines.find((line) => line.gross === gross)!;
}

/** What the window shows of the line at `gross`: what is left and what its cancels still owe. */
async function shown(saleId: string, gross: string) {
  const line = await lineOf(saleId, gross);
  return { left: line.left, owed: line.cancelled?.owed, back: line.cancelled?.back };
}

async function press(saleId: string, request: GiveBackRequest) {
  const body = await fixture.giveBackBody(venue, adminCookie, saleId, request, reasonId);
  const answer = await send(
    venue.app,
    adminCookie,
    "POST",
    `/api/transactions/${saleId}/give-back`,
    body,
  );
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
  return {
    expected: body.expected,
    answer,
    correctionId: (answer.json as { parts: { correctionId?: string }[] }).parts.find(
      (part) => part.correctionId !== undefined,
    )?.correctionId,
  };
}

const tick = (line: GiveBackLine, amount: string) =>
  ask("dishes", amount, { lineIds: [line.id], fromCancel: line.cancelIds });

/** Every link on the sale's refunds, oldest refund first: the cancel, the refund's method and
 * amount, and what of it pays the cancel, in cents. */
function linksOf(saleId: string) {
  return venue.db.all<{ cancel: string; method: string; refund: number; amount: number }>(sql`
    select l.adjustment_id as cancel, t.method as method, r.applied_amount as refund,
           l.amount as amount
    from adjustment_refunds l
    join refunds r on r.id = l.refund_id
    join tenders t on t.id = r.tender_id
    where r.sale_id = ${saleId}
    order by r.created_at, r.id, l.adjustment_id`);
}

const readerOf = (saleId: string) =>
  venue.db.all<{ id: string }>(
    sql`select id from tenders where sale_id = ${saleId} and method = 'card'`,
  )[0]!.id;

function readerLeg(saleId: string, correctionId: string, amount: string, submissionId: string) {
  return send(venue.app, adminCookie, "POST", `/api/transactions/${saleId}/refunds`, {
    submissionId,
    tenderId: readerOf(saleId),
    appliedAmount: amount,
    tipAmount: "0.00",
    reason: "Goodwill",
    invoiceCorrectionId: correctionId,
    override: supervisor(),
  });
}

const correctivesOf = (saleId: string) => correctiveRecordsOf(venue.db, saleId);

describe("a full invoice's corrective pays its dishes' cancels (section 5)", () => {
  it("goodwill on a cancelled Tarta pays its cancel what the corrective takes off it", async () => {
    const { billId, saleId } = await fullInvoiceOf(["Tarta", "Octopus"], { cash: "38.00" });
    const cancelId = await cancel(billId, 1);
    expect(await shown(saleId, "18.00")).toEqual({ left: "18.00", owed: "18.00", back: "0.00" });
    const { expected } = await press(saleId, ask("goodwill", "19.00"));
    expect(expected).toEqual([{ kind: "correction", amount: "19.00", way: "cash", lineIds: [] }]);
    expect(correctivesOf(saleId)).toEqual([r1(-1900)]);
    expect(linksOf(saleId)).toEqual([
      { cancel: cancelId, method: "cash", refund: 1900, amount: 900 },
    ]);
    expect(await shown(saleId, "18.00")).toEqual({ left: "9.00", owed: "9.00", back: "9.00" });
  });

  it("one of two cancelled croquettes: goodwill pays its share, then a tick pays the rest it owes", async () => {
    const { billId, saleId } = await croquettesOnOneLine();
    const cancelId = await cancel(billId, 1);
    await press(saleId, ask("goodwill", "10.00"));
    expect(linksOf(saleId)).toEqual([
      { cancel: cancelId, method: "cash", refund: 1000, amount: 500 },
    ]);
    expect(await shown(saleId, "20.00")).toEqual({ left: "15.00", owed: "5.00", back: "5.00" });
    await press(saleId, tick(await lineOf(saleId, "20.00"), "10.00"));
    expect(correctivesOf(saleId)).toEqual([r1(-1000), r1(-1000)]);
    expect(linksOf(saleId)).toEqual([
      { cancel: cancelId, method: "cash", refund: 1000, amount: 500 },
      { cancel: cancelId, method: "cash", refund: 1000, amount: 500 },
    ]);
    expect(await shown(saleId, "20.00")).toEqual({ left: "5.00", owed: "0.00", back: "10.00" });
  });

  it("a Tarta cancelled after goodwill is shown owing no more than is left of it", async () => {
    const { billId, saleId } = await fullInvoiceOf(["Tarta", "Octopus"], { cash: "38.00" });
    await press(saleId, ask("goodwill", "19.00"));
    const cancelId = await cancel(billId, 1);
    expect(linksOf(saleId)).toEqual([]);
    expect(await shown(saleId, "18.00")).toEqual({ left: "9.00", owed: "9.00", back: "0.00" });
    await press(saleId, tick(await lineOf(saleId, "18.00"), "9.00"));
    expect(correctivesOf(saleId)).toEqual([r1(-1900), r1(-900)]);
    expect(linksOf(saleId)).toEqual([
      { cancel: cancelId, method: "cash", refund: 900, amount: 900 },
    ]);
    expect(await shown(saleId, "18.00")).toEqual({ left: "0.00", owed: "0.00", back: "9.00" });
  });
});

describe("links of a corrective given back over two payments", () => {
  /** A full invoice for a Tarta and an Octopus paid €10.00 in cash and €28.00 on the reader, its
   * Tarta cancelled and ticked: the cash leg is back and €8.00 is left for the reader. */
  async function cashLegBack() {
    const { billId, saleId } = await fullInvoiceOf(
      ["Tarta", "Octopus"],
      { cash: "10.00" },
      { reader: "28.00" },
    );
    const cancelId = await cancel(billId, 1);
    const { correctionId, answer } = await press(
      saleId,
      tick(await lineOf(saleId, "18.00"), "18.00"),
    );
    expect(answer.json).toMatchObject({ underWay: { moneyBack: "10.00", left: "8.00" } });
    return { billId, saleId, cancelId, correctionId: correctionId! };
  }

  /** A full invoice (or a receipt) for a Tarta and an Octopus paid €10.00 on the reader and €28.00
   * in cash, with €19.00 of goodwill given back from the reader: €10.00 is back and €9.00 is left
   * for the cash. */
  async function readerLegBack(full: boolean) {
    const billId = await tabWith(venue, "Tarta", "Octopus");
    if (full) await fixture.chooseFullInvoice(venue, billId);
    await fixture.payPart(venue, billId, { reader: "10.00" });
    await fixture.payPart(venue, billId, { cash: "28.00" });
    const saleId = await fixture.saleOf(venue, billId);
    const { correctionId, answer } = await press(
      saleId,
      ask("goodwill", "19.00", { way: readerOf(saleId) }),
    );
    expect(answer.json).toMatchObject({ underWay: { moneyBack: "10.00", left: "9.00" } });
    return { saleId, correctionId: correctionId! };
  }

  const cashLeg = (correctionId: string, amount: string) =>
    send(venue.app, adminCookie, "POST", `/api/invoice-corrections/${correctionId}/cash`, {
      submissionId: randomUUID(),
      amount,
    });

  function recordsNeedChecking() {
    const unsound = vi.spyOn(venue.backend, "checkIntegrity").mockResolvedValue({
      ok: false,
      checked: 1,
      issues: [{ code: "predecessor-hash-mismatch", params: {} }],
    } as Awaited<ReturnType<typeof venue.backend.checkIntegrity>>);
    onTestFinished(() => unsound.mockRestore());
  }

  const refundCountOf = (saleId: string) =>
    venue.db.all<{ n: number }>(
      sql`select count(*) as n from refunds where sale_id = ${saleId}`,
    )[0]!.n;

  it("links nothing between the legs, closes a second till's window, then links both legs once filed", async () => {
    const { saleId, cancelId, correctionId } = await cashLegBack();
    expect(linksOf(saleId)).toEqual([]);
    const second = await readView(saleId, venue.cookie2);
    expect(second.lines.find((line) => line.gross === "18.00")).toMatchObject({
      available: false,
      reason: { code: "invoice_correction.already_open" },
    });
    expect(second.choices).toMatchObject({
      dishes: { available: false, reason: { code: "invoice_correction.already_open" } },
      goodwill: { available: false, reason: { code: "invoice_correction.already_open" } },
    });
    const submissionId = randomUUID();
    const leg = await readerLeg(saleId, correctionId, "8.00", submissionId);
    expect(leg).toMatchObject({ status: 200, json: { state: "completed" } });
    expect(correctivesOf(saleId)).toEqual([r1(-1800)]);
    expect(linksOf(saleId)).toEqual([
      { cancel: cancelId, method: "cash", refund: 1000, amount: 1000 },
      { cancel: cancelId, method: "card", refund: 800, amount: 800 },
    ]);
    // The cancel's approval never covers a leg: its links are the corrective's.
    const resent = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/transactions/${saleId}/refunds`,
      {
        submissionId,
        tenderId: readerOf(saleId),
        appliedAmount: "8.00",
        tipAmount: "0.00",
        reason: "Goodwill",
        invoiceCorrectionId: correctionId,
      },
    );
    expect(resent).toMatchObject({ status: 403, json: { code: "authorization.not_permitted" } });
  });

  it("Stop here after the cash leg links only its amount; a filing that then waits still shows the dish less its links", async () => {
    const { saleId, cancelId, correctionId } = await cashLegBack();
    const fileNow = (await readView(saleId)).underWay!.fileNow as { vatBreakdown: unknown };
    const stop = await send(
      venue.app,
      adminCookie,
      "POST",
      `/api/invoice-corrections/${correctionId}/file`,
      { expectedSplit: fileNow.vatBreakdown },
    );
    expect(stop.status, JSON.stringify(stop.json)).toBe(200);
    expect(correctivesOf(saleId)).toEqual([r1(-1000)]);
    expect(linksOf(saleId)).toEqual([
      { cancel: cancelId, method: "cash", refund: 1000, amount: 1000 },
    ]);
    expect(await shown(saleId, "18.00")).toEqual({ left: "8.00", owed: "8.00", back: "10.00" });
    await inTx(venue, (tx) => heldFromSending(tx, saleId));
    expect(await shown(saleId, "18.00")).toEqual({ left: "8.00", owed: "8.00", back: "10.00" });
  });

  it("does not link a cancel made between the legs", async () => {
    const { billId, saleId } = await fullInvoiceOf(
      ["Tarta", "Octopus"],
      { cash: "10.00" },
      { reader: "28.00" },
    );
    const { correctionId } = await press(saleId, ask("goodwill", "19.00"));
    await cancel(billId, 1);
    const leg = await readerLeg(saleId, correctionId!, "9.00", randomUUID());
    expect(leg).toMatchObject({ status: 200, json: { state: "completed" } });
    expect(correctivesOf(saleId)).toEqual([r1(-1900)]);
    expect(linksOf(saleId)).toEqual([]);
    expect(await shown(saleId, "18.00")).toEqual({ left: "9.00", owed: "9.00", back: "0.00" });
  });

  it("while the box's records need checking, sends no fresh leg and files nothing", async () => {
    const { saleId, correctionId } = await cashLegBack();
    recordsNeedChecking();
    const sends = venue.card.refundCalls.length;
    const refunds = refundCountOf(saleId);
    expect(await readerLeg(saleId, correctionId, "8.00", randomUUID())).toEqual({
      status: 409,
      json: { code: "invoice_correction.chain_unsound", params: { saleId } },
    });
    expect(venue.card.refundCalls.length).toBe(sends);
    expect(refundCountOf(saleId)).toBe(refunds);
    expect(correctivesOf(saleId)).toEqual([]);
  });

  it("while the box's records need checking, the money under way waits for them on a full invoice", async () => {
    const { saleId } = await cashLegBack();
    expect((await readView(saleId)).underWay!.fileNow).toMatchObject({ gross: "10.00" });
    recordsNeedChecking();
    expect((await readView(saleId)).underWay!.fileNow).toEqual({
      refusal: "invoice_correction.chain_unsound",
      closable: false,
    });
  });

  it("on a receipt, the money under way still answers what it would file while the box's records need checking", async () => {
    const { saleId } = await readerLegBack(false);
    recordsNeedChecking();
    expect((await readView(saleId)).underWay!.fileNow).toMatchObject({ gross: "10.00" });
  });

  it("while the box's records need checking, still answers a resend of a leg already sent", async () => {
    const { saleId, correctionId } = await cashLegBack();
    const lost = randomUUID();
    venue.card.scriptNextRefund({ made: false, answer: { kind: "uncertain", reason: "network" } });
    expect(await readerLeg(saleId, correctionId, "8.00", lost)).toMatchObject({
      status: 200,
      json: { state: "pending" },
    });
    recordsNeedChecking();
    const refunds = refundCountOf(saleId);
    const resent = await readerLeg(saleId, correctionId, "8.00", lost);
    expect(resent.status, JSON.stringify(resent.json)).toBe(200);
    expect(refundCountOf(saleId)).toBe(refunds);
  });

  it("while the box's records need checking, gives no fresh cash leg on a full invoice", async () => {
    const { saleId, correctionId } = await readerLegBack(true);
    recordsNeedChecking();
    const refunds = refundCountOf(saleId);
    expect(await cashLeg(correctionId, "4.00")).toEqual({
      status: 409,
      json: { code: "invoice_correction.chain_unsound", params: { saleId } },
    });
    expect(refundCountOf(saleId)).toBe(refunds);
  });

  it("on a receipt, a fresh cash leg still goes back while the box's records need checking", async () => {
    const { saleId, correctionId } = await readerLegBack(false);
    recordsNeedChecking();
    const refunds = refundCountOf(saleId);
    const leg = await cashLeg(correctionId, "4.00");
    expect(leg.status, JSON.stringify(leg.json)).toBe(200);
    expect(refundCountOf(saleId)).toBe(refunds + 1);
  });

  it("ended unrecorded, links the money back to the cancel and does not offer it again", async () => {
    const { saleId, cancelId, correctionId } = await cashLegBack();
    await inTx(venue, (tx) => refusedByAeat(tx, saleId));
    const finished = await send(
      venue.app,
      adminCookie,
      "POST",
      `/api/invoice-corrections/${correctionId}/close`,
      {},
    );
    expect(finished.status, JSON.stringify(finished.json)).toBe(200);
    expect(finished.json).toMatchObject({ state: "closed", correctiveSaleId: null });
    expect(correctivesOf(saleId)).toEqual([]);
    expect(linksOf(saleId)).toEqual([
      { cancel: cancelId, method: "cash", refund: 1000, amount: 1000 },
    ]);
    expect(await shown(saleId, "18.00")).toEqual({ left: "8.00", owed: "8.00", back: "10.00" });
  });
});

describe("which cancels a corrective's money pays", () => {
  /** A full invoice for a Paella with an Aioli (€21.50) and a Cheesecake (€6.50), paid in cash. */
  async function paellaWithAioliInvoice() {
    const billId = await inTx(venue, async (tx) => {
      const table = await createTable(tx, {
        label: `A-${randomUUID().slice(0, 8)}`,
        zoneId: withExtra.offers.zoneId,
      });
      const opened = await openPartyTab(tx, venue.cfg, { tableId: table.id });
      await placeGroups(tx, venue.cfg, opened.partyId, {
        groups: [
          {
            lines: [
              {
                menuItemId: withExtra.offers.offerFor(withExtra.paella),
                quantity: "1",
                extras: [
                  {
                    listId: withExtra.sauces,
                    picks: [{ productId: withExtra.aioli, quantity: 1 }],
                  },
                ],
              },
              { menuItemId: withExtra.offers.offerFor(withExtra.cheesecake), quantity: "1" },
            ],
            release: "hold",
          },
        ],
        operatorId: venue.operatorId,
        billId: opened.tabId,
      });
      return opened.tabId;
    });
    await fixture.chooseFullInvoice(venue, billId);
    await fixture.payPart(venue, billId, { cash: "28.00" });
    const [paella] = venue.db.all<{ lineNo: number }>(
      sql`select line_no as lineNo from working_order_lines
          where working_order_id = ${billId} and product_id = ${withExtra.paella}`,
    );
    return { billId, saleId: await fixture.saleOf(venue, billId), paellaLine: paella!.lineNo };
  }

  /** AEAT refuses the sale's filing for good, and Finish ends its open give-back unrecorded. */
  async function finishRefused(saleId: string, correctionId: string) {
    await inTx(venue, (tx) => refusedByAeat(tx, saleId));
    const finished = await send(
      venue.app,
      adminCookie,
      "POST",
      `/api/invoice-corrections/${correctionId}/close`,
      {},
    );
    expect(finished.status, JSON.stringify(finished.json)).toBe(200);
    expect(finished.json).toMatchObject({ state: "closed", correctiveSaleId: null });
  }

  it("counts a cancelled dish's priced extra in what goodwill takes off it", async () => {
    const { billId, saleId, paellaLine } = await paellaWithAioliInvoice();
    const cancelId = await cancel(billId, paellaLine);
    await press(saleId, ask("goodwill", "14.00"));
    expect(correctivesOf(saleId)).toEqual([r1(-1400)]);
    expect(linksOf(saleId)).toEqual([
      { cancel: cancelId, method: "cash", refund: 1400, amount: 1075 },
    ]);
    expect(await shown(saleId, "18.50")).toEqual({ left: "10.75", owed: "10.75", back: "10.75" });
  });

  it("ended unrecorded with another dish ticked, pays nothing to the cancelled dish", async () => {
    const { billId, saleId } = await fullInvoiceOf(
      ["Tarta", "Octopus"],
      { cash: "10.00" },
      { reader: "28.00" },
    );
    await cancel(billId, 1);
    const octopus = await lineOf(saleId, "20.00");
    const { correctionId } = await press(saleId, ask("dishes", "20.00", { lineIds: [octopus.id] }));
    await finishRefused(saleId, correctionId!);
    expect(linksOf(saleId)).toEqual([]);
    expect(await shown(saleId, "18.00")).toEqual({ left: "18.00", owed: "18.00", back: "0.00" });
  });

  it("ended unrecorded on goodwill, which names no dish, pays the cancelled dish's cancel", async () => {
    const { billId, saleId } = await fullInvoiceOf(
      ["Tarta", "Octopus"],
      { cash: "10.00" },
      { reader: "28.00" },
    );
    const cancelId = await cancel(billId, 1);
    const { correctionId } = await press(saleId, ask("goodwill", "19.00"));
    await finishRefused(saleId, correctionId!);
    expect(linksOf(saleId)).toEqual([
      { cancel: cancelId, method: "cash", refund: 1000, amount: 1000 },
    ]);
    expect(await shown(saleId, "18.00")).toEqual({ left: "8.00", owed: "8.00", back: "10.00" });
  });

  it("on a receipt, ended unrecorded, links nothing to a cancel made between the legs", async () => {
    const billId = await tabWith(venue, "Tarta", "Octopus");
    await fixture.payPart(venue, billId, { cash: "10.00" });
    await fixture.payPart(venue, billId, { reader: "28.00" });
    const saleId = await fixture.saleOf(venue, billId);
    const { correctionId } = await press(saleId, ask("goodwill", "19.00"));
    await cancel(billId, 1);
    // A voided receipt: a refusal Finish ends a receipt's give-back over.
    const spy = vi
      .spyOn(venue.backend, "correctionAdmissionFor")
      .mockResolvedValue({ eligible: false, reason: "voided" } as never);
    onTestFinished(() => spy.mockRestore());
    const finished = await send(
      venue.app,
      adminCookie,
      "POST",
      `/api/invoice-corrections/${correctionId}/close`,
      {},
    );
    expect(finished.status, JSON.stringify(finished.json)).toBe(200);
    expect(finished.json).toMatchObject({ state: "closed", correctiveSaleId: null });
    expect(linksOf(saleId)).toEqual([]);
  });
});
