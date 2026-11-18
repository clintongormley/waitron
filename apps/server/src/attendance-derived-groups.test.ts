import { testTradingAdmission } from "./testing/trading-admission.js";
import { observedGroupSender } from "./testing/group-composition-fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import {
  newId,
  orderEvents,
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

import { createCourse, createStation } from "./kitchen.js";

import { placeGroupedRound } from "./testing/group-submit-fixture.js";
import { mountTillApi } from "./till-api.js";

import {
  provisionBillVenue,
  seatedWith,
  send as rawGroupSend,
  type BillVenue,
} from "./testing/bill-venue.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let v: BillVenue, courseId: string;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-05T09:00:00Z"));
  v = await provisionBillVenue(suite.db);
  await withTransaction(suite.db, async (tx) => {
    await createStation(tx, { name: "Kitchen", isDefault: true });
    courseId = (await createCourse(tx, { name: "Main", displayOrder: 0 })).id;
  });
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

type Action = "empty-move";
function api(attendance?: AttendanceRecorder) {
  const app = new Hono();
  mountTillApi(
    app,
    {
      admission: testTradingAdmission(),
      db: suite.db,
      cfg: v.cfg,
      backend: v.backend,
      clock: v.clock,
      secureCookies: false,
      venueLocale: "es",
      attendance,
    },
    () => {},
  );
  return app;
}
async function prepare() {
  const party = await seatedWith(v);
  const submitted = await withTransaction(suite.db, async (tx) => {
    const placed = [];
    for (const name of ["House salad", "Tarta"])
      placed.push(
        await placeGroupedRound(
          tx,
          v.cfg,
          party,
          { release: "hold", lines: [{ menuItemId: v.offerFor(name), quantity: "2", courseId }] },
          v.adminId,
        ),
      );
    return { ...placed[1]!, groups: placed.flatMap((round) => round.groups) };
  });
  const [line] = await suite.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.groupId, submitted.groups[0]!.id));
  return {
    ...party,
    tabId: submitted.tabId,
    revision: submitted.revision,
    groupId: submitted.groups[0]!.id,
    otherGroupId: submitted.groups[1]!.id,
    lineId: line!.id,
    submissionId: newId(),
  };
}
function command(app: Hono, _action: Action, p: Awaited<ReturnType<typeof prepare>>) {
  return send(app, v.cookie, "POST", `/api/parties/${p.partyId}/groups/move`, {
    submissionId: p.submissionId,
    expectedPartyRevision: p.revision,
    operatorId: v.adminId,
    moves: [{ lineId: p.lineId, quantity: "2" }],
    target: { groupId: p.otherGroupId },
  });
}
async function state() {
  return {
    groups: await suite.db.select().from(orderGroups),
    events: await suite.db
      .select()
      .from(orderEvents)
      .where(sql`${orderEvents.kind} like 'group.%'`),
    orders: await suite.db.select().from(workingOrders),
    lines: await suite.db.select().from(workingOrderLines),
    tickets: await suite.db.select().from(ticketItems),
    parties: await suite.db.select().from(parties),
    commands: await suite.db.select().from(serviceCommands),
    facts: await suite.db.select().from(staffActivity),
    days: await suite.db.select().from(attendanceDays),
  };
}

describe("group events derived from accepted commands", () => {
  it.each(["empty-move"] as const)(
    "%s uses one trusted instant for the whole accepted command",
    async (action) => {
      const p = await prepare();
      const reading = v.clock.now();
      vi.spyOn(v.clock, "now")
        .mockReturnValueOnce({ ...reading, instant: new Date("2026-01-05T16:40:00.987Z") })
        .mockReturnValue({ ...reading, instant: new Date("2026-01-05T17:00:00Z") });
      expect(await command(api(recordAttendanceFact), action, p)).toMatchObject({ status: 200 });
      expect((await state()).facts).toMatchObject([
        { personId: v.operatorId, lastAt: "2026-01-05T16:40:00.000Z" },
      ]);
    },
  );
});

const send = observedGroupSender(() => v.db, rawGroupSend);
