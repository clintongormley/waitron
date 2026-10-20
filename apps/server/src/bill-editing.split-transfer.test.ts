import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { parties, workingOrders, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { writeEditSentLines } from "@waitron/venue-service";
import { splitBill, transferItems } from "./bill-actions.js";
import { readBillEditState } from "./bill-editing.js";
import { recallToDraft } from "./draft-recall.js";

import { submitGroups } from "./testing/group-submit-fixture.js";
import {
  readDrafts,
  saveDraft,
  type BillEditExpected,
  type BillEditState,
} from "./order-drafts.js";
import { seatTable } from "./parties.js";
import { VENUE_SERVICE } from "./modules.js";
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

async function fixture() {
  return inTx(venue, async (tx) => {
    const table = await createTable(tx, venue.cfg, {
      label: `Split-${randomUUID().slice(0, 8)}`,
      zoneId: venue.zoneId,
    });
    const p = await seatTable(tx, venue.cfg, {
      tableId: table.id,
      operatorId: venue.operatorId,
      guestCount: 2,
    });
    const [other] = await tx
      .insert(workingOrders)
      .values({
        source: "dashboard",
        orderNumber: 2,
        partyId: p.partyId,
        locationId: venue.cfg.locationId,
      })
      .returning();
    await VENUE_SERVICE.recordOrderContext(tx, venue.cfg, other!.id, venue.zoneId);
    await submitGroups(tx, venue.cfg, p.partyId, {
      allergy: { party: { answer: "none", guests: [] }, ticks: [] },
      expectedPartyRevision: p.revision,
      operatorId: venue.operatorId,
      submissionId: randomUUID(),
      groups: [
        { release: "fire", lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "2" }] },
      ],
    });
    const [dish] = await tx
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, p.tabId));
    return { ...p, otherId: other!.id, dish: dish! };
  });
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function edit(billId: string) {
  return inTx(venue, (tx) => readBillEditState(tx, billId));
}
async function save(p: Fixture, billId: string, operatorId = venue.operatorId) {
  const expectedEdit = await edit(billId);
  return inTx(venue, (tx) =>
    saveDraft(tx, venue.cfg, p.partyId, operatorId, {
      billId,
      draftId: expectedEdit.draftId,
      revision: expectedEdit.draftRevision ?? 0,
      expectedEdit,
      lines: [{ menuItemId: venue.offerFor("Paella"), quantity: "1" }],
    }),
  );
}
async function command(p: Fixture) {
  const [row] = await venue.db.select().from(parties).where(eq(parties.id, p.partyId));
  return { partyId: p.partyId, expectedPartyRevision: row!.revision, operatorId: venue.operatorId };
}
async function edits(p: Fixture): Promise<BillEditExpected[]> {
  return [await edit(p.tabId), await edit(p.otherId)].sort((a, b) =>
    a.billId.localeCompare(b.billId),
  );
}
async function rows(http = false) {
  const tables = venue.db.all<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' order by name`,
  );
  const result: Record<string, unknown[]> = {};
  for (const { name } of tables)
    result[name] = venue.db
      .all<Record<string, unknown>>(sql`select * from ${sql.identifier(name)} order by rowid`)
      .map((row) => (http && name === "devices" ? { ...row, last_seen_at: null } : row));
  return result;
}
async function refused(run: () => Promise<unknown>, code: string, params: unknown) {
  const before = await rows();
  await expect(run()).rejects.toMatchObject({ code, params });
  expect(await rows()).toEqual(before);
}
function conflict(e: BillEditState, multiple = false) {
  return {
    billId: e.billId,
    draftId: e.draftId,
    ownerId: e.editorId,
    ownerName: e.editorName,
    edit: e,
    ...(multiple ? { conflicts: [e] } : {}),
  };
}
function stale(e: BillEditState) {
  return { billId: e.billId, draftId: e.draftId, revision: e.draftRevision, edit: e };
}
async function split(p: Fixture, expectedEdit: BillEditExpected, quantity?: string) {
  const ask = { ...(await command(p)), expectedEdit };
  return inTx(venue, (tx) =>
    splitBill(
      tx,
      venue.cfg,
      p.tabId,
      [{ lineNo: p.dish.lineNo, ...(quantity === undefined ? {} : { quantity }) }],
      ask,
    ),
  );
}
async function transfer(p: Fixture, expectedEdits: BillEditExpected[], quantity?: string) {
  const ask = { ...(await command(p)), expectedEdits };
  return inTx(venue, (tx) =>
    transferItems(
      tx,
      venue.cfg,
      p.tabId,
      p.otherId,
      [{ lineNo: p.dish.lineNo, ...(quantity === undefined ? {} : { quantity }) }],
      ask,
    ),
  );
}
async function recall(p: Fixture) {
  const ask = {
    ...(await command(p)),
    expectedEdit: await edit(p.tabId),
    submissionId: randomUUID(),
  };
  return inTx(venue, async (tx) => {
    await writeEditSentLines(tx, true);
    return recallToDraft(tx, venue.cfg, p.partyId, p.dish.id, ask);
  });
}

describe("splitting a bill requires its current editor before creating a destination", () => {
  it("refuses a colleague without creating a bill or editor state", async () => {
    const p = await fixture(),
      saved = await save(p, p.tabId, venue.adminId);
    await refused(() => split(p, saved.edit), "draft.taken_over", conflict(saved.edit));
  });
  it("refuses a stale source version without creating any rows", async () => {
    const p = await fixture(),
      old = await edit(p.tabId),
      saved = await save(p, p.tabId);
    await refused(() => split(p, old), "draft.out_of_date", stale(saved.edit));
  });
  it.each(["absent", "wrong-bill"] as const)("refuses %s expectation", async (kind) => {
    const p = await fixture();
    await refused(
      () => split(p, (kind === "absent" ? undefined : wrongBill(p)) as BillEditExpected),
      "management.request_invalid",
      { field: kind === "absent" ? "expectedEdit" : "expectedEdit.billId" },
    );
  });
  it("splits sent food while unrelated colleague work and both outboxes stay unchanged", async () => {
    const p = await fixture(),
      saved = await save(p, p.tabId);
    const other = await save(p, p.otherId, venue.adminId);
    const drafts = await inTx(venue, (tx) => readDrafts(tx, venue.cfg, p.partyId));
    const result = await split(p, saved.edit, "1");
    expect(await edit(p.tabId)).toEqual(saved.edit);
    expect(await edit(p.otherId)).toEqual(other.edit);
    expect(await edit(result.billId)).toEqual({
      billId: result.billId,
      editorId: null,
      editorName: null,
      editorVersion: 0,
      draftId: null,
      draftRevision: null,
    });
    expect(await inTx(venue, (tx) => readDrafts(tx, venue.cfg, p.partyId))).toEqual(drafts);
    const source = await venue.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.id, p.dish.id));
    const moved = await venue.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, result.billId));
    expect(source[0]).toMatchObject({ quantity: 1000, unitPriceGross: 1800, lineTotal: 1800 });
    expect(moved[0]).toMatchObject({ quantity: 1000, unitPriceGross: 1800, lineTotal: 1800 });
  });
});
function wrongBill(p: Fixture): BillEditExpected {
  return { billId: p.otherId, editorVersion: 0, draftId: null, draftRevision: null };
}

describe("transferring dishes compares both bills including an empty destination", () => {
  it.each(["source", "destination"] as const)(
    "refuses the foreign %s editor atomically",
    async (which) => {
      const p = await fixture();
      const saved = await save(p, which === "source" ? p.tabId : p.otherId, venue.adminId);
      const expected = await edits(p);
      await refused(() => transfer(p, expected), "draft.taken_over", conflict(saved.edit, true));
    },
  );
  it("refuses a sole common foreign editor rather than treating composition as relocation", async () => {
    const p = await fixture();
    const a = await save(p, p.tabId, venue.adminId),
      b = await save(p, p.otherId, venue.adminId);
    const conflicts = [a.edit, b.edit].sort((x, y) => x.billId.localeCompare(y.billId));
    const expected = await edits(p);
    await refused(() => transfer(p, expected), "draft.taken_over", {
      ...conflict(conflicts[0]!),
      conflicts,
    });
  });
  it.each(["absent", "missing", "extra", "unsorted"] as const)(
    "refuses %s affected-state set",
    async (kind) => {
      const p = await fixture(),
        expected = await edits(p);
      const bad =
        kind === "absent"
          ? undefined
          : kind === "missing"
            ? expected.slice(1)
            : kind === "unsorted"
              ? [...expected].reverse()
              : [
                  ...expected,
                  { billId: randomUUID(), editorVersion: 0, draftId: null, draftRevision: null },
                ].sort((a, b) => a.billId.localeCompare(b.billId));
      await refused(() => transfer(p, bad as BillEditExpected[]), "management.request_invalid", {
        field: kind === "unsorted" ? "expectedEdits.1.billId" : "expectedEdits",
      });
    },
  );
  it("refuses a same-person acquisition of the formerly empty destination", async () => {
    const p = await fixture(),
      expected = await edits(p),
      saved = await save(p, p.otherId);
    await refused(() => transfer(p, expected), "draft.out_of_date", stale(saved.edit));
  });
  it("keeps the two actor-owned outboxes while moving exact priced sent quantities", async () => {
    const p = await fixture(),
      a = await save(p, p.tabId),
      b = await save(p, p.otherId);
    const drafts = await inTx(venue, (tx) => readDrafts(tx, venue.cfg, p.partyId));
    await transfer(p, await edits(p), "1");
    expect(await edit(p.tabId)).toEqual(a.edit);
    expect(await edit(p.otherId)).toEqual(b.edit);
    expect(await inTx(venue, (tx) => readDrafts(tx, venue.cfg, p.partyId))).toEqual(drafts);
    const moved = await venue.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, p.otherId));
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ quantity: 1000, unitPriceGross: 1800, lineTotal: 1800 });
    expect(
      (
        await venue.db.select().from(workingOrderLines).where(eq(workingOrderLines.id, p.dish.id))
      )[0],
    ).toMatchObject({ quantity: 1000, unitPriceGross: 1800, lineTotal: 1800 });
  });
});

describe("direct financial moves cannot mutate a reserved recalled family", () => {
  it.each(["split", "transfer"] as const)(
    "%s still moves a different sent dish while keeping the recalled source intact",
    async (action) => {
      const p = await fixture();
      await recall(p);
      const ask = await command(p);
      await inTx(venue, (tx) =>
        submitGroups(tx, venue.cfg, p.partyId, {
          ...ask,
          submissionId: randomUUID(),
          groups: [
            { release: "fire", lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }] },
          ],
        }),
      );
      const dishes = await venue.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, p.tabId));
      const sent = dishes.find((dish) => dish.id !== p.dish.id)!;
      const before = await edit(p.tabId);
      const drafts = await inTx(venue, (tx) => readDrafts(tx, venue.cfg, p.partyId));
      const target = { ...p, dish: sent };
      const destination = action === "split" ? (await split(target, before)).billId : p.otherId;
      if (action === "transfer") await transfer(target, await edits(p));
      expect(await edit(p.tabId)).toEqual(before);
      expect(await inTx(venue, (tx) => readDrafts(tx, venue.cfg, p.partyId))).toEqual(drafts);
      expect(
        (
          await venue.db.select().from(workingOrderLines).where(eq(workingOrderLines.id, p.dish.id))
        )[0],
      ).toEqual(p.dish);
      expect(
        (
          await venue.db.select().from(workingOrderLines).where(eq(workingOrderLines.id, sent.id))
        )[0],
      ).toMatchObject({
        workingOrderId: destination,
        quantity: 1000,
        unitPriceGross: 300,
        lineTotal: 300,
      });
    },
  );
  for (const action of ["split", "transfer"] as const)
    it.each(["whole", "partial"] as const)(
      `${action} refuses a %s recalled source without changing charges or reservations`,
      async (part) => {
        const p = await fixture(),
          recalled = await recall(p),
          expected = await edits(p);
        await refused(
          () =>
            action === "split"
              ? split(p, recalled.edit, part === "partial" ? "1" : undefined)
              : transfer(p, expected, part === "partial" ? "1" : undefined),
          "draft.out_of_date",
          stale(recalled.edit),
        );
      },
    );
});

describe("split and transfer HTTP contracts", () => {
  it.each(["split", "transfer"] as const)("refuses absent expectations on %s", async (action) => {
    const p = await fixture(),
      before = await rows(true);
    const response = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/bills/${p.tabId}/${action}`,
      {
        ...(await command(p)),
        transfers: [{ lineNo: p.dish.lineNo }],
        toBillId: p.otherId,
      },
    );
    expect(response.status).toBe(400);
    expect(response.json).toMatchObject({
      code: "management.request_invalid",
      params: {
        field: action === "split" ? "expectedEdit" : "expectedEdits",
      },
    });
    expect(await rows(true)).toEqual(before);
  });
  it.each(["split", "transfer"] as const)(
    "%s uses the session person instead of a body operator",
    async (action) => {
      const p = await fixture(),
        saved = await save(p, p.tabId, venue.adminId);
      const expectedEdits = await edits(p),
        before = await rows(true);
      const response = await send(
        venue.app,
        venue.cookie,
        "POST",
        `/api/bills/${p.tabId}/${action}`,
        {
          ...(await command(p)),
          operatorId: venue.adminId,
          transfers: [{ lineNo: p.dish.lineNo }],
          toBillId: p.otherId,
          expectedEdit: saved.edit,
          expectedEdits,
        },
      );
      expect(response.status).toBe(409);
      expect(response.json).toMatchObject({
        code: "draft.taken_over",
        params: conflict(saved.edit, action === "transfer"),
      });
      expect(await rows(true)).toEqual(before);
    },
  );
  it.each(["split", "transfer"] as const)(
    "%s forwards a valid explicit expectation",
    async (action) => {
      const p = await fixture(),
        expectedEdit = await edit(p.tabId),
        expectedEdits = await edits(p);
      const response = await send(
        venue.app,
        venue.cookie,
        "POST",
        `/api/bills/${p.tabId}/${action}`,
        {
          ...(await command(p)),
          transfers: [{ lineNo: p.dish.lineNo, quantity: "1" }],
          toBillId: p.otherId,
          expectedEdit,
          expectedEdits,
        },
      );
      expect(response.status).toBe(action === "split" ? 200 : 204);
      const destination = action === "split" ? (response.json.billId as string) : p.otherId;
      expect(
        (
          await venue.db
            .select()
            .from(workingOrderLines)
            .where(eq(workingOrderLines.workingOrderId, destination))
        )[0],
      ).toMatchObject({ quantity: 1000, unitPriceGross: 1800, lineTotal: 1800 });
    },
  );
});
