import { observedOrderSender } from "./testing/order-writer-fixture.js";
import {
  recallLines,
  sendLines,
  setLineCourse,
  placeOrder,
} from "./testing/order-writer-fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  locations,
  newId,
  orderGroups,
  orderGroupEvents,
  parties,
  printJobs,
  serviceCommands,
  ticketItemMoves,
  ticketItems,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { AppError, locationId } from "@waitron/shared";
import { attendanceDayWork, attendanceOperationFacts } from "@waitron/workforce";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";
import { createCourse, createStation } from "./kitchen.js";
import { mountTillApi } from "./till-api.js";
import { bumpGroupReady } from "./order-groups.js";
import { splitPartyBill } from "./testing/serve-line.js";
import { advanceTicketItem, bumpCourseReady, markServed } from "./working-order.js";
import {
  provisionBillVenue,
  seatedWith,
  send as rawSend,
  type BillVenue,
} from "./testing/bill-venue.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let v: BillVenue, courseId: string, stationId: string, destination: string;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-05T09:00:00Z"));
  v = await provisionBillVenue(suite.db);
  await withTransaction(suite.db, async (tx) => {
    stationId = (await createStation(tx, v.cfg, { name: "Kitchen", isDefault: true })).id;
    destination = (await createStation(tx, v.cfg, { name: "Bar" })).id;
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
const actions = [
  "ticket-preparing",
  "ticket-ready",
  "station-preparing",
  "station-ready",
  "group-fire",
  "course-ready",
  "group-ready",
  "served",
  "unserved",
  "group-served",
  "station-move",
  "hand-over",
] as const;
const retiredActions = ["course-fire", "course-away", "group-away"] as const;
type Action = (typeof actions)[number] | (typeof retiredActions)[number];
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
  const party = await seatedWith(v, "Ensalada");
  const [line] = await suite.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, party.tabId));
  await withTransaction(suite.db, async (tx) => {
    await recallLines(tx, v.cfg, party.tabId, [1]);
    await setLineCourse(tx, v.cfg, party.tabId, 1, courseId);
    if (action === "group-fire")
      await tx
        .update(orderGroups)
        .set({ state: "held", firedAt: null })
        .where(eq(orderGroups.id, line!.groupId!));
    if (action !== "course-fire" && action !== "group-fire")
      await sendLines(tx, v.cfg, party.tabId, [1]);
    if (action.endsWith("-away")) await bumpCourseReady(tx, v.cfg, party.tabId, courseId);
    if (action === "unserved")
      await markServed(tx, v.cfg, party.partyId, [{ lineId: line!.id, quantity: "1" }], {
        submissionId: newId(),
        expectedPartyRevision: party.revision,
        operatorId: v.adminId,
      });
  });
  const [ticket] = await suite.db
    .select()
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderLineId, line!.id));
  if (action === "ticket-ready" || action === "station-ready")
    await withTransaction(suite.db, (tx) => advanceTicketItem(tx, v.cfg, ticket!.id, "preparing"));
  if (action === "hand-over") {
    await placeOrder(
      { db: suite.db, backend: v.backend, clock: v.clock },
      v.cfg,
      party.tabId,
      v.adminId,
    );
    expect(
      await send(v.app, v.cookie, "POST", `/api/working-orders/${party.tabId}/collect`, {
        tender: { method: "cash", amount: "12.00" },
      }),
    ).toMatchObject({ status: 200 });
  }
  const [current] = await suite.db.select().from(parties).where(eq(parties.id, party.partyId));
  return {
    ...party,
    revision: current!.revision,
    lineId: line!.id,
    groupId: line!.groupId!,
    ticketId: ticket!.id,
    submissionId: newId(),
  };
}
function command(app: Hono, action: Action, order: Awaited<ReturnType<typeof prepare>>) {
  let path: string, body: Record<string, unknown>;
  if (action === "hand-over") {
    path = `/api/orders/${order.tabId}/collect`;
    body = { submissionId: order.submissionId };
  } else if (action.startsWith("ticket-")) {
    path = `/api/ticket-items/${order.ticketId}/advance`;
    body = { stationId, to: action.slice(7) };
  } else if (action.startsWith("station-") && action !== "station-move") {
    path = `/api/orders/${order.tabId}/stations/${stationId}/advance`;
    body = { to: action.slice(8) };
  } else if (action.startsWith("course-")) {
    path = `/api/orders/${order.tabId}/courses/${courseId}/${action.slice(7)}`;
    body = {};
  } else if (action === "station-move") {
    path = `/api/working-orders/${order.tabId}/lines/move-station`;
    body = { submissionId: order.submissionId, lineIds: [order.lineId], stationId: destination };
  } else {
    path = `/api/parties/${order.partyId}/${action.startsWith("group-") ? `groups/${order.groupId}/${action.slice(6)}` : action}`;
    body = {
      submissionId: order.submissionId,
      expectedPartyRevision: order.revision,
      items: [{ lineId: order.lineId, quantity: "1" }],
    };
  }
  return send(app, v.cookie, "POST", path, {
    ...body,
    personId: v.adminId,
    operatorId: v.adminId,
    at: "2026-01-06T22:00:00Z",
  });
}
async function state() {
  return {
    orders: await suite.db.select().from(workingOrders),
    lines: await suite.db.select().from(workingOrderLines),
    tickets: await suite.db.select().from(ticketItems),
    prints: await suite.db.select().from(printJobs),
    commands: await suite.db.select().from(serviceCommands),
    parties: await suite.db.select().from(parties),
    groups: await suite.db.select().from(orderGroupEvents),
    orderGroups: await suite.db.select().from(orderGroups),
    moves: await suite.db.select().from(ticketItemMoves),
    facts: await suite.db.select().from(attendanceOperationFacts),
    days: await suite.db.select().from(attendanceDayWork),
  };
}
describe("kitchen service attendance", () => {
  it("group preparation captures each affected bill once at one trusted instant", async () => {
    const party = await seatedWith(v, "Ensalada", "Tarta");
    const [line] = await suite.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, party.tabId));
    const split = await withTransaction(suite.db, (tx) =>
      splitPartyBill(tx, v.cfg, party.tabId, [{ lineNo: 2 }]),
    );
    const [current] = await suite.db.select().from(parties).where(eq(parties.id, party.partyId));
    const reading = v.clock.now();
    vi.spyOn(v.clock, "now")
      .mockReturnValueOnce(reading)
      .mockImplementation(() => {
        throw new Error("second command clock read");
      });
    await withTransaction(suite.db, (tx) =>
      bumpGroupReady(
        tx,
        v.cfg,
        party.partyId,
        line!.groupId!,
        {
          submissionId: newId(),
          expectedPartyRevision: current!.revision,
          operatorId: v.operatorId,
        },
        { personId: v.operatorId },
        { recorder: recordAttendanceFact, clock: v.clock },
      ),
    );
    const facts = (await state()).facts;
    expect(facts.map((r) => [r.personId, r.at])).toEqual([
      [v.operatorId, "2026-01-05T16:40:00.000Z"],
      [v.operatorId, "2026-01-05T16:40:00.000Z"],
    ]);
    expect(facts.map((r) => r.key.split(":")[1]).sort()).toEqual(
      [party.tabId, split.billId].sort(),
    );
  });
  it("a kitchen transition uses its stored order location", async () => {
    const order = await prepare("ticket-preparing");
    const [other] = await suite.db
      .insert(locations)
      .values({ name: "Elsewhere", invoiceLocales: ["es-ES"], operationDescription: "Restaurant" })
      .returning({ id: locations.id });
    await withTransaction(suite.db, (tx) =>
      advanceTicketItem(
        tx,
        { ...v.cfg, locationId: locationId(other!.id) },
        order.ticketId,
        "preparing",
        { recorder: recordAttendanceFact, clock: v.clock, personId: v.operatorId },
      ),
    );
    expect((await state()).facts.map((r) => [r.personId, r.locationId])).toEqual([
      [v.operatorId, v.cfg.locationId],
    ]);
    expect((await state()).days.map((r) => r.locationId)).toEqual([v.cfg.locationId]);
  });
  it("a device-only group command supplies no worker activity", async () => {
    const order = await prepare("group-ready");
    await expect(
      withTransaction(suite.db, (tx) =>
        bumpGroupReady(
          tx,
          v.cfg,
          order.partyId,
          order.groupId,
          {
            submissionId: order.submissionId,
            expectedPartyRevision: order.revision,
            operatorId: v.deviceId,
          },
          { deviceId: v.deviceId },
          { recorder: recordAttendanceFact, clock: v.clock },
        ),
      ),
    ).resolves.toEqual({ revision: order.revision + 1 });
    expect((await state()).facts).toEqual([]);
    expect((await state()).days).toEqual([]);
    expect((await state()).tickets.find((r) => r.id === order.ticketId)!.state).toBe("ready");
  });
  it("the same submission id in bill and party command scopes remains two activities", async () => {
    const order = await prepare("station-move"),
      app = api(recordAttendanceFact);
    expect(await command(app, "station-move", order)).toMatchObject({ status: 200 });
    expect(await command(app, "group-ready", order)).toMatchObject({ status: 200 });
    const after = await state();
    expect(after.facts.map((r) => [r.personId, r.at])).toEqual([
      [v.operatorId, "2026-01-05T16:40:00.000Z"],
      [v.operatorId, "2026-01-05T16:40:00.000Z"],
    ]);
    expect(new Set(after.facts.map((r) => r.key)).size).toBe(2);
    expect(after.days.map((r) => r.dirtyRevision)).toEqual([2]);
  });
  it.each(actions)("%s captures the admitted human activity with its command", async (action) => {
    const order = await prepare(action);
    expect(await command(api(recordAttendanceFact), action, order)).toMatchObject({ status: 200 });
    const after = await state();
    expect(
      after.facts.map((r) => [
        r.source,
        r.personId,
        r.locationId,
        r.kind,
        r.at,
        r.offsetMinutes,
        r.outcome,
      ]),
    ).toEqual([
      [
        action === "group-fire" ? "draft" : "order",
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
    const ticket = after.tickets.find((r) => r.id === order.ticketId)!;
    const line = after.lines.find((r) => r.id === order.lineId)!;
    if (action === "hand-over")
      expect(after.orders.find((r) => r.id === order.tabId)!.collectedAt).not.toBeNull();
    if (action.endsWith("-preparing")) expect(ticket.state).toBe("preparing");
    if (action.endsWith("-ready")) expect(ticket.state).toBe("ready");
    if (action === "group-fire") expect(ticket.firedAt).not.toBeNull();
    if (action === "station-move") expect(ticket.stationId).toBe(destination);
    if (action === "served" || action === "group-served" || action === "unserved")
      expect(line.servedQuantity).toBe(action === "unserved" ? 0 : 1000);
  });
  it.each(actions)("%s rolls back its command when capture refuses", async (action) => {
    const order = await prepare(action),
      before = await state();
    expect(
      await command(
        api(async (tx, fact) => {
          await recordAttendanceFact(tx, fact);
          throw new AppError("attendance.invalid", { reason: "kitchen capture refused" });
        }),
        action,
        order,
      ),
    ).toMatchObject({ status: 400, json: { code: "attendance.invalid" } });
    expect(await state()).toEqual(before);
  });
  it.each(actions)("a repeated %s does not record later human activity", async (action) => {
    const order = await prepare(action),
      app = api(recordAttendanceFact);
    expect(await command(app, action, order)).toMatchObject({ status: 200 });
    const before = await state();
    vi.spyOn(v.clock, "now").mockImplementation(() => {
      throw new Error("replay kitchen clock read");
    });
    expect(await command(app, action, order)).toMatchObject(
      action.startsWith("ticket-")
        ? { status: 409, json: { code: "ticket.invalid_transition" } }
        : { status: 200 },
    );
    expect((await state()).facts).toEqual(before.facts);
    expect((await state()).days).toEqual(before.days);
  });
  it.each(["group-ready", "group-served", "station-move"] as const)(
    "a new %s submission with nothing left to change is not new activity",
    async (action) => {
      const order = await prepare(action),
        app = api(recordAttendanceFact);
      expect(await command(app, action, order)).toMatchObject({ status: 200 });
      const before = await state(),
        revision = before.parties.find((r) => r.id === order.partyId)!.revision;
      vi.spyOn(v.clock, "now").mockImplementation(() => {
        throw new Error("empty kitchen command clock read");
      });
      expect(
        await command(app, action, { ...order, revision, submissionId: newId() }),
      ).toMatchObject({ status: 200 });
      expect((await state()).facts).toEqual(before.facts);
      expect((await state()).days).toEqual(before.days);
    },
  );
  it.each(actions)("%s with capture disabled records no attendance state", async (action) => {
    const order = await prepare(action);
    expect(await command(api(), action, order)).toMatchObject({ status: 200 });
    expect((await state()).facts).toEqual([]);
    expect((await state()).days).toEqual([]);
  });
  it.each(
    retiredActions.flatMap((action) =>
      (["enabled", "refusing", "disabled"] as const).map((capture) => ({ action, capture })),
    ),
  )("$action is retired with $capture attendance capture", async ({ action, capture }) => {
    const order = await prepare(action);
    const before = await state();
    const recorder = vi.fn<AttendanceRecorder>(async (tx, fact) => {
      await recordAttendanceFact(tx, fact);
      if (capture === "refusing")
        throw new AppError("attendance.invalid", { reason: "kitchen capture refused" });
    });
    const app = api(capture === "disabled" ? undefined : recorder);
    vi.spyOn(v.clock, "now").mockImplementation(() => {
      throw new Error("retired kitchen command clock read");
    });
    for (const submissionId of [order.submissionId, order.submissionId, newId()]) {
      expect(await command(app, action, { ...order, submissionId })).toMatchObject({
        status: 404,
      });
      expect(await state()).toEqual(before);
    }
    expect(recorder).not.toHaveBeenCalled();
  });
});

const send = observedOrderSender(() => suite.db, rawSend);
