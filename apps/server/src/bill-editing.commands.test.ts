import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  billEditStates,
  orderDraftEvents,
  orderDraftLines,
  orderDraftRecalledLines,
  orderDrafts,
  parties,
  serviceCommands,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { persons } from "@waitron/identity";
import { readEditSentLines, writeEditSentLines } from "@waitron/venue-service";
import { AppError } from "@waitron/shared";
import { readBillEditState } from "./bill-editing.js";
import { saveDraft, submitDraft, takeOverDraft } from "./order-drafts.js";
import type { BillEditExpected, BillEditState } from "./order-drafts.js";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import { createTable } from "./testing/live-table.js";
import { recallToDraft } from "./draft-recall.js";
import { submitGroups } from "./order-groups.js";
import { seatTable } from "./parties.js";

let venue: BillVenue;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
  },
});

const blank = (billId: string): BillEditExpected => ({
  billId,
  editorVersion: 0,
  draftId: null,
  draftRevision: null,
});

async function fixture() {
  return inTx(venue, async (tx) => {
    const table = await createTable(tx, venue.cfg, {
      label: `Ownership-${randomUUID().slice(0, 8)}`,
      zoneId: venue.zoneId,
    });
    const party = await seatTable(tx, venue.cfg, {
      tableId: table.id,
      operatorId: venue.operatorId,
      guestCount: 2,
    });
    const [other] = await tx
      .insert(workingOrders)
      .values({
        source: "dashboard",
        orderNumber: 2,
        partyId: party.partyId,
        locationId: venue.cfg.locationId,
      })
      .returning();
    return { ...party, otherId: other!.id };
  });
}

function fresh(quantity = "1") {
  return { menuItemId: venue.offerFor("Tarta"), quantity };
}

function save(
  partyId: string,
  expectedEdit: BillEditExpected,
  lines: unknown[] = [fresh()],
  operatorId = venue.operatorId,
) {
  return inTx(venue, (tx) =>
    saveDraft(tx, venue.cfg, partyId, operatorId, {
      billId: expectedEdit.billId,
      draftId: expectedEdit.draftId,
      revision: expectedEdit.draftRevision ?? 0,
      expectedEdit,
      lines,
    }),
  );
}

function take(
  partyId: string,
  expectedEdit: BillEditExpected,
  operatorId = venue.adminId,
  submissionId = randomUUID(),
) {
  return inTx(venue, (tx) =>
    takeOverDraft(tx, venue.cfg, partyId, expectedEdit.draftId!, operatorId, {
      revision: expectedEdit.draftRevision!,
      expectedEdit,
      submissionId,
    }),
  );
}

async function sentDish(p: Awaited<ReturnType<typeof fixture>>) {
  await inTx(venue, (tx) =>
    submitGroups(tx, venue.cfg, p.partyId, {
      operatorId: venue.operatorId,
      submissionId: randomUUID(),
      expectedPartyRevision: p.revision,
      groups: [{ release: "fire", lines: [fresh()] }],
    }),
  );
  const [line] = await venue.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, p.tabId));
  return line!;
}

async function recall(
  partyId: string,
  lineId: string,
  expectedEdit: BillEditExpected,
  operatorId = venue.operatorId,
  submissionId = randomUUID(),
) {
  const [party] = await venue.db.select().from(parties).where(eq(parties.id, partyId));
  return inTx(venue, (tx) =>
    recallToDraft(tx, venue.cfg, partyId, lineId, {
      expectedPartyRevision: party!.revision,
      operatorId,
      submissionId,
      expectedEdit,
    }),
  );
}

async function rows() {
  return {
    parties: await venue.db.select().from(parties).orderBy(parties.id),
    edits: await venue.db.select().from(billEditStates).orderBy(billEditStates.billId),
    drafts: await venue.db.select().from(orderDrafts).orderBy(orderDrafts.id),
    fresh: await venue.db.select().from(orderDraftLines).orderBy(orderDraftLines.id),
    sources: await venue.db
      .select()
      .from(orderDraftRecalledLines)
      .orderBy(orderDraftRecalledLines.id),
    events: await venue.db.select().from(orderDraftEvents).orderBy(orderDraftEvents.id),
    commands: await venue.db.select().from(serviceCommands).orderBy(serviceCommands.id),
    charges: await venue.db.select().from(workingOrderLines).orderBy(workingOrderLines.id),
    tickets: await venue.db.select().from(ticketItems).orderBy(ticketItems.id),
    bills: await venue.db.select().from(workingOrders).orderBy(workingOrders.id),
  };
}

async function refused(run: () => Promise<unknown>, code: string, params: unknown) {
  const before = await rows();
  const error = await run().then(
    () => null,
    (error: unknown) => error,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  expect((error as AppError).params).toEqual(params);
  expect(await rows()).toEqual(before);
}

function stale(edit: BillEditState) {
  return { billId: edit.billId, draftId: edit.draftId, revision: edit.draftRevision, edit };
}

describe("bill editor in real save and takeover commands", () => {
  it("a blank save allocates no draft, editor, event or command", async () => {
    const p = await fixture();
    const before = await rows();
    await expect(save(p.partyId, blank(p.tabId), [])).resolves.toEqual({
      draft: null,
      edit: { ...blank(p.tabId), editorId: null, editorName: null },
    });
    expect(await rows()).toEqual(before);
  });

  it("acquires only the bill with the first nonempty save", async () => {
    const p = await fixture();
    const saved = await save(p.partyId, blank(p.tabId));
    expect(saved).toMatchObject({
      draft: {
        billId: p.tabId,
        ownerId: venue.operatorId,
        revision: 0,
        lines: [{ quantity: "1.000" }],
      },
      edit: { billId: p.tabId, editorId: venue.operatorId, editorVersion: 1, draftRevision: 0 },
    });
    expect(saved.edit.draftId).toBe(saved.draft!.id);
    expect(await inTx(venue, (tx) => readBillEditState(tx, p.otherId))).toEqual({
      ...blank(p.otherId),
      editorId: null,
      editorName: null,
    });
  });

  it("a rival first save refuses with the current bill/editor and writes nothing", async () => {
    const p = await fixture();
    const saved = await save(p.partyId, blank(p.tabId));
    await refused(
      () => save(p.partyId, blank(p.tabId), [fresh()], venue.adminId),
      "draft.taken_over",
      {
        billId: p.tabId,
        draftId: saved.draft!.id,
        ownerId: venue.operatorId,
        ownerName: saved.edit.editorName,
        edit: saved.edit,
      },
    );
  });

  it("two people save independently on two bills of the same party", async () => {
    const p = await fixture();
    const first = await save(p.partyId, blank(p.tabId));
    const second = await save(p.partyId, blank(p.otherId), [fresh("2")], venue.adminId);
    expect(first.edit.editorId).toBe(venue.operatorId);
    expect(second.edit.editorId).toBe(venue.adminId);
    expect(second.draft!.billId).toBe(p.otherId);
    expect(await inTx(venue, (tx) => readBillEditState(tx, p.tabId))).toEqual(first.edit);
  });

  it("a current same-person save keeps its editor version and stable line id", async () => {
    const p = await fixture();
    const first = await save(p.partyId, blank(p.tabId));
    const second = await save(p.partyId, first.edit, [
      { ...first.draft!.lines[0]!, quantity: "2" },
    ]);
    expect(second).toMatchObject({
      draft: {
        id: first.draft!.id,
        revision: 1,
        lines: [{ id: first.draft!.lines[0]!.id, quantity: "2.000" }],
      },
      edit: { ...first.edit, draftRevision: 1 },
    });
  });

  it("a stale same-person save returns the exact current edit state", async () => {
    const p = await fixture();
    const first = await save(p.partyId, blank(p.tabId));
    const second = await save(p.partyId, first.edit, [first.draft!.lines[0]!]);
    await refused(() => save(p.partyId, first.edit), "draft.out_of_date", stale(second.edit));
  });

  it("last fresh removal closes and releases only that bill", async () => {
    const p = await fixture();
    const first = await save(p.partyId, blank(p.tabId));
    const other = await save(p.partyId, blank(p.otherId), [fresh()], venue.adminId);
    const removed = await save(p.partyId, first.edit, []);
    expect(removed).toEqual({
      draft: null,
      edit: { ...blank(p.tabId), editorVersion: 2, editorId: null, editorName: null },
    });
    expect(
      await venue.db.select().from(orderDrafts).where(eq(orderDrafts.id, first.draft!.id)),
    ).toMatchObject([{ state: "discarded", revision: 1 }]);
    expect(await inTx(venue, (tx) => readBillEditState(tx, p.otherId))).toEqual(other.edit);
    const reacquired = await save(p.partyId, removed.edit, [fresh()], venue.adminId);
    expect(reacquired.edit.editorVersion).toBe(3);
    expect(reacquired.draft!.id).not.toBe(first.draft!.id);
  });

  it("release and same-person reacquisition do not revive the old expectation", async () => {
    const p = await fixture();
    const first = await save(p.partyId, blank(p.tabId));
    const released = await save(p.partyId, first.edit, []);
    const current = await save(p.partyId, released.edit);
    await refused(() => save(p.partyId, first.edit), "draft.out_of_date", stale(current.edit));
  });

  it("invalid fresh work cannot leave an acquired editor or audit", async () => {
    const p = await fixture();
    await refused(
      () => save(p.partyId, blank(p.tabId), [{ ...fresh(), quantity: "0" }]),
      "management.request_invalid",
      { field: "lines.0.quantity" },
    );
  });

  it("taking a bill transfers its existing outbox in place and preserves every line and other bill", async () => {
    const p = await fixture();
    const first = await save(p.partyId, blank(p.tabId));
    const other = await save(p.partyId, blank(p.otherId), [fresh("2")], venue.adminId);
    const before = await rows();
    const taken = await take(p.partyId, first.edit);
    expect(taken).toMatchObject({
      draft: {
        ...first.draft,
        ownerId: venue.adminId,
        revision: 1,
        ownerName: expect.any(String),
        takenOverFrom: { personId: venue.operatorId, name: first.draft!.ownerName },
      },
      edit: {
        ...first.edit,
        editorId: venue.adminId,
        editorName: expect.any(String),
        editorVersion: 2,
        draftRevision: 1,
      },
    });
    const after = await rows();
    expect(after.fresh).toEqual(before.fresh);
    expect(after.sources).toEqual(before.sources);
    expect(after.charges).toEqual(before.charges);
    expect(after.tickets).toEqual(before.tickets);
    expect(after.bills).toEqual(before.bills);
    expect(await inTx(venue, (tx) => readBillEditState(tx, p.otherId))).toEqual(other.edit);
  });

  it("a completed takeover replays its original snapshot after a later takeover", async () => {
    const p = await fixture();
    const first = await save(p.partyId, blank(p.tabId));
    const id = randomUUID();
    const taken = await take(p.partyId, first.edit, venue.adminId, id);
    await take(p.partyId, taken.edit, venue.operatorId);
    const before = await rows();
    await expect(take(p.partyId, first.edit, venue.adminId, id)).resolves.toEqual(taken);
    expect(await rows()).toEqual(before);
  });

  it("takeover fingerprints include the expectation", async () => {
    const p = await fixture();
    const first = await save(p.partyId, blank(p.tabId));
    const id = randomUUID();
    await take(p.partyId, first.edit, venue.adminId, id);
    await refused(
      () =>
        take(
          p.partyId,
          { ...first.edit, editorVersion: first.edit.editorVersion + 1 },
          venue.adminId,
          id,
        ),
      "submission.id_reused",
      {
        submissionId: id,
      },
    );
  });

  it("a stale takeover refuses even when the actor is already the editor", async () => {
    const p = await fixture();
    const first = await save(p.partyId, blank(p.tabId));
    const second = await save(p.partyId, first.edit, [first.draft!.lines[0]!]);
    await refused(
      () => take(p.partyId, first.edit, venue.operatorId),
      "draft.out_of_date",
      stale(second.edit),
    );
  });

  it("current same-person takeover adds no ownership event or version", async () => {
    const p = await fixture();
    const first = await save(p.partyId, blank(p.tabId));
    const before = await rows();
    expect(await take(p.partyId, first.edit, venue.operatorId)).toEqual(first);
    const after = await rows();
    expect(after.edits).toEqual(before.edits);
    expect(after.drafts).toEqual(before.drafts);
    expect(after.events).toEqual(before.events);
    expect(after.commands).toHaveLength(before.commands.length + 1);
  });

  it("uses the recorded person name for the acquired editor", async () => {
    const p = await fixture();
    const [person] = await venue.db.select().from(persons).where(eq(persons.id, venue.operatorId));
    const first = await save(p.partyId, blank(p.tabId));
    expect(first.edit.editorName).toBe(person!.displayName);
  });
  it("two rival first saves have one winner and no losing outbox or ownership event", async () => {
    const p = await fixture();
    const before = await rows();
    const answers = await Promise.allSettled([
      save(p.partyId, blank(p.tabId)),
      save(p.partyId, blank(p.tabId), [fresh("2")], venue.adminId),
    ]);
    const wins = answers.filter((answer) => answer.status === "fulfilled");
    const losses = answers.filter((answer) => answer.status === "rejected");
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    expect((losses[0]!.reason as AppError).code).toBe("draft.taken_over");
    const after = await rows();
    expect(after.drafts).toHaveLength(before.drafts.length + 1);
    expect(after.events).toHaveLength(before.events.length + 1);
    expect(after.fresh).toHaveLength(before.fresh.length + 1);
    expect(after.charges).toEqual(before.charges);
    expect(after.tickets).toEqual(before.tickets);
  });

  it.each([undefined, null, {}, [], { billId: "bad" }])(
    "save refuses malformed expectedEdit %j without mutation",
    async (expectedEdit) => {
      const p = await fixture();
      const before = await rows();
      const error = await inTx(venue, (tx) =>
        saveDraft(tx, venue.cfg, p.partyId, venue.operatorId, {
          billId: p.tabId,
          draftId: null,
          revision: 0,
          lines: [fresh()],
          expectedEdit: expectedEdit as BillEditExpected,
        }),
      ).then(
        () => null,
        (error: unknown) => error,
      );
      expect(error).toMatchObject({ code: "management.request_invalid" });
      expect(await rows()).toEqual(before);
    },
  );

  it("the save HTTP route requires the expectation and returns the complete snapshot", async () => {
    const p = await fixture();
    const body = {
      billId: p.tabId,
      draftId: null,
      revision: 0,
      lines: [fresh()],
      expectedEdit: blank(p.tabId),
    };
    const response = await send(
      venue.app,
      venue.cookie,
      "PUT",
      `/api/parties/${p.partyId}/drafts`,
      body,
    );
    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({
      draft: { billId: p.tabId, ownerId: venue.operatorId },
      edit: { billId: p.tabId, editorId: venue.operatorId, editorVersion: 1, draftRevision: 0 },
    });
  });

  it("the takeover HTTP route passes both expectation and submission identity", async () => {
    const p = await fixture();
    const first = await save(p.partyId, blank(p.tabId));
    const body = {
      revision: first.draft!.revision,
      expectedEdit: first.edit,
      submissionId: randomUUID(),
    };
    const path = `/api/parties/${p.partyId}/drafts/${first.draft!.id}/take-over`;
    const response = await send(venue.app, venue.cookie, "POST", path, body);
    expect(response.status).toBe(200);
    expect(response.json).toEqual(first);
    const before = await rows();
    expect((await send(venue.app, venue.cookie, "POST", path, body)).json).toEqual(first);
    expect(await rows()).toEqual(before);
  });

  it("sending the last saved dish closes and releases its editor", async () => {
    const p = await fixture();
    const saved = await save(p.partyId, blank(p.tabId));
    const sent = await inTx(venue, (tx) =>
      submitDraft(tx, venue.cfg, p.partyId, saved.draft!.id, {
        submissionId: randomUUID(),
        operatorId: venue.operatorId,
        expectedPartyRevision: p.revision,
        draftRevision: saved.draft!.revision,
        groups: [{ lineIds: [saved.draft!.lines[0]!.id], release: "fire" }],
      }),
    );
    expect(sent).toMatchObject({
      draft: null,
      edit: {
        ...blank(p.tabId),
        editorId: null,
        editorName: null,
        editorVersion: 2,
      },
    });
    expect(await inTx(venue, (tx) => readBillEditState(tx, p.tabId))).toEqual(sent.edit);
    const reacquired = await save(p.partyId, sent.edit, [fresh()], venue.adminId);
    expect(reacquired.edit.editorVersion).toBe(3);
  });

  it("Recall acquires an unowned bill and returns its saved source and edit state", async () => {
    const p = await fixture();
    const source = await sentDish(p);
    const recalled = await recall(p.partyId, source.id, blank(p.tabId));
    expect(recalled).toMatchObject({
      draft: { billId: p.tabId, ownerId: venue.operatorId, lines: [{ sourceLineId: source.id }] },
      edit: { billId: p.tabId, editorId: venue.operatorId, editorVersion: 1, draftRevision: 0 },
    });
    expect(recalled.edit.draftId).toBe(recalled.draft.id);
  });

  it("Recall loses to a rival first save without changing charges, tickets or audit", async () => {
    const p = await fixture();
    const source = await sentDish(p);
    const saved = await save(p.partyId, blank(p.tabId), [fresh()], venue.adminId);
    await refused(() => recall(p.partyId, source.id, blank(p.tabId)), "draft.taken_over", {
      billId: p.tabId,
      draftId: saved.draft!.id,
      ownerId: venue.adminId,
      ownerName: saved.edit.editorName,
      edit: saved.edit,
    });
  });

  it("first save loses to a rival Recall without creating a parallel outbox", async () => {
    const p = await fixture();
    const source = await sentDish(p);
    const recalled = await recall(p.partyId, source.id, blank(p.tabId), venue.adminId);
    await refused(() => save(p.partyId, blank(p.tabId)), "draft.taken_over", {
      billId: p.tabId,
      draftId: recalled.draft.id,
      ownerId: venue.adminId,
      ownerName: recalled.edit.editorName,
      edit: recalled.edit,
    });
  });

  it("Recall appends to the editor's current outbox without changing the editor version", async () => {
    const p = await fixture();
    const source = await sentDish(p);
    const saved = await save(p.partyId, blank(p.tabId));
    const recalled = await recall(p.partyId, source.id, saved.edit);
    expect(recalled.edit).toEqual({ ...saved.edit, draftRevision: 1 });
    expect(recalled.draft.id).toBe(saved.draft!.id);
    expect(recalled.draft.lines.map((line) => line.id)[0]).toBe(saved.draft!.lines[0]!.id);
    expect(recalled.draft.lines[1]!.sourceLineId).toBe(source.id);
  });

  it("a completed Recall replays its original edit state after takeover", async () => {
    const p = await fixture();
    const source = await sentDish(p);
    const id = randomUUID();
    const recalled = await recall(p.partyId, source.id, blank(p.tabId), venue.operatorId, id);
    await take(p.partyId, recalled.edit);
    const before = await rows();
    expect(await recall(p.partyId, source.id, blank(p.tabId), venue.operatorId, id)).toEqual(
      recalled,
    );
    expect(await rows()).toEqual(before);
    await refused(
      () =>
        recall(p.partyId, source.id, { ...blank(p.tabId), editorVersion: 1 }, venue.operatorId, id),
      "submission.id_reused",
      { submissionId: id },
    );
  });
  it("Recall checks the other editor before the venue's sent-edit restriction", async () => {
    const p = await fixture();
    const source = await sentDish(p);
    const saved = await save(p.partyId, blank(p.tabId), [fresh()], venue.adminId);
    const allowed = await inTx(venue, (tx) => readEditSentLines(tx));
    await inTx(venue, (tx) => writeEditSentLines(tx, false));
    try {
      await refused(() => recall(p.partyId, source.id, blank(p.tabId)), "draft.taken_over", {
        billId: p.tabId,
        draftId: saved.draft!.id,
        ownerId: venue.adminId,
        ownerName: saved.edit.editorName,
        edit: saved.edit,
      });
    } finally {
      await inTx(venue, (tx) => writeEditSentLines(tx, allowed));
    }
  });

  it("the save HTTP route refuses a missing expectation without allocating an outbox", async () => {
    const p = await fixture();
    const before = await rows();
    const answer = await send(venue.app, venue.cookie, "PUT", `/api/parties/${p.partyId}/drafts`, {
      billId: p.tabId,
      draftId: null,
      revision: 0,
      lines: [fresh()],
    });
    expect(answer).toEqual({
      status: 400,
      json: {
        code: "management.request_invalid",
        params: { field: "expectedEdit" },
      },
    });
    expect(await rows()).toEqual(before);
  });

  it("the Recall HTTP route uses the required edit state and returns its acquired snapshot", async () => {
    const p = await fixture();
    const source = await sentDish(p);
    const [party] = await venue.db.select().from(parties).where(eq(parties.id, p.partyId));
    const answer = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${p.partyId}/lines/${source.id}/recall`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: party!.revision,
        expectedEdit: blank(p.tabId),
        operatorId: venue.adminId,
      },
    );
    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({
      draft: { ownerId: venue.operatorId, billId: p.tabId, lines: [{ sourceLineId: source.id }] },
      edit: { editorId: venue.operatorId, editorVersion: 1, billId: p.tabId },
    });
  });

  it("a takeover replay still requires a current authenticated session", async () => {
    const p = await fixture();
    const saved = await save(p.partyId, blank(p.tabId));
    const path = `/api/parties/${p.partyId}/drafts/${saved.draft!.id}/take-over`;
    const body = {
      revision: saved.draft!.revision,
      expectedEdit: saved.edit,
      submissionId: randomUUID(),
    };
    expect((await send(venue.app, venue.cookie, "POST", path, body)).status).toBe(200);
    const before = await rows();
    expect((await send(venue.app, "", "POST", path, body)).status).toBe(401);
    expect(await rows()).toEqual(before);
  });
});
