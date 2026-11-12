import { testTradingAdmission } from "./testing/trading-admission.js";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { workingOrders, workingOrderLines, ticketItems } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readBillEditState } from "./bill-editing.js";
import { applyAdjustment, previewAdjustment } from "./adjustments-apply.js";
import { parkOrder, advanceTicketItem } from "./working-order.js";
import { cancelItem } from "./line-cancel.js";
import { readCancellationContext } from "./line-cancel-context.js";
import { partyRevision } from "./parties.js";
import {
  saveDraft,
  takeOverDraft,
  readDrafts,
  type BillEditExpected,
  type BillEditState,
} from "./order-drafts.js";
import {
  billWith,
  inTx,
  PINS,
  provisionAdjustmentVenue,
  todayLine,
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
  return {
    ...bill,
    parent: lines[0]!,
    extra: lines[1]!,
    row: await todayLine(venue, bill.billId, 1),
    extraRow: await todayLine(venue, bill.billId, 2),
  };
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
    const tickets = await venue.db
      .select()
      .from(ticketItems)
      .where(inArray(ticketItems.workingOrderLineId, p.row.lineIds ?? [p.row.lineId]));
    for (const ticket of tickets)
      await inTx(venue, (tx) => advanceTicketItem(tx, ticket.id, "preparing"));
  }
  const [bill] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, p.billId));
  return {
    orderId: p.billId,
    ...p.row,
    expectedRevision: bill!.revision,
    expectedEdit: expectedEdit!,
    action: "comp" as const,
    reasonId:
      op === "cancel" || op === "cancel-keep" ? venue.reasonId.houseVoid : venue.reasonId.house,
    note: null,
    operatorId: venue.staffId,
    submissionId: randomUUID(),
    quantity: "1",
    outcome: op === "cancel-keep" ? ("keep_charge" as const) : ("remove_charge" as const),
    expectedPartyRevision: await inTx(venue, (tx) => partyRevision(tx, p.partyId)),
    expectedBillRevision: bill!.revision,
    expectedContext:
      op === "cancel" || op === "cancel-keep"
        ? await inTx(venue, (tx) =>
            readCancellationContext(tx, p.partyId, p.row.lineId, p.row.lineIds),
          )
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
          { admission: testTradingAdmission(), ...ask, note: undefined },
          venue.staffId,
        )
      : op === "apply"
        ? applyAdjustment(
            tx,
            venue.cfg,
            { ...ask, admission: testTradingAdmission() },
            venue.venueLocale,
          )
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
      await inTx(venue, (tx) =>
        applyAdjustment(
          tx,
          venue.cfg,
          { ...ask, admission: testTradingAdmission() },
          venue.venueLocale,
        ),
      );
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

it("cancelling sent work keeps a remaining fresh dish owned", async () => {
  const p = await fixture();
  const saved = await save(p);
  const ask = {
    ...(await request(p, saved!.edit, "apply")),
    action: "cancel" as const,
    quantity: "3",
    reasonId: venue.reasonId.houseVoid,
    approver: { personId: venue.supervisorId, pin: PINS.supervisor },
  };
  await inTx(venue, (tx) =>
    applyAdjustment(
      tx,
      venue.cfg,
      { ...ask, admission: testTradingAdmission() },
      venue.venueLocale,
    ),
  );
  expect(await edit(p.billId)).toEqual({
    ...saved!.edit,
    draftRevision: saved!.edit.draftRevision!,
  });
  const drafts = await inTx(venue, (tx) => readDrafts(tx, venue.cfg, p.partyId));
  expect(drafts[0]!.lines).toMatchObject([{ menuItemId: venue.item("Bread"), quantity: "1.000" }]);
});
