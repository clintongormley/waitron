import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  invoiceSeries,
  nodes,
  saleSettlements,
  saleSubstitutions,
  saleVoids,
  sales,
  tenders,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { recordCorrection } from "@waitron/core";
import { loginWithPin } from "@waitron/identity";
import { saleId as brandSaleId, seriesId as brandSeriesId } from "@waitron/shared";
import { readBillEditState } from "./bill-editing.js";
import { saveDraft } from "./order-drafts.js";
import { readDeferredClosure } from "./deferred-close.js";
import { readOrderRevision } from "./working-order.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import {
  abandonHeldOrder,
  setOrderInvoiceChoice,
  setOrderReceiptLanguage,
} from "./testing/order-writer-fixture.js";
import { inTx, seatedWith, send, type Answer } from "./testing/bill-venue.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { collectOrderOrchestration } from "./testing/whole-payment-fixture.js";
import {
  MINUTE,
  RECIPIENT,
  clockAt,
  refusal,
  deferredCloseVenue,
  type DeferredCloseKit,
} from "./testing/deferred-close-fixture.js";
import "./errors.js";

// Every refusal of a deferred close leaves the ledger as it was; beside each, where
// one exists, the legitimate close that must still be served.
let t: DeferredCloseKit;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    t = await deferredCloseVenue(db);
  },
});

async function refusedWithNothingWritten(run: () => Promise<unknown>) {
  const before = await t.ledger();
  const error = await refusal(run());
  expect(await t.ledger()).toEqual(before);
  return error;
}

async function counterRequest(billId: string, over = {}) {
  return t.requestFor(billId, "18.00", null, over);
}

async function issuedSaleOf(billId: string) {
  const [sale] = await inTx(t.venue, (tx) =>
    tx.select().from(sales).where(eq(sales.workingOrderId, billId)),
  );
  return sale!;
}

function ineligible(billId: string, reason: string) {
  return { code: "deferred_close.ineligible", params: { workingOrderId: billId, reason } };
}

async function correct(saleId: string) {
  await inTx(t.venue, async (tx) => {
    const [series] = await tx
      .select({ id: invoiceSeries.id })
      .from(invoiceSeries)
      .where(
        and(
          eq(invoiceSeries.nodeId, t.venue.cfg.nodeId),
          eq(invoiceSeries.purpose, "rectificative"),
        ),
      );
    const session = await loginWithPin(tx, {
      deviceId: t.venue.deviceId,
      personId: t.venue.adminId,
      pin: "1234",
    });
    await recordCorrection(tx, t.venue.backend, {
      origin: t.venue.cfg.origin,
      nodeId: t.venue.cfg.nodeId,
      seriesId: brandSeriesId(series!.id),
      correctsSaleId: brandSaleId(saleId),
      total: "-2.42",
      lines: [
        {
          lineNo: 1,
          name: "Descuento",
          descriptions: { [t.venue.cfg.locale]: "Descuento" },
          quantity: "-1",
          unitPrice: "2.00",
          vatRate: "21.00",
          lineTotal: "-2.00",
        },
      ],
      clock: t.venue.clock,
      authz: { sessionId: session.id },
    });
  });
}

function payPart(
  party: { tabId: string },
  amount: string,
  method: "cash" | "card" = "cash",
): Promise<Answer> {
  const tender =
    method === "cash" ? { method, tendered: amount } : { method, entry: "reader" as const };
  return inTx(t.venue, (tx) => readBillEditState(tx, party.tabId)).then((expectedEdit) =>
    send(t.venue.app, t.venue.cookie, "POST", `/api/working-orders/${party.tabId}/payments`, {
      submissionId: randomUUID(),
      expectedEdit,
      kind: "contribution",
      amount,
      ...tender,
      applied: amount,
      tip: "0.00",
    }),
  );
}

describe("closeBillDeferredTx refuses, before writing anything", () => {
  it("a stopped disk, whether the route saw it or the state notes it", async () => {
    const billId = await t.counterOrder("placed");
    const request = await counterRequest(billId);

    const routed = await refusedWithNothingWritten(() =>
      t.close(request, t.depsWith({ diskBlockedBeforeQueue: true })),
    );
    const noted = await refusedWithNothingWritten(() =>
      t.close(request, t.depsWith({ disk: diskNoted(true) })),
    );

    for (const error of [routed, noted]) expect(error.code).toBe("storage.disk_full");
    const served = await t.close(request, t.depsWith({ disk: diskNoted(false) }));
    expect(served.workingOrderId).toBe(billId);
  });

  it("a clock more than a minute behind the latest record, serving one within the minute", async () => {
    const billId = await t.counterOrder("placed");
    const request = await counterRequest(billId);
    const latest = t.latestRecordMs();

    const error = await refusedWithNothingWritten(() =>
      t.close(request, t.depsWith({ clock: clockAt(latest - 10 * MINUTE) })),
    );

    expect(error.code).toBe("clock.behind_chain");
    const served = await t.close(request, t.depsWith({ clock: clockAt(latest - 30_000) }));
    expect(served.workingOrderId).toBe(billId);
  });

  it("a bill that does not exist", async () => {
    const missing = randomUUID();
    const request = { ...(await counterRequest(await t.counterOrder("placed"))), id: missing };

    const error = await refusedWithNothingWritten(() => t.close(request));

    expect(error.code).toBe("working_order.not_open");
    expect(error.params).toEqual({ workingOrderId: missing });
  });

  it("a bill another node holds", async () => {
    const billId = await t.counterOrder("open");
    const request = await counterRequest(billId);
    const otherNode = randomUUID();
    await inTx(t.venue, async (tx) => {
      await tx.insert(nodes).values({ id: otherNode, name: "Spare" });
      await tx.update(workingOrders).set({ nodeId: otherNode }).where(eq(workingOrders.id, billId));
    });

    const error = await refusedWithNothingWritten(() => t.close(request));

    expect(error).toMatchObject(ineligible(billId, "other_node"));
  });

  it("a bill already paid in full the ordinary way", async () => {
    const billId = await t.counterOrder("placed", true);
    const request = await counterRequest(billId);
    await collectOrderOrchestration(
      {
        admission: testTradingAdmission(),
        db: t.venue.db,
        backend: t.venue.backend,
        clock: t.venue.clock,
      },
      t.venue.cfg,
      { id: billId, lines: [], tender: { method: "cash", amount: "20.00" } },
      t.venue.operatorId,
    );

    const error = await refusedWithNothingWritten(() =>
      t.close({ ...request, expectedRevision: request.expectedRevision + 1 }),
    );

    expect(error).toMatchObject(ineligible(billId, "final_without_deferral"));
  });

  it("an abandoned bill", async () => {
    const billId = await t.counterOrder("open");
    await abandonHeldOrder({ db: t.venue.db }, t.venue.cfg, billId);

    const error = await refusedWithNothingWritten(async () =>
      t.close(await counterRequest(billId)),
    );

    expect(error).toMatchObject(ineligible(billId, "void"));
  });

  it("a stale revision", async () => {
    const billId = await t.counterOrder("placed");
    const request = await counterRequest(billId);

    const error = await refusedWithNothingWritten(() =>
      t.close({ ...request, expectedRevision: request.expectedRevision - 1 }),
    );

    expect(error.code).toBe("working_order.out_of_date");
    expect(error.params).toEqual({ workingOrderId: billId, revision: request.expectedRevision });
    expect(await inTx(t.venue, (tx) => readDeferredClosure(tx, billId))).toBeNull();
  });

  it("a stale bill edit, another person's draft, and the closer's own unsent dishes", async () => {
    const stale = await seatedWith(t.venue, "House salad");
    const staleRequest = await t.requestFor(stale.tabId, "12.00", stale.partyId);
    const taken = await seatedWith(t.venue, "House salad");
    const ownUnsent = await seatedWith(t.venue, "House salad");
    for (const [party, personId] of [
      [taken, t.venue.adminId],
      [ownUnsent, t.venue.operatorId],
    ] as const)
      await inTx(t.venue, async (tx) =>
        saveDraft(tx, t.venue.cfg, party.partyId, personId, {
          billId: party.tabId,
          expectedEdit: await readBillEditState(tx, party.tabId),
          draftId: null,
          revision: 0,
          lines: [{ menuItemId: t.venue.offerFor("Tarta"), quantity: "1" }],
        }),
      );

    const staleError = await refusedWithNothingWritten(() =>
      t.close({
        ...staleRequest,
        expectedEdit: { ...staleRequest.expectedEdit!, editorVersion: 99 },
      }),
    );
    const takenError = await refusedWithNothingWritten(async () =>
      t.close(await t.requestFor(taken.tabId, "12.00", taken.partyId)),
    );
    const unsentError = await refusedWithNothingWritten(async () =>
      t.close(await t.requestFor(ownUnsent.tabId, "12.00", ownUnsent.partyId)),
    );

    expect(staleError.code).toBe("draft.out_of_date");
    expect(takenError.code).toBe("draft.taken_over");
    expect(unsentError).toMatchObject({
      code: "bill.unsent_dishes",
      params: { billId: ownUnsent.tabId },
    });
    expect((await t.close(staleRequest)).workingOrderId).toBe(stale.tabId);
  });

  it("a bill holding an earlier payment, even a part, but not one whose only card was declined", async () => {
    const party = await seatedWith(t.venue, "House salad");
    const paid = await payPart(party, "5.00");
    expect(paid.status).toBe(200);
    const declinedParty = await seatedWith(t.venue, "House salad");
    t.venue.card.failNextCollect();
    const declined = await payPart(declinedParty, "5.00", "card");
    expect(declined.status).toBe(200);
    expect(declined.json).toMatchObject({
      outcome: "declined",
      payment: { state: "failed" },
      balance: { received: "0.00", reserved: "0.00" },
    });

    const error = await refusedWithNothingWritten(async () =>
      t.close(await t.requestFor(party.tabId, "12.00", party.partyId)),
    );

    expect(error).toMatchObject(ineligible(party.tabId, "prior_payment"));
    const served = await t.close(
      await t.requestFor(declinedParty.tabId, "12.00", declinedParty.partyId),
    );
    expect(served.workingOrderId).toBe(declinedParty.tabId);
  });

  it("a bill whose payment was given back in full", async () => {
    const party = await seatedWith(t.venue, "House salad");
    const paid = await payPart(party, "5.00");
    expect(paid.status).toBe(200);
    const paymentId = (paid.json.payment as { id: string }).id;
    const refunded = await send(
      t.venue.app,
      t.venue.cookie,
      "POST",
      `/api/working-orders/${party.tabId}/payments/${paymentId}/refunds`,
      {
        submissionId: randomUUID(),
        appliedAmount: "5.00",
        tipAmount: "0.00",
        reason: "Customer requested it",
        override: { personId: t.venue.adminId, pin: "1234" },
      },
    );
    expect(refunded.status).toBe(200);
    expect(refunded.json).toMatchObject({
      refund: { appliedAmount: "5.00", state: "completed" },
      balance: { received: "0.00" },
    });

    const error = await refusedWithNothingWritten(async () =>
      t.close(await t.requestFor(party.tabId, "12.00", party.partyId)),
    );

    expect(error).toMatchObject(ineligible(party.tabId, "prior_payment"));
  });

  it("a bill whose card payment is still being taken", async () => {
    const billId = await t.counterOrder("open");
    await inTx(t.venue, (tx) =>
      tx
        .update(workingOrders)
        .set({ paymentAttemptAt: new Date().toISOString() })
        .where(eq(workingOrders.id, billId)),
    );

    const error = await refusedWithNothingWritten(async () =>
      t.close(await counterRequest(billId)),
    );

    expect(error.code).toBe("order.payment_in_flight");
    expect(error.params).toEqual({ workingOrderId: billId });
  });

  it("a request whose invoice type or total is not the bill's", async () => {
    const billId = await t.counterOrder("placed");
    const request = await counterRequest(billId);
    const conflict = { code: "deferred_close.conflict", params: { workingOrderId: billId } };

    const type = await refusedWithNothingWritten(() =>
      t.close({ ...request, invoiceType: "F1", recipient: RECIPIENT }),
    );
    const total = await refusedWithNothingWritten(() =>
      t.close({ ...request, expectedTotal: "17.99" }),
    );

    expect(type).toMatchObject(conflict);
    expect(total).toMatchObject(conflict);
    expect((await t.close(request)).total).toBe("18.00");
  });

  it("a bill whose total is not positive", async () => {
    const billId = await t.counterOrder("open");
    await inTx(t.venue, (tx) =>
      tx
        .update(workingOrderLines)
        .set({ unitPriceGross: 0 })
        .where(eq(workingOrderLines.workingOrderId, billId)),
    );

    const error = await refusedWithNothingWritten(async () =>
      t.close(await t.requestFor(billId, "0.00", null)),
    );

    expect(error).toMatchObject(ineligible(billId, "non_positive"));
  });
});

describe("closeBillDeferredTx refuses an issued invoice that is no longer whole", () => {
  it("one a corrective invoice has corrected", async () => {
    const billId = await t.counterOrder("placed", true);
    await correct((await issuedSaleOf(billId)).id);

    const error = await refusedWithNothingWritten(async () =>
      t.close(await counterRequest(billId)),
    );

    expect(error).toMatchObject(ineligible(billId, "correction"));
  });

  it("one with a tender or a void", async () => {
    for (const reason of ["prior_tender", "void"] as const) {
      const billId = await t.counterOrder("placed", true);
      const saleId = (await issuedSaleOf(billId)).id;
      const at = new Date().toISOString();
      await inTx(t.venue, async (tx) => {
        if (reason === "prior_tender")
          await tx.insert(tenders).values({ saleId, method: "cash", amount: 500, settledAt: at });
        else await tx.insert(saleVoids).values({ saleId, reason: "Mistake", voidedAt: at });
      });

      const error = await refusedWithNothingWritten(async () =>
        t.close(await counterRequest(billId)),
      );

      expect(error).toMatchObject(ineligible(billId, reason));
    }
  });

  it("one already settled with nothing tendered, as only a zero invoice can be", async () => {
    const billId = await t.counterOrder("open");
    await inTx(t.venue, (tx) =>
      tx
        .update(workingOrderLines)
        .set({ unitPriceGross: 0 })
        .where(eq(workingOrderLines.workingOrderId, billId)),
    );
    await issueOrderInvoice(
      {
        db: t.venue.db,
        backend: t.venue.backend,
        clock: t.venue.clock,
        admission: testTradingAdmission(),
      },
      t.venue.cfg,
      billId,
      t.venue.operatorId,
    );
    const saleId = (await issuedSaleOf(billId)).id;
    await inTx(t.venue, (tx) =>
      tx.insert(saleSettlements).values({ saleId, settledAt: new Date().toISOString() }),
    );

    const error = await refusedWithNothingWritten(async () =>
      t.close(await t.requestFor(billId, "0.00", null)),
    );

    expect(error).toMatchObject(ineligible(billId, "final_without_deferral"));
  });

  it("a request naming another recipient than an issued full invoice froze, serving the same one", async () => {
    const party = await seatedWith(t.venue, "House salad");
    await setOrderInvoiceChoice(t.venue.db, t.venue.backend, t.venue.cfg, party.tabId, {
      revision: await inTx(t.venue, (tx) => readOrderRevision(tx, party.tabId)),
      invoiceType: "F1",
      recipient: RECIPIENT,
    });
    await issueOrderInvoice(
      {
        db: t.venue.db,
        backend: t.venue.backend,
        clock: t.venue.clock,
        admission: testTradingAdmission(),
      },
      t.venue.cfg,
      party.tabId,
      t.venue.operatorId,
    );
    const request = await t.requestFor(party.tabId, "12.00", party.partyId);

    const error = await refusedWithNothingWritten(() =>
      t.close({
        ...request,
        recipient: { ...RECIPIENT, address: "3 Main Street, 28013 Madrid, Madrid" },
      }),
    );

    expect(error).toMatchObject({
      code: "deferred_close.conflict",
      params: { workingOrderId: party.tabId },
    });
    expect((await t.close(request)).saleId).toBe((await issuedSaleOf(party.tabId)).id);
  });

  it("either side of a substitution, and still reuses an untouched one", async () => {
    const substitution = await t.counterOrder("placed", true);
    const substituted = await t.counterOrder("placed", true);
    const substitutionSaleId = (await issuedSaleOf(substitution)).id;
    const substitutedSaleId = (await issuedSaleOf(substituted)).id;
    await inTx(t.venue, (tx) =>
      tx.insert(saleSubstitutions).values({ substitutionSaleId, substitutedSaleId }),
    );
    const untouched = await t.counterOrder("placed", true);

    for (const billId of [substitution, substituted]) {
      const error = await refusedWithNothingWritten(async () =>
        t.close(await counterRequest(billId)),
      );
      expect(error).toMatchObject(ineligible(billId, "substitution"));
    }
    const served = await t.close(await counterRequest(untouched));
    expect(served.saleId).toBe((await issuedSaleOf(untouched)).id);
  });

  it("a request naming another language than the invoice was filed in", async () => {
    const billId = await t.counterOrder("placed", true);

    const error = await refusedWithNothingWritten(async () =>
      t.close(await counterRequest(billId, { receiptLanguage: "en" })),
    );

    expect(error).toMatchObject({
      code: "deferred_close.conflict",
      params: { workingOrderId: billId },
    });
  });
});

describe("closeBillDeferredTx compares the staged invoice choice", () => {
  async function stagedF1() {
    const party = await seatedWith(t.venue, "House salad");
    await setOrderInvoiceChoice(t.venue.db, t.venue.backend, t.venue.cfg, party.tabId, {
      revision: await inTx(t.venue, (tx) => readOrderRevision(tx, party.tabId)),
      invoiceType: "F1",
      recipient: RECIPIENT,
    });
    await inTx(t.venue, (tx) =>
      tx
        .update(workingOrders)
        .set({
          invoiceDelivery: { medium: "a4", pagePrinterId: printerId, personId: t.venue.adminId },
        })
        .where(eq(workingOrders.id, party.tabId)),
    );
    return party;
  }
  const printerId = randomUUID();

  it.each([
    ["recipient", { recipient: { ...RECIPIENT, legalName: "Otro Cliente SL" } }],
    ["missing recipient", { recipient: null }],
    ["delivery", { delivery: { medium: "a4", pagePrinterId: randomUUID() } }],
    ["delivery medium", { delivery: { medium: "receipt" } }],
    ["no delivery", { delivery: null }],
    ["language", { receiptLanguage: "en" }],
  ] as const)("refuses a request with another %s", async (_name, over) => {
    const party = await stagedF1();
    const request = await t.requestFor(party.tabId, "12.00", party.partyId, {
      delivery: { medium: "a4", pagePrinterId: printerId },
      ...over,
    });

    const error = await refusedWithNothingWritten(() => t.close(request));

    expect(error).toMatchObject({
      code: "deferred_close.conflict",
      params: { workingOrderId: party.tabId },
    });
  });

  it("serves the staged choice, whoever staged its delivery", async () => {
    const party = await stagedF1();
    const request = await t.requestFor(party.tabId, "12.00", party.partyId, {
      delivery: { medium: "a4", pagePrinterId: printerId.toUpperCase() },
    });

    expect((await t.close(request)).workingOrderId).toBe(party.tabId);
  });

  it("refuses a recipient on a simplified invoice, and serves a staged receipt language", async () => {
    const billId = await t.counterOrder("open");
    await setOrderReceiptLanguage(t.venue.db, billId, {
      revision: await inTx(t.venue, (tx) => readOrderRevision(tx, billId)),
      language: t.venue.cfg.locale,
    });
    await inTx(t.venue, (tx) =>
      tx
        .update(workingOrders)
        .set({ invoiceDelivery: { medium: "receipt" } })
        .where(eq(workingOrders.id, billId)),
    );
    const request = await counterRequest(billId, { delivery: { medium: "receipt" } });

    const error = await refusedWithNothingWritten(() =>
      t.close({ ...request, recipient: RECIPIENT }),
    );

    expect(error.code).toBe("deferred_close.conflict");
    expect((await t.close(request)).workingOrderId).toBe(billId);
  });
});

describe("closeBillDeferredTx on a frozen day", () => {
  // Freezes today's business day, so it runs last.
  it("refuses new work on a business day this node has frozen", async () => {
    const billId = await t.counterOrder("placed");
    const request = await counterRequest(billId);
    const sameDay = t.depsWith({ clock: t.sameDayClock() });
    const businessDay = (
      await t.close(await counterRequest(await t.counterOrder("placed")), sameDay)
    ).businessDay;
    await t.freezeDay(businessDay);

    const error = await refusedWithNothingWritten(() => t.close(request, sameDay));

    expect(error.code).toBe("deferred_close.day_frozen");
    expect(error.params).toEqual({ nodeId: t.venue.cfg.nodeId, businessDay });
  });
});

function diskNoted(noted: boolean) {
  return {
    noteRefused: () => {},
    noted: () => noted,
    full: () => Promise.resolve(noted),
    since: () => (noted ? new Date() : null),
  };
}
