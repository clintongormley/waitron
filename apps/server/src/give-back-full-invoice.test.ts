import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { createAdjustmentReason, listAdjustmentReasons } from "@waitron/adjustments";
import { adjustments, billAdvances, parties, taxpayer, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { correctiveRecordsOf } from "@waitron/fiscal-verifactu/test/invoice-records.js";
import {
  heldFromSending,
  refusedByAeat,
} from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { refundsWithoutCorrectiveQuery } from "./accountant-export.js";
import { readBillEditState } from "./bill-editing.js";
import type { GiveBackRequest } from "./give-back-plan.js";
import { cancelItem } from "./line-cancel.js";
import { readCancellationContext } from "./line-cancel-context.js";
import { REASONS } from "./testing/adjustment-venue.js";
import * as fixture from "./testing/full-invoice-give-back.js";
import { ask, r1, type Part } from "./testing/full-invoice-give-back.js";
import { inTx, provisionBillVenue, send, tabWith, type BillVenue } from "./testing/bill-venue.js";
import { testTradingAdmission } from "./testing/trading-admission.js";

let venue: BillVenue;
let reasonId: string;
let voidReasonId: string;
/** The administrator, holding every right, signed in on the first till. */
let adminCookie: string;

const DOMICILE = "Calle Fiscal 8, Madrid";

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await inTx(venue, async (tx) => {
      await tx.update(taxpayer).set({ taxpayerDomicile: DOMICILE });
      reasonId = (await listAdjustmentReasons(tx))[0]!.id;
      voidReasonId = (await createAdjustmentReason(tx, REASONS.houseVoid)).id;
      adminCookie = await fixture.adminTillCookie(tx, venue);
    });
  },
});

const supervisor = () => ({ personId: venue.adminId, pin: "1234" });

const fullInvoice = (...parts: Part[]) => fixture.fullInvoice(venue, ...parts);
const payPart = (billId: string, part: Part, extra?: Record<string, unknown>) =>
  fixture.payPart(venue, billId, part, extra);
const tenderOf = (saleId: string, method: "cash" | "card") =>
  fixture.tenderOf(venue, saleId, method);

const routePreview = (saleId: string, request: GiveBackRequest) =>
  send(venue.app, adminCookie, "POST", `/api/transactions/${saleId}/give-back/preview`, request);

const giveBody = (saleId: string, request: GiveBackRequest) =>
  fixture.giveBackBody(venue, adminCookie, saleId, request, reasonId);

const give = (saleId: string, body: unknown) =>
  send(venue.app, adminCookie, "POST", `/api/transactions/${saleId}/give-back`, body);

const correctivesOf = (saleId: string) => correctiveRecordsOf(venue.db, saleId);

/** Every refund on `saleId`, in cents, plain refunds first: whether it is a leg of a correction,
 * and the cancel it pays. */
function moneyOf(saleId: string) {
  return venue.db.all<{
    applied: number;
    method: string;
    state: string;
    leg: number;
    cancel: string | null;
  }>(sql`
    select r.applied_amount as applied, t.method as method, r.state as state,
           exists (select 1 from invoice_correction_refunds l where l.tender_refund_id = r.id) as leg,
           (select a.adjustment_id from adjustment_refunds a where a.refund_id = r.id) as cancel
    from refunds r join tenders t on t.id = r.tender_id
    where r.sale_id = ${saleId}
    order by leg, r.applied_amount`);
}

function drawerCents(): number {
  return venue.db.all<{ cents: number }>(
    sql`select coalesce(sum(amount), 0) as cents from drawer_entries`,
  )[0]!.cents;
}

const correctionIdOf = (answer: { json: Record<string, unknown> }) =>
  (answer.json as { parts: { correctionId?: string }[] }).parts.find(
    (part) => part.correctionId !== undefined,
  )!.correctionId!;

describe("Give money back on a full invoice", () => {
  it("files goodwill given back in cash as one R1 naming the customer, and refuses it as a plain refund", async () => {
    const { saleId } = await fullInvoice({ cash: "37.00" });
    const cash = await tenderOf(saleId, "cash");
    const plain = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/transactions/${saleId}/refunds`,
      {
        submissionId: randomUUID(),
        tenderId: cash,
        appliedAmount: "10.00",
        tipAmount: "0.00",
        reason: "Goodwill",
        override: supervisor(),
      },
    );
    expect(plain).toEqual({
      status: 409,
      json: { code: "tender.refund_needs_correction", params: { tenderId: cash } },
    });
    const admissions = vi.spyOn(venue.backend, "correctionAdmissionFor");
    onTestFinished(() => admissions.mockRestore());
    const read = await send(venue.app, adminCookie, "GET", `/api/transactions/${saleId}/give-back`);
    expect(read.status, JSON.stringify(read.json)).toBe(200);
    expect(admissions).toHaveBeenCalledTimes(1);
    admissions.mockRestore();

    const body = await giveBody(saleId, ask("goodwill", "10.00"));
    expect(body.expected).toEqual([
      { kind: "correction", amount: "10.00", way: "cash", lineIds: [] },
    ]);
    const drawer = drawerCents();
    const answer = await give(saleId, body);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(answer.json).toMatchObject({
      parts: [{ kind: "correction", amount: "10.00", state: "completed" }],
      underWay: null,
    });
    expect(correctivesOf(saleId)).toEqual([r1(-1000)]);
    expect(moneyOf(saleId)).toEqual([
      { applied: 1000, method: "cash", state: "completed", leg: 1, cancel: null },
    ]);
    expect(drawerCents()).toBe(drawer - 1000);
  });

  it("files goodwill refunded on a separate terminal as one R1", async () => {
    const { saleId } = await fullInvoice({ card: "37.00" });
    const card = await tenderOf(saleId, "card");
    const body = await giveBody(saleId, ask("goodwill", "10.00", { way: card }));
    const answer = await give(saleId, { ...body, manualConfirmed: true, override: supervisor() });
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(answer.json).toMatchObject({ parts: [{ kind: "correction", state: "completed" }] });
    expect(correctivesOf(saleId)).toEqual([r1(-1000)]);
    expect(moneyOf(saleId)).toEqual([
      { applied: 1000, method: "card", state: "completed", leg: 1, cancel: null },
    ]);
  });

  it("files goodwill given back on the card reader as one R1", async () => {
    const { saleId } = await fullInvoice({ reader: "37.00" });
    const reader = await tenderOf(saleId, "card");
    const answer = await give(
      saleId,
      await giveBody(saleId, ask("goodwill", "10.00", { way: reader })),
    );
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(answer.json).toMatchObject({ parts: [{ kind: "correction", state: "completed" }] });
    expect(correctivesOf(saleId)).toEqual([r1(-1000)]);
    expect(moneyOf(saleId)).toEqual([
      { applied: 1000, method: "card", state: "completed", leg: 1, cancel: null },
    ]);
  });

  it("over two payments, files one R1 once the card's share is back; Stop here files one for the cash alone", async () => {
    const finished = await fullInvoice({ cash: "20.00" }, { card: "17.00" });
    const first = await give(
      finished.saleId,
      await giveBody(finished.saleId, ask("goodwill", "25.00")),
    );
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    expect(first.json).toMatchObject({
      parts: [{ kind: "correction", amount: "25.00", state: "pending" }],
      underWay: { moneyBack: "20.00", left: "5.00", fileNow: { gross: "20.00" } },
    });
    expect(correctivesOf(finished.saleId)).toEqual([]);
    const leg = await send(
      venue.app,
      adminCookie,
      "POST",
      `/api/transactions/${finished.saleId}/refunds`,
      {
        submissionId: randomUUID(),
        tenderId: await tenderOf(finished.saleId, "card"),
        appliedAmount: "5.00",
        tipAmount: "0.00",
        reason: "Goodwill",
        manualConfirmed: true,
        invoiceCorrectionId: correctionIdOf(first),
        override: supervisor(),
      },
    );
    expect(leg.status, JSON.stringify(leg.json)).toBe(200);
    expect(correctivesOf(finished.saleId)).toEqual([r1(-2500)]);

    const stopped = await fullInvoice({ cash: "20.00" }, { card: "17.00" });
    const opened = await give(
      stopped.saleId,
      await giveBody(stopped.saleId, ask("goodwill", "25.00")),
    );
    const underWay = (opened.json as { underWay: { fileNow: { vatBreakdown: unknown } } }).underWay;
    const stop = await send(
      venue.app,
      adminCookie,
      "POST",
      `/api/invoice-corrections/${correctionIdOf(opened)}/file`,
      { expectedSplit: underWay.fileNow.vatBreakdown },
    );
    expect(stop.status, JSON.stringify(stop.json)).toBe(200);
    expect(stop.json).toMatchObject({ state: "filed", moneyBack: "20.00" });
    expect(correctivesOf(stopped.saleId)).toEqual([r1(-2000)]);
    expect(moneyOf(stopped.saleId)).toEqual([
      { applied: 2000, method: "cash", state: "completed", leg: 1, cancel: null },
    ]);
  });

  it("answers the press sent again with its first result, writing nothing", async () => {
    const { saleId } = await fullInvoice({ cash: "37.00" });
    const body = await giveBody(saleId, ask("goodwill", "10.00"));
    const first = await give(saleId, body);
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    expect(correctivesOf(saleId)).toEqual([r1(-1000)]);
    const written = {
      correctives: correctivesOf(saleId),
      money: moneyOf(saleId),
      drawer: drawerCents(),
    };
    expect(await give(saleId, body)).toEqual(first);
    expect({
      correctives: correctivesOf(saleId),
      money: moneyOf(saleId),
      drawer: drawerCents(),
    }).toEqual(written);
  });

  it("moves no money while the business has no registered address", async () => {
    // On the reader each part's money goes out in its own transaction, so a refusal after a part
    // would leave that refund behind; cash would undo it with the press.
    const { saleId } = await fullInvoice({ reader: "37.00" });
    const reader = await tenderOf(saleId, "card");
    const body = await giveBody(saleId, ask("goodwill", "10.00", { way: reader }));
    await inTx(venue, (tx) => tx.update(taxpayer).set({ taxpayerDomicile: null }));
    onTestFinished(async () => {
      await inTx(venue, (tx) => tx.update(taxpayer).set({ taxpayerDomicile: DOMICILE }));
    });
    const cardRefunds = venue.card.refundCalls.length;
    const refused = { status: 409, json: { code: "fiscal.taxpayer_domicile_missing", params: {} } };
    expect(await routePreview(saleId, ask("goodwill", "10.00", { way: reader }))).toEqual(refused);
    expect(await give(saleId, body)).toEqual(refused);
    expect(moneyOf(saleId)).toEqual([]);
    expect(correctivesOf(saleId)).toEqual([]);
    expect(venue.card.refundCalls.length).toBe(cardRefunds);
  });

  it("files an R1 against a full invoice an advance was taken off", async () => {
    const billId = await tabWith(venue, "Steak", "House salad");
    await payPart(billId, { cash: "10.00" }, { ownReceipt: true });
    const [advance] = await venue.db
      .select()
      .from(billAdvances)
      .where(eq(billAdvances.workingOrderId, billId));
    expect(advance).toBeDefined();
    await fixture.chooseFullInvoice(venue, billId);
    await payPart(billId, { cash: "27.00" });
    const saleId = await fixture.saleOf(venue, billId);
    const answer = await give(saleId, await giveBody(saleId, ask("goodwill", "10.00")));
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(answer.json).toMatchObject({ parts: [{ kind: "correction", state: "completed" }] });
    expect(correctivesOf(saleId)).toEqual([r1(-1000)]);
    expect(correctivesOf(advance!.advanceSaleId)).toEqual([]);
  });

  it("gives goodwill back as a plain refund on a full invoice AEAT refused with no fix", async () => {
    const { saleId } = await fullInvoice({ cash: "37.00" });
    await inTx(venue, (tx) => refusedByAeat(tx, saleId));
    const body = await giveBody(saleId, ask("goodwill", "10.00"));
    expect(body.expected).toEqual([{ kind: "refund", amount: "10.00", way: "cash" }]);
    const answer = await give(saleId, body);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(correctivesOf(saleId)).toEqual([]);
    expect(moneyOf(saleId)).toEqual([
      { applied: 1000, method: "cash", state: "completed", leg: 0, cancel: null },
    ]);
  });

  it("pays a cancel still owed plain first, then files the rest as an R1", async () => {
    const { billId, saleId } = await fullInvoice({ cash: "37.00" });
    const cancelId = await cancelSteak(billId);
    const body = await giveBody(saleId, ask("goodwill", "30.00"));
    expect(body.expected).toEqual([
      { kind: "refund", amount: "25.00", way: "cash" },
      { kind: "correction", amount: "5.00", way: "cash", lineIds: [] },
    ]);
    const answer = await give(saleId, body);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(correctivesOf(saleId)).toEqual([r1(-500)]);
    expect(moneyOf(saleId)).toEqual([
      { applied: 2500, method: "cash", state: "completed", leg: 0, cancel: cancelId },
      { applied: 500, method: "cash", state: "completed", leg: 1, cancel: null },
    ]);
  });
});

describe("a fresh leg on an open give-back once its corrective cannot be filed", () => {
  /** A €25.00 goodwill give-back on the sale, pressed on `way`; the correction's id. */
  async function opened(saleId: string, way = "cash") {
    const body = await giveBody(saleId, ask("goodwill", "25.00", { way }));
    const answer = await give(saleId, {
      ...body,
      ...(way === "cash" ? {} : { manualConfirmed: true, override: supervisor() }),
    });
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    return correctionIdOf(answer);
  }

  const cardLeg = (saleId: string, correctionId: string, tenderId: string) =>
    send(venue.app, adminCookie, "POST", `/api/transactions/${saleId}/refunds`, {
      submissionId: randomUUID(),
      tenderId,
      appliedAmount: "5.00",
      tipAmount: "0.00",
      reason: "Goodwill",
      invoiceCorrectionId: correctionId,
      override: supervisor(),
    });

  const cashLeg = (correctionId: string, amount: string) =>
    send(venue.app, adminCookie, "POST", `/api/invoice-corrections/${correctionId}/cash`, {
      submissionId: randomUUID(),
      amount,
      override: supervisor(),
    });

  it("while the corrective can be filed, takes a reader leg, counts it and files one R1", async () => {
    const { saleId } = await fullInvoice({ cash: "20.00" }, { reader: "17.00" });
    const correctionId = await opened(saleId);
    const leg = await cardLeg(saleId, correctionId, await tenderOf(saleId, "card"));
    expect(leg).toMatchObject({ status: 200, json: { state: "completed", appliedAmount: "5.00" } });
    expect(moneyOf(saleId)).toEqual([
      { applied: 500, method: "card", state: "completed", leg: 1, cancel: null },
      { applied: 2000, method: "cash", state: "completed", leg: 1, cancel: null },
    ]);
    expect(correctivesOf(saleId)).toEqual([r1(-2500)]);
  });

  it("refuses a reader leg on a full invoice held from sending, as a fresh preview does, sending nothing", async () => {
    const { saleId } = await fullInvoice({ cash: "20.00" }, { reader: "17.00" });
    const correctionId = await opened(saleId);
    await inTx(venue, (tx) => heldFromSending(tx, saleId));
    const refused = {
      status: 409,
      json: { code: "sale.correction_not_admitted", params: { reason: "filing_refused" } },
    };
    const before = { money: moneyOf(saleId), calls: venue.card.refundCalls.length };
    expect(await cardLeg(saleId, correctionId, await tenderOf(saleId, "card"))).toEqual(refused);
    expect({ money: moneyOf(saleId), calls: venue.card.refundCalls.length }).toEqual(before);
    expect(correctivesOf(saleId)).toEqual([]);
  });

  it("refuses a reader leg while the business has no registered address, sending nothing", async () => {
    const { saleId } = await fullInvoice({ cash: "20.00" }, { reader: "17.00" });
    const correctionId = await opened(saleId);
    await inTx(venue, (tx) => tx.update(taxpayer).set({ taxpayerDomicile: null }));
    onTestFinished(async () => {
      await inTx(venue, (tx) => tx.update(taxpayer).set({ taxpayerDomicile: DOMICILE }));
    });
    const before = { money: moneyOf(saleId), calls: venue.card.refundCalls.length };
    expect(await cardLeg(saleId, correctionId, await tenderOf(saleId, "card"))).toEqual({
      status: 409,
      json: { code: "fiscal.taxpayer_domicile_missing", params: {} },
    });
    expect({ money: moneyOf(saleId), calls: venue.card.refundCalls.length }).toEqual(before);
  });

  it("refuses cash making up the rest, and cash short of it, with no money moved", async () => {
    const { saleId } = await fullInvoice({ card: "17.00" }, { cash: "20.00" });
    const correctionId = await opened(saleId, await tenderOf(saleId, "card"));
    await inTx(venue, (tx) => heldFromSending(tx, saleId));
    const refused = {
      status: 409,
      json: { code: "sale.correction_not_admitted", params: { reason: "filing_refused" } },
    };
    const before = { money: moneyOf(saleId), drawer: drawerCents() };
    expect(await cashLeg(correctionId, "8.00")).toEqual(refused);
    expect({ money: moneyOf(saleId), drawer: drawerCents() }).toEqual(before);
    expect(await cashLeg(correctionId, "3.00")).toEqual(refused);
    expect({ money: moneyOf(saleId), drawer: drawerCents() }).toEqual(before);
  });

  it("refuses a separate terminal's leg on a receipt AEAT refused", async () => {
    const billId = await tabWith(venue, "Steak", "House salad");
    await payPart(billId, { cash: "20.00" });
    await payPart(billId, { card: "17.00" });
    const saleId = await fixture.saleOf(venue, billId);
    const correctionId = await opened(saleId);
    await inTx(venue, (tx) => refusedByAeat(tx, saleId));
    const before = moneyOf(saleId);
    const leg = await send(venue.app, adminCookie, "POST", `/api/transactions/${saleId}/refunds`, {
      submissionId: randomUUID(),
      tenderId: await tenderOf(saleId, "card"),
      appliedAmount: "5.00",
      tipAmount: "0.00",
      reason: "Goodwill",
      manualConfirmed: true,
      invoiceCorrectionId: correctionId,
      override: supervisor(),
    });
    expect(leg).toEqual({
      status: 409,
      json: { code: "sale.correction_not_admitted", params: { reason: "filing_refused" } },
    });
    expect(moneyOf(saleId)).toEqual(before);
  });

  it("on a full invoice AEAT refused with no fix, takes cash and a reader leg unrecorded, and Finish lists them for the accountant", async () => {
    const { saleId } = await fullInvoice({ card: "10.00" }, { cash: "20.00" }, { reader: "7.00" });
    const [keyed] = venue.db.all<{ id: string }>(
      sql`select id from tenders where sale_id = ${saleId} and method = 'card' and amount = 1000`,
    );
    const correctionId = await opened(saleId, keyed!.id);
    await inTx(venue, (tx) => refusedByAeat(tx, saleId));

    const cash = await cashLeg(correctionId, "8.00");
    expect(cash.status, JSON.stringify(cash.json)).toBe(200);
    const reader = venue.db.all<{ id: string }>(
      sql`select id from tenders where sale_id = ${saleId} and method = 'card' and amount = 700`,
    )[0]!.id;
    expect(await cardLeg(saleId, correctionId, reader)).toMatchObject({
      status: 200,
      json: { state: "completed", appliedAmount: "5.00" },
    });
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
    const listed = await inTx(venue, (tx) => refundsWithoutCorrectiveQuery(tx, () => sql`1`));
    expect(
      listed
        .filter((row) => row.saleId === saleId)
        .map(({ applied, method }) => ({ applied, method }))
        .sort((a, b) => a.applied - b.applied),
    ).toEqual([
      { applied: 500, method: "card" },
      { applied: 800, method: "cash" },
      { applied: 1000, method: "card" },
    ]);
  });

  it("on a full invoice AEAT refused with no fix, takes cash making up the rest, files nothing, and Finish closes it", async () => {
    const { saleId } = await fullInvoice({ card: "17.00" }, { cash: "20.00" });
    const correctionId = await opened(saleId, await tenderOf(saleId, "card"));
    await inTx(venue, (tx) => refusedByAeat(tx, saleId));
    const drawer = drawerCents();

    const part = await cashLeg(correctionId, "3.00");
    expect(part.status, JSON.stringify(part.json)).toBe(200);
    const rest = await cashLeg(correctionId, "5.00");
    expect(rest.status, JSON.stringify(rest.json)).toBe(200);
    expect(rest.json).toMatchObject({
      correction: { state: "open", moneyBack: "25.00", left: "0.00" },
    });
    expect(correctivesOf(saleId)).toEqual([]);
    expect(drawerCents()).toBe(drawer - 800);

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
  });

  it.each([
    ["the card reader", { reader: "17.00" }, false],
    ["a separate terminal", { card: "17.00" }, true],
  ] as const)(
    "on a full invoice AEAT refused with no fix, keeps a leg on %s making up the rest, files nothing, and Finish closes it",
    async (_, card, manualConfirmed) => {
      const { saleId } = await fullInvoice({ cash: "20.00" }, card);
      const correctionId = await opened(saleId);
      await inTx(venue, (tx) => refusedByAeat(tx, saleId));
      const leg = await send(
        venue.app,
        adminCookie,
        "POST",
        `/api/transactions/${saleId}/refunds`,
        {
          submissionId: randomUUID(),
          tenderId: await tenderOf(saleId, "card"),
          appliedAmount: "5.00",
          tipAmount: "0.00",
          reason: "Goodwill",
          ...(manualConfirmed && { manualConfirmed }),
          invoiceCorrectionId: correctionId,
          override: supervisor(),
        },
      );
      expect(leg).toMatchObject({
        status: 200,
        json: { state: "completed", appliedAmount: "5.00" },
      });
      expect(correctivesOf(saleId)).toEqual([]);
      const finished = await send(
        venue.app,
        adminCookie,
        "POST",
        `/api/invoice-corrections/${correctionId}/close`,
        {},
      );
      expect(finished.status, JSON.stringify(finished.json)).toBe(200);
      expect(finished.json).toMatchObject({
        state: "closed",
        moneyBack: "25.00",
        correctiveSaleId: null,
      });
      expect(correctivesOf(saleId)).toEqual([]);
    },
  );

  it("on a receipt this box can no longer correct, takes cash making up the rest, files nothing, and Finish closes it", async () => {
    const billId = await tabWith(venue, "Steak", "House salad");
    await payPart(billId, { card: "17.00" });
    await payPart(billId, { cash: "20.00" });
    const saleId = await fixture.saleOf(venue, billId);
    const correctionId = await opened(saleId, await tenderOf(saleId, "card"));
    const otherBox = vi
      .spyOn(venue.backend, "correctionAdmissionFor")
      .mockResolvedValue({ eligible: false, reason: "wrong_node" });
    onTestFinished(() => otherBox.mockRestore());

    const rest = await cashLeg(correctionId, "8.00");
    expect(rest.status, JSON.stringify(rest.json)).toBe(200);
    expect(rest.json).toMatchObject({ correction: { state: "open", moneyBack: "25.00" } });
    expect(correctivesOf(saleId)).toEqual([]);
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
  });
});

/** A still-charge cancel of the bill's Steak (its first line) with Refund ticked; its id. */
async function cancelSteak(billId: string): Promise<string> {
  const [order] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, billId));
  const [line] = venue.db.all<{ id: string }>(
    sql`select id from working_order_lines where working_order_id = ${billId} and line_no = 1`,
  );
  await inTx(venue, async (tx) => {
    const [party] = await tx.select().from(parties).where(eq(parties.id, order!.partyId!));
    return cancelItem(
      tx,
      venue.cfg,
      order!.partyId!,
      line!.id,
      {
        quantity: "1",
        expectedEdit: await readBillEditState(tx, billId),
        outcome: "keep_charge",
        reasonId: voidReasonId,
        expectedPartyRevision: party!.revision,
        expectedBillRevision: order!.revision,
        expectedContext: await readCancellationContext(tx, order!.partyId!, line!.id),
        submissionId: randomUUID(),
        refundHandoff: true,
        admission: testTradingAdmission(),
      },
      venue.adminId,
    );
  });
  const rows = await venue.db.select().from(adjustments).where(eq(adjustments.lineId, line!.id));
  return rows.find((row) => row.action === "cancel")!.id;
}
