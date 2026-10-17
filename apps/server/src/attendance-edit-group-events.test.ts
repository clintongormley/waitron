import { expectedDraftEditForTest } from "./testing/draft-command-fixture.js";
import { saveDraftForTest as saveDraft } from "./testing/draft-command-fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  locations,
  newId,
  orderDraftEvents,
  orderDraftLines,
  orderDrafts,
  orderGroupEvents,
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
import { AppError } from "@waitron/shared";
import { attendanceDayWork, attendanceOperationFacts } from "@waitron/workforce";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";
import { readAttendanceFacts } from "./attendance-facts.js";
import { submitDraft } from "./order-drafts.js";

import { submitGroups } from "./testing/group-submit-fixture.js";
import { updateHeldOrder, updateOrderLine, type UpdateHeldOrderRequest } from "./working-order.js";
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
      saveDraft(tx, v.cfg, party.partyId, v.operatorId, {
        billId: party.tabId,
        draftId: null,
        revision: 0,
        lines: ["Ensalada", "Tarta"].map((name) => ({
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
      groups: ["Ensalada", "Tarta"].map((name) => ({
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
        { quantity: "2" },
        p.revision,
        v.operatorId,
        attendance,
      ),
    );
  const lines: UpdateHeldOrderRequest["lines"] = rows
    .filter((row) => action !== "remove-group" || row.lineNo !== 1)
    .map((row) => ({
      workingOrderLineId: row.id,
      menuItemId: v.offerFor(row.lineNo === 1 ? "Ensalada" : "Tarta"),
      quantity: "1",
    }));
  if (action === "add-group") lines.push({ menuItemId: v.offerFor("Pulpo"), quantity: "1" });
  return updateHeldOrder(
    { db: suite.db },
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
    events: await suite.db.select().from(orderGroupEvents),
    drafts: await suite.db.select().from(orderDrafts),
    draftLines: await suite.db.select().from(orderDraftLines),
    draftEvents: await suite.db.select().from(orderDraftEvents),
    tickets: await suite.db.select().from(ticketItems),
    parties: await suite.db.select().from(parties),
    commands: await suite.db.select().from(serviceCommands),
    facts: await suite.db.select().from(attendanceOperationFacts),
    days: await suite.db.select().from(attendanceDayWork),
  };
}
async function factsAt(locationId: string = v.cfg.locationId) {
  return run((tx) =>
    readAttendanceFacts(tx, {
      locationId,
      businessDay: "2026-01-05",
      startAt: "2026-01-05T00:00:00Z",
      endAt: "2026-01-06T00:00:00Z",
    }),
  );
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
          ? ["submitted", "submitted"]
          : action === "add-group"
            ? ["submitted"]
            : action === "remove-group"
              ? ["removed"]
              : [],
      );
      expect(
        saved.facts
          .filter((f) => f.key.startsWith("group:"))
          .map((f) => [f.key, f.personId, f.locationId, f.at])
          .sort(),
      ).toEqual(
        events
          .map((e) => [`group:${e.id}`, v.operatorId, v.cfg.locationId, "2026-01-05T16:40:00.000Z"])
          .sort(),
      );
      const [other] = await suite.db
        .insert(locations)
        .values({ name: "Other", invoiceLocales: ["es-ES"], operationDescription: "Restaurant" })
        .returning();
      await suite.db
        .update(workingOrders)
        .set({ locationId: other!.id })
        .where(eq(workingOrders.partyId, p.partyId));
      expect(
        (await factsAt())
          .filter((f) => f.key.startsWith("group:") && f.personId === v.operatorId)
          .map((f) => [f.key, f.locationId, f.at])
          .sort(),
      ).toEqual(
        events.map((e) => [`group:${e.id}`, v.cfg.locationId, "2026-01-05T16:40:00.000Z"]).sort(),
      );
      expect(
        (await factsAt(other!.id)).filter(
          (f) => f.key.startsWith("group:") && f.personId === v.operatorId,
        ),
      ).toEqual([]);
    },
  );
  it.each(["submit-draft", "add-group", "remove-group"] as const)(
    "%s rolls back when a derived event snapshot refuses",
    async (action) => {
      const p = await prepare(action),
        before = await state();
      const refusing: AttendanceRecorder = async (tx, fact) => {
        await recordAttendanceFact(tx, fact);
        if (fact.key.startsWith("group:"))
          throw new AppError("attendance.invalid", { reason: "derived group refused" });
      };
      await expect(command(action, p, refusing)).rejects.toMatchObject({
        code: "attendance.invalid",
      });
      expect(await state()).toEqual(before);
    },
  );
  it.each(["add-group", "remove-group"] as const)(
    "%s shares one trusted instant with its order snapshot",
    async (action) => {
      const p = await prepare(action),
        reading = v.clock.now();
      vi.spyOn(v.clock, "now")
        .mockReturnValueOnce({ ...reading, instant: new Date("2026-01-05T16:40:00.987Z") })
        .mockReturnValue({ ...reading, instant: new Date("2026-01-05T17:00:00Z") });
      await command(action, p, recordAttendanceFact);
      expect((await state()).facts.map((f) => f.at)).toEqual([
        "2026-01-05T16:40:00.000Z",
        "2026-01-05T16:40:00.000Z",
      ]);
    },
  );
  it.each(actions)("%s without capture writes no workforce evidence", async (action) => {
    const p = await prepare(action);
    await command(action, p);
    expect((await state()).facts).toEqual([]);
  });
  it("a draft submit replay retains the original group snapshots", async () => {
    const p = await prepare("submit-draft");
    const result = await command("submit-draft", p, recordAttendanceFact),
      before = await state();
    vi.setSystemTime(new Date("2026-01-06T23:00:00Z"));
    expect(await command("submit-draft", p, recordAttendanceFact)).toEqual(result);
    expect(await state()).toEqual(before);
  });
});
