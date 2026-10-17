import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { adjustments } from "@waitron/adjustments";
import { workingOrders, workingOrderLines, ticketItems } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { writeEditSentLines } from "@waitron/venue-service";
import { readBillEditState } from "./bill-editing.js";
import { applyAdjustment, previewAdjustment } from "./adjustments-apply.js";
import { parkOrder, advanceTicketItem } from "./working-order.js";
import { cancelItem } from "./line-cancel.js";
import { readCancellationContext } from "./line-cancel-context.js";
import { recallToDraft } from "./draft-recall.js";
import { partyRevision } from "./parties.js";
import {
  saveDraft,
  takeOverDraft,
  discardDraft,
  readDrafts,
  type BillEditExpected,
  type BillEditState,
} from "./order-drafts.js";
import {
  billWith,
  inTx,
  provisionAdjustmentVenue,
  type AdjustmentVenue,
} from "./testing/adjustment-venue.js";
import { send } from "./testing/bill-venue.js";

let venue: AdjustmentVenue;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionAdjustmentVenue(db);
  },
});
const operations = ["preview", "apply", "cancel", "cancel-keep"] as const;
type Operation = (typeof operations)[number];
const edit = (id: string) => inTx(venue, (tx) => readBillEditState(tx, id));
async function fixture() {
  const bill = await billWith(venue, [{ name: "Pizza", quantity: "3", olives: 2 }]);
  const lines = await venue.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, bill.billId))
    .orderBy(workingOrderLines.lineNo);
  return { ...bill, parent: lines[0]!, extra: lines[1]! };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function save(p: Fixture, operatorId = venue.staffId) {
  const expectedEdit = await edit(p.billId);
  return inTx(venue, (tx) =>
    saveDraft(tx, venue.cfg, p.partyId, operatorId, {
      billId: p.billId,
      expectedEdit,
      draftId: expectedEdit.draftId,
      revision: expectedEdit.draftRevision ?? 0,
      lines: [{ menuItemId: venue.item("Bread"), quantity: "1" }],
    }),
  );
}
async function request(
  p: Fixture,
  expectedEdit: BillEditExpected | null | undefined,
  op: Operation,
) {
  if (op === "cancel-keep") {
    const [ticket] = await venue.db
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderLineId, p.parent.id));
    await inTx(venue, (tx) => advanceTicketItem(tx, venue.cfg, ticket!.id, "preparing"));
  }
  const [bill] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, p.billId));
  return {
    orderId: p.billId,
    lineId: p.parent.id,
    expectedRevision: bill!.revision,
    expectedEdit: expectedEdit!,
    action: "comp" as const,
    reasonId: venue.reasonId.house,
    note: null,
    operatorId: venue.staffId,
    submissionId: randomUUID(),
    quantity: "1",
    outcome: op === "cancel-keep" ? ("keep_charge" as const) : ("remove_charge" as const),
    expectedPartyRevision: await inTx(venue, (tx) => partyRevision(tx, p.partyId)),
    expectedBillRevision: bill!.revision,
    expectedContext:
      op === "cancel" || op === "cancel-keep"
        ? await inTx(venue, (tx) => readCancellationContext(tx, p.partyId, p.parent.id))
        : undefined!,
  };
}
type Ask = Awaited<ReturnType<typeof request>>;
function run(p: Fixture, op: Operation, ask: Ask) {
  return inTx(venue, async (tx) =>
    op === "cancel" || op === "cancel-keep"
      ? cancelItem(
          tx,
          venue.cfg,
          p.partyId,
          p.parent.id,
          { ...ask, note: undefined },
          venue.staffId,
        )
      : op === "apply"
        ? applyAdjustment(tx, venue.cfg, ask, venue.venueLocale)
        : previewAdjustment(tx, ask, venue.venueLocale),
  );
}
function frozen(http = false) {
  return Object.fromEntries(
    venue.db
      .all<{ name: string }>(sql`select name from sqlite_master where type='table' order by name`)
      .map(({ name }) => [
        name,
        venue.db
          .all<Record<string, unknown>>(sql`select * from ${sql.identifier(name)} order by rowid`)
          .map((row) => (http && name === "devices" ? { ...row, last_seen_at: null } : row)),
      ]),
  );
}
const stale = (e: BillEditState) => ({
  billId: e.billId,
  draftId: e.draftId,
  revision: e.draftRevision,
  edit: e,
});
const foreign = (e: BillEditState) => ({
  billId: e.billId,
  draftId: e.draftId,
  ownerId: e.editorId,
  ownerName: e.editorName,
  edit: e,
});
function http(p: Fixture, op: Operation, ask: Ask) {
  return send(
    venue.app,
    venue.cookie.staff,
    "POST",
    op === "cancel" || op === "cancel-keep"
      ? `/api/parties/${p.partyId}/lines/${p.parent.id}/cancel-item`
      : `/api/working-orders/${p.billId}/adjustments${op === "preview" ? "/preview" : ""}`,
    op === "cancel" || op === "cancel-keep" ? { ...ask, note: undefined } : ask,
  );
}
for (const op of operations)
  describe(`${op} respects bill editing authority`, () => {
    it("refuses a colleague without changing order, draft, kitchen, money or audit rows", async () => {
      const p = await fixture(),
        owned = await save(p, venue.managerId),
        ask = await request(p, owned.edit, op),
        before = frozen();
      await expect(run(p, op, ask)).rejects.toMatchObject({
        code: "draft.taken_over",
        params: foreign(owned.edit),
      });
      expect(frozen()).toEqual(before);
    });
    it("refuses an outdated observation by the same person", async () => {
      const p = await fixture(),
        old = await edit(p.billId),
        owned = await save(p),
        ask = await request(p, old, op),
        before = frozen();
      await expect(run(p, op, ask)).rejects.toMatchObject({
        code: "draft.out_of_date",
        params: stale(owned.edit),
      });
      expect(frozen()).toEqual(before);
    });
    it.each(["absent", "other-bill"] as const)(
      "requires the %s observation to identify this bill",
      async (kind) => {
        const p = await fixture(),
          other = await fixture(),
          ask = await request(p, kind === "absent" ? undefined : await edit(other.billId), op),
          before = frozen();
        await expect(run(p, op, ask)).rejects.toMatchObject({
          code: "management.request_invalid",
          params: { field: kind === "absent" ? "expectedEdit" : "expectedEdit.billId" },
        });
        expect(frozen()).toEqual(before);
      },
    );
    it("allows the editor without changing either bill's outbox or editor", async () => {
      const p = await fixture(),
        other = await fixture();
      await save(p);
      await save(other, venue.managerId);
      const states = [await edit(p.billId), await edit(other.billId)];
      const drafts = await inTx(venue, async (tx) => [
        await readDrafts(tx, venue.cfg, p.partyId),
        await readDrafts(tx, venue.cfg, other.partyId),
      ]);
      await run(p, op, await request(p, states[0]!, op));
      expect([await edit(p.billId), await edit(other.billId)]).toEqual(states);
      expect(
        await inTx(venue, async (tx) => [
          await readDrafts(tx, venue.cfg, p.partyId),
          await readDrafts(tx, venue.cfg, other.partyId),
        ]),
      ).toEqual(drafts);
    });
    it("does not acquire an unowned bill", async () => {
      const p = await fixture(),
        before = await edit(p.billId);
      await run(p, op, await request(p, before, op));
      expect(await edit(p.billId)).toEqual(before);
    });
    it("uses the HTTP session actor rather than a supplied owner", async () => {
      const p = await fixture(),
        owned = await save(p, venue.managerId),
        ask = await request(p, owned.edit, op),
        before = frozen(true);
      ask.operatorId = venue.managerId;
      const result = await http(p, op, ask);
      expect(result.status).toBe(409);
      expect(result.json).toMatchObject({ code: "draft.taken_over", params: foreign(owned.edit) });
      expect(frozen(true)).toEqual(before);
    });
    it("forwards the observed edit through HTTP", async () => {
      const p = await fixture(),
        owned = await save(p);
      const result = await http(p, op, await request(p, owned.edit, op));
      expect(result.status).toBe(200);
      expect(await edit(p.billId)).toEqual(owned.edit);
    });
    it("refuses an old HTTP observation without any write", async () => {
      const p = await fixture(),
        old = await edit(p.billId),
        owned = await save(p),
        ask = await request(p, old, op),
        before = frozen(true);
      const result = await http(p, op, ask);
      expect(result.status).toBe(409);
      expect(result.json).toMatchObject({ code: "draft.out_of_date", params: stale(owned.edit) });
      expect(frozen(true)).toEqual(before);
    });
  });

for (const op of ["apply", "cancel", "cancel-keep"] as const)
  it(`${op} replays the original result after takeover, and rejects a changed observation under the same id`, async () => {
    const p = await fixture(),
      owned = await save(p),
      ask = await request(p, owned.edit, op),
      result = await run(p, op, ask);
    const current = await edit(p.billId);
    await inTx(venue, (tx) =>
      takeOverDraft(tx, venue.cfg, p.partyId, current.draftId!, venue.managerId, {
        revision: current.draftRevision!,
        expectedEdit: current,
        submissionId: randomUUID(),
      }),
    );
    const after = await edit(p.billId),
      before = frozen();
    await expect(run(p, op, ask)).resolves.toEqual(result);
    expect(frozen()).toEqual(before);
    await expect(run(p, op, { ...ask, expectedEdit: after })).rejects.toMatchObject({
      code: "submission.id_reused",
    });
    expect(frozen()).toEqual(before);
  });

async function recall(p: Fixture) {
  return inTx(venue, async (tx) => {
    await writeEditSentLines(tx, true);
    return recallToDraft(tx, venue.cfg, p.partyId, p.parent.id, {
      operatorId: venue.staffId,
      expectedEdit: await readBillEditState(tx, p.billId),
      expectedPartyRevision: await partyRevision(tx, p.partyId),
      submissionId: randomUUID(),
    });
  });
}
for (const target of ["parent", "extra", "bill"] as const)
  it(`direct ${target} adjustment refuses its own reserved recalled family`, async () => {
    const p = await fixture();
    await recall(p);
    const current = await edit(p.billId),
      ask = await request(p, current, "apply"),
      before = frozen();
    const adjustment = {
      ...ask,
      lineId: target === "bill" ? null : p[target].id,
      action: target === "bill" ? ("discount_percent" as const) : ("comp" as const),
      quantity: undefined,
      ...(target === "bill" ? { percentBp: 1000 } : {}),
    };
    await expect(
      inTx(venue, (tx) => applyAdjustment(tx, venue.cfg, adjustment, venue.venueLocale)),
    ).rejects.toMatchObject({ code: "draft.out_of_date", params: stale(current) });
    expect(frozen()).toEqual(before);
  });

it("Discard still resolves its own recalled family and releases the bill", async () => {
  const p = await fixture();
  await recall(p);
  const current = await edit(p.billId),
    [bill] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, p.billId));
  const result = await inTx(venue, (tx) =>
    discardDraft(
      tx,
      venue.cfg,
      p.partyId,
      current.draftId!,
      venue.staffId,
      {
        expectedEdit: current,
        submissionId: randomUUID(),
        revision: current.draftRevision!,
        expectedRevision: bill!.revision,
        reasonId: venue.reasonId.house,
        note: null,
      },
      venue.venueLocale,
    ),
  );
  expect(result.adjustmentIds).toHaveLength(1);
  expect(
    await venue.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, p.billId)),
  ).toEqual([]);
  expect(await edit(p.billId)).toEqual({
    ...current,
    editorId: null,
    editorName: null,
    editorVersion: current.editorVersion + 1,
    draftId: null,
    draftRevision: null,
  });
  expect(
    await venue.db.select().from(adjustments).where(eq(adjustments.workingOrderId, p.billId)),
  ).toHaveLength(1);
});

for (const op of ["preview", "apply"] as const)
  it(`${op} keeps counter adjustments independent of bill ownership`, async () => {
    const id = randomUUID();
    await parkOrder({ db: venue.db }, venue.cfg, {
      id,
      operatorId: venue.staffId,
      zoneId: venue.tables.zoneId,
      lines: [{ menuItemId: venue.item("Pizza"), quantity: "1" }],
    });
    const [parent] = await venue.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    const ask = {
      orderId: id,
      expectedRevision: 0,
      expectedEdit: null,
      lineId: parent!.id,
      reasonId: venue.reasonId.house,
      action: "comp" as const,
      note: null,
      operatorId: venue.staffId,
      submissionId: randomUUID(),
    };
    if (op === "preview") {
      const result = await inTx(venue, (tx) => previewAdjustment(tx, ask, venue.venueLocale));
      expect(result.reduction).toBe("9.00");
    } else {
      await inTx(venue, (tx) => applyAdjustment(tx, venue.cfg, ask, venue.venueLocale));
      const [after] = await venue.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.id, parent!.id));
      expect(after!.unitPriceGross).toBe(0);
    }
    expect(await edit(id)).toEqual({
      billId: id,
      editorId: null,
      editorName: null,
      editorVersion: 0,
      draftId: null,
      draftRevision: null,
    });
  });

it("Discard rolls back released reservations when its normal adjustment refuses", async () => {
  const p = await fixture();
  await recall(p);
  const current = await edit(p.billId),
    [bill] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, p.billId));
  const before = frozen();
  await expect(
    inTx(venue, (tx) =>
      discardDraft(
        tx,
        venue.cfg,
        p.partyId,
        current.draftId!,
        venue.staffId,
        {
          expectedEdit: current,
          submissionId: randomUUID(),
          revision: current.draftRevision!,
          expectedRevision: bill!.revision,
          reasonId: venue.reasonId.mistake,
          note: null,
        },
        venue.venueLocale,
      ),
    ),
  ).rejects.toMatchObject({ code: "adjustment.note_required" });
  expect(frozen()).toEqual(before);
});
