import { readBillEditState } from "./bill-editing.js";
import { recallLines } from "./testing/order-writer-fixture.js";
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
import { AppError } from "@waitron/shared";
import { attendanceDayWork, attendanceOperationFacts } from "@waitron/workforce";
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
    stationId = (await createStation(tx, v.cfg, { name: "Kitchen", isDefault: true })).id;
    courseId = (await createCourse(tx, v.cfg, { name: "Main", displayOrder: 0 })).id;
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
const actions = ["course", "send", "recall", "make-at"] as const;
type Action = (typeof actions)[number];
function api(attendance?: AttendanceRecorder) {
  const app = new Hono();
  mountTillApi(
    app,
    {
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
    id = (await seatedWith(v, "Ensalada")).tabId;
    if (action !== "recall")
      await withTransaction(suite.db, (tx) => recallLines(tx, v.cfg, id, [1]));
  } else {
    id = newId();
    await parkOrder({ db: suite.db }, v.cfg, {
      id,
      operatorId: v.adminId,
      zoneId: v.zoneId,
      lines: [{ menuItemId: v.offerFor("Ensalada"), quantity: "1" }],
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
    facts: await suite.db.select().from(attendanceOperationFacts),
    days: await suite.db.select().from(attendanceDayWork),
  };
}

describe("direct line service attendance", () => {
  it.each(actions)("%s records the accepted change under the admitted actor", async (action) => {
    const order = await prepare(action);
    expect(await command(api(recordAttendanceFact), action, order)).toMatchObject({ status: 200 });
    const after = await state();
    expect(
      after.facts.map((r) => [
        r.source,
        r.key,
        r.personId,
        r.locationId,
        r.kind,
        r.at,
        r.offsetMinutes,
        r.outcome,
      ]),
    ).toEqual([
      [
        "order",
        `${order.id}:${order.revision + 1}:${action}`,
        v.operatorId,
        v.cfg.locationId,
        "order",
        "2026-01-05T16:40:00.000Z",
        60,
        "qualifying",
      ],
    ]);
    expect(after.days.map((r) => [r.locationId, r.businessDay, r.dirtyRevision])).toEqual([
      [v.cfg.locationId, "2026-01-05", 1],
    ]);
    const line = after.lines.find((r) => r.id === order.lineId)!;
    if (action === "course") expect(line.courseId).toBe(courseId);
    if (action === "make-at") expect(line.makeAtStationId).toBe(stationId);
    if (action === "send" || action === "recall")
      expect(
        after.tickets.find((r) => r.workingOrderLineId === order.lineId)!.firedAt === null,
      ).toBe(action === "recall");
  });
  it.each(actions)("%s rolls back command writes if capture fails", async (action) => {
    const order = await prepare(action),
      before = await state();
    const response = await command(
      api(async (tx, fact) => {
        await recordAttendanceFact(tx, fact);
        throw new AppError("attendance.invalid", { reason: "service capture refused" });
      }),
      action,
      order,
    );
    expect(response).toMatchObject({ status: 400, json: { code: "attendance.invalid" } });
    expect(await state()).toEqual(before);
  });
  it.each(actions)("a repeated %s creates no later activity", async (action) => {
    const order = await prepare(action),
      app = api(recordAttendanceFact);
    expect(await command(app, action, order)).toMatchObject({ status: 200 });
    const before = await state();
    vi.spyOn(v.clock, "now").mockImplementation(() => {
      throw new Error("unchanged service clock read");
    });
    const response = await command(app, action, order);
    expect(response).toMatchObject(
      action === "make-at"
        ? { status: 409, json: { code: "working_order.out_of_date" } }
        : { status: 200 },
    );
    expect((await state()).facts).toEqual(before.facts);
    expect((await state()).days).toEqual(before.days);
  });
  it.each(actions)("%s with capture disabled creates no attendance state", async (action) => {
    const order = await prepare(action);
    expect(await command(api(), action, order)).toMatchObject({ status: 200 });
    expect((await state()).facts).toEqual([]);
    expect((await state()).days).toEqual([]);
  });
  it("an unchanged make-at choice at the current revision is not later activity", async () => {
    const order = await prepare("make-at"),
      app = api(recordAttendanceFact);
    expect(await command(app, "make-at", order)).toMatchObject({ status: 200 });
    const before = await state();
    vi.spyOn(v.clock, "now").mockImplementation(() => {
      throw new Error("unchanged make-at clock read");
    });
    expect(await command(app, "make-at", { ...order, revision: order.revision + 1 })).toMatchObject(
      { status: 200 },
    );
    expect((await state()).facts).toEqual(before.facts);
    expect((await state()).days).toEqual(before.days);
  });
});
