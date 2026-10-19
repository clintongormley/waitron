import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { parties, workingOrders, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { writeEditSentLines } from "@waitron/venue-service";
import { VENUE_SERVICE } from "./modules.js";
import { readBillEditState } from "./bill-editing.js";
import { recallToDraft } from "./draft-recall.js";
import { fireGroup, moveLinesToGroup, splitHeldLineIntoUnits } from "./order-groups.js";
import { submitGroups } from "./testing/group-submit-fixture.js";
import {
  readDrafts,
  saveDraft,
  takeOverDraft,
  type BillEditExpected,
  type BillEditState,
} from "./order-drafts.js";
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
      label: `Groups-${randomUUID().slice(0, 8)}`,
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
      expectedPartyRevision: p.revision,
      operatorId: venue.operatorId,
      submissionId: randomUUID(),
      groups: [
        { release: "hold", lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "3" }] },
      ],
    });
    const [line] = await tx
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, p.tabId));
    return { ...p, otherId: other!.id, line: line! };
  });
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function edit(billId: string) {
  return inTx(venue, (tx) => readBillEditState(tx, billId));
}
async function command(p: Fixture) {
  const [party] = await venue.db.select().from(parties).where(eq(parties.id, p.partyId));
  return {
    operatorId: venue.operatorId,
    expectedPartyRevision: party!.revision,
    submissionId: randomUUID(),
  };
}
async function save(p: Fixture, billId = p.tabId, operatorId = venue.operatorId) {
  const expectedEdit = await edit(billId);
  return inTx(venue, (tx) =>
    saveDraft(tx, venue.cfg, p.partyId, operatorId, {
      billId,
      draftId: expectedEdit.draftId,
      revision: expectedEdit.draftRevision ?? 0,
      expectedEdit,
      lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }],
    }),
  );
}
async function frozen(http = false) {
  const tables = venue.db.all<{ name: string }>(
    sql`select name from sqlite_master where type='table' order by name`,
  );
  return Object.fromEntries(
    tables.map(({ name }) => [
      name,
      venue.db
        .all<Record<string, unknown>>(sql`select * from ${sql.identifier(name)} order by rowid`)
        .map((row) => (http && name === "devices" ? { ...row, last_seen_at: null } : row)),
    ]),
  );
}
function stale(e: BillEditState) {
  return { billId: e.billId, draftId: e.draftId, revision: e.draftRevision, edit: e };
}
function foreign(e: BillEditState, multiple: boolean) {
  return {
    billId: e.billId,
    draftId: e.draftId,
    ownerId: e.editorId,
    ownerName: e.editorName,
    edit: e,
    ...(multiple ? { conflicts: [e] } : {}),
  };
}
async function refused(run: () => Promise<unknown>, code: string, params: unknown) {
  const before = await frozen();
  await expect(run()).rejects.toMatchObject({ code, params });
  expect(await frozen()).toEqual(before);
}
const operations = ["move", "split"] as const;
type Operation = (typeof operations)[number];
async function run(
  p: Fixture,
  operation: Operation,
  expected: BillEditExpected | undefined,
  args?: Awaited<ReturnType<typeof command>>,
) {
  const base = args ?? (await command(p));
  return inTx(venue, (tx) =>
    operation === "move"
      ? moveLinesToGroup(tx, venue.cfg, p.partyId, [{ lineId: p.line.id, quantity: "3" }], "new", {
          ...base,
          expectedEdits: expected === undefined ? undefined! : [expected],
        })
      : splitHeldLineIntoUnits(tx, venue.cfg, p.partyId, p.line.id, {
          ...base,
          expectedEdit: expected!,
        }),
  );
}
async function recall(p: Fixture) {
  const args = { ...(await command(p)), expectedEdit: await edit(p.tabId) };
  return inTx(venue, async (tx) => {
    await writeEditSentLines(tx, true);
    return recallToDraft(tx, venue.cfg, p.partyId, p.line.id, args);
  });
}

for (const operation of operations)
  describe(`${operation} held dishes requires the observed bill editor`, () => {
    it("refuses a colleague before any group, line, audit or command changes", async () => {
      const p = await fixture(),
        saved = await save(p, p.tabId, venue.adminId);
      await refused(
        () => run(p, operation, saved.edit),
        "draft.taken_over",
        foreign(saved.edit, operation === "move"),
      );
    });
    it("refuses same-person stale ownership", async () => {
      const p = await fixture(),
        old = await edit(p.tabId),
        saved = await save(p);
      await refused(() => run(p, operation, old), "draft.out_of_date", stale(saved.edit));
    });
    it.each(["absent", "other-bill"] as const)("refuses an %s expectation", async (kind) => {
      const p = await fixture();
      await refused(
        () =>
          run(
            p,
            operation,
            kind === "absent"
              ? undefined
              : { billId: p.otherId, editorVersion: 0, draftId: null, draftRevision: null },
          ),
        "management.request_invalid",
        {
          field:
            operation === "move"
              ? "expectedEdits"
              : kind === "absent"
                ? "expectedEdit"
                : "expectedEdit.billId",
        },
      );
    });
    it("allows current editor while a colleague's other bill and both outboxes stay unchanged", async () => {
      const p = await fixture(),
        own = await save(p),
        other = await save(p, p.otherId, venue.adminId);
      const drafts = await inTx(venue, (tx) => readDrafts(tx, venue.cfg, p.partyId));
      await run(p, operation, own.edit);
      expect(await edit(p.tabId)).toEqual(own.edit);
      expect(await edit(p.otherId)).toEqual(other.edit);
      expect(await inTx(venue, (tx) => readDrafts(tx, venue.cfg, p.partyId))).toEqual(drafts);
      const lines = await venue.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, p.tabId));
      expect(lines.reduce((sum, line) => sum + line.quantity, 0)).toBe(3000);
      expect(lines.reduce((sum, line) => sum + line.lineTotal, 0)).toBe(5400);
      expect(lines).toHaveLength(operation === "split" ? 3 : 1);
      if (operation === "move") expect(lines[0]!.groupId).not.toBe(p.line.groupId);
    });
    it("replays completed facts after takeover but fingerprints a changed expectation", async () => {
      const p = await fixture(),
        own = await save(p),
        args = await command(p);
      const result = await run(p, operation, own.edit, args);
      const moved = await inTx(venue, (tx) =>
        takeOverDraft(tx, venue.cfg, p.partyId, own.draft!.id, venue.adminId, {
          revision: own.draft!.revision,
          expectedEdit: own.edit,
          submissionId: randomUUID(),
        }),
      );
      const before = await frozen();
      expect(await run(p, operation, own.edit, args)).toEqual(result);
      expect(await frozen()).toEqual(before);
      await refused(() => run(p, operation, moved.edit, args), "submission.id_reused", {
        submissionId: args.submissionId,
      });
    });
    it("HTTP refuses missing observations", async () => {
      const p = await fixture(),
        before = await frozen(true);
      const answer = await send(
        venue.app,
        venue.cookie,
        "POST",
        `/api/parties/${p.partyId}/groups/${operation === "split" ? "split-line" : "move"}`,
        {
          ...(await command(p)),
          lineId: p.line.id,
          moves: [{ lineId: p.line.id, quantity: "3" }],
          target: "new",
        },
      );
      expect(answer.status).toBe(400);
      expect(answer.json).toMatchObject({
        code: "management.request_invalid",
        params: { field: operation === "split" ? "expectedEdit" : "expectedEdits" },
      });
      expect(await frozen(true)).toEqual(before);
    });
    it("HTTP takes the session actor, keeping the body owner powerless", async () => {
      const p = await fixture(),
        saved = await save(p, p.tabId, venue.adminId),
        before = await frozen(true);
      const answer = await send(
        venue.app,
        venue.cookie,
        "POST",
        `/api/parties/${p.partyId}/groups/${operation === "split" ? "split-line" : "move"}`,
        {
          ...(await command(p)),
          operatorId: venue.adminId,
          lineId: p.line.id,
          moves: [{ lineId: p.line.id, quantity: "3" }],
          target: "new",
          expectedEdit: saved.edit,
          expectedEdits: [saved.edit],
        },
      );
      expect(answer.status).toBe(409);
      expect(answer.json).toMatchObject({
        code: "draft.taken_over",
        params: foreign(saved.edit, operation === "move"),
      });
      expect(await frozen(true)).toEqual(before);
    });
  });
it("a recalled split compares the owning draft revision before touching charge or source identities", async () => {
  const p = await fixture(),
    recalled = await recall(p);
  const saved = await inTx(venue, (tx) =>
    saveDraft(tx, venue.cfg, p.partyId, venue.operatorId, {
      billId: p.tabId,
      draftId: recalled.draft.id,
      revision: recalled.draft.revision,
      expectedEdit: recalled.edit,
      lines: recalled.draft.lines,
    }),
  );
  await refused(() => run(p, "split", recalled.edit), "draft.out_of_date", stale(saved.edit));
});
it("a recalled source splits only with its current owning expectation, preserving the charge", async () => {
  const p = await fixture(),
    recalled = await recall(p);
  await run(p, "split", recalled.edit);
  const [draft] = await inTx(venue, (tx) => readDrafts(tx, venue.cfg, p.partyId));
  expect(draft!.id).toBe(recalled.draft.id);
  expect(draft!.revision).toBe(recalled.draft.revision + 1);
  expect(draft!.lines).toHaveLength(3);
  expect(draft!.lines[0]!.id).toBe(recalled.draft.lines[0]!.id);
  expect(draft!.lines[0]!.sourceLineId).toBe(p.line.id);
  expect(new Set(draft!.lines.map((l) => l.sourceLineId)).size).toBe(3);
  expect((await edit(p.tabId)).editorVersion).toBe(recalled.edit.editorVersion);
  const lines = await venue.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, p.tabId));
  expect(lines.map((l) => l.quantity)).toEqual([1000, 1000, 1000]);
  expect(lines.reduce((sum, l) => sum + l.lineTotal, 0)).toBe(5400);
});
it("already-sent group Fire stays shared while the bill belongs to a colleague", async () => {
  const p = await fixture(),
    saved = await save(p, p.tabId, venue.adminId);
  const before = await inTx(venue, (tx) => readDrafts(tx, venue.cfg, p.partyId));
  await inTx(venue, async (tx) =>
    fireGroup(tx, venue.cfg, p.partyId, p.line.groupId!, await command(p)),
  );
  expect(await edit(p.tabId)).toEqual(saved.edit);
  expect(await inTx(venue, (tx) => readDrafts(tx, venue.cfg, p.partyId))).toEqual(before);
  expect(
    (await venue.db.select().from(workingOrderLines).where(eq(workingOrderLines.id, p.line.id)))[0]!
      .groupId,
  ).toBe(p.line.groupId);
});

it("moving a recalled source refuses the current snapshot without changing its reservation", async () => {
  const p = await fixture(),
    recalled = await recall(p);
  await refused(() => run(p, "move", recalled.edit), "draft.out_of_date", stale(recalled.edit));
});
it.each(["missing", "extra", "unsorted"] as const)(
  "group move refuses a %s affected bill set",
  async (kind) => {
    const p = await fixture(),
      own = await save(p),
      other = await edit(p.otherId);
    const expectedEdits =
      kind === "missing" ? [] : [own.edit, other].sort((a, b) => a.billId.localeCompare(b.billId));
    if (kind === "unsorted") expectedEdits.reverse();
    const args = { ...(await command(p)), expectedEdits };
    await refused(
      () =>
        inTx(venue, (tx) =>
          moveLinesToGroup(
            tx,
            venue.cfg,
            p.partyId,
            [{ lineId: p.line.id, quantity: "3" }],
            "new",
            args,
          ),
        ),
      "management.request_invalid",
      { field: kind === "unsorted" ? "expectedEdits.1.billId" : "expectedEdits" },
    );
  },
);
it("checks every source bill before moving a multi-bill selection", async () => {
  const p = await fixture();
  const added = await inTx(venue, async (tx) => {
    await submitGroups(tx, venue.cfg, p.partyId, {
      ...(await command(p)),
      billId: p.otherId,
      groups: [{ release: "hold", lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }] }],
    });
    return (
      await tx
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, p.otherId))
    )[0]!;
  });
  const own = await save(p),
    other = await save(p, p.otherId, venue.adminId);
  const args = {
    ...(await command(p)),
    expectedEdits: [own.edit, other.edit].sort((a, b) => a.billId.localeCompare(b.billId)),
  };
  await refused(
    () =>
      inTx(venue, (tx) =>
        moveLinesToGroup(
          tx,
          venue.cfg,
          p.partyId,
          [
            { lineId: p.line.id, quantity: "3" },
            { lineId: added.id, quantity: "1" },
          ],
          "new",
          args,
        ),
      ),
    "draft.taken_over",
    foreign(other.edit, true),
  );
});
it.each(operations)("HTTP %s forwards the full valid expectation", async (operation) => {
  const p = await fixture(),
    e = await edit(p.tabId);
  const answer = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/parties/${p.partyId}/groups/${operation === "split" ? "split-line" : "move"}`,
    {
      ...(await command(p)),
      lineId: p.line.id,
      moves: [{ lineId: p.line.id, quantity: "3" }],
      target: "new",
      expectedEdit: e,
      expectedEdits: [e],
    },
  );
  expect(answer.status).toBe(200);
  const lines = await venue.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, p.tabId));
  expect(lines).toHaveLength(operation === "split" ? 3 : 1);
  expect(lines.reduce((sum, l) => sum + l.lineTotal, 0)).toBe(5400);
});
