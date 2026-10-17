import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ticketItems, workingOrderLines, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { writeEditSentLines } from "@waitron/venue-service";
import { readBillEditState } from "./bill-editing.js";
import { createStation } from "./kitchen.js";
import { saveDraft, takeOverDraft, type BillEditExpected } from "./order-drafts.js";
import { recallToDraft } from "./draft-recall.js";
import { partyRevisionOfOrder } from "./parties.js";
import { moveDishesToStation, type StationMover } from "./station-move.js";
import { VENUE_SERVICE } from "./modules.js";
import { withStationDishes } from "./station-closing.js";
import { createOpenOrder } from "./working-order.js";
import { fireAll } from "./testing/serve-line.js";
import {
  inTx,
  provisionBillVenue,
  seatedWith,
  send,
  type BillVenue,
} from "./testing/bill-venue.js";

let venue: BillVenue;
let bar: string;
let grill: string;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await inTx(venue, async (tx) => {
      bar = (await createStation(tx, venue.cfg, { name: "Bar", isDefault: true })).id;
      grill = (await createStation(tx, venue.cfg, { name: "Grill" })).id;
    });
  },
});
const edit = (id: string) => inTx(venue, (tx) => readBillEditState(tx, id));
async function fixture() {
  const p = await seatedWith(venue, "Paella", "Caña");
  const lines = await venue.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, p.tabId));
  return { ...p, lineId: lines[0]!.id, extraId: lines[1]!.id };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function save(p: Fixture, personId = venue.operatorId) {
  const expectedEdit = await edit(p.tabId);
  return inTx(venue, (tx) =>
    saveDraft(tx, venue.cfg, p.partyId, personId, {
      billId: p.tabId,
      expectedEdit,
      draftId: expectedEdit.draftId,
      revision: expectedEdit.draftRevision ?? 0,
      lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }],
    }),
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
function move(
  p: Pick<Fixture, "tabId" | "lineId">,
  expectedEdit: BillEditExpected | null | undefined,
  options: { personId?: string; kitchen?: boolean; submissionId?: string; lineId?: string } = {},
) {
  const actor = { deviceId: venue.deviceId, personId: options.personId ?? venue.operatorId };
  const mover = options.kitchen
    ? { ...actor, kind: "kitchen" as const }
    : { ...actor, kind: "order" as const, expectedEdit: expectedEdit! };
  return inTx(venue, (tx) =>
    moveDishesToStation(
      tx,
      venue.cfg,
      p.tabId,
      {
        submissionId: options.submissionId ?? randomUUID(),
        lineIds: [options.lineId ?? p.lineId],
        stationId: grill,
      },
      mover,
    ),
  );
}
async function assertMoved(p: Fixture, snapshot: Awaited<ReturnType<typeof edit>>) {
  const [item] = await venue.db
    .select()
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderLineId, p.lineId));
  expect(item!.stationId).toBe(grill);
  expect(await edit(p.tabId)).toEqual(snapshot);
}
describe("station movement checks bill editing authority", () => {
  it.each([undefined, "unknown"])(
    "refuses an unclassified internal authority (%s)",
    async (kind) => {
      const p = await fixture(),
        before = frozen();
      await expect(
        inTx(venue, (tx) =>
          moveDishesToStation(
            tx,
            venue.cfg,
            p.tabId,
            { submissionId: randomUUID(), lineIds: [p.lineId], stationId: grill },
            { deviceId: venue.deviceId, personId: venue.operatorId, kind } as StationMover,
          ),
        ),
      ).rejects.toMatchObject({
        code: "management.request_invalid",
        params: { field: "authority" },
      });
      expect(frozen()).toEqual(before);
    },
  );
  it("requires a named order actor even with a current observation", async () => {
    const p = await fixture(),
      expectedEdit = await edit(p.tabId),
      before = frozen();
    await expect(
      inTx(venue, (tx) =>
        moveDishesToStation(
          tx,
          venue.cfg,
          p.tabId,
          { submissionId: randomUUID(), lineIds: [p.lineId], stationId: grill },
          { kind: "order", deviceId: venue.deviceId, personId: null, expectedEdit },
        ),
      ),
    ).rejects.toMatchObject({
      code: "management.request_invalid",
      params: { field: "operatorId" },
    });
    expect(frozen()).toEqual(before);
  });
  it("refuses another editor without kitchen, money, draft or audit writes", async () => {
    const p = await fixture(),
      owned = await save(p, venue.adminId),
      before = frozen();
    await expect(move(p, owned.edit)).rejects.toMatchObject({
      code: "draft.taken_over",
      params: {
        billId: p.tabId,
        draftId: owned.edit.draftId,
        ownerId: venue.adminId,
        ownerName: "Administradora",
        edit: owned.edit,
      },
    });
    expect(frozen()).toEqual(before);
  });
  it("refuses a stale same-person draft revision without writes", async () => {
    const p = await fixture(),
      stale = await save(p);
    const current = await save(p),
      before = frozen();
    await expect(move(p, stale.edit)).rejects.toMatchObject({
      code: "draft.out_of_date",
      params: {
        billId: p.tabId,
        draftId: current.edit.draftId,
        revision: current.edit.draftRevision,
        edit: current.edit,
      },
    });
    expect(frozen()).toEqual(before);
  });
  it.each([undefined, null])("requires a bill observation (%s)", async (expected) => {
    const p = await fixture(),
      before = frozen();
    await expect(move(p, expected)).rejects.toMatchObject({
      code: "management.request_invalid",
      params: { field: "expectedEdit" },
    });
    expect(frozen()).toEqual(before);
  });
  it("refuses an observation of a different bill", async () => {
    const p = await fixture(),
      other = await fixture(),
      before = frozen();
    await expect(move(p, await edit(other.tabId))).rejects.toMatchObject({
      code: "management.request_invalid",
      params: { field: "expectedEdit.billId" },
    });
    expect(frozen()).toEqual(before);
  });
  it.each([false, true])("moves a dish with the current observation (owned: %s)", async (owned) => {
    const p = await fixture();
    if (owned) await save(p);
    const observation = await edit(p.tabId);
    const result = await move(p, observation);
    expect(result.moved).toEqual([{ workingOrderLineId: p.lineId, fromStationId: bar }]);
    await assertMoved(p, observation);
  });
  it("does not gate a kitchen device on a colleague's unsent bill", async () => {
    const p = await fixture(),
      owned = await save(p, venue.adminId);
    const result = await move(p, undefined, { kitchen: true });
    expect(result.moved).toEqual([{ workingOrderLineId: p.lineId, fromStationId: bar }]);
    await assertMoved(p, owned.edit);
  });
  it("a colleague's other bill at this table does not block the requested bill", async () => {
    const p = await fixture();
    const other = await inTx(venue, async (tx) => {
      const [row] = await tx
        .insert(workingOrders)
        .values({
          locationId: venue.cfg.locationId,
          partyId: p.partyId,
          source: "dashboard",
          orderNumber: 2,
        })
        .returning();
      await VENUE_SERVICE.recordOrderContext(tx, venue.cfg, row!.id, venue.zoneId);
      return { ...p, tabId: row!.id };
    });
    const owned = await save(other, venue.adminId),
      observation = await edit(p.tabId);
    await move(p, observation);
    await assertMoved(p, observation);
    expect(await edit(other.tabId)).toEqual(owned.edit);
  });
  it("closing a station retains its kitchen authority across independently edited bills", async () => {
    const p = await fixture(),
      q = await fixture();
    await move(p, undefined, { kitchen: true });
    await move(q, undefined, { kitchen: true });
    const a = await save(p),
      b = await save(q, venue.adminId);
    try {
      await inTx(venue, (tx) =>
        withStationDishes(
          tx,
          venue.cfg,
          grill,
          bar,
          "send",
          (at) => VENUE_SERVICE.closeStationForToday(tx, venue.cfg, grill, bar, at),
          { deviceId: venue.deviceId, personId: venue.operatorId },
        ),
      );
      for (const bill of [p, q]) {
        const [item] = await venue.db
          .select()
          .from(ticketItems)
          .where(eq(ticketItems.workingOrderLineId, bill.lineId));
        expect(item!.stationId).toBe(bar);
      }
      expect(await edit(p.tabId)).toEqual(a.edit);
      expect(await edit(q.tabId)).toEqual(b.edit);
      const states = await inTx(venue, (tx) =>
        VENUE_SERVICE.stationStates(tx, venue.cfg, new Date()),
      );
      expect(states.get(grill)!.open).toBe(false);
    } finally {
      await inTx(venue, (tx) =>
        VENUE_SERVICE.openStationForToday(tx, venue.cfg, grill, new Date()),
      );
    }
  });
  it("replays a completed move after another person takes over", async () => {
    const p = await fixture(),
      owned = await save(p),
      submissionId = randomUUID();
    const result = await move(p, owned.edit, { submissionId });
    await inTx(venue, (tx) =>
      takeOverDraft(tx, venue.cfg, p.partyId, owned.draft!.id, venue.adminId, {
        revision: owned.draft!.revision,
        expectedEdit: owned.edit,
        submissionId: randomUUID(),
      }),
    );
    const before = frozen();
    expect(await move(p, owned.edit, { submissionId })).toEqual(result);
    expect(frozen()).toEqual(before);
  });
  it("fingerprints the complete bill observation before replay", async () => {
    const p = await fixture(),
      owned = await save(p),
      submissionId = randomUUID();
    await move(p, owned.edit, { submissionId });
    const before = frozen();
    await expect(
      move(p, { ...owned.edit, editorVersion: owned.edit.editorVersion + 1 }, { submissionId }),
    ).rejects.toMatchObject({ code: "submission.id_reused" });
    expect(frozen()).toEqual(before);
  });
  it("does not replay a kitchen command as a till composition command on a counter order", async () => {
    const tabId = randomUUID(),
      submissionId = randomUUID();
    await inTx(venue, async (tx) => {
      await createOpenOrder(
        tx,
        venue.cfg,
        tabId,
        [{ menuItemId: venue.offerFor("Paella"), quantity: "1" }],
        null,
        { zoneId: venue.zoneId },
      );
      await fireAll(tx, venue.cfg, tabId);
    });
    const [line] = await venue.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId));
    const p = { tabId, lineId: line!.id };
    await move(p, undefined, { kitchen: true, submissionId });
    const before = frozen();
    await expect(move(p, null, { submissionId })).rejects.toMatchObject({
      code: "submission.id_reused",
    });
    expect(frozen()).toEqual(before);
    expect((await move(p, null)).moved).toEqual([]);
    expect(await edit(tabId)).toEqual({
      billId: tabId,
      editorId: null,
      editorName: null,
      editorVersion: 0,
      draftId: null,
      draftRevision: null,
    });
  });
  it("normalizes the observation without fingerprinting display metadata", async () => {
    const p = await fixture(),
      owned = await save(p),
      submissionId = randomUUID();
    const result = await move(p, owned.edit, { submissionId }),
      before = frozen();
    expect(
      await move(p, { ...owned.edit, editorName: "renamed display" } as BillEditExpected, {
        submissionId,
      }),
    ).toEqual(result);
    expect(frozen()).toEqual(before);
  });
  it.each([false, true])(
    "refuses a reserved recalled parent through either authority (kitchen: %s)",
    async (kitchen) => {
      const p = await fixture();
      await inTx(venue, (tx) => writeEditSentLines(tx, true));
      const recalled = await inTx(venue, async (tx) =>
        recallToDraft(tx, venue.cfg, p.partyId, p.lineId, {
          submissionId: randomUUID(),
          expectedPartyRevision: (await partyRevisionOfOrder(tx, p.tabId))!.revision,
          operatorId: venue.operatorId,
          expectedEdit: await readBillEditState(tx, p.tabId),
        }),
      );
      const before = frozen();
      await expect(move(p, recalled.edit, { kitchen })).rejects.toMatchObject({
        code: "draft.out_of_date",
        params: {
          billId: p.tabId,
          draftId: recalled.edit.draftId,
          revision: recalled.edit.draftRevision,
          edit: recalled.edit,
        },
      });
      expect(frozen()).toEqual(before);
    },
  );
  it.each([false, true])(
    "refuses the extra of a reserved recalled parent (kitchen: %s)",
    async (kitchen) => {
      const p = await fixture();
      await inTx(venue, async (tx) => {
        await tx
          .update(workingOrderLines)
          .set({ parentLineId: p.lineId })
          .where(eq(workingOrderLines.id, p.extraId));
        await writeEditSentLines(tx, true);
      });
      const recalled = await inTx(venue, async (tx) =>
        recallToDraft(tx, venue.cfg, p.partyId, p.lineId, {
          submissionId: randomUUID(),
          expectedPartyRevision: (await partyRevisionOfOrder(tx, p.tabId))!.revision,
          operatorId: venue.operatorId,
          expectedEdit: await readBillEditState(tx, p.tabId),
        }),
      );
      const before = frozen();
      await expect(move(p, recalled.edit, { kitchen, lineId: p.extraId })).rejects.toMatchObject({
        code: "draft.out_of_date",
        params: { billId: p.tabId, edit: recalled.edit },
      });
      expect(frozen()).toEqual(before);
    },
  );
  it("till route uses its session actor despite a forged body owner and kitchen authority", async () => {
    const p = await fixture(),
      owned = await save(p, venue.adminId),
      before = frozen(true);
    const answer = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${p.tabId}/lines/move-station`,
      {
        submissionId: randomUUID(),
        lineIds: [p.lineId],
        stationId: grill,
        expectedEdit: owned.edit,
        personId: venue.adminId,
        kind: "kitchen",
      },
    );
    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({
      code: "draft.taken_over",
      params: { billId: p.tabId, edit: owned.edit },
    });
    expect(frozen(true)).toEqual(before);
  });
  it("till route forwards a stale expected revision", async () => {
    const p = await fixture(),
      stale = await save(p),
      current = await save(p),
      before = frozen(true);
    const answer = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${p.tabId}/lines/move-station`,
      {
        submissionId: randomUUID(),
        lineIds: [p.lineId],
        stationId: grill,
        expectedEdit: stale.edit,
      },
    );
    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({
      code: "draft.out_of_date",
      params: { edit: current.edit },
    });
    expect(frozen(true)).toEqual(before);
  });
  it.each([undefined, null, { editorVersion: -1 }])(
    "till route refuses a missing or malformed bill observation (%j)",
    async (expectedEdit) => {
      const p = await fixture(),
        before = frozen(true);
      const answer = await send(
        venue.app,
        venue.cookie,
        "POST",
        `/api/working-orders/${p.tabId}/lines/move-station`,
        { submissionId: randomUUID(), lineIds: [p.lineId], stationId: grill, expectedEdit },
      );
      expect(answer.status).toBe(400);
      expect(answer.json).toMatchObject({
        code: "management.request_invalid",
        params: {
          field:
            expectedEdit !== null && expectedEdit !== undefined
              ? "expectedEdit.billId"
              : "expectedEdit",
        },
      });
      expect(frozen(true)).toEqual(before);
    },
  );
  it("till route accepts the session editor's current observation", async () => {
    const p = await fixture(),
      owned = await save(p);
    const answer = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${p.tabId}/lines/move-station`,
      {
        submissionId: randomUUID(),
        lineIds: [p.lineId],
        stationId: grill,
        expectedEdit: owned.edit,
      },
    );
    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({
      moved: [{ workingOrderLineId: p.lineId, fromStationId: bar }],
    });
    await assertMoved(p, owned.edit);
  });
});
