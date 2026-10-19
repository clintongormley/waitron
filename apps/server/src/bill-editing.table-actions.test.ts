import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  orderDraftLines,
  orderDraftRecalledLines,
  parties,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readBillEditState } from "./bill-editing.js";
import {
  saveDraft,
  takeOverDraft,
  type BillEditExpected,
  type BillEditState,
} from "./order-drafts.js";
import { combineParties, joinTables, moveGuests } from "./table-actions.js";
import { writeEditSentLines } from "@waitron/venue-service";
import { VENUE_SERVICE } from "./modules.js";
import { recallToDraft } from "./draft-recall.js";

import { submitGroups } from "./testing/group-submit-fixture.js";
import { seatTable } from "./parties.js";
import { offerProducts } from "./testing/zone-offers.js";
import { createTable } from "./testing/live-table.js";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";

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
async function party() {
  return inTx(venue, async (tx) => {
    const table = await createTable(tx, venue.cfg, {
      label: `Editor-${randomUUID().slice(0, 8)}`,
      zoneId: venue.zoneId,
    });
    return {
      ...(await seatTable(tx, venue.cfg, {
        tableId: table.id,
        operatorId: venue.operatorId,
        guestCount: 2,
      })),
      tableId: table.id,
    };
  });
}
async function otherBill(partyId: string) {
  return inTx(venue, async (tx) => {
    const [bill] = await tx
      .insert(workingOrders)
      .values({ source: "dashboard", orderNumber: 2, partyId, locationId: venue.cfg.locationId })
      .returning();
    return bill!.id;
  });
}
async function save(partyId: string, billId: string, operatorId = venue.operatorId) {
  return inTx(venue, (tx) =>
    saveDraft(tx, venue.cfg, partyId, operatorId, {
      billId,
      draftId: null,
      revision: 0,
      expectedEdit: blank(billId),
      lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }],
    }),
  );
}
async function edits(...partyIds: string[]) {
  return inTx(venue, async (tx) => {
    const bills = await tx
      .select({ id: workingOrders.id })
      .from(workingOrders)
      .where(inArray(workingOrders.partyId, partyIds))
      .orderBy(workingOrders.id);
    const result: BillEditState[] = [];
    for (const bill of bills) result.push(await readBillEditState(tx, bill.id));
    return result;
  });
}
async function allRows() {
  const tables = venue.db.all<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' order by name`,
  );
  const result: Record<string, unknown[]> = {};
  for (const { name } of tables)
    result[name] = venue.db.all(sql`select * from ${sql.identifier(name)} order by rowid`);
  return result;
}
async function refused(run: () => Promise<unknown>, code: string, params: unknown) {
  const before = await allRows();
  await expect(run()).rejects.toMatchObject({ code, params });
  expect(await allRows()).toEqual(before);
}
const actions = ["join", "move", "combine"] as const;
type Action = (typeof actions)[number];
async function request(
  action: Action,
  from: Awaited<ReturnType<typeof party>>,
  into: Awaited<ReturnType<typeof party>>,
  expectedEdits: BillEditExpected[],
  bills: "merge" | "separate" = "separate",
  operatorId = venue.operatorId,
) {
  const revisions = await venue.db
    .select()
    .from(parties)
    .where(inArray(parties.id, [from.partyId, into.partyId]));
  const revision = (id: string) => revisions.find((p) => p.id === id)!.revision;
  return inTx<unknown>(venue, (tx) => {
    if (action === "combine")
      return combineParties(tx, venue.cfg, {
        from: from.partyId,
        into: into.partyId,
        tables: "join",
        bills,
        operatorId,
        expectedEdits,
      });
    const options = {
      bills,
      operatorId,
      expectedEdits,
      expectedPartyRevision: revision(action === "join" ? into.partyId : from.partyId),
      otherPartyId: action === "join" ? from.partyId : into.partyId,
      expectedOtherPartyRevision: revision(action === "join" ? from.partyId : into.partyId),
    };
    return action === "join"
      ? joinTables(tx, venue.cfg, into.partyId, from.tableId, options)
      : moveGuests(tx, venue.cfg, from.partyId, into.tableId, options);
  });
}
function conflict(edit: BillEditState, conflicts = [edit]) {
  return {
    billId: edit.billId,
    draftId: edit.draftId,
    ownerId: edit.editorId,
    ownerName: edit.editorName,
    edit,
    conflicts,
  };
}
function stale(edit: BillEditState) {
  return { billId: edit.billId, draftId: edit.draftId, revision: edit.draftRevision, edit };
}

describe("table composition compares every affected bill before moving anything", () => {
  it.each(actions)(
    "%s refuses distinct editors with the complete sorted conflict set",
    async (action) => {
      const from = await party(),
        into = await party();
      const extra = await otherBill(from.partyId);
      await save(from.partyId, from.tabId, venue.adminId);
      await save(from.partyId, extra, venue.adminId);
      await save(into.partyId, into.tabId);
      const expected = await edits(from.partyId, into.partyId);
      const conflicts = expected.filter((e) => e.editorId === venue.adminId);
      await refused(
        () => request(action, from, into, expected),
        "draft.taken_over",
        conflict(conflicts[0]!, conflicts),
      );
    },
  );
  it.each(actions)(
    "%s accepts one common foreign editor when bills stay separate",
    async (action) => {
      const from = await party(),
        into = await party();
      const left = await save(from.partyId, from.tabId, venue.adminId);
      const right = await save(into.partyId, into.tabId, venue.adminId);
      await request(action, from, into, await edits(from.partyId, into.partyId));
      const after = await edits(into.partyId);
      expect(after.map((e) => [e.billId, e.editorId, e.draftId])).toEqual(
        [
          [from.tabId, venue.adminId, left.draft!.id],
          [into.tabId, venue.adminId, right.draft!.id],
        ].sort((a, b) => a[0]!.localeCompare(b[0]!)),
      );
    },
  );
  it.each(actions)(
    "%s refuses an actual bill merge without the common editor's authority",
    async (action) => {
      const from = await party(),
        into = await party();
      await save(from.partyId, from.tabId, venue.adminId);
      await save(into.partyId, into.tabId, venue.adminId);
      const expected = await edits(from.partyId, into.partyId);
      await refused(
        () => request(action, from, into, expected, "merge"),
        "draft.taken_over",
        conflict(expected[0]!, expected),
      );
    },
  );

  it.each(actions)(
    "%s compares merge authority using the service mode after relocation",
    async (action) => {
      const from = await party(),
        into = await party();
      await save(from.partyId, from.tabId, venue.adminId);
      await save(into.partyId, into.tabId, venue.adminId);
      await inTx(venue, async (tx) => {
        const counter = await offerProducts(tx, venue.cfg, { zone: "counter" });
        await VENUE_SERVICE.retargetOrderContext(tx, venue.cfg, from.tabId, counter.zoneId);
      });
      const expected = await edits(from.partyId, into.partyId);
      await refused(
        () => request(action, from, into, expected, "merge"),
        "draft.taken_over",
        conflict(expected[0]!, expected),
      );
    },
  );
  it.each(actions)(
    "%s retains an authorised bill merge after the source changes service mode",
    async (action) => {
      const from = await party(),
        into = await party();
      await save(from.partyId, from.tabId);
      await save(into.partyId, into.tabId);
      await inTx(venue, async (tx) => {
        const counter = await offerProducts(tx, venue.cfg, { zone: "counter" });
        await VENUE_SERVICE.retargetOrderContext(tx, venue.cfg, from.tabId, counter.zoneId);
      });
      expect(
        await request(action, from, into, await edits(from.partyId, into.partyId), "merge"),
      ).toMatchObject({ merged: true });
    },
  );
  it.each(actions)("%s rejects a stale version on an empty destination bill", async (action) => {
    const from = await party(),
      into = await party();
    const extra = await otherBill(into.partyId);
    const expected = await edits(from.partyId, into.partyId);
    await inTx(venue, async (tx) =>
      tx.run(
        sql`insert into bill_edit_states (bill_id, editor_id, editor_version) values (${extra}, null, 2)`,
      ),
    );
    const current = await inTx(venue, (tx) => readBillEditState(tx, extra));
    await refused(() => request(action, from, into, expected), "draft.out_of_date", stale(current));
  });
  it.each(actions)("%s detects acquisition on an empty bill after the prompt", async (action) => {
    const from = await party(),
      into = await party();
    const expected = await edits(from.partyId, into.partyId);
    await save(into.partyId, into.tabId);
    const current = await inTx(venue, (tx) => readBillEditState(tx, into.tabId));
    await refused(() => request(action, from, into, expected), "draft.out_of_date", stale(current));
  });
  it.each(actions)("%s refuses missing or surplus bill expectations", async (action) => {
    const from = await party(),
      into = await party();
    const expected = await edits(from.partyId, into.partyId);
    await refused(
      () => request(action, from, into, expected.slice(1)),
      "management.request_invalid",
      { field: "expectedEdits" },
    );
    const extra = [...expected, blank(randomUUID())].sort((a, b) =>
      a.billId.localeCompare(b.billId),
    );
    await refused(() => request(action, from, into, extra), "management.request_invalid", {
      field: "expectedEdits",
    });
  });
  it.each(actions)("%s does not trust editor identity supplied by the body", async (action) => {
    const from = await party(),
      into = await party();
    await save(from.partyId, from.tabId, venue.adminId);
    await save(into.partyId, into.tabId);
    const expected = await edits(from.partyId, into.partyId);
    const foreign = expected.find((e) => e.editorId === venue.adminId)!;
    await refused(
      () =>
        request(
          action,
          from,
          into,
          expected.map((e) => ({ ...e, editorId: venue.operatorId })),
        ),
      "draft.taken_over",
      conflict(foreign),
    );
  });
  it.each(actions)(
    "%s succeeds after explicit per-bill takeover and a new read",
    async (action) => {
      const from = await party(),
        into = await party();
      const saved = await save(from.partyId, from.tabId, venue.adminId);
      await save(into.partyId, into.tabId);
      const old = await edits(from.partyId, into.partyId);
      await inTx(venue, (tx) =>
        takeOverDraft(tx, venue.cfg, from.partyId, saved.draft!.id, venue.operatorId, {
          revision: saved.draft!.revision,
          expectedEdit: saved.edit,
          submissionId: randomUUID(),
        }),
      );
      const current = await inTx(venue, (tx) => readBillEditState(tx, from.tabId));
      await refused(() => request(action, from, into, old), "draft.out_of_date", stale(current));
      await request(action, from, into, await edits(from.partyId, into.partyId));
      expect((await edits(into.partyId)).map((e) => e.editorId)).toEqual([
        venue.operatorId,
        venue.operatorId,
      ]);
    },
  );
  it.each(actions)(
    "%s advances only relocated bills once, including empty bills",
    async (action) => {
      const from = await party(),
        into = await party();
      const empty = await otherBill(from.partyId);
      const saved = await save(from.partyId, from.tabId, venue.adminId);
      await save(into.partyId, into.tabId, venue.adminId);
      const expected = await edits(from.partyId, into.partyId);
      const lines = await venue.db.select().from(orderDraftLines).orderBy(orderDraftLines.id);
      await request(action, from, into, expected);
      expect(await inTx(venue, (tx) => readBillEditState(tx, from.tabId))).toEqual({
        ...saved.edit,
        editorVersion: 2,
        draftRevision: 1,
      });
      expect(await inTx(venue, (tx) => readBillEditState(tx, empty))).toEqual({
        ...blank(empty),
        editorId: null,
        editorName: null,
        editorVersion: 1,
      });
      expect(await inTx(venue, (tx) => readBillEditState(tx, into.tabId))).toEqual(
        expected.find((e) => e.billId === into.tabId),
      );
      expect(await venue.db.select().from(orderDraftLines).orderBy(orderDraftLines.id)).toEqual(
        lines,
      );
      await refused(
        () =>
          inTx(venue, (tx) =>
            saveDraft(tx, venue.cfg, into.partyId, venue.adminId, {
              billId: from.tabId,
              draftId: saved.draft!.id,
              revision: saved.draft!.revision,
              expectedEdit: saved.edit,
              lines: saved.draft!.lines,
            }),
          ),
        "draft.out_of_date",
        stale({ ...saved.edit, editorVersion: 2, draftRevision: 1 }),
      );
    },
  );
  it("a whole party moving to a free table advances every bill without changing editor or dishes", async () => {
    const from = await party(),
      free = await inTx(venue, (tx) =>
        createTable(tx, venue.cfg, { label: `Free-${randomUUID()}`, zoneId: venue.zoneId }),
      );
    const saved = await save(from.partyId, from.tabId, venue.adminId);
    const empty = await otherBill(from.partyId);
    const expectedEdits = await edits(from.partyId);
    await inTx(venue, (tx) =>
      moveGuests(tx, venue.cfg, from.partyId, free.id, {
        expectedEdits,
        bills: "separate",
        operatorId: venue.operatorId,
        expectedPartyRevision: from.revision,
        otherPartyId: null,
      }),
    );
    expect(await inTx(venue, (tx) => readBillEditState(tx, from.tabId))).toEqual({
      ...saved.edit,
      editorVersion: 2,
      draftRevision: 1,
    });
    expect(await inTx(venue, (tx) => readBillEditState(tx, empty))).toEqual({
      ...blank(empty),
      editorId: null,
      editorName: null,
      editorVersion: 1,
    });
  });
  it.each(["join", "move"] as const)(
    "%s to a free table still compares every source bill",
    async (action) => {
      const from = await party(),
        free = await inTx(venue, (tx) =>
          createTable(tx, venue.cfg, { label: `Free-${randomUUID()}`, zoneId: venue.zoneId }),
        );
      const empty = await otherBill(from.partyId);
      await refused(
        () =>
          inTx(venue, (tx) =>
            (action === "join" ? joinTables : moveGuests)(tx, venue.cfg, from.partyId, free.id, {
              expectedEdits: [blank(from.tabId)],
              bills: "separate",
              operatorId: venue.operatorId,
              expectedPartyRevision: from.revision,
              otherPartyId: null,
            }),
          ),
        "management.request_invalid",
        { field: "expectedEdits" },
      );
      const saved = await save(from.partyId, empty);
      const old = [blank(from.tabId), blank(empty)].sort((a, b) =>
        a.billId.localeCompare(b.billId),
      );
      await refused(
        () =>
          inTx(venue, (tx) =>
            (action === "join" ? joinTables : moveGuests)(tx, venue.cfg, from.partyId, free.id, {
              expectedEdits: old,
              bills: "separate",
              operatorId: venue.operatorId,
              expectedPartyRevision: from.revision,
              otherPartyId: null,
            }),
          ),
        "draft.out_of_date",
        stale(saved.edit),
      );
    },
  );

  it.each(actions)("%s compares closed destination bills as well", async (action) => {
    const from = await party(),
      into = await party();
    const [closed] = await inTx(venue, async (tx) =>
      tx
        .insert(workingOrders)
        .values({
          source: "dashboard",
          orderNumber: 3,
          partyId: into.partyId,
          locationId: venue.cfg.locationId,
          status: "abandoned",
        })
        .returning(),
    );
    const expected = (await edits(from.partyId, into.partyId)).filter(
      (e) => e.billId !== closed!.id,
    );
    await refused(() => request(action, from, into, expected), "management.request_invalid", {
      field: "expectedEdits",
    });
  });
  it.each(actions)(
    "%s preserves recalled identity, price and allergy ticks during relocation",
    async (action) => {
      const from = await party(),
        into = await party();
      await inTx(venue, async (tx) => {
        await writeEditSentLines(tx, true);
        await submitGroups(tx, venue.cfg, from.partyId, {
          expectedPartyRevision: from.revision,
          operatorId: venue.operatorId,
          submissionId: randomUUID(),
          groups: [
            { release: "fire", lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }] },
          ],
        });
      });
      const [dish] = await venue.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, from.tabId));
      const [partyRow] = await venue.db.select().from(parties).where(eq(parties.id, from.partyId));
      const recalled = await inTx(venue, (tx) =>
        recallToDraft(tx, venue.cfg, from.partyId, dish!.id, {
          expectedPartyRevision: partyRow!.revision,
          operatorId: venue.operatorId,
          submissionId: randomUUID(),
          expectedEdit: blank(from.tabId),
        }),
      );
      await inTx(venue, async (tx) => {
        const allergy = await VENUE_SERVICE.savePartyAllergy(
          tx,
          from.partyId,
          recalled.revision,
          { answer: "allergies", guests: [{ who: "Blue coat", allergens: { milk: {} } }] },
          venue.operatorId,
        );
        await VENUE_SERVICE.setAllergyLineTicks(tx, from.partyId, [
          { guestId: allergy.guests[0]!.id, workingLineId: dish!.id },
        ]);
      });
      const sources = await venue.db
        .select()
        .from(orderDraftRecalledLines)
        .orderBy(orderDraftRecalledLines.id);
      const charges = await venue.db.select().from(workingOrderLines).orderBy(workingOrderLines.id);
      const allergy = await inTx(venue, (tx) => VENUE_SERVICE.readPartyAllergy(tx, from.partyId));
      await request(action, from, into, await edits(from.partyId, into.partyId));
      expect(
        await venue.db.select().from(orderDraftRecalledLines).orderBy(orderDraftRecalledLines.id),
      ).toEqual(sources);
      expect(await venue.db.select().from(workingOrderLines).orderBy(workingOrderLines.id)).toEqual(
        charges,
      );
      const movedAllergy = await inTx(venue, (tx) =>
        VENUE_SERVICE.readPartyAllergy(tx, into.partyId),
      );
      expect(movedAllergy.guests).toEqual(
        allergy.guests.map((guest) => ({ ...guest, partyId: into.partyId })),
      );
      expect(movedAllergy.ticks).toEqual(allergy.ticks);
      expect(await inTx(venue, (tx) => readBillEditState(tx, from.tabId))).toEqual({
        ...recalled.edit,
        editorVersion: 2,
        draftRevision: 1,
      });
    },
  );
  it.each(["join", "move"] as const)(
    "HTTP %s forwards observations and authenticates the actor",
    async (action) => {
      const from = await party(),
        into = await party();
      const saved = await save(from.partyId, from.tabId, venue.adminId);
      await save(into.partyId, into.tabId);
      const expectedEdits = await edits(from.partyId, into.partyId);
      const body = {
        expectedEdits,
        operatorId: venue.adminId,
        bills: "separate",
        expectedPartyRevision: into.revision,
        otherPartyId: from.partyId,
        expectedOtherPartyRevision: from.revision,
        ...(action === "join" ? { tableId: from.tableId } : { toTableId: from.tableId }),
      };
      expect((await send(venue.app, venue.cookie, "GET", "/api/till")).status).toBe(200);
      const before = await allRows();
      expect(
        await send(venue.app, venue.cookie, "POST", `/api/parties/${into.partyId}/${action}`, body),
      ).toEqual({ status: 409, json: { code: "draft.taken_over", params: conflict(saved.edit) } });
      expect(await allRows()).toEqual(before);
    },
  );
  it.each(["join", "move"] as const)(
    "HTTP %s requires the complete expected-edit array",
    async (action) => {
      const from = await party(),
        into = await party();
      const body = {
        bills: "separate",
        expectedPartyRevision: into.revision,
        otherPartyId: from.partyId,
        expectedOtherPartyRevision: from.revision,
        ...(action === "join" ? { tableId: from.tableId } : { toTableId: from.tableId }),
      };
      expect((await send(venue.app, venue.cookie, "GET", "/api/till")).status).toBe(200);
      const before = await allRows();
      const answer = await send(
        venue.app,
        venue.cookie,
        "POST",
        `/api/parties/${into.partyId}/${action}`,
        body,
      );
      expect(answer).toEqual({
        status: 400,
        json: { code: "management.request_invalid", params: { field: "expectedEdits" } },
      });
      expect(await allRows()).toEqual(before);
    },
  );
});
