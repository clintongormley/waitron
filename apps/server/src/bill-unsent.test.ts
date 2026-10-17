import { placeOrder } from "./testing/order-writer-fixture.js";
import { readBillEditState } from "./bill-editing.js";
import { saveDraftForTest as saveDraft } from "./testing/draft-command-fixture.js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  orderDraftLines,
  orderDraftRecalledLines,
  orderDrafts,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { persons } from "@waitron/identity";
import { insertCapturedPayment } from "@waitron/payments";
import { decimal } from "@waitron/shared";

import type { Draft } from "./order-drafts.js";
import { issueIfFullyPaid, previewBillPayment, type BillPaymentAsk } from "./bill-payments.js";
import { payWorkingOrder, payWorkingOrderIntegratedOrchestration } from "./till-sale.js";
import { createOpenOrder } from "./working-order.js";
import {
  inTx,
  paymentRows,
  provisionBillVenue,
  registroCount,
  partyRevisionOf,
  seatedWith,
  send,
  statusOf,
  tabWith,
  type BillVenue,
} from "./testing/bill-venue.js";

let venue: BillVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  setup: async (db) => {
    venue = await provisionBillVenue(db);
  },
});

describe("payment reservations and previously received money", () => {
  it.each(["cash", "card"] as const)("refuses whole %s through the sale route", async (method) => {
    const billId = await tabWith(venue, "Tarta");
    await unsent(billId);
    const paid = await send(venue.app, venue.cookie, "POST", "/api/sales", {
      workingOrderId: billId,
      lines: [],
      tender: { method, amount: "18.00" },
    });
    expect(paid.status).toBe(409);
    expect(paid.json).toMatchObject({ code: "bill.unsent_dishes", params: { billId } });
    expect(registroCount(venue, billId)).toBe(0);
  });

  it("refuses a new whole payment through /api/pay", async () => {
    const billId = await tabWith(venue, "Tarta");
    await unsent(billId);
    const calls = venue.card.collectCalls.length;
    const paid = await send(venue.app, venue.cookie, "POST", "/api/pay", { id: billId, lines: [] });
    expect(paid.status).toBe(409);
    expect(paid.json).toMatchObject({ code: "bill.unsent_dishes", params: { billId } });
    expect(venue.card.collectCalls.length).toBe(calls);
  });

  it.each(["cash", "card"] as const)("refuses a new placed-bill %s collection", async (method) => {
    const billId = await tabWith(venue, "Tarta");
    await unsent(billId);
    await placeOrder(deps(), venue.cfg, billId, venue.operatorId);
    const paid = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${billId}/collect`,
      { tender: { method, amount: "18.00" } },
    );
    expect(paid.status).toBe(409);
    expect(paid.json).toMatchObject({ code: "bill.unsent_dishes", params: { billId } });
    expect(registroCount(venue, billId)).toBe(0);
    expect(await statusOf(venue, billId)).toBe("placed");
  });

  it.each(["cash", "manual", "reader"] as const)(
    "replays a received %s contribution even after a new draft appears",
    async (method) => {
      const billId = await tabWith(venue, "Tarta");
      const body = {
        ...ask("contribution", method === "cash" ? "cash" : "card"),
        ...(method === "cash" ? {} : { entry: method }),
        submissionId: randomUUID(),
        applied: "5.00",
        tip: "0.00",
      };
      const path = `/api/working-orders/${billId}/payments`;
      const first = await send(venue.app, venue.cookie, "POST", path, body);
      expect(first.status).toBe(200);
      await unsent(billId);
      const calls = venue.card.collectCalls.length;
      const replay = await send(venue.app, venue.cookie, "POST", path, body);
      expect(replay).toEqual(first);
      expect(await paymentRows(venue, billId)).toHaveLength(1);
      expect(venue.card.collectCalls.length).toBe(calls);
    },
  );

  it("completes an already captured whole payment with a later stored draft, without collecting again", async () => {
    const billId = await tabWith(venue, "Tarta");
    await unsent(billId);
    await inTx(venue, (tx) =>
      insertCapturedPayment(tx, {
        origin: venue.cfg.origin,
        workingOrderId: billId,
        provider: venue.card.provider,
        paymentRef: randomUUID(),
        amount: decimal("18.00"),
        settledAt: new Date(),
      }),
    );
    const calls = venue.card.collectCalls.length;
    const result = await payWorkingOrderIntegratedOrchestration(
      { ...deps(), provider: venue.card },
      venue.cfg,
      { id: billId, lines: [] },
    );
    expect(result).toMatchObject({ outcome: "captured", ticket: { total: "18.00" } });
    expect(venue.card.collectCalls.length).toBe(calls);
    expect(registroCount(venue, billId)).toBe(1);
  });

  it.each(["bill", "whole"] as const)(
    "refuses draft save and Recall while a %s reader reservation runs",
    async (kind) => {
      const p = await seatedWith(venue, "Tarta");
      const [line] = await venue.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, p.tabId));
      const release = venue.card.holdNextCollect();
      const calls = venue.card.collectCalls.length;
      const pending =
        kind === "bill"
          ? send(venue.app, venue.cookie, "POST", `/api/working-orders/${p.tabId}/payments`, {
              kind: "contribution",
              amount: "5.00",
              method: "card",
              entry: "reader",
              applied: "5.00",
              tip: "0.00",
              submissionId: randomUUID(),
            })
          : send(venue.app, venue.cookie, "POST", "/api/pay", { id: p.tabId, lines: [] });
      try {
        await vi.waitFor(() => expect(venue.card.collectCalls.length).toBe(calls + 1));
        await expect(unsent(p.tabId)).rejects.toMatchObject({ code: "order.payment_in_flight" });
        const recalled = await send(
          venue.app,
          venue.cookie,
          "POST",
          `/api/parties/${p.partyId}/lines/${line!.id}/recall`,
          {
            submissionId: randomUUID(),
            expectedPartyRevision: await partyRevisionOf(venue, p.tabId),
            expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, p.tabId)),
          },
        );
        expect(recalled.status).toBe(409);
        expect(recalled.json).toMatchObject({ code: "order.payment_in_flight" });
      } finally {
        release();
        const paid = await pending;
        expect(paid.status).toBe(200);
      }
    },
  );

  it("defers automatic issuance until the last draft is removed", async () => {
    const billId = await tabWith(venue, "Tarta");
    const paid = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${billId}/payments`,
      {
        ...ask("contribution", "cash"),
        submissionId: randomUUID(),
        applied: "5.00",
        tip: "0.00",
      },
    );
    expect(paid.status).toBe(200);
    const draft = await unsent(billId);
    await venue.db
      .update(workingOrderLines)
      .set({ unitPriceGross: 500 })
      .where(eq(workingOrderLines.workingOrderId, billId));
    const issued = await inTx(venue, (tx) =>
      issueIfFullyPaid(tx, deps(), venue.cfg, billId, venue.operatorId),
    );
    expect(issued).toBeNull();
    expect(registroCount(venue, billId)).toBe(0);
    expect(await statusOf(venue, billId)).toBe("open");
    await venue.db.delete(orderDraftLines).where(eq(orderDraftLines.draftId, draft.id));
    const after = await inTx(venue, (tx) =>
      issueIfFullyPaid(tx, deps(), venue.cfg, billId, venue.operatorId),
    );
    expect(after).toMatchObject({ total: "5.00" });
    expect(registroCount(venue, billId)).toBe(1);
  });

  it("issues after the last recalled draft is submitted, after its reference is removed", async () => {
    const p = await seatedWith(venue, "Tarta");
    const paid = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${p.tabId}/payments`,
      {
        ...ask("contribution", "cash"),
        submissionId: randomUUID(),
        applied: "5.00",
        tip: "0.00",
      },
    );
    expect(paid.status).toBe(200);
    const [line] = await venue.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, p.tabId));
    const recalled = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${p.partyId}/lines/${line!.id}/recall`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: await partyRevisionOf(venue, p.tabId),
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, p.tabId)),
      },
    );
    expect(recalled.status).toBe(200);
    const draft = (recalled.json as unknown as { draft: Draft }).draft;
    await venue.db
      .update(workingOrderLines)
      .set({ unitPriceGross: 500 })
      .where(eq(workingOrderLines.id, line!.id));
    const sent = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${p.partyId}/drafts/${draft.id}/submit`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: await partyRevisionOf(venue, p.tabId),
        draftRevision: draft.revision,
        groups: [{ lineIds: [draft.lines[0]!.id], release: "fire" }],
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, p.tabId)),
      },
    );
    expect(sent.status).toBe(200);
    expect(
      await venue.db
        .select()
        .from(orderDraftRecalledLines)
        .where(eq(orderDraftRecalledLines.draftId, draft.id)),
    ).toEqual([]);
    expect(await statusOf(venue, p.tabId)).toBe("settled");
    expect(registroCount(venue, p.tabId)).toBe(1);
  });

  it.each(["empty save", "discard"] as const)(
    "resumes deferred issuance after the last fresh draft's %s",
    async (way) => {
      const billId = await tabWith(venue, "Tarta");
      const paid = await send(
        venue.app,
        venue.cookie,
        "POST",
        `/api/working-orders/${billId}/payments`,
        {
          ...ask("contribution", "cash"),
          submissionId: randomUUID(),
          applied: "5.00",
          tip: "0.00",
        },
      );
      expect(paid.status).toBe(200);
      const draft = await unsent(billId);
      await venue.db
        .update(workingOrderLines)
        .set({ unitPriceGross: 500 })
        .where(eq(workingOrderLines.workingOrderId, billId));
      const [bill] = await venue.db
        .select()
        .from(workingOrders)
        .where(eq(workingOrders.id, billId));
      const answer =
        way === "empty save"
          ? await send(venue.app, venue.cookie, "PUT", `/api/parties/${draft.partyId}/drafts`, {
              billId,
              draftId: draft.id,
              revision: draft.revision,
              lines: [],
              expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, billId)),
            })
          : await send(
              venue.app,
              venue.cookie,
              "POST",
              `/api/parties/${draft.partyId}/drafts/${draft.id}/discard`,
              {
                revision: draft.revision,
                expectedRevision: bill!.revision,
                submissionId: randomUUID(),
                expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, billId)),
              },
            );
      expect(answer.status).toBe(200);
      expect(await statusOf(venue, billId)).toBe("settled");
      expect(registroCount(venue, billId)).toBe(1);
    },
  );

  it("replays a pending reader reservation and files its capture even with a restored draft", async () => {
    const billId = await tabWith(venue, "Tarta");
    const draft = await unsent(billId);
    await venue.db
      .update(orderDrafts)
      .set({ state: "discarded" })
      .where(eq(orderDrafts.id, draft.id));
    const body = {
      kind: "items",
      lines: [{ lineNo: 1 }],
      method: "card",
      entry: "reader",
      applied: "18.00",
      tip: "0.00",
      submissionId: randomUUID(),
    };
    const path = `/api/working-orders/${billId}/payments`;
    const release = venue.card.holdNextCollect();
    const calls = venue.card.collectCalls.length;
    const pending = send(venue.app, venue.cookie, "POST", path, body);
    try {
      await vi.waitFor(() => expect(venue.card.collectCalls.length).toBe(calls + 1));
      await venue.db.update(orderDrafts).set({ state: "open" }).where(eq(orderDrafts.id, draft.id));
      const replay = await send(venue.app, venue.cookie, "POST", path, body);
      expect(replay.status).toBe(200);
      expect(replay.json).toMatchObject({ outcome: "pending" });
      expect(venue.card.collectCalls.length).toBe(calls + 1);
    } finally {
      release();
      const captured = await pending;
      expect(captured.status).toBe(200);
      expect(captured.json).toMatchObject({ outcome: "received", invoice: { total: "18.00" } });
    }
    expect(registroCount(venue, billId)).toBe(1);
    expect(await paymentRows(venue, billId)).toHaveLength(1);
  });
});

function deps() {
  return { db: venue.db, backend: venue.backend, clock: venue.clock };
}

async function unsent(billId: string, ownerId = venue.operatorId, quantity = "2") {
  const [bill] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, billId));
  return inTx(venue, (tx) =>
    saveDraft(tx, venue.cfg, bill!.partyId!, ownerId, {
      billId,
      draftId: null,
      revision: 0,
      lines: [
        {
          menuItemId: venue.offerFor("Tarta"),
          quantity,
          options: [],
          extras: [],
          note: null,
          courseId: null,
          makeAt: null,
        },
      ],
    }),
  );
}

function ask(kind: BillPaymentAsk["kind"], method: "cash" | "card"): BillPaymentAsk {
  return {
    kind,
    method,
    ...(kind === "contribution" ? { amount: "5.00" } : {}),
    ...(kind === "share" ? { shareOf: 2 } : {}),
    ...(kind === "items" ? { lines: [{ lineNo: 1 }] } : {}),
    ...(method === "cash" ? { tendered: "18.00" } : {}),
  };
}

describe("unsent dishes block new payments on their own bill", () => {
  it("counts each bill's own editor and fresh plus recalled dishes, excluding extras", async () => {
    const billId = await tabWith(venue, "Tarta");
    const ana = await unsent(billId, venue.operatorId, "1.25");
    const [colleague] = await venue.db.insert(persons).values({ displayName: "Zoë" }).returning();
    const otherBillId = randomUUID();
    await inTx(venue, async (tx) => {
      const [bill] = await tx.select().from(workingOrders).where(eq(workingOrders.id, billId));
      await createOpenOrder(tx, venue.cfg, otherBillId, [], "Other bill", {
        partyId: bill!.partyId!,
        existingService: true,
        copyServiceContextFrom: billId,
      });
    });
    await unsent(otherBillId, colleague!.id, "2.5");
    const [source] = await venue.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, billId));
    await venue.db.insert(orderDraftRecalledLines).values({
      draftId: ana.id,
      sourceLineId: source!.id,
      position: 1,
    });
    await venue.db
      .update(orderDraftLines)
      .set({
        extras: [{ listId: randomUUID(), picks: [{ productId: randomUUID(), quantity: 9 }] }],
      })
      .where(eq(orderDraftLines.draftId, ana.id));

    await expect(
      previewBillPayment(deps(), venue.cfg, billId, ask("items", "cash")),
    ).rejects.toMatchObject({
      code: "bill.unsent_dishes",
      params: {
        billId,
        owners: [{ personId: venue.operatorId, name: "Ana", quantity: "2.250" }],
      },
    });
    await expect(
      previewBillPayment(deps(), venue.cfg, otherBillId, ask("contribution", "cash")),
    ).rejects.toMatchObject({
      code: "bill.unsent_dishes",
      params: {
        billId: otherBillId,
        owners: [{ personId: colleague!.id, name: "Zoë", quantity: "2.500" }],
      },
    });
  });

  for (const kind of ["contribution", "share", "items"] as const) {
    for (const method of ["cash", "manual", "reader"] as const) {
      it(`refuses ${kind} ${method} preview and create before money or provider work`, async () => {
        const billId = await tabWith(venue, "Tarta");
        await unsent(billId);
        const body = {
          ...ask(kind, method === "cash" ? "cash" : "card"),
          ...(method === "cash" ? {} : { entry: method }),
        };
        const calls = venue.card.collectCalls.length;
        const preview = await send(
          venue.app,
          venue.cookie,
          "POST",
          `/api/working-orders/${billId}/payments/preview`,
          body,
        );
        expect(preview).toEqual({
          status: 409,
          json: {
            code: "bill.unsent_dishes",
            params: {
              billId,
              owners: [{ personId: venue.operatorId, name: "Ana", quantity: "2.000" }],
            },
          },
        });
        const applied = kind === "contribution" ? "5.00" : kind === "share" ? "9.00" : "18.00";
        const paid = await send(
          venue.app,
          venue.cookie,
          "POST",
          `/api/working-orders/${billId}/payments`,
          { ...body, submissionId: randomUUID(), applied, tip: "0.00" },
        );
        expect(paid).toEqual(preview);
        expect(await paymentRows(venue, billId)).toEqual([]);
        expect(venue.card.collectCalls.length).toBe(calls);
        expect(registroCount(venue, billId)).toBe(0);
        expect(await statusOf(venue, billId)).toBe("open");
      });
    }
  }

  it.each(["cash", "card"] as const)(
    "refuses a whole %s payment through the public service",
    async (method) => {
      const billId = await tabWith(venue, "Tarta");
      await unsent(billId);
      await expect(
        payWorkingOrder(deps(), venue.cfg, {
          id: billId,
          lines: [],
          tender: { method, amount: "18.00" },
        }),
      ).rejects.toMatchObject({ code: "bill.unsent_dishes", params: { billId } });
      expect(registroCount(venue, billId)).toBe(0);
    },
  );

  it("refuses a new integrated whole payment before asking the reader", async () => {
    const billId = await tabWith(venue, "Tarta");
    await unsent(billId);
    const calls = venue.card.collectCalls.length;
    await expect(
      payWorkingOrderIntegratedOrchestration({ ...deps(), provider: venue.card }, venue.cfg, {
        id: billId,
        lines: [],
      }),
    ).rejects.toMatchObject({ code: "bill.unsent_dishes", params: { billId } });
    expect(venue.card.collectCalls.length).toBe(calls);
    const [bill] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, billId));
    expect(bill!.paymentAttemptAt).toBeNull();
    expect(registroCount(venue, billId)).toBe(0);
  });

  it.each(["open empty", "submitted", "discarded", "another bill"] as const)(
    "allows a payment when the only draft is %s",
    async (state) => {
      const billId = await tabWith(venue, "Tarta");
      const draft = await unsent(state === "another bill" ? await tabWith(venue, "Tarta") : billId);
      if (state === "open empty")
        await venue.db.delete(orderDraftLines).where(eq(orderDraftLines.draftId, draft.id));
      if (state === "submitted" || state === "discarded")
        await venue.db.update(orderDrafts).set({ state }).where(eq(orderDrafts.id, draft.id));
      const result = await payWorkingOrder(deps(), venue.cfg, {
        id: billId,
        lines: [],
        tender: { method: "cash", amount: "18.00" },
      });
      expect(result.total).toBe("18.00");
      expect(await statusOf(venue, billId)).toBe("settled");
      expect(registroCount(venue, billId)).toBe(1);
    },
  );
});
