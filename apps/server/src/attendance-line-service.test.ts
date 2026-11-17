import { addTabRound } from "./testing/order-writer-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { readBillEditState } from "./bill-editing.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  newId,
  printJobs,
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
import { mountTillApi } from "./till-api.js";
import { parkOrder } from "./working-order.js";
import { provisionBillVenue, seatedWith, send, type BillVenue } from "./testing/bill-venue.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let v: BillVenue, courseId: string, stationId: string;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-05T09:00:00Z"));
  v = await provisionBillVenue(suite.db);
  await withTransaction(suite.db, async (tx) => {
    stationId = (await createStation(tx, { name: "Kitchen", isDefault: true })).id;
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
const actions = ["course", "send", "make-at"] as const;
type Action = (typeof actions)[number];
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
async function prepare(action: Action) {
  let id: string;
  if (action !== "make-at") {
    id = (await seatedWith(v)).tabId;
    await withTransaction(suite.db, (tx) =>
      addTabRound(
        tx,
        v.cfg,
        id,
        [{ menuItemId: v.offerFor("House salad"), quantity: "1", hold: true }],
        { creditedTo: v.operatorId },
      ),
    );
  } else {
    id = newId();
    await parkOrder({ db: suite.db }, v.cfg, {
      id,
      operatorId: v.adminId,
      zoneId: v.zoneId,
      lines: [{ menuItemId: v.offerFor("House salad"), quantity: "1" }],
    });
  }
  const [line] = await suite.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, id));
  const [order] = await suite.db.select().from(workingOrders).where(eq(workingOrders.id, id));
  return { id, lineId: line!.id, revision: order!.revision };
}
async function command(app: Hono, action: Action, order: Awaited<ReturnType<typeof prepare>>) {
  const extra = { personId: v.adminId, at: "2026-01-06T22:00:00Z" };
  return send(
    app,
    v.cookie,
    action === "course" ? "PATCH" : action === "make-at" ? "PUT" : "POST",
    `/api/working-orders/${order.id}/${action === "course" ? "lines/1/course" : action === "make-at" ? "make-at" : `lines/${action}`}`,
    {
      ...extra,
      expectedEdit: await withTransaction(suite.db, (tx) => readBillEditState(tx, order.id)),
      ...(action === "course"
        ? { courseId }
        : action === "make-at"
          ? { revision: order.revision, lines: { [order.lineId]: stationId } }
          : { lineNos: [1] }),
    },
  );
}
async function state() {
  return {
    orders: await suite.db.select().from(workingOrders),
    lines: await suite.db.select().from(workingOrderLines),
    tickets: await suite.db.select().from(ticketItems),
    prints: await suite.db.select().from(printJobs),
    facts: await suite.db.select().from(staffActivity),
    days: await suite.db.select().from(attendanceDays),
  };
}

describe("direct line service attendance", () => {
  it.each(actions)("%s records the accepted change under the admitted actor", async (action) => {
    const order = await prepare(action);
    expect(await command(api(recordAttendanceFact), action, order)).toMatchObject({ status: 200 });
    const after = await state();
    expect(after.facts.map((row) => [row.personId, row.lastAt])).toEqual([
      [v.operatorId, "2026-01-05T16:40:00.000Z"],
    ]);
    expect(after.days.map((r) => [r.businessDay, r.dirtyRevision])).toEqual([["2026-01-05", 1]]);
    const line = after.lines.find((r) => r.id === order.lineId)!;
    if (action === "course") expect(line.courseId).toBe(courseId);
    if (action === "make-at") expect(line.makeAtStationId).toBe(stationId);
    if (action === "send")
      expect(
        after.tickets.find((r) => r.workingOrderLineId === order.lineId)!.firedAt === null,
      ).toBe(false);
  });
});
