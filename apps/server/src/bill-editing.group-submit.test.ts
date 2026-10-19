import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { parties, workingOrders, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { writeEditSentLines } from "@waitron/venue-service";
import { VENUE_SERVICE } from "./modules.js";
import { readBillEditState } from "./bill-editing.js";
import { placeGroups, submitGroups, type SubmitGroupsInput } from "./order-groups.js";
import { readDrafts, saveDraft, submitDraft, takeOverDraft } from "./order-drafts.js";
import type { BillEditState } from "./order-drafts.js";
import { recallToDraft } from "./draft-recall.js";
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

async function fixture() {
  return inTx(venue, async (tx) => {
    const table = await createTable(tx, venue.cfg, {
      label: `Submit-${randomUUID().slice(0, 8)}`,
      zoneId: venue.zoneId,
    });
    const p = await seatTable(tx, venue.cfg, {
      tableId: table.id,
      operatorId: venue.operatorId,
      guestCount: 2,
    });
    await VENUE_SERVICE.writePartyAllergy(
      tx,
      p.partyId,
      { answer: "none", guests: [] },
      venue.operatorId,
    );
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
    return { ...p, otherId: other!.id };
  });
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const fresh = () => ({ menuItemId: venue.offerFor("Tarta"), quantity: "1" });
async function edit(id: string) {
  return inTx(venue, (tx) => readBillEditState(tx, id));
}
async function command(p: Fixture, billId = p.tabId) {
  const [party] = await venue.db.select().from(parties).where(eq(parties.id, p.partyId));
  return {
    submissionId: randomUUID(),
    expectedPartyRevision: party!.revision,
    operatorId: venue.operatorId,
    billId,
    expectedEdit: await edit(billId),
    groups: [{ release: "hold" as const, lines: [fresh()] }],
  };
}
async function save(p: Fixture, id = p.tabId, operatorId = venue.operatorId) {
  const expectedEdit = await edit(id);
  return inTx(venue, (tx) =>
    saveDraft(tx, venue.cfg, p.partyId, operatorId, {
      billId: id,
      expectedEdit,
      draftId: expectedEdit.draftId,
      revision: expectedEdit.draftRevision ?? 0,
      lines: [fresh()],
    }),
  );
}
async function frozen(http = false) {
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
async function refused(run: () => Promise<unknown>, code: string, params: unknown) {
  const before = await frozen();
  await expect(run()).rejects.toMatchObject({ code, params });
  expect(await frozen()).toEqual(before);
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

for (const operation of ["place", "submit"] as const) {
  const run = (p: Fixture, ask: SubmitGroupsInput) =>
    inTx(venue, (tx) =>
      operation === "place"
        ? placeGroups(tx, venue.cfg, p.partyId, ask)
        : submitGroups(tx, venue.cfg, p.partyId, ask),
    );
  describe(`${operation} groups checks bill editing at the writer`, () => {
    it("refuses a colleague before any charge, ticket, group, audit or command writes", async () => {
      const p = await fixture(),
        owned = await save(p, p.tabId, venue.adminId);
      const ask = await command(p);
      await refused(() => run(p, ask), "draft.taken_over", foreign(owned.edit));
    });
    it("refuses a stale same-person observation", async () => {
      const p = await fixture(),
        ask = await command(p),
        owned = await save(p);
      await refused(() => run(p, ask), "draft.out_of_date", stale(owned.edit));
    });
    it.each(["absent", "other-bill"] as const)(
      "refuses %s observation without selecting the main bill",
      async (kind) => {
        const p = await fixture(),
          ask = await command(p);
        const expectedEdit = kind === "absent" ? undefined! : await edit(p.otherId);
        await refused(() => run(p, { ...ask, expectedEdit }), "management.request_invalid", {
          field: kind === "absent" ? "expectedEdit" : "expectedEdit.billId",
        });
      },
    );
    it("allows its current editor without changing either bill's outbox or editor", async () => {
      const p = await fixture();
      await save(p);
      await save(p, p.otherId, venue.adminId);
      const before = await inTx(venue, (tx) => readDrafts(tx, venue.cfg, p.partyId));
      const states = [await edit(p.tabId), await edit(p.otherId)];
      const result = await run(p, await command(p));
      expect(result.tabId).toBe(p.tabId);
      expect(await inTx(venue, (tx) => readDrafts(tx, venue.cfg, p.partyId))).toEqual(before);
      expect([await edit(p.tabId), await edit(p.otherId)]).toEqual(states);
      const lines = await venue.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, p.tabId));
      expect(lines.map((l) => ({ quantity: l.quantity, total: l.lineTotal }))).toEqual([
        { quantity: 1000, total: 1800 },
      ]);
    });
    it("uses the supplied expectation's bill when the redundant billId is absent", async () => {
      const p = await fixture(),
        ask = await command(p, p.otherId);
      const withoutBillId = { ...ask, billId: undefined };
      const placed = await run(p, withoutBillId);
      expect(placed.tabId).toBe(p.otherId);
      expect(
        await venue.db
          .select()
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, p.tabId)),
      ).toEqual([]);
      expect(await edit(p.otherId)).toEqual({
        ...ask.expectedEdit,
        editorId: null,
        editorName: null,
      });
    });
    it("refuses another party's observed bill before moving either party", async () => {
      const p = await fixture(),
        other = await fixture(),
        ask = await command(p);
      const expectedEdit = await edit(other.tabId);
      await refused(
        () => run(p, { ...ask, billId: other.tabId, expectedEdit }),
        "bill.other_party",
        { workingOrderId: other.tabId },
      );
    });
  });
}

describe("submitted groups retain original ownership observations", () => {
  it("lets independent bill editors join one table-wide held group without transferring either outbox", async () => {
    const p = await fixture(),
      own = await save(p),
      other = await save(p, p.otherId, venue.adminId);
    const drafts = await inTx(venue, (tx) => readDrafts(tx, venue.cfg, p.partyId));
    const firstAsk = await command(p);
    const first = await inTx(venue, (tx) => submitGroups(tx, venue.cfg, p.partyId, firstAsk));
    const secondAsk = await command(p, p.otherId);
    const joined = await inTx(venue, (tx) =>
      submitGroups(tx, venue.cfg, p.partyId, {
        ...secondAsk,
        operatorId: venue.adminId,
        joinGroupId: first.groups[0]!.id,
      }),
    );
    expect(joined.groups).toHaveLength(1);
    expect(joined.groups[0]!.id).toBe(first.groups[0]!.id);
    expect(joined.groups[0]!.lineIds).toHaveLength(2);
    expect([await edit(p.tabId), await edit(p.otherId)]).toEqual([own.edit, other.edit]);
    expect(await inTx(venue, (tx) => readDrafts(tx, venue.cfg, p.partyId))).toEqual(drafts);
  });
  it("replays completed facts after takeover and rejects a changed observation under the same ID", async () => {
    const p = await fixture(),
      owned = await save(p),
      ask = await command(p);
    const result = await inTx(venue, (tx) => submitGroups(tx, venue.cfg, p.partyId, ask));
    const taken = await inTx(venue, (tx) =>
      takeOverDraft(tx, venue.cfg, p.partyId, owned.draft!.id, venue.adminId, {
        revision: owned.draft!.revision,
        expectedEdit: owned.edit,
        submissionId: randomUUID(),
      }),
    );
    const before = await frozen();
    expect(await inTx(venue, (tx) => submitGroups(tx, venue.cfg, p.partyId, ask))).toEqual(result);
    expect(await frozen()).toEqual(before);
    await refused(
      () =>
        inTx(venue, (tx) =>
          submitGroups(tx, venue.cfg, p.partyId, { ...ask, expectedEdit: taken.edit }),
        ),
      "submission.id_reused",
      { submissionId: ask.submissionId },
    );
  });
  it("requires HTTP observations and uses the session person rather than a body operator", async () => {
    const p = await fixture(),
      owned = await save(p, p.tabId, venue.adminId),
      ask = await command(p);
    for (const body of [
      { ...ask, expectedEdit: undefined },
      { ...ask, operatorId: venue.adminId },
    ]) {
      const before = await frozen(true);
      const answer = await send(
        venue.app,
        venue.cookie,
        "POST",
        `/api/parties/${p.partyId}/groups`,
        body,
      );
      expect(answer.status).toBe(body.expectedEdit === undefined ? 400 : 409);
      expect(answer.json).toMatchObject({
        code: body.expectedEdit === undefined ? "management.request_invalid" : "draft.taken_over",
        params: body.expectedEdit === undefined ? { field: "expectedEdit" } : foreign(owned.edit),
      });
      expect(await frozen(true)).toEqual(before);
    }
  });
  it("does not let direct placement move a reserved source, but its owning draft can resend it", async () => {
    const p = await fixture(),
      ask = await command(p);
    await inTx(venue, (tx) => submitGroups(tx, venue.cfg, p.partyId, ask));
    const [source] = await venue.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, p.tabId));
    const recallAsk = await command(p);
    await inTx(venue, async (tx) => {
      await writeEditSentLines(tx, true);
      await recallToDraft(tx, venue.cfg, p.partyId, source!.id, recallAsk);
    });
    const current = await edit(p.tabId),
      direct = await command(p);
    await refused(
      () =>
        inTx(venue, (tx) =>
          placeGroups(tx, venue.cfg, p.partyId, {
            ...direct,
            groups: [{ release: "fire", lines: [], existingLineIds: [source!.id] }],
          }),
        ),
      "draft.out_of_date",
      stale(current),
    );
    const drafts = await inTx(venue, (tx) => readDrafts(tx, venue.cfg, p.partyId));
    const sent = await inTx(venue, (tx) =>
      submitDraft(tx, venue.cfg, p.partyId, current.draftId!, {
        ...direct,
        expectedEdit: current,
        draftRevision: current.draftRevision!,
        groups: [{ release: "fire", lineIds: drafts[0]!.lines.map((l) => l.id) }],
      }),
    );
    expect(sent.draft).toBeNull();
    expect(sent.edit).toEqual({
      billId: p.tabId,
      editorId: null,
      editorName: null,
      editorVersion: 2,
      draftId: null,
      draftRevision: null,
    });
    const [after] = await venue.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.id, source!.id));
    expect(after).toEqual({ ...source, groupId: sent.groups[0]!.id, sentAt: expect.any(String) });
  });
});
