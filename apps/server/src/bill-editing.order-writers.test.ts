import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { workingOrders, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { writeEditSentLines } from "@waitron/venue-service";
import { VENUE_SERVICE } from "./modules.js";
import { readBillEditState } from "./bill-editing.js";
import { saveDraft, type BillEditExpected, type BillEditState } from "./order-drafts.js";
import { recallToDraft } from "./draft-recall.js";
import { readDrafts } from "./order-drafts.js";
import { partyRevisionOfOrder } from "./parties.js";
import {
  sendLines,
  recallLines,
  setLineCourse,
  updateHeldOrder,
  updateOrderLine,
} from "./working-order.js";
import { fireAll } from "./testing/serve-line.js";
import { inTx, provisionBillVenue, tabWith, send, type BillVenue } from "./testing/bill-venue.js";

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
  const id = await tabWith(venue, "Tarta");
  const [order] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, id));
  const [line] = await venue.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, id));
  return { id, partyId: order!.partyId!, revision: order!.revision, line: line! };
}
async function sibling(p: Awaited<ReturnType<typeof fixture>>) {
  const id = await inTx(venue, async (tx) => {
    const [order] = await tx
      .insert(workingOrders)
      .values({
        source: "dashboard",
        orderNumber: 2,
        partyId: p.partyId,
        locationId: venue.cfg.locationId,
      })
      .returning();
    await VENUE_SERVICE.recordOrderContext(tx, venue.cfg, order!.id, venue.zoneId);
    return order!.id;
  });
  return { ...p, id };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const edit = (id: string) => inTx(venue, (tx) => readBillEditState(tx, id));
async function save(p: Fixture, operatorId = venue.operatorId) {
  const expectedEdit = await edit(p.id);
  return inTx(venue, (tx) =>
    saveDraft(tx, venue.cfg, p.partyId, operatorId, {
      billId: p.id,
      expectedEdit,
      draftId: expectedEdit.draftId,
      revision: expectedEdit.draftRevision ?? 0,
      lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }],
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
          .map((r) => (http && name === "devices" ? { ...r, last_seen_at: null } : r)),
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
const operations = ["line", "whole", "course", "send", "recall"] as const;
type Operation = (typeof operations)[number];
async function run(
  p: Fixture,
  op: Operation,
  expectedEdit: BillEditExpected,
  operatorId = venue.operatorId,
) {
  const authority = { operatorId, expectedEdit };
  if (op === "whole")
    return updateHeldOrder({ db: venue.db }, venue.cfg, p.id, {
      operatorId,
      expectedEdit,
      revision: p.revision,
      lines: [
        {
          workingOrderLineId: p.line.id,
          menuItemId: venue.offerFor("Tarta"),
          quantity: "1",
          note: "changed",
        },
      ],
    });
  return inTx<unknown>(venue, (tx) => {
    switch (op) {
      case "line":
        return updateOrderLine(
          tx,
          venue.cfg,
          p.id,
          p.line.lineNo,
          { note: "changed" },
          p.revision,
          authority,
        );
      case "course":
        return setLineCourse(tx, venue.cfg, p.id, p.line.lineNo, null, authority);
      case "send":
        return sendLines(tx, venue.cfg, p.id, [], authority);
      case "recall":
        return recallLines(tx, venue.cfg, p.id, [p.line.lineNo], authority);
    }
  });
}
async function refused(fn: () => Promise<unknown>, code: string, params: unknown) {
  const before = await frozen();
  await expect(fn()).rejects.toMatchObject({ code, params });
  expect(await frozen()).toEqual(before);
}
for (const op of operations)
  describe(`${op} direct writer checks its bill editor`, () => {
    it("refuses a colleague before any line, kitchen, source, charge or audit changes", async () => {
      const p = await fixture(),
        owned = await save(p, venue.adminId);
      await refused(() => run(p, op, owned.edit), "draft.taken_over", foreign(owned.edit));
    });
    it("refuses an old same-person observation", async () => {
      const p = await fixture(),
        old = await edit(p.id),
        owned = await save(p);
      await refused(() => run(p, op, old), "draft.out_of_date", stale(owned.edit));
    });
    it.each(["absent", "other-bill"] as const)("refuses %s observation", async (kind) => {
      const p = await fixture(),
        other = await fixture();
      await refused(
        () =>
          run(
            p,
            op,
            kind === "absent"
              ? undefined!
              : { billId: other.id, editorVersion: 0, draftId: null, draftRevision: null },
          ),
        "management.request_invalid",
        { field: kind === "absent" ? "expectedEdit" : "expectedEdit.billId" },
      );
    });
    it("allows the current editor without changing either saved outbox", async () => {
      const p = await fixture(),
        other = await sibling(p);
      await save(p);
      await save(other, venue.adminId);
      const states = [await edit(p.id), await edit(other.id)];
      const drafts = await inTx(venue, (tx) => readDrafts(tx, venue.cfg, p.partyId));
      await run(p, op, states[0]!);
      expect([await edit(p.id), await edit(other.id)]).toEqual(states);
      expect(await inTx(venue, (tx) => readDrafts(tx, venue.cfg, p.partyId))).toEqual(drafts);
      const [after] = await venue.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.id, p.line.id));
      expect({ quantity: after!.quantity, total: after!.lineTotal, note: after!.note }).toEqual({
        quantity: 1000,
        total: 1800,
        note: op === "line" || op === "whole" ? "changed" : null,
      });
    });
    it("refuses a reserved recalled family even for its current editor", async () => {
      const p = await fixture();
      await inTx(venue, async (tx) => {
        await writeEditSentLines(tx, true);
        await fireAll(tx, venue.cfg, p.id);
        const party = await partyRevisionOfOrder(tx, p.id);
        await recallToDraft(tx, venue.cfg, p.partyId, p.line.id, {
          operatorId: venue.operatorId,
          expectedEdit: await readBillEditState(tx, p.id),
          expectedPartyRevision: party!.revision,
          submissionId: randomUUID(),
        });
      });
      const [order] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, p.id));
      p.revision = order!.revision;
      const current = await edit(p.id);
      await refused(() => run(p, op, current), "draft.out_of_date", stale(current));
    });
  });

const httpPath = (p: Fixture, op: Operation | "make-at") =>
  `/api/working-orders/${p.id}${op === "whole" ? "" : op === "line" ? `/lines/${p.line.lineNo}` : op === "course" ? `/lines/${p.line.lineNo}/course` : op === "make-at" ? "/make-at" : `/lines/${op}`}`;
function httpBody(
  p: Fixture,
  op: Operation | "make-at",
  expectedEdit: BillEditExpected | undefined,
) {
  return {
    expectedEdit,
    revision: p.revision,
    operatorId: venue.adminId,
    ...(op === "whole"
      ? {
          lines: [
            {
              workingOrderLineId: p.line.id,
              menuItemId: venue.offerFor("Tarta"),
              quantity: "1",
              note: "changed",
            },
          ],
        }
      : op === "line"
        ? { note: "changed" }
        : op === "course"
          ? { courseId: null }
          : op === "make-at"
            ? { lines: { [p.line.id]: null } }
            : { lineNos: [p.line.lineNo] }),
  };
}
for (const op of [...operations, "make-at"] as const)
  describe(`${op} HTTP editor admission`, () => {
    it.each(["absent", "foreign"] as const)(
      "refuses %s state and ignores a body operator",
      async (kind) => {
        const p = await fixture(),
          owned = await save(p, venue.adminId),
          before = await frozen(true);
        const answer = await send(
          venue.app,
          venue.cookie,
          op === "course" ? "PATCH" : op === "send" || op === "recall" ? "POST" : "PUT",
          httpPath(p, op),
          httpBody(p, op, kind === "absent" ? undefined : owned.edit),
        );
        expect(answer.status).toBe(kind === "absent" ? 400 : 409);
        expect(answer.json).toMatchObject({
          code: kind === "absent" ? "management.request_invalid" : "draft.taken_over",
          params: kind === "absent" ? { field: "expectedEdit" } : foreign(owned.edit),
        });
        expect(await frozen(true)).toEqual(before);
      },
    );
  });

for (const op of [...operations, "make-at"] as const)
  describe(`${op} HTTP current observation`, () => {
    it("allows the session editor while the other bill stays owned by a colleague", async () => {
      const p = await fixture(),
        other = await sibling(p);
      const owned = await save(p);
      await save(other, venue.adminId);
      const states = [await edit(p.id), await edit(other.id)];
      const drafts = await inTx(venue, (tx) => readDrafts(tx, venue.cfg, p.partyId));
      const answer = await send(
        venue.app,
        venue.cookie,
        op === "course" ? "PATCH" : op === "send" || op === "recall" ? "POST" : "PUT",
        httpPath(p, op),
        httpBody(p, op, owned.edit),
      );
      expect(answer.status).toBe(200);
      expect([await edit(p.id), await edit(other.id)]).toEqual(states);
      expect(await inTx(venue, (tx) => readDrafts(tx, venue.cfg, p.partyId))).toEqual(drafts);
      const [line] = await venue.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.id, p.line.id));
      expect({ quantity: line!.quantity, total: line!.lineTotal, note: line!.note }).toEqual({
        quantity: 1000,
        total: 1800,
        note: op === "line" || op === "whole" ? "changed" : null,
      });
    });
    it("refuses a stale observation at the HTTP boundary", async () => {
      const p = await fixture(),
        old = await edit(p.id),
        owned = await save(p),
        before = await frozen(true);
      const answer = await send(
        venue.app,
        venue.cookie,
        op === "course" ? "PATCH" : op === "send" || op === "recall" ? "POST" : "PUT",
        httpPath(p, op),
        httpBody(p, op, old),
      );
      expect(answer.status).toBe(409);
      expect(answer.json).toMatchObject({ code: "draft.out_of_date", params: stale(owned.edit) });
      expect(await frozen(true)).toEqual(before);
    });
  });

describe("make-at protects recalled source families", () => {
  it.each(["parent", "extra"] as const)(
    "refuses the reserved %s with current draft facts",
    async (kind) => {
      const p = await fixture();
      const extraId = randomUUID();
      await inTx(venue, async (tx) => {
        await tx
          .insert(workingOrderLines)
          .values({ ...p.line, id: extraId, lineNo: 2, parentLineId: p.line.id });
        await writeEditSentLines(tx, true);
        await fireAll(tx, venue.cfg, p.id);
        const party = await partyRevisionOfOrder(tx, p.id);
        await recallToDraft(tx, venue.cfg, p.partyId, p.line.id, {
          operatorId: venue.operatorId,
          expectedEdit: await readBillEditState(tx, p.id),
          expectedPartyRevision: party!.revision,
          submissionId: randomUUID(),
        });
      });
      const [order] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, p.id));
      const current = await edit(p.id),
        before = await frozen(true);
      const answer = await send(venue.app, venue.cookie, "PUT", httpPath(p, "make-at"), {
        revision: order!.revision,
        expectedEdit: current,
        lines: { [kind === "parent" ? p.line.id : extraId]: null },
      });
      expect(answer.status).toBe(409);
      expect(answer.json).toMatchObject({ code: "draft.out_of_date", params: stale(current) });
      expect(await frozen(true)).toEqual(before);
    },
  );
});
