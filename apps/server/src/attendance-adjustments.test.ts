import { testTradingAdmission } from "./testing/trading-admission.js";
import { readBillEditState } from "./bill-editing.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  newId,
  orderGroupEvents,
  parties,
  printJobs,
  serviceCommands,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { adjustments } from "@waitron/adjustments";

import { attendanceDays, staffActivity } from "@waitron/workforce";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";
import { mountTillApi } from "./till-api.js";
import { send } from "./testing/bill-venue.js";
import { cancelItemRequest } from "./testing/cancel-line.js";
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
    reasonId: action === "cancel" ? v.reasonId.houseVoid : v.reasonId.house,
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
  const request =
    action === "cancel"
      ? await cancelItemRequest(v.db, bill.billId, 1, undefined, {
          submissionId: body.submissionId,
          reasonId: body.reasonId,
          preparationStarted: true,
        })
      : { path: `/api/working-orders/${bill.billId}/adjustments`, body };
  return {
    ...bill,
    path: request.path,
    body: { ...request.body, operatorId: body.operatorId, at: body.at },
  };
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
    facts: await suite.db.select().from(staffActivity),
    days: await suite.db.select().from(attendanceDays),
  };
}
async function heldCancellation(app: Hono) {
  const bill = await billWith(v, [{ name: "Burger" }], { operatorId: v.staffId, release: "hold" });
  const { path, body } = await cancelItemRequest(v.db, bill.billId, 1, undefined, {
    reasonId: v.reasonId.houseVoid,
  });
  return {
    billId: bill.billId,
    send: () => send(app, v.cookie.supervisor, "POST", path, body),
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
    expect(facts.map((row) => [row.personId, row.lastAt])).toEqual([
      [v.supervisorId, "2026-01-05T16:40:00.000Z"],
    ]);

    const before = await state();
    vi.spyOn(v.clock, "now").mockImplementation(() => {
      throw new Error("replay clock");
    });
    expect(await command.send()).toMatchObject({ status: 200 });
    expect(await state()).toEqual(before);
  });
});
describe("adjustment order activity", () => {
  it.each(actions)(
    "%s retains the initiating worker rather than line credit or supplied attribution",
    async (action) => {
      const { billId, partyId, revision, path, body } = await prepare(action);
      const [party] = await suite.db.select().from(parties).where(eq(parties.id, partyId));
      const response = await send(
        api(recordAttendanceFact),
        v.cookie.supervisor,
        "POST",
        path,
        body,
      );
      expect(response).toMatchObject({
        status: 200,
        json: { revision: action === "cancel" ? party!.revision + 1 : revision + 1 },
      });
      const [order] = await suite.db
        .select()
        .from(workingOrders)
        .where(eq(workingOrders.id, billId));
      expect(order!.revision).toBe(revision + 1);
      expect((await state()).facts.map((row) => [row.personId, row.lastAt])).toEqual([
        [v.supervisorId, "2026-01-05T16:40:00.000Z"],
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
      expect((await state()).days.map((r) => [r.businessDay, r.dirtyRevision])).toEqual([
        ["2026-01-05", 1],
      ]);
    },
  );
});
