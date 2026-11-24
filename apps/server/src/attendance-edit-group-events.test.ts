import { cancelItemForTest } from "./testing/cancel-line.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { updateHeldOrder, updateOrderLine } from "./testing/order-writer-fixture.js";
import { expectedDraftEditForTest } from "./testing/draft-command-fixture.js";
import { saveDraftForTest as saveDraft } from "./testing/draft-command-fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  newId,
  orderEvents,
  orderDraftLines,
  orderDrafts,
  orderGroups,
  parties,
  serviceCommands,
  ticketItems,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";

import { attendanceDays, staffActivity } from "@waitron/workforce";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";
import { submitDraft } from "./order-drafts.js";

import { submitGroups } from "./testing/group-submit-fixture.js";
import { type UpdateHeldOrderRequest } from "./working-order-edit-state.js";
import { provisionBillVenue, seatedWith, type BillVenue } from "./testing/bill-venue.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let v: BillVenue;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-05T09:00:00Z"));
  v = await provisionBillVenue(suite.db);
  const reading = v.clock.now();
  vi.spyOn(v.clock, "now").mockReturnValue({
    ...reading,
    instant: new Date("2026-01-05T16:40:00.987Z"),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const run = <T>(body: Parameters<typeof withTransaction<T>>[1]) => withTransaction(suite.db, body);
const actions = ["submit-draft", "add-group", "remove-group", "line-edit"] as const;
type Action = (typeof actions)[number];
async function prepare(action: Action) {
  const party = await seatedWith(v);
  if (action === "submit-draft") {
    const draft = await run((tx) =>
      saveDraft(tx, party.partyId, v.operatorId, {
        billId: party.tabId,
        draftId: null,
        revision: 0,
        lines: ["House salad", "Tarta"].map((name) => ({
          menuItemId: v.offerFor(name),
          variantId: null,
          menuVersionId: null,
          options: [],
          extras: [],
          note: null,
          quantity: "1",
          courseId: null,
          noMerge: false,
        })),
      }),
    );
    return {
      partyId: party.partyId,
      tabId: party.tabId,
      draft,
      expectedEdit: await expectedDraftEditForTest(suite.db, draft),
      submissionId: newId(),
      revision: party.revision,
    };
  }
  const placed = await run((tx) =>
    submitGroups(tx, v.cfg, party.partyId, {
      submissionId: newId(),
      expectedPartyRevision: party.revision,
      operatorId: v.adminId,
      groups: ["House salad", "Tarta"].map((name) => ({
        release: "hold" as const,
        lines: [{ menuItemId: v.offerFor(name), quantity: "1" }],
      })),
    }),
  );
  const [order] = await suite.db
    .select()
    .from(workingOrders)
    .where(eq(workingOrders.id, placed.tabId));
  return {
    partyId: party.partyId,
    tabId: placed.tabId,
    draft: null,
    expectedEdit: null,
    submissionId: newId(),
    revision: order!.revision,
  };
}
async function command(
  action: Action,
  p: Awaited<ReturnType<typeof prepare>>,
  recorder?: AttendanceRecorder,
) {
  if (action === "submit-draft")
    return run(async (tx) =>
      submitDraft(
        tx,
        v.cfg,
        p.partyId,
        p.draft!.id,
        {
          submissionId: p.submissionId,
          expectedPartyRevision: p.revision,
          operatorId: v.operatorId,
          expectedEdit: p.expectedEdit!,
          draftRevision: p.draft!.revision,
          groups: p.draft!.lines.map((line) => ({ lineIds: [line.id], release: "hold" as const })),
        },
        recorder,
      ),
    );
  if (action === "remove-group")
    return run((tx) =>
      cancelItemForTest(
        tx,
        v.cfg,
        p.tabId,
        1,
        undefined,
        v.operatorId,
        recorder === undefined ? undefined : { recorder, clock: v.clock },
      ),
    );
  const rows = await suite.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, p.tabId));
  const attendance = recorder === undefined ? undefined : { recorder, clock: v.clock };
  if (action === "line-edit")
    return run((tx) =>
      updateOrderLine(
        tx,
        v.cfg,
        p.tabId,
        1,
        { portionLineNos: [], quantity: "2" },
        p.revision,
        v.operatorId,
        attendance,
      ),
    );
  const lines: UpdateHeldOrderRequest["lines"] = rows.map((row) => ({
    workingOrderLineId: row.id,
    menuItemId: v.offerFor(row.lineNo === 1 ? "House salad" : "Tarta"),
    quantity: "1",
  }));
  if (action === "add-group") lines.push({ menuItemId: v.offerFor("Octopus"), quantity: "1" });
  return updateHeldOrder(
    { admission: testTradingAdmission(), db: suite.db },
    v.cfg,
    p.tabId,
    {
      operatorId: v.operatorId,
      revision: p.revision,
      lines,
    },
    undefined,
    attendance,
  );
}
async function state() {
  return {
    orders: await suite.db.select().from(workingOrders),
    lines: await suite.db.select().from(workingOrderLines),
    groups: await suite.db.select().from(orderGroups),
    events: await suite.db
      .select()
      .from(orderEvents)
      .where(sql`${orderEvents.kind} like 'group.%'`),
    drafts: await suite.db.select().from(orderDrafts),
    draftLines: await suite.db.select().from(orderDraftLines),
    draftEvents: await suite.db
      .select()
      .from(orderEvents)
      .where(sql`${orderEvents.kind} like 'draft.%'`),
    tickets: await suite.db.select().from(ticketItems),
    parties: await suite.db.select().from(parties),
    commands: await suite.db.select().from(serviceCommands),
    facts: await suite.db.select().from(staffActivity),
    days: await suite.db.select().from(attendanceDays),
  };
}
describe("group events from draft submission and order editing", () => {
  it.each(actions)(
    "%s snapshots derived groups under the editor at the command instant",
    async (action) => {
      const p = await prepare(action);
      vi.setSystemTime(new Date("2026-01-05T16:40:00.987Z"));
      await command(action, p, recordAttendanceFact);
      const saved = await state(),
        events = saved.events.filter((e) => e.actorId === v.operatorId);
      expect(events.map((e) => e.kind)).toEqual(
        action === "submit-draft"
          ? ["group.submitted", "group.submitted"]
          : action === "add-group"
            ? ["group.submitted"]
            : action === "remove-group"
              ? ["group.removed"]
              : [],
      );
      expect(saved.facts).toMatchObject([
        { personId: v.operatorId, lastAt: "2026-01-05T16:40:00.000Z" },
      ]);
    },
  );
});
