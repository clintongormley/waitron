import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  orderDrafts,
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
  readDrafts,
  type BillEditExpected,
  type BillEditState,
} from "./order-drafts.js";
import { joinTables, splitTable } from "./table-actions.js";
import { moveBill } from "./move-bill.js";
import { mergeBills } from "./bill-actions.js";
import { writeEditSentLines } from "@waitron/venue-service";
import { VENUE_SERVICE } from "./modules.js";
import { recallToDraft } from "./draft-recall.js";

import { submitGroups } from "./testing/group-submit-fixture.js";
import { seatTable } from "./parties.js";
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
    await VENUE_SERVICE.recordOrderContext(tx, venue.cfg, bill!.id, venue.zoneId);
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
async function move(
  from: Awaited<ReturnType<typeof party>>,
  into: Awaited<ReturnType<typeof party>>,
  billId: string,
  expectedEdits: BillEditExpected[],
  bills: "merge" | "separate" = "separate",
) {
  const rows = await venue.db
    .select()
    .from(parties)
    .where(inArray(parties.id, [from.partyId, into.partyId]));
  return inTx(venue, (tx) =>
    moveBill(
      tx,
      venue.cfg,
      billId,
      { tableId: into.tableId },
      {
        partyId: from.partyId,
        expectedPartyRevision: rows.find((p) => p.id === from.partyId)!.revision,
        otherPartyId: into.partyId,
        expectedOtherPartyRevision: rows.find((p) => p.id === into.partyId)!.revision,
        operatorId: venue.operatorId,
        bills,
        expectedEdits,
      },
    ),
  );
}
async function billEdits(...ids: string[]) {
  return inTx(venue, async (tx) => {
    const result: BillEditState[] = [];
    for (const id of [...ids].sort()) result.push(await readBillEditState(tx, id));
    return result;
  });
}

describe("moving one bill compares only that bill and the complete destination", () => {
  it("refuses distinct destination editors without moving any row", async () => {
    const from = await party(),
      into = await party();
    await save(from.partyId, from.tabId, venue.adminId);
    await save(into.partyId, into.tabId);
    const expected = await billEdits(from.tabId, into.tabId);
    const foreign = expected.find((e) => e.editorId === venue.adminId)!;
    await refused(
      () => move(from, into, from.tabId, expected),
      "draft.taken_over",
      conflict(foreign),
    );
  });
  it("does not include unrelated source bills and keeps their editor state unchanged", async () => {
    const from = await party(),
      into = await party();
    const moving = await otherBill(from.partyId);
    await save(from.partyId, from.tabId);
    const left = (await billEdits(from.tabId))[0]!;
    const saved = await save(from.partyId, moving, venue.adminId);
    await save(into.partyId, into.tabId, venue.adminId);
    await move(from, into, moving, await billEdits(moving, into.tabId));
    expect((await billEdits(from.tabId))[0]).toEqual(left);
    expect((await billEdits(moving))[0]).toEqual({
      ...saved.edit,
      editorVersion: 2,
      draftRevision: 1,
    });
    const [draft] = await venue.db
      .select()
      .from(orderDrafts)
      .where(eq(orderDrafts.id, saved.draft!.id));
    expect(draft).toMatchObject({
      partyId: into.partyId,
      billId: moving,
      ownerId: venue.adminId,
      state: "open",
    });
    expect(
      (await inTx(venue, (tx) => readDrafts(tx, venue.cfg, into.partyId))).find(
        (d) => d.id === saved.draft!.id,
      )?.lines,
    ).toEqual(saved.draft!.lines);
  });
  it.each(["missing", "extra", "unsorted", "absent"] as const)(
    "refuses %s affected-set expectations",
    async (kind) => {
      const from = await party(),
        into = await party();
      const expected = await billEdits(from.tabId, into.tabId);
      const values =
        kind === "missing"
          ? expected.slice(1)
          : kind === "extra"
            ? [...expected, blank(randomUUID())].sort((a, b) => a.billId.localeCompare(b.billId))
            : kind === "unsorted"
              ? [...expected].reverse()
              : undefined;
      await refused(
        () => move(from, into, from.tabId, values as BillEditExpected[]),
        "management.request_invalid",
        { field: kind === "unsorted" ? "expectedEdits.1.billId" : "expectedEdits" },
      );
    },
  );
  it("refuses a newly acquired formerly empty destination before changing any row", async () => {
    const from = await party(),
      into = await party();
    const expected = await billEdits(from.tabId, into.tabId);
    const saved = await save(into.partyId, into.tabId);
    await refused(
      () => move(from, into, from.tabId, expected),
      "draft.out_of_date",
      stale(saved.edit),
    );
  });
  it("invalidates an empty relocated bill while retaining the destination version", async () => {
    const from = await party(),
      into = await party();
    const expected = await billEdits(from.tabId, into.tabId);
    await move(from, into, from.tabId, expected);
    expect((await billEdits(from.tabId))[0]).toEqual({
      ...blank(from.tabId),
      editorId: null,
      editorName: null,
      editorVersion: 1,
    });
    expect((await billEdits(into.tabId))[0]).toEqual(expected.find((e) => e.billId === into.tabId));
  });
  it("refuses a merge even with a common foreign editor", async () => {
    const from = await party(),
      into = await party();
    await save(from.partyId, from.tabId, venue.adminId);
    await save(into.partyId, into.tabId, venue.adminId);
    const expected = await billEdits(from.tabId, into.tabId);
    await refused(
      () => move(from, into, from.tabId, expected, "merge"),
      "draft.taken_over",
      conflict(expected[0]!, expected),
    );
  });
});

describe("split a table carries only its moved bill editor", () => {
  async function setup() {
    const from = await party();
    const free = await inTx(venue, (tx) =>
      createTable(tx, venue.cfg, { label: `Split-${randomUUID()}`, zoneId: venue.zoneId }),
    );
    const own = await venue.db.select().from(parties).where(eq(parties.id, from.partyId));
    await inTx(venue, (tx) =>
      joinTables(tx, venue.cfg, from.partyId, free.id, {
        bills: "separate",
        operatorId: venue.operatorId,
        otherPartyId: null,
        expectedPartyRevision: own[0]!.revision,
        expectedEdits: [blank(from.tabId)],
      }),
    );
    return { ...from, leaving: free.id, billId: await otherBill(from.partyId) };
  }
  async function split(from: Awaited<ReturnType<typeof setup>>, expectedEdits: BillEditExpected[]) {
    const [row] = await venue.db.select().from(parties).where(eq(parties.id, from.partyId));
    return inTx(venue, (tx) =>
      splitTable(tx, venue.cfg, from.partyId, from.leaving, from.billId, {
        expectedPartyRevision: row!.revision,
        operatorId: venue.operatorId,
        expectedEdits,
      }),
    );
  }
  it("keeps a common foreign editor and leaves the staying bill unchanged", async () => {
    const from = await setup();
    await save(from.partyId, from.tabId);
    const staying = (await billEdits(from.tabId))[0]!;
    const saved = await save(from.partyId, from.billId, venue.adminId);
    const result = await split(from, [saved.edit]);
    expect((await billEdits(from.billId))[0]).toEqual({
      ...saved.edit,
      editorVersion: 2,
      draftRevision: 1,
    });
    expect((await billEdits(from.tabId))[0]).toEqual(staying);
    const [draft] = await venue.db
      .select()
      .from(orderDrafts)
      .where(eq(orderDrafts.id, saved.draft!.id));
    expect(draft).toMatchObject({
      partyId: result.partyId,
      billId: from.billId,
      ownerId: venue.adminId,
    });
  });
  it("refuses a stale empty bill without creating a party or editor state", async () => {
    const from = await setup();
    const saved = await save(from.partyId, from.billId);
    await refused(() => split(from, [blank(from.billId)]), "draft.out_of_date", stale(saved.edit));
  });
});

describe("bill merges require both editors and release the consumed bill", () => {
  async function merge(
    partyId: string,
    into: string,
    from: string,
    expectedEdits: BillEditExpected[],
  ) {
    const [p] = await venue.db.select().from(parties).where(eq(parties.id, partyId));
    return inTx(venue, (tx) =>
      mergeBills(tx, venue.cfg, into, from, {
        partyId,
        expectedPartyRevision: p!.revision,
        operatorId: venue.operatorId,
        expectedEdits,
      }),
    );
  }
  it("refuses both common foreign drafts before any composition", async () => {
    const p = await party(),
      from = await otherBill(p.partyId);
    await save(p.partyId, p.tabId, venue.adminId);
    await save(p.partyId, from, venue.adminId);
    const expected = await billEdits(p.tabId, from);
    await refused(
      () => merge(p.partyId, p.tabId, from, expected),
      "draft.taken_over",
      conflict(expected[0]!, expected),
    );
  });
  it("merges same-editor rows without coalescing IDs, releasing source and advancing survivor once", async () => {
    const p = await party(),
      from = await otherBill(p.partyId);
    const left = await save(p.partyId, p.tabId),
      right = await save(p.partyId, from);
    await merge(p.partyId, p.tabId, from, await billEdits(p.tabId, from));
    const after = await billEdits(p.tabId, from);
    expect(after.find((e) => e.billId === from)).toEqual({
      ...blank(from),
      editorId: null,
      editorName: null,
      editorVersion: 2,
    });
    expect(after.find((e) => e.billId === p.tabId)).toEqual({
      ...left.edit,
      editorVersion: 2,
      draftRevision: 1,
    });
    const drafts = await inTx(venue, (tx) => readDrafts(tx, venue.cfg, p.partyId));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.id).toBe(left.draft!.id);
    expect(drafts[0]!.lines.map((l) => ({ id: l.id, quantity: l.quantity }))).toEqual([
      { id: left.draft!.lines[0]!.id, quantity: "1.000" },
      { id: right.draft!.lines[0]!.id, quantity: "1.000" },
    ]);
  });
  it("retargets the only draft in place and transfers its editor to an empty survivor", async () => {
    const p = await party(),
      from = await otherBill(p.partyId);
    const saved = await save(p.partyId, from);
    await merge(p.partyId, p.tabId, from, await billEdits(p.tabId, from));
    expect((await billEdits(from))[0]).toEqual({
      ...blank(from),
      editorId: null,
      editorName: null,
      editorVersion: 2,
    });
    expect((await billEdits(p.tabId))[0]).toEqual({
      ...saved.edit,
      billId: p.tabId,
      editorVersion: 1,
      draftRevision: 1,
    });
    const drafts = await inTx(venue, (tx) => readDrafts(tx, venue.cfg, p.partyId));
    expect(drafts[0]).toMatchObject({
      id: saved.draft!.id,
      billId: p.tabId,
      ownerId: venue.operatorId,
    });
    expect(drafts[0]!.lines).toEqual(saved.draft!.lines);
  });
  it("keeps recalled and fresh row identities, slot offsets and both allergy tick kinds", async () => {
    const p = await party(),
      from = await otherBill(p.partyId);
    await inTx(venue, async (tx) => {
      await writeEditSentLines(tx, true);
      await submitGroups(tx, venue.cfg, p.partyId, {
        expectedPartyRevision: p.revision,
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
      .where(eq(workingOrderLines.workingOrderId, p.tabId));
    const [row] = await venue.db.select().from(parties).where(eq(parties.id, p.partyId));
    const recalled = await inTx(venue, (tx) =>
      recallToDraft(tx, venue.cfg, p.partyId, dish!.id, {
        expectedPartyRevision: row!.revision,
        operatorId: venue.operatorId,
        submissionId: randomUUID(),
        expectedEdit: blank(p.tabId),
      }),
    );
    const source = await save(p.partyId, from);
    await inTx(venue, async (tx) => {
      await tx
        .update(orderDraftLines)
        .set({ slot: 1 })
        .where(eq(orderDraftLines.id, source.draft!.lines[0]!.id));
      await tx
        .update(orderDraftRecalledLines)
        .set({ slot: 2 })
        .where(eq(orderDraftRecalledLines.id, recalled.draft.lines[0]!.id));
      const [pRow] = await tx.select().from(parties).where(eq(parties.id, p.partyId));
      const allergy = await VENUE_SERVICE.savePartyAllergy(
        tx,
        p.partyId,
        pRow!.revision,
        { answer: "allergies", guests: [{ who: "Green coat", allergens: { milk: {} } }] },
        venue.operatorId,
      );
      await VENUE_SERVICE.setAllergyLineTicks(tx, p.partyId, [
        { guestId: allergy.guests[0]!.id, workingLineId: dish!.id },
        { guestId: allergy.guests[0]!.id, draftLineId: source.draft!.lines[0]!.id },
      ]);
    });
    const allergy = await inTx(venue, (tx) => VENUE_SERVICE.readPartyAllergy(tx, p.partyId));
    const charges = await venue.db.select().from(workingOrderLines).orderBy(workingOrderLines.id);
    const sources = await venue.db
      .select()
      .from(orderDraftRecalledLines)
      .orderBy(orderDraftRecalledLines.id);
    await merge(p.partyId, from, p.tabId, await billEdits(from, p.tabId));
    const drafts = await inTx(venue, (tx) => readDrafts(tx, venue.cfg, p.partyId));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.id).toBe(source.draft!.id);
    expect(
      drafts[0]!.lines.map((l) => ({ id: l.id, sourceLineId: l.sourceLineId, slot: l.slot })),
    ).toEqual([
      { id: source.draft!.lines[0]!.id, sourceLineId: null, slot: 1 },
      { id: recalled.draft.lines[0]!.id, sourceLineId: dish!.id, slot: 3 },
    ]);
    expect(await venue.db.select().from(workingOrderLines).orderBy(workingOrderLines.id)).toEqual(
      charges.map((c) => (c.workingOrderId === p.tabId ? { ...c, workingOrderId: from } : c)),
    );
    expect(
      await venue.db.select().from(orderDraftRecalledLines).orderBy(orderDraftRecalledLines.id),
    ).toEqual(
      sources.map((r) =>
        r.draftId === recalled.draft.id
          ? { ...r, draftId: source.draft!.id, position: 2, slot: 3 }
          : r,
      ),
    );
    expect(await inTx(venue, (tx) => VENUE_SERVICE.readPartyAllergy(tx, p.partyId))).toEqual({
      ...allergy,
      revision: 4,
    });
  });
});

describe("bill move HTTP boundaries require observed edits and use the authenticated actor", () => {
  it.each(["move", "merge", "split-table"] as const)(
    "HTTP %s refuses absent expectations",
    async (action) => {
      const from = await party(),
        into = await party();
      const route =
        action === "split-table"
          ? `/api/parties/${from.partyId}/split-table`
          : `/api/bills/${from.tabId}/${action}`;
      const body = {
        bills: "separate",
        partyId: from.partyId,
        expectedPartyRevision: from.revision,
        to: { tableId: into.tableId },
        otherPartyId: into.partyId,
        expectedOtherPartyRevision: into.revision,
        fromBillId: into.tabId,
        tableId: from.tableId,
        billId: from.tabId,
      };
      expect((await send(venue.app, venue.cookie, "GET", "/api/till")).status).toBe(200);
      const before = await allRows();
      expect(await send(venue.app, venue.cookie, "POST", route, body)).toEqual({
        status: 400,
        json: { code: "management.request_invalid", params: { field: "expectedEdits" } },
      });
      expect(await allRows()).toEqual(before);
    },
  );
  it("HTTP move cannot impersonate the destination editor", async () => {
    const from = await party(),
      into = await party();
    await save(from.partyId, from.tabId);
    const foreign = await save(into.partyId, into.tabId, venue.adminId);
    expect((await send(venue.app, venue.cookie, "GET", "/api/till")).status).toBe(200);
    const before = await allRows();
    expect(
      await send(venue.app, venue.cookie, "POST", `/api/bills/${from.tabId}/move`, {
        bills: "separate",
        partyId: from.partyId,
        expectedPartyRevision: from.revision,
        to: { tableId: into.tableId },
        otherPartyId: into.partyId,
        expectedOtherPartyRevision: into.revision,
        operatorId: venue.adminId,
        expectedEdits: await billEdits(from.tabId, into.tabId),
      }),
    ).toEqual({ status: 409, json: { code: "draft.taken_over", params: conflict(foreign.edit) } });
    expect(await allRows()).toEqual(before);
  });
});
