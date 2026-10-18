import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  billEditStates,
  billPayments,
  billPaymentLines,
  ticketItems,
  printJobs,
  sales,
  tenders,
  orderDraftLines,
  orderDraftRecalledLines,
  orderDraftEvents,
  orderDrafts,
  parties,
  workingOrderLines,
  workingOrders,
  workingOrderCounters,
  serviceCommands,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readBillEditState } from "./bill-editing.js";
import type { BillDraftSnapshot } from "./order-drafts.js";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import { createTable } from "./testing/live-table.js";
import { observedGroupSubmitBody } from "./testing/group-submit-fixture.js";
import { observedDraftCommandBody } from "./testing/draft-command-fixture.js";
import { splitDraft, takeOverDraft } from "./order-drafts.js";
import { readPartyAllergy, savePartyAllergy, setAllergyLineTicks } from "@waitron/venue-service";
import { createExtraList, writeProductModifiers } from "@waitron/catalogue";
import type { ExtraSelection } from "@waitron/shared";
import { VENUE_SERVICE } from "./modules.js";
import { createOpenOrder } from "./working-order.js";
import { saveDraft } from "./order-drafts.js";
import { republishMenus } from "./testing/publish-menu.js";

let venue: BillVenue;
let extras: ExtraSelection[];
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    extras = await inTx(venue, async (tx) => {
      const { offers } = await VENUE_SERVICE.listZoneOffers(tx, venue.cfg, venue.zoneId);
      const paella = offers.find((offer) => offer.id === venue.offerFor("Paella"))!;
      const croquetas = offers.find((offer) => offer.id === venue.offerFor("Croquetas"))!;
      const list = await createExtraList(
        tx,
        {
          name: "Side dishes",
          customerName: null,
          kitchenName: null,
          minPicks: 0,
          maxPicks: 1,
          active: true,
          items: [
            { productId: croquetas.productId, maxQuantity: 1, preselected: false, price: "2.50" },
          ],
        },
        venue.cfg.locale,
      );
      await writeProductModifiers(tx, paella.productId, [{ kind: "extras", id: list.id }]);
      await republishMenus(tx);
      return [{ listId: list.id, picks: [{ productId: croquetas.productId, quantity: 1 }] }];
    });
  },
});

async function setup() {
  const table = await inTx(venue, (tx) =>
    createTable(tx, venue.cfg, { label: `Split-${randomUUID()}`, zoneId: venue.zoneId }),
  );
  const seated = await send(venue.app, venue.cookie, "POST", `/api/tables/${table.id}/seat`, {});
  expect(seated.status).toBe(200);
  const { partyId, tabId: billId } = seated.json as unknown as {
    partyId: string;
    tabId: string;
  };
  const saved = await send(venue.app, venue.cookie, "PUT", `/api/parties/${partyId}/drafts`, {
    billId,
    draftId: null,
    revision: 0,
    expectedEdit: { billId, editorVersion: 0, draftId: null, draftRevision: null },
    lines: ["Tarta", "Croquetas"].map((name, index) => ({
      menuItemId: venue.offerFor(name),
      variantId: null,
      menuVersionId: null,
      quantity: String(index + 1),
      options: [],
      extras: [],
      note: `Dish ${index + 1}`,
      courseId: null,
      noMerge: false,
      slot: index + 1,
      joinGroupId: null,
      afterGroupId: null,
    })),
  });
  expect(saved.status).toBe(200);
  const snapshot = saved.json as unknown as BillDraftSnapshot;
  const [party] = await venue.db.select().from(parties).where(eq(parties.id, partyId));
  const { billId: editBillId, editorVersion, draftId, draftRevision } = snapshot.edit;
  const body = {
    submissionId: randomUUID(),
    expectedPartyRevision: party!.revision,
    expectedEdit: { billId: editBillId, editorVersion, draftId, draftRevision },
    lineIds: [snapshot.draft!.lines[1]!.id],
  };
  const path = `/api/parties/${partyId}/drafts/${snapshot.draft!.id}/split`;
  return { partyId, billId, snapshot, body, path };
}

async function withSource(
  p: Awaited<ReturnType<typeof setup>>,
  keepSent = false,
  selections: ExtraSelection[] = [],
) {
  const groupPath = `/api/parties/${p.partyId}/groups`;
  const sent = await send(
    venue.app,
    venue.cookie,
    "POST",
    groupPath,
    await observedGroupSubmitBody(venue.db, groupPath, {
      submissionId: randomUUID(),
      expectedPartyRevision: p.body.expectedPartyRevision,
      billId: p.billId,
      groups: [
        {
          release: "hold",
          lines: [
            { menuItemId: venue.offerFor("Paella"), quantity: "2", extras: selections },
            ...(keepSent ? [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }] : []),
          ],
        },
      ],
    }),
  );
  expect(sent.status, JSON.stringify(sent.json)).toBe(200);
  const [source] = await venue.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, p.billId))
    .orderBy(workingOrderLines.lineNo);
  const [party] = await venue.db.select().from(parties).where(eq(parties.id, p.partyId));
  const recallPath = `/api/parties/${p.partyId}/lines/${source!.id}/recall`;
  const recalled = await send(
    venue.app,
    venue.cookie,
    "POST",
    recallPath,
    await observedDraftCommandBody(venue.db, "POST", recallPath, {
      submissionId: randomUUID(),
      expectedPartyRevision: party!.revision,
    }),
  );
  expect(recalled.status).toBe(200);
  const snapshot = recalled.json as unknown as BillDraftSnapshot & { revision: number };
  return { source: source!, snapshot };
}

async function frozen() {
  return {
    bills: await venue.db.select().from(workingOrders).orderBy(workingOrders.id),
    counters: await venue.db.select().from(workingOrderCounters),
    states: await venue.db.select().from(billEditStates).orderBy(billEditStates.billId),
    drafts: await venue.db.select().from(orderDrafts).orderBy(orderDrafts.id),
    fresh: await venue.db.select().from(orderDraftLines).orderBy(orderDraftLines.id),
    sources: await venue.db
      .select()
      .from(orderDraftRecalledLines)
      .orderBy(orderDraftRecalledLines.id),
    lines: await venue.db.select().from(workingOrderLines).orderBy(workingOrderLines.id),
    parties: await venue.db.select().from(parties).orderBy(parties.id),
    events: await venue.db.select().from(orderDraftEvents).orderBy(orderDraftEvents.id),
    commands: await venue.db.select().from(serviceCommands).orderBy(serviceCommands.id),
    payments: await venue.db.select().from(billPayments).orderBy(billPayments.id),
    allocations: await venue.db.select().from(billPaymentLines).orderBy(billPaymentLines.id),
    tickets: await venue.db.select().from(ticketItems).orderBy(ticketItems.id),
    jobs: await venue.db.select().from(printJobs).orderBy(printJobs.id),
    sales: await venue.db.select().from(sales).orderBy(sales.id),
    tenders: await venue.db.select().from(tenders).orderBy(tenders.id),
  };
}

describe("splitting a saved outbox to a new bill", () => {
  it("moves the chosen unsent row in place and acquires only the new bill for its editor", async () => {
    const p = await setup();
    const before = await frozen();
    const result = await send(venue.app, venue.cookie, "POST", p.path, p.body);
    expect(result.status).toBe(200);
    const answer = result.json as unknown as {
      billId: string;
      revision: number;
      source: BillDraftSnapshot;
      destination: BillDraftSnapshot;
    };
    expect(answer.billId).not.toBe(p.billId);
    expect(answer.revision).toBe(p.body.expectedPartyRevision + 1);
    expect(answer.source.draft!.lines).toEqual([p.snapshot.draft!.lines[0]]);
    expect(answer.source.edit).toEqual({
      ...p.snapshot.edit,
      draftRevision: p.snapshot.edit.draftRevision! + 1,
    });
    expect(answer.destination.draft!.lines).toEqual([p.snapshot.draft!.lines[1]]);
    expect(answer.destination.edit).toEqual({
      billId: answer.billId,
      editorId: venue.operatorId,
      editorName: p.snapshot.edit.editorName,
      editorVersion: 1,
      draftId: answer.destination.draft!.id,
      draftRevision: 0,
    });
    expect(answer.destination.draft).toMatchObject({
      billId: answer.billId,
      partyId: p.partyId,
      ownerId: venue.operatorId,
    });
    expect(await inTx(venue, (tx) => readBillEditState(tx, p.billId))).toEqual(answer.source.edit);
    expect(await inTx(venue, (tx) => readBillEditState(tx, answer.billId))).toEqual(
      answer.destination.edit,
    );
    const after = await frozen();
    expect(after.lines).toEqual(before.lines);
    expect(after.fresh.map((line) => ({ ...line, draftId: null }))).toEqual(
      before.fresh.map((line) => ({ ...line, draftId: null })),
    );
    expect(after.bills).toHaveLength(before.bills.length + 1);
  });

  it("releases an emptied source, records its resolution and replays the original split once", async () => {
    const p = await setup();
    const body = { ...p.body, lineIds: p.snapshot.draft!.lines.map((line) => line.id) };
    const result = await send(venue.app, venue.cookie, "POST", p.path, body);
    expect(result.status).toBe(200);
    const answer = result.json as unknown as {
      billId: string;
      source: BillDraftSnapshot;
      destination: BillDraftSnapshot;
    };
    expect(answer.source).toEqual({
      draft: null,
      edit: {
        billId: p.billId,
        editorId: null,
        editorName: null,
        editorVersion: p.snapshot.edit.editorVersion + 1,
        draftId: null,
        draftRevision: null,
      },
    });
    expect(answer.destination.draft!.lines).toEqual(p.snapshot.draft!.lines);
    const [closed] = await venue.db
      .select()
      .from(orderDrafts)
      .where(eq(orderDrafts.id, p.snapshot.draft!.id));
    expect(closed!.state).toBe("discarded");
    const events = await venue.db
      .select()
      .from(orderDraftEvents)
      .where(eq(orderDraftEvents.draftId, p.snapshot.draft!.id));
    expect(events.map((event) => event.kind)).toEqual(["created", "discarded"]);
    const before = await frozen();
    const retry = await send(venue.app, venue.cookie, "POST", p.path, body);
    expect(retry).toEqual(result);
    expect(await frozen()).toEqual(before);
    const changed = await send(venue.app, venue.cookie, "POST", p.path, {
      ...body,
      lineIds: [body.lineIds[0]],
    });
    expect(changed.status).toBe(409);
    expect(changed.json).toMatchObject({ code: "submission.id_reused" });
    expect(await frozen()).toEqual(before);
    const changedRevision = await send(venue.app, venue.cookie, "POST", p.path, {
      ...body,
      expectedPartyRevision: body.expectedPartyRevision + 1,
    });
    expect(changedRevision).toEqual(result);
    const changedObservation = await send(venue.app, venue.cookie, "POST", p.path, {
      ...body,
      expectedEdit: { ...body.expectedEdit, editorVersion: body.expectedEdit.editorVersion + 1 },
    });
    expect(changedObservation.status).toBe(409);
    expect(changedObservation.json).toMatchObject({ code: "submission.id_reused" });
    const stale = await send(venue.app, venue.cookie, "POST", p.path, {
      ...body,
      submissionId: randomUUID(),
    });
    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({ code: "draft.out_of_date" });
    expect(await frozen()).toEqual(before);
    const acquired = await inTx(venue, (tx) =>
      saveDraft(tx, venue.cfg, p.partyId, venue.adminId, {
        billId: p.billId,
        draftId: null,
        revision: 0,
        expectedEdit: answer.source.edit,
        lines: [{ ...p.snapshot.draft!.lines[0], id: undefined }],
      }),
    );
    expect(acquired.edit.editorId).toBe(venue.adminId);
    expect(acquired.edit.editorVersion).toBe(answer.source.edit.editorVersion + 1);
    expect(acquired.draft!.id).not.toBe(p.snapshot.draft!.id);
    expect(await inTx(venue, (tx) => readBillEditState(tx, answer.billId))).toEqual(
      answer.destination.edit,
    );
    const acquiredBefore = await frozen();
    expect(await send(venue.app, venue.cookie, "POST", p.path, body)).toEqual(result);
    expect(await frozen()).toEqual(acquiredBefore);
  });

  it("moves a recalled charge and its exclusive reservation without losing either allergy tick", async () => {
    const p = await setup();
    const { source, snapshot } = await withSource(p);
    const allergic = await inTx(venue, (tx) =>
      savePartyAllergy(
        tx,
        p.partyId,
        snapshot.revision,
        {
          answer: "allergies",
          guests: [{ who: "Ana", allergens: { milk: {} } }],
        },
        venue.operatorId,
      ),
    );
    await inTx(venue, (tx) =>
      setAllergyLineTicks(tx, p.partyId, [
        { workingLineId: source!.id, guestId: allergic.guests[0]!.id },
        { draftLineId: p.snapshot.draft!.lines[1]!.id, guestId: allergic.guests[0]!.id },
      ]),
    );
    const allergyBefore = await inTx(venue, (tx) => readPartyAllergy(tx, p.partyId));
    const selected = snapshot.draft!.lines.filter(
      (line) => line.sourceLineId !== null || line.id === p.snapshot.draft!.lines[1]!.id,
    );
    const { billId, editorVersion, draftId, draftRevision } = snapshot.edit;
    const result = await send(venue.app, venue.cookie, "POST", p.path, {
      ...p.body,
      expectedPartyRevision: allergic.revision,
      expectedEdit: { billId, editorVersion, draftId, draftRevision },
      lineIds: selected.map((line) => line.id),
    });
    expect(result.status).toBe(200);
    const answer = result.json as unknown as {
      billId: string;
      source: BillDraftSnapshot;
      destination: BillDraftSnapshot;
    };
    expect(answer.destination.draft!.lines.map((line) => line.id)).toEqual(
      selected.map((line) => line.id),
    );
    const [moved] = await venue.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.id, source!.id));
    expect(moved).toEqual({ ...source, workingOrderId: answer.billId, lineNo: 1 });
    const [reservation] = await venue.db
      .select()
      .from(orderDraftRecalledLines)
      .where(eq(orderDraftRecalledLines.sourceLineId, source!.id));
    expect(reservation!.draftId).toBe(answer.destination.draft!.id);
    expect(await inTx(venue, (tx) => readPartyAllergy(tx, p.partyId))).toEqual({
      ...allergyBefore,
      revision: allergyBefore.revision + 1,
    });
  });

  it.each([
    ["missing observation", { expectedEdit: undefined }, "expectedEdit"],
    ["missing selection", { lineIds: undefined }, "lineIds"],
    ["empty selection", { lineIds: [] }, "lineIds"],
    ["malformed selection", { lineIds: [null] }, "lineIds"],
    ["unknown line", { lineIds: [randomUUID()] }, "lineIds"],
  ])("refuses %s without creating a bill or editing row", async (_name, patch, field) => {
    const p = await setup();
    const before = await frozen();
    const result = await send(venue.app, venue.cookie, "POST", p.path, { ...p.body, ...patch });
    expect(result.status).toBe(400);
    expect(result.json).toMatchObject({ code: "management.request_invalid", params: { field } });
    expect(await frozen()).toEqual(before);
  });

  it.each(["contribution", "items"] as const)(
    "keeps a received %s on its original bill and refuses moving its charged food",
    async (kind) => {
      const p = await setup();
      const { source, snapshot } = await withSource(p);
      const paymentId = randomUUID();
      await inTx(venue, async (tx) => {
        await tx.insert(billPayments).values({
          id: paymentId,
          workingOrderId: p.billId,
          submissionId: randomUUID(),
          fingerprint: "fixture",
          kind,
          method: "cash",
          applied: 100,
          tendered: 100,
          state: "received",
          requestedBy: venue.operatorId,
          source: "device",
          deviceId: venue.deviceId,
          receivedAt: new Date().toISOString(),
        });
        if (kind === "items")
          await tx.insert(billPaymentLines).values({
            billPaymentId: paymentId,
            lineId: source.id,
            quantity: 1000,
            amount: 100,
          });
      });
      const before = await frozen();
      const result = await send(venue.app, venue.cookie, "POST", p.path, {
        ...p.body,
        expectedPartyRevision: snapshot.revision,
        expectedEdit: snapshot.edit,
        lineIds: snapshot
          .draft!.lines.filter((line) => line.sourceLineId !== null)
          .map((line) => line.id),
      });
      expect(result.status).toBe(409);
      expect(result.json).toMatchObject({
        code: kind === "items" ? "bill.line_paid" : "bill.received_exceeds_total",
      });
      expect(await frozen()).toEqual(before);
    },
  );

  it("rolls back moved rows, ownership, numbering and audit when later attendance capture fails", async () => {
    const p = await setup();
    const before = await frozen();
    await expect(
      inTx(venue, (tx) =>
        splitDraft(
          tx,
          venue.cfg,
          p.partyId,
          p.snapshot.draft!.id,
          {
            ...p.body,
            operatorId: venue.operatorId,
          },
          async () => {
            throw new Error("attendance unavailable");
          },
        ),
      ),
    ).rejects.toThrow("attendance unavailable");
    expect(await frozen()).toEqual(before);
  });

  it("uses the existing issuance path when the remaining sent food is fully paid after the split", async () => {
    const p = await setup();
    const { snapshot } = await withSource(p, true);
    await venue.db.insert(billPayments).values({
      workingOrderId: p.billId,
      submissionId: randomUUID(),
      fingerprint: "fixture",
      kind: "contribution",
      method: "cash",
      applied: 300,
      tendered: 300,
      state: "received",
      requestedBy: venue.operatorId,
      source: "device",
      deviceId: venue.deviceId,
      receivedAt: new Date().toISOString(),
    });
    const before = await venue.db.select().from(sales);
    const body = {
      ...p.body,
      expectedPartyRevision: snapshot.revision,
      expectedEdit: snapshot.edit,
      lineIds: snapshot.draft!.lines.map((line) => line.id),
    };
    const result = await send(venue.app, venue.cookie, "POST", p.path, body);
    expect(result.status).toBe(200);
    const [original] = await venue.db
      .select()
      .from(workingOrders)
      .where(eq(workingOrders.id, p.billId));
    expect(original!.status).toBe("settled");
    const after = await venue.db.select().from(sales);
    expect(after).toHaveLength(before.length + 1);
    const frozenAfter = await frozen();
    expect(await send(venue.app, venue.cookie, "POST", p.path, body)).toEqual(result);
    expect(await frozen()).toEqual(frozenAfter);
  });

  it("moves every extra with its recalled parent, retaining the recorded amounts and single reservation", async () => {
    const p = await setup();
    const { source, snapshot } = await withSource(p, false, extras);
    const before = await venue.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, p.billId))
      .orderBy(workingOrderLines.lineNo);
    expect(before).toHaveLength(2);
    const recalled = snapshot.draft!.lines.find((line) => line.sourceLineId === source.id)!;
    expect(recalled.source!.extras).toHaveLength(1);
    const result = await send(venue.app, venue.cookie, "POST", p.path, {
      ...p.body,
      expectedPartyRevision: snapshot.revision,
      expectedEdit: snapshot.edit,
      lineIds: [recalled.id],
    });
    expect(result.status).toBe(200);
    const answer = result.json as unknown as { billId: string; destination: BillDraftSnapshot };
    const moved = await venue.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, answer.billId))
      .orderBy(workingOrderLines.lineNo);
    expect(moved).toEqual(
      before.map((line, index) => ({ ...line, workingOrderId: answer.billId, lineNo: index + 1 })),
    );
    const reservations = await venue.db
      .select()
      .from(orderDraftRecalledLines)
      .where(eq(orderDraftRecalledLines.sourceLineId, source.id));
    expect(reservations).toHaveLength(1);
    expect(reservations[0]!.draftId).toBe(answer.destination.draft!.id);
    expect(answer.destination.draft!.lines[0]!.source!.extras[0]!.id).toBe(before[1]!.id);
  });

  it("leaves an unrelated bill's different editor and unsent rows unchanged", async () => {
    const p = await setup();
    const otherBill = randomUUID();
    const other = await inTx(venue, async (tx) => {
      await createOpenOrder(tx, venue.cfg, otherBill, [], null, {
        partyId: p.partyId,
        existingService: true,
        copyServiceContextFrom: p.billId,
      });
      return saveDraft(tx, venue.cfg, p.partyId, venue.adminId, {
        billId: otherBill,
        draftId: null,
        revision: 0,
        expectedEdit: { billId: otherBill, editorVersion: 0, draftId: null, draftRevision: null },
        lines: [{ ...p.snapshot.draft!.lines[0], id: undefined }],
      });
    });
    const result = await send(venue.app, venue.cookie, "POST", p.path, p.body);
    expect(result.status).toBe(200);
    expect(await inTx(venue, (tx) => readBillEditState(tx, otherBill))).toEqual(other.edit);
    const [unchanged] = await venue.db
      .select()
      .from(orderDraftLines)
      .where(eq(orderDraftLines.id, other.draft!.lines[0]!.id));
    expect(unchanged!.draftId).toBe(other.draft!.id);
    const [unchangedDraft] = await venue.db
      .select()
      .from(orderDrafts)
      .where(eq(orderDrafts.id, other.draft!.id));
    expect(unchangedDraft!.revision).toBe(other.draft!.revision);
  });

  it("accepts one of two concurrent splits of the same observed outbox", async () => {
    const p = await setup();
    const before = await frozen();
    const results = await Promise.all([
      send(venue.app, venue.cookie, "POST", p.path, p.body),
      send(venue.app, venue.cookie, "POST", p.path, { ...p.body, submissionId: randomUUID() }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(results.find((result) => result.status === 409)!.json).toMatchObject({
      code: "draft.out_of_date",
    });
    expect((await frozen()).bills).toHaveLength(before.bills.length + 1);
  });

  it("refuses duplicate rows before changing either bill", async () => {
    const p = await setup();
    const before = await frozen();
    const result = await send(venue.app, venue.cookie, "POST", p.path, {
      ...p.body,
      lineIds: [p.body.lineIds[0], p.body.lineIds[0]],
    });
    expect(result.status).toBe(400);
    expect(result.json).toMatchObject({
      code: "management.request_invalid",
      params: { field: "lineIds" },
    });
    expect(await frozen()).toEqual(before);
  });

  it("refuses a selected row from a different bill without changing either outbox", async () => {
    const p = await setup();
    const other = await setup();
    const before = await frozen();
    const result = await send(venue.app, venue.cookie, "POST", p.path, {
      ...p.body,
      lineIds: [other.body.lineIds[0]],
    });
    expect(result.status).toBe(400);
    expect(result.json).toMatchObject({
      code: "management.request_invalid",
      params: { field: "lineIds" },
    });
    expect(await frozen()).toEqual(before);
  });

  it("refuses while a payment is pending without allocating a destination", async () => {
    const p = await setup();
    await venue.db.insert(billPayments).values({
      workingOrderId: p.billId,
      submissionId: randomUUID(),
      fingerprint: "pending fixture",
      kind: "contribution",
      method: "card",
      applied: 100,
      state: "pending",
      requestedBy: venue.operatorId,
      source: "device",
      deviceId: venue.deviceId,
    });
    const before = await frozen();
    const result = await send(venue.app, venue.cookie, "POST", p.path, p.body);
    expect(result.status).toBe(409);
    expect(result.json).toMatchObject({ code: "order.payment_in_flight" });
    expect(await frozen()).toEqual(before);
  });

  it.each(["editorVersion", "draftRevision"] as const)(
    "refuses a stale %s atomically",
    async (key) => {
      const p = await setup();
      const before = await frozen();
      const result = await send(venue.app, venue.cookie, "POST", p.path, {
        ...p.body,
        expectedEdit: { ...p.body.expectedEdit, [key]: p.body.expectedEdit[key]! + 1 },
      });
      expect(result.status).toBe(409);
      expect(result.json).toMatchObject({ code: "draft.out_of_date" });
      expect(await frozen()).toEqual(before);
    },
  );

  it("refuses an old party revision without keeping its new bill", async () => {
    const p = await setup();
    const before = await frozen();
    const result = await send(venue.app, venue.cookie, "POST", p.path, {
      ...p.body,
      expectedPartyRevision: p.body.expectedPartyRevision + 1,
    });
    expect(result.status).toBe(409);
    expect(result.json).toMatchObject({ code: "party.out_of_date" });
    expect(await frozen()).toEqual(before);
  });

  it("refuses after another person takes over and replays a completed split without reacquiring", async () => {
    const p = await setup();
    const result = await send(venue.app, venue.cookie, "POST", p.path, p.body);
    expect(result.status).toBe(200);
    const answer = result.json as unknown as { source: BillDraftSnapshot };
    const remaining = await inTx(venue, (tx) =>
      saveDraft(tx, venue.cfg, p.partyId, venue.operatorId, {
        billId: p.billId,
        draftId: answer.source.draft!.id,
        revision: answer.source.draft!.revision,
        expectedEdit: answer.source.edit,
        lines: [
          answer.source.draft!.lines[0],
          {
            ...answer.source.draft!.lines[0],
            id: undefined,
            note: "Second remaining dish",
          },
        ],
      }),
    );
    const takeover = await inTx(venue, (tx) =>
      takeOverDraft(tx, venue.cfg, p.partyId, p.snapshot.draft!.id, venue.adminId, {
        submissionId: randomUUID(),
        revision: remaining.edit.draftRevision!,
        expectedEdit: remaining.edit,
      }),
    );
    const before = await frozen();
    const refused = await send(venue.app, venue.cookie, "POST", p.path, {
      ...p.body,
      submissionId: randomUUID(),
      expectedEdit: takeover.edit,
      expectedPartyRevision: p.body.expectedPartyRevision + 1,
      lineIds: [answer.source.draft!.lines[0]!.id],
    });
    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({
      code: "draft.taken_over",
      params: { ownerId: venue.adminId },
    });
    expect(await frozen()).toEqual(before);
    expect(await send(venue.app, venue.cookie, "POST", p.path, p.body)).toEqual(result);
    expect(await frozen()).toEqual(before);
  });
});
