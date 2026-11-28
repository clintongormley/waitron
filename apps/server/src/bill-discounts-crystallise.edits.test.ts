import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createAdjustmentReason } from "@waitron/adjustments";
import { withTransaction, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readBillEditState } from "./bill-editing.js";
import { createTable } from "./testing/live-table.js";
import { REASONS, lineIdOf, type AdjustmentVenue } from "./testing/adjustment-venue.js";
import { observedBillActionBody } from "./testing/bill-action-fixture.js";
import { discountsHeldOn, holdDiscount } from "./testing/bill-discounts.js";
import {
  inTx,
  partyRevisionOf,
  provisionBillVenue,
  seatedWith,
  send,
  strandedPending,
  type Answer,
  type BillVenue,
} from "./testing/bill-venue.js";
import { observedCancelItem } from "./testing/cancel-line.js";
import { observedDraftCommandBody } from "./testing/draft-command-fixture.js";
import { observedGroupCompositionBody } from "./testing/group-composition-fixture.js";
import { observedGroupSubmitBody } from "./testing/group-submit-fixture.js";
import { observedMoveBillBody } from "./testing/move-bill-fixture.js";
import { observedOrderWriteBody } from "./testing/order-writer-fixture.js";
import { observedTableActionBody } from "./testing/table-action-fixture.js";
import { offerProducts } from "./testing/zone-offers.js";
import { parkOrder } from "./working-order-open.js";
import "./errors.js";

// Spec 6.6: nothing may make a held discount stop holding between the check a card payment's start
// makes and the invoice its capture issues, so while a card payment is pending every edit that
// changes what the bill charges is refused (plan A1621 PR 2b, item 5).
let venue: BillVenue;
let giver: Pick<AdjustmentVenue, "reasonId" | "staffId">;
let voidReason: string;
let counterZone: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    const complaint = await withTransaction(
      db,
      async (tx) => (await createAdjustmentReason(tx, REASONS.complaint)).id,
    );
    voidReason = await withTransaction(
      db,
      async (tx) => (await createAdjustmentReason(tx, REASONS.houseVoid)).id,
    );
    giver = {
      reasonId: { complaint } as AdjustmentVenue["reasonId"],
      staffId: venue.operatorId,
    };
    counterZone = (
      await inTx(venue, (tx) => offerProducts(tx, { zone: "counter", orderStart: "counter" }))
    ).zoneId;
  },
});

function revisionOf(partyId: string): number {
  const [row] = venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${partyId}`,
  );
  return row!.revision;
}

function billRevision(billId: string): number {
  const [row] = venue.db.all<{ revision: number }>(
    sql`select revision from working_orders where id = ${billId}`,
  );
  return row!.revision;
}

function addRound(
  partyId: string,
  lines: { menuItemId: string; quantity: string }[],
  release: "fire" | "hold" = "fire",
) {
  const path = `/api/parties/${partyId}/groups`;
  return observedGroupSubmitBody(venue.db, path, {
    submissionId: randomUUID(),
    expectedPartyRevision: revisionOf(partyId),
    groups: [{ lines, release }],
  }).then((body) => send(venue.app, venue.cookie, "POST", path, body));
}

/** What an edit could change: the bill's lines, its held discounts and its payments. */
function snapshot(billId: string) {
  return {
    lines: venue.db.all(sql`
      select id, line_no, quantity, line_total from working_order_lines
      where working_order_id = ${billId} order by line_no`),
    discounts: discountsHeldOn(venue, billId),
    payments: venue.db.all(sql`
      select id, state from bill_payments where working_order_id = ${billId}`),
  };
}

/**
 * A table bill of Steak, Tarta and two Small beers, sent in one course (held at the kitchen with
 * `release: "hold"`), holding 10% off the bill, with a card payment of 10.00 pending at the second
 * till's reader.
 */
async function paying(
  beforePayment?: (party: { partyId: string; tabId: string }) => unknown,
  release: "fire" | "hold" = "fire",
) {
  const party = await seatedWith(venue);
  const ordered = await addRound(
    party.partyId,
    [
      { menuItemId: venue.offerFor("Steak"), quantity: "1" },
      { menuItemId: venue.offerFor("Tarta"), quantity: "1" },
      { menuItemId: venue.offerFor("Small beer"), quantity: "2" },
    ],
    release,
  );
  expect(ordered.status, JSON.stringify(ordered.json)).toBe(200);
  await inTx(venue, (tx) => holdDiscount(tx, giver, { workingOrderId: party.tabId }));
  const extra = await beforePayment?.(party);
  await strandedPending(venue, party.tabId, 1000);
  return { ...party, extra, before: snapshot(party.tabId) };
}

function expectRefused(answer: Answer, code = "order.payment_in_flight") {
  expect(answer.json, JSON.stringify(answer.json)).toMatchObject({ code });
  expect(answer.status).toBe(409);
}

async function draftOn(party: { partyId: string; tabId: string }) {
  const path = `/api/parties/${party.partyId}/drafts`;
  const saved = await send(
    venue.app,
    venue.cookie,
    "PUT",
    path,
    await observedDraftCommandBody(venue.db, "PUT", path, {
      billId: party.tabId,
      draftId: null,
      revision: 0,
      lines: [{ menuItemId: venue.offerFor("Croquettes"), quantity: "1" }],
    }),
  );
  expect(saved.status, JSON.stringify(saved.json)).toBe(200);
  return (saved.json as { draft: { id: string; revision: number; lines: { id: string }[] } }).draft;
}

describe("while a card payment is pending, every edit that changes what the bill charges is refused", () => {
  it("adding a round: POST /api/parties/:id/groups", async () => {
    const p = await paying();
    expectRefused(
      await addRound(p.partyId, [{ menuItemId: venue.offerFor("Croquettes"), quantity: "1" }]),
    );
    expect(snapshot(p.tabId)).toEqual(p.before);
  });

  it("saving a draft: PUT /api/parties/:id/drafts", async () => {
    const p = await paying();
    const path = `/api/parties/${p.partyId}/drafts`;
    const saved = await send(
      venue.app,
      venue.cookie,
      "PUT",
      path,
      await observedDraftCommandBody(venue.db, "PUT", path, {
        billId: p.tabId,
        draftId: null,
        revision: 0,
        lines: [{ menuItemId: venue.offerFor("Croquettes"), quantity: "1" }],
      }),
    );
    expectRefused(saved);
    expect(snapshot(p.tabId)).toEqual(p.before);
  });

  it("sending a draft: POST /api/parties/:id/drafts/:did/submit", async () => {
    const p = await paying(draftOn);
    const draft = p.extra as Awaited<ReturnType<typeof draftOn>>;
    const path = `/api/parties/${p.partyId}/drafts/${draft.id}/submit`;
    const sent = await send(
      venue.app,
      venue.cookie,
      "POST",
      path,
      await observedDraftCommandBody(venue.db, "POST", path, {
        submissionId: randomUUID(),
        expectedPartyRevision: revisionOf(p.partyId),
        draftRevision: draft.revision,
        allergy: { party: { answer: "none", guests: [] }, ticks: [] },
        groups: [{ lineIds: draft.lines.map(({ id }) => id), release: "fire" }],
        dining: "eat_in",
      }),
    );
    expectRefused(sent);
    expect(snapshot(p.tabId)).toEqual(p.before);
  });

  it("splitting a draft: POST /api/parties/:id/drafts/:did/split", async () => {
    const p = await paying(draftOn);
    const draft = p.extra as Awaited<ReturnType<typeof draftOn>>;
    const split = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${p.partyId}/drafts/${draft.id}/split`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: revisionOf(p.partyId),
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, p.tabId)),
        lineIds: draft.lines.map(({ id }) => id),
      },
    );
    expectRefused(split);
    expect(snapshot(p.tabId)).toEqual(p.before);
  });

  it("splitting a line: POST /api/parties/:id/groups/split-line", async () => {
    // Only a held course's line can be split.
    const p = await paying(undefined, "hold");
    const path = `/api/parties/${p.partyId}/groups/split-line`;
    const split = await send(
      venue.app,
      venue.cookie,
      "POST",
      path,
      await observedGroupCompositionBody(venue.db, path, {
        submissionId: randomUUID(),
        expectedPartyRevision: revisionOf(p.partyId),
        lineId: await lineIdOf(venue, p.tabId, 3),
      }),
    );
    expectRefused(split);
    expect(snapshot(p.tabId)).toEqual(p.before);
  });

  it("moving a whole dish to another course is not refused: it changes nothing the bill charges", async () => {
    const p = await paying(undefined, "hold");
    const path = `/api/parties/${p.partyId}/groups/move`;
    const moved = await send(
      venue.app,
      venue.cookie,
      "POST",
      path,
      await observedGroupCompositionBody(venue.db, path, {
        submissionId: randomUUID(),
        expectedPartyRevision: revisionOf(p.partyId),
        moves: [{ lineId: await lineIdOf(venue, p.tabId, 3), quantity: "1" }],
        target: "new",
      }),
    );
    expect(moved.status, JSON.stringify(moved.json)).toBe(200);
    // A part of a line would split it, and that is refused (`order-group-edits.ts`'s `splitting`).
    expect(snapshot(p.tabId)).toEqual(p.before);
  });

  it("a comp or discount: POST /api/working-orders/:id/adjustments", async () => {
    const p = await paying();
    const path = `/api/working-orders/${p.tabId}/adjustments`;
    const comped = await send(
      venue.app,
      venue.cookie,
      "POST",
      path,
      await observedOrderWriteBody(venue.db, "POST", path, {
        submissionId: randomUUID(),
        expectedRevision: billRevision(p.tabId),
        action: "discount_percent",
        percentBp: 1000,
        lineId: null,
        reasonId: giver.reasonId.complaint,
      }),
    );
    expectRefused(comped);
    expect(snapshot(p.tabId)).toEqual(p.before);
  });

  it("cancelling a dish: POST /api/parties/:id/lines/:lineId/cancel-item", async () => {
    const p = await paying();
    const { lineId, body } = await inTx(venue, (tx) => observedCancelItem(tx, p.tabId, 2));
    const cancelled = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${p.partyId}/lines/${lineId}/cancel-item`,
      { ...body, reasonId: voidReason },
    );
    expectRefused(cancelled);
    expect(snapshot(p.tabId)).toEqual(p.before);
  });

  it("editing a line: PUT /api/working-orders/:id/lines/:lineNo", async () => {
    const p = await paying();
    const path = `/api/working-orders/${p.tabId}/lines/3`;
    const edited = await send(
      venue.app,
      venue.cookie,
      "PUT",
      path,
      await observedOrderWriteBody(venue.db, "PUT", path, {
        revision: billRevision(p.tabId),
        quantity: "3",
        portionLineNos: [],
      }),
    );
    expectRefused(edited);
    expect(snapshot(p.tabId)).toEqual(p.before);
  });

  it("moving dishes to a new bill: POST /api/bills/:id/move-dishes", async () => {
    const p = await paying();
    const path = `/api/bills/${p.tabId}/move-dishes`;
    const moved = await send(
      venue.app,
      venue.cookie,
      "POST",
      path,
      await observedBillActionBody(venue.db, path, {
        lineIds: [await lineIdOf(venue, p.tabId, 2)],
        toBillId: null,
        partyId: p.partyId,
        expectedPartyRevision: revisionOf(p.partyId),
      }),
    );
    expectRefused(moved);
    expect(snapshot(p.tabId)).toEqual(p.before);
  });

  it("merging the bill into another: POST /api/bills/:id/merge", async () => {
    const p = await paying(async (party) => {
      const path = `/api/bills/${party.tabId}/move-dishes`;
      const split = await send(
        venue.app,
        venue.cookie,
        "POST",
        path,
        await observedBillActionBody(venue.db, path, {
          lineIds: [await lineIdOf(venue, party.tabId, 1)],
          toBillId: null,
          partyId: party.partyId,
          expectedPartyRevision: revisionOf(party.partyId),
        }),
      );
      expect(split.status, JSON.stringify(split.json)).toBe(200);
      return split.json.billId as string;
    });
    const other = p.extra as string;
    const path = `/api/bills/${other}/merge`;
    const merged = await send(
      venue.app,
      venue.cookie,
      "POST",
      path,
      await observedBillActionBody(venue.db, path, {
        fromBillId: p.tabId,
        expectedPartyRevision: revisionOf(p.partyId),
      }),
    );
    expectRefused(merged);
    expect(snapshot(p.tabId)).toEqual(p.before);
  });

  it("moving the bill to an empty table is not refused: it changes nothing the bill charges", async () => {
    const p = await paying();
    const { id: tableId } = await withTransaction(venue.db, (tx) =>
      createTable(tx, { label: `Table ${randomUUID().slice(0, 8)}`, zoneId: venue.zoneId }),
    );
    const path = `/api/bills/${p.tabId}/move`;
    const moved = await send(
      venue.app,
      venue.cookie,
      "POST",
      path,
      await observedMoveBillBody(venue.db, path, {
        to: { tableId },
        expectedPartyRevision: revisionOf(p.partyId),
      }),
    );
    expect(moved.status, JSON.stringify(moved.json)).toBe(200);
    // A move that regroups the bill's set menus is refused (`move-bill.ts`'s `regrouped`).
    expect(snapshot(p.tabId)).toEqual(p.before);
  });

  it("Pay for items: POST /api/working-orders/:id/item-payments", async () => {
    const p = await paying();
    const paid = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${p.tabId}/item-payments`,
      {
        submissionId: randomUUID(),
        picks: [{ lineId: await lineIdOf(venue, p.tabId, 2) }],
        partyId: p.partyId,
        expectedPartyRevision: await partyRevisionOf(venue, p.tabId),
        expectedEdits: [await inTx(venue, (tx) => readBillEditState(tx, p.tabId))],
        method: "cash",
        tendered: "16.20",
        applied: "16.20",
        tip: "0.00",
      },
    );
    expectRefused(paid);
    expect(snapshot(p.tabId)).toEqual(p.before);
  });

  it("splitting the table: POST /api/parties/:id/split-table", async () => {
    const p = await paying(async (party) => {
      const { id: leaving } = await withTransaction(venue.db, (tx) =>
        createTable(tx, { label: `Table ${randomUUID().slice(0, 8)}`, zoneId: venue.zoneId }),
      );
      const path = `/api/parties/${party.partyId}/join`;
      const joined = await send(
        venue.app,
        venue.cookie,
        "POST",
        path,
        await observedTableActionBody(venue.db, path, {
          tableId: leaving,
          expectedPartyRevision: revisionOf(party.partyId),
        }),
      );
      expect(joined.status, JSON.stringify(joined.json)).toBe(200);
      return leaving;
    });
    const path = `/api/parties/${p.partyId}/split-table`;
    const split = await send(
      venue.app,
      venue.cookie,
      "POST",
      path,
      await observedTableActionBody(venue.db, path, {
        tableId: p.extra as string,
        selection: {
          wholeBillIds: [],
          loose: [{ billId: p.tabId, lineIds: [await lineIdOf(venue, p.tabId, 2)] }],
        },
        expectedPartyRevision: revisionOf(p.partyId),
      }),
    );
    expectRefused(split);
    expect(snapshot(p.tabId)).toEqual(p.before);
  });

  it("switching eat-in and takeaway: PUT /api/working-orders/:id/dining", async () => {
    const p = await paying();
    const path = `/api/working-orders/${p.tabId}/dining`;
    const switched = await send(venue.app, venue.cookie, "PUT", path, {
      dining: "takeaway",
      revision: billRevision(p.tabId),
      expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, p.tabId)),
    });
    // Refused before the payment is looked at: this zone offers no choice. Where it does, a payment
    // pending or received locks it (`ordersDiningLocked`, packages/db/src/order-dining.ts).
    expect(switched.json).toMatchObject({ code: "order.dining_fixed" });
    expect(snapshot(p.tabId)).toEqual(p.before);
  });
});

describe("while a card payment is pending, every edit of a counter order is refused", () => {
  async function payingCounter() {
    const id = randomUUID();
    await parkOrder({ db: venue.db }, venue.cfg, {
      id,
      lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }],
      zoneId: counterZone,
      operatorId: venue.operatorId,
    });
    await inTx(venue, (tx) => holdDiscount(tx, giver, { workingOrderId: id }));
    await strandedPending(venue, id, 1000);
    return { id, before: snapshot(id) };
  }

  it("saving it: PUT /api/working-orders/:id", async () => {
    const { id, before } = await payingCounter();
    const [line] = await venue.db
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    const saved = await send(venue.app, venue.cookie, "PUT", `/api/working-orders/${id}`, {
      revision: billRevision(id),
      expectedEdit: null,
      dining: "eat_in",
      lines: [
        { workingOrderLineId: line!.id, menuItemId: venue.offerFor("Tarta"), quantity: "1" },
        { menuItemId: venue.offerFor("Small beer"), quantity: "1" },
      ],
    });
    expectRefused(saved);
    expect(snapshot(id)).toEqual(before);
  });

  it("deleting it: DELETE /api/working-orders/:id", async () => {
    const { id, before } = await payingCounter();
    const deleted = await send(venue.app, venue.cookie, "DELETE", `/api/working-orders/${id}`, {
      expectedEdit: null,
    });
    expectRefused(deleted);
    expect(snapshot(id)).toEqual(before);
  });
});
