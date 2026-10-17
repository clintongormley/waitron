import { readBillEditState } from "./bill-editing.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  newId,
  locations,
  orderGroupEvents,
  orderGroups,
  parties,
  printJobs,
  serviceCommands,
  ticketItems,
  workingOrderLines,
  workingOrders,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { adjustments } from "@waitron/adjustments";
import { AppError } from "@waitron/shared";
import { attendanceDayWork, attendanceOperationFacts } from "@waitron/workforce";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";
import { readAttendanceFacts } from "./attendance-facts.js";
import { mountTillApi } from "./till-api.js";
import { send } from "./testing/bill-venue.js";
import {
  billWith,
  lineIdOf,
  provisionAdjustmentVenue,
  type AdjustmentVenue,
} from "./testing/adjustment-venue.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let v: AdjustmentVenue;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-05T09:00:00Z"));
  v = await provisionAdjustmentVenue(suite.db);
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
const actions = ["cancel", "comp", "discount_percent", "discount_amount"] as const;
type Action = (typeof actions)[number];
async function prepare(action: Action) {
  const bill = await billWith(v, [{ name: "Burger" }, { name: "Salad" }], {
    operatorId: v.staffId,
  });
  const body = {
    submissionId: newId(),
    expectedRevision: bill.revision,
    expectedEdit: await readBillEditState(v.db, bill.billId),
    lineId: await lineIdOf(v, bill.billId, 1),
    reasonId: v.reasonId.house,
    action,
    note: null,
    ...(action === "discount_percent"
      ? { percentBp: 1000 }
      : action === "discount_amount"
        ? { amount: "1.00" }
        : {}),
    operatorId: v.managerId,
    at: "2026-01-06T22:00:00Z",
  };
  return { ...bill, body };
}
async function state() {
  return {
    orders: await suite.db.select().from(workingOrders),
    lines: await suite.db.select().from(workingOrderLines),
    adjustments: await suite.db.select().from(adjustments),
    commands: await suite.db.select().from(serviceCommands),
    parties: await suite.db.select().from(parties),
    tickets: await suite.db.select().from(ticketItems),
    jobs: await suite.db.select().from(printJobs),
    facts: await suite.db.select().from(attendanceOperationFacts),
    days: await suite.db.select().from(attendanceDayWork),
  };
}
async function heldCancellation(app: Hono) {
  const bill = await billWith(v, [{ name: "Burger" }], { operatorId: v.staffId, release: "hold" });
  const body = {
    submissionId: newId(),
    expectedRevision: bill.revision,
    expectedEdit: await readBillEditState(v.db, bill.billId),
    lineId: await lineIdOf(v, bill.billId, 1),
    reasonId: v.reasonId.house,
    action: "cancel",
    note: null,
  };
  return {
    billId: bill.billId,
    send: () =>
      send(
        app,
        v.cookie.supervisor,
        "POST",
        `/api/working-orders/${bill.billId}/adjustments`,
        body,
      ),
  };
}
describe("an adjustment that empties a held group", () => {
  it("snapshots the removed group at the same trusted instant as the cancellation", async () => {
    const command = await heldCancellation(api(recordAttendanceFact)),
      reading = v.clock.now();
    vi.spyOn(v.clock, "now")
      .mockReturnValueOnce({ ...reading, instant: new Date("2026-01-05T16:40:00.987Z") })
      .mockReturnValue({ ...reading, instant: new Date("2026-01-05T17:00:00Z") });
    expect(await command.send()).toMatchObject({ status: 200 });
    const [event] = await suite.db
      .select()
      .from(orderGroupEvents)
      .where(eq(orderGroupEvents.kind, "removed"));
    expect(event!.actorId).toBe(v.supervisorId);
    const facts = (await state()).facts;
    expect(facts.map((f) => [f.personId, f.locationId, f.at])).toEqual([
      [v.supervisorId, v.cfg.locationId, "2026-01-05T16:40:00.000Z"],
      [v.supervisorId, v.cfg.locationId, "2026-01-05T16:40:00.000Z"],
    ]);
    expect(facts[0]!.key).toBe(`group:${event!.id}`);
    const before = await state();
    vi.spyOn(v.clock, "now").mockImplementation(() => {
      throw new Error("replay clock");
    });
    expect(await command.send()).toMatchObject({ status: 200 });
    expect(await state()).toEqual(before);
  });
  it("keeps the removed event's original location after its bill moves", async () => {
    const command = await heldCancellation(api(recordAttendanceFact));
    expect(await command.send()).toMatchObject({ status: 200 });
    const [event] = await suite.db
      .select()
      .from(orderGroupEvents)
      .where(eq(orderGroupEvents.kind, "removed"));
    const [other] = await suite.db
      .insert(locations)
      .values({ name: "Other", invoiceLocales: ["es-ES"], operationDescription: "Restaurant" })
      .returning();
    await suite.db
      .update(workingOrders)
      .set({ locationId: other!.id })
      .where(eq(workingOrders.id, command.billId));
    const read = (locationId: string) =>
      withTransaction(suite.db, (tx) =>
        readAttendanceFacts(tx, {
          locationId,
          businessDay: "2026-01-05",
          startAt: "2026-01-05T00:00:00Z",
          endAt: "2026-01-06T00:00:00Z",
        }),
      );
    expect(
      (await read(v.cfg.locationId))
        .filter((f) => f.key === `group:${event!.id}`)
        .map((f) => [f.personId, f.at]),
    ).toEqual([[v.supervisorId, "2026-01-05T16:40:00.000Z"]]);
    expect((await read(other!.id)).filter((f) => f.key === `group:${event!.id}`)).toEqual([]);
  });
  it("rolls back a held cancellation whose removed-event capture refuses", async () => {
    const command = await heldCancellation(
      api(async (tx, fact) => {
        await recordAttendanceFact(tx, fact);
        if (fact.key.startsWith("group:"))
          throw new AppError("attendance.invalid", { reason: "removed group refused" });
      }),
    );
    const before = await state(),
      groups = await suite.db.select().from(orderGroups),
      events = await suite.db.select().from(orderGroupEvents);
    expect(await command.send()).toMatchObject({
      status: 400,
      json: { code: "attendance.invalid" },
    });
    expect(await state()).toEqual(before);
    expect(await suite.db.select().from(orderGroups)).toEqual(groups);
    expect(await suite.db.select().from(orderGroupEvents)).toEqual(events);
  });
});
describe("adjustment order activity", () => {
  it.each(actions)(
    "%s retains the initiating worker rather than line credit or supplied attribution",
    async (action) => {
      const { billId, revision, body } = await prepare(action);
      const response = await send(
        api(recordAttendanceFact),
        v.cookie.supervisor,
        "POST",
        `/api/working-orders/${billId}/adjustments`,
        body,
      );
      expect(response).toMatchObject({ status: 200, json: { revision: revision + 1 } });
      expect(
        (await state()).facts.map((r) => [
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
          `${billId}:${revision + 1}:adjustment`,
          v.supervisorId,
          v.cfg.locationId,
          "order",
          "2026-01-05T16:40:00.000Z",
          60,
          "qualifying",
        ],
      ]);
      const [recorded] = await suite.db
        .select()
        .from(adjustments)
        .where(eq(adjustments.workingOrderId, billId));
      expect([recorded!.requestedBy, recorded!.beforeAmount, recorded!.afterAmount]).toEqual([
        v.supervisorId,
        1200,
        action === "cancel" || action === "comp" ? 0 : action === "discount_percent" ? 1080 : 1100,
      ]);
      expect(
        (await state()).days.map((r) => [r.locationId, r.businessDay, r.dirtyRevision]),
      ).toEqual([[v.cfg.locationId, "2026-01-05", 1]]);
    },
  );
  it.each(actions)(
    "%s rolls back its money, kitchen, replay marker and activity after recorder refusal",
    async (action) => {
      const { billId, body } = await prepare(action),
        before = await state();
      const response = await send(
        api(async (tx, fact) => {
          await recordAttendanceFact(tx, fact);
          throw new AppError("attendance.invalid", { reason: "adjustment capture refused" });
        }),
        v.cookie.supervisor,
        "POST",
        `/api/working-orders/${billId}/adjustments`,
        body,
      );
      expect(response).toMatchObject({ status: 400, json: { code: "attendance.invalid" } });
      expect(await state()).toEqual(before);
    },
  );
  it.each(actions)("a replayed %s creates no new attendance or clock reading", async (action) => {
    const { billId, body } = await prepare(action),
      app = api(recordAttendanceFact);
    const response = await send(
      app,
      v.cookie.supervisor,
      "POST",
      `/api/working-orders/${billId}/adjustments`,
      body,
    );
    expect(response).toMatchObject({ status: 200 });
    const before = await state();
    vi.spyOn(v.clock, "now").mockImplementation(() => {
      throw new Error("replayed adjustment clock");
    });
    expect(
      await send(
        app,
        v.cookie.supervisor,
        "POST",
        `/api/working-orders/${billId}/adjustments`,
        body,
      ),
    ).toEqual(response);
    expect(await state()).toEqual(before);
  });
  it.each(actions)("%s without attendance creates no workforce state", async (action) => {
    const { billId, body } = await prepare(action);
    expect(
      await send(
        api(),
        v.cookie.supervisor,
        "POST",
        `/api/working-orders/${billId}/adjustments`,
        body,
      ),
    ).toMatchObject({ status: 200 });
    expect((await state()).facts).toEqual([]);
    expect((await state()).days).toEqual([]);
  });
  it("an adjustment preview never creates attendance", async () => {
    const { billId, body } = await prepare("discount_percent"),
      before = await state();
    expect(
      await send(
        api(recordAttendanceFact),
        v.cookie.supervisor,
        "POST",
        `/api/working-orders/${billId}/adjustments/preview`,
        body,
      ),
    ).toMatchObject({ status: 200 });
    expect(await state()).toEqual(before);
  });
});
