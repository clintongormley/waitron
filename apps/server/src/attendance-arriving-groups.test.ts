import { observedRelocationSender } from "./testing/table-action-fixture.js";
import { observedBillActionBody } from "./testing/bill-action-fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  locations,
  orderGroupEvents,
  orderGroups,
  parties,
  partyTables,
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
import { joinTables } from "./testing/table-action-fixture.js";
import { groupArrivingDishes } from "./order-groups.js";
import { mountTillApi } from "./till-api.js";
import { createTable } from "./testing/live-table.js";
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
const actions = ["move-free", "move-party", "split-table"] as const;
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
  const source = await seatedWith(v, "Ensalada", "Tarta");
  const { id: free } = await run((tx) =>
    createTable(tx, v.cfg, { label: "Destination", zoneId: v.zoneId }),
  );
  if (action === "split-table") {
    await run((tx) =>
      joinTables(tx, v.cfg, source.partyId, free, {
        expectedPartyRevision: source.revision,
        operatorId: v.adminId,
        bills: "separate",
        otherPartyId: null,
      }),
    );
  }
  const [party] = await suite.db.select().from(parties).where(eq(parties.id, source.partyId));
  const split = await send(
    v.app,
    v.cookie,
    "POST",
    `/api/bills/${source.tabId}/split`,
    await observedBillActionBody(v.db, `/api/bills/${source.tabId}/split`, {
      transfers: [{ lineNo: 2 }],
      expectedPartyRevision: party!.revision,
    }),
  );
  expect(split.status).toBe(200);
  const destination = action === "move-party" ? await seatedWith(v) : null;
  const [updated] = await suite.db.select().from(parties).where(eq(parties.id, source.partyId));
  return {
    source,
    billId: split.json.billId as string,
    revision: updated!.revision,
    tableId: destination?.tableId ?? free,
    destination,
  };
}
function command(app: Hono, action: Action, p: Awaited<ReturnType<typeof prepare>>) {
  const spoofed = { operatorId: v.adminId, at: "2026-01-06T22:00:00Z" };
  if (action === "split-table")
    return send(app, v.cookie, "POST", `/api/parties/${p.source.partyId}/split-table`, {
      ...spoofed,
      tableId: p.tableId,
      billId: p.billId,
      expectedPartyRevision: p.revision,
    });
  return send(app, v.cookie, "POST", `/api/bills/${p.billId}/move`, {
    ...spoofed,
    to: { tableId: p.tableId },
    bills: "separate",
    expectedPartyRevision: p.revision,
    ...(p.destination === null
      ? {}
      : {
          otherPartyId: p.destination.partyId,
          expectedOtherPartyRevision: p.destination.revision,
        }),
  });
}
async function state() {
  return {
    orders: await suite.db.select().from(workingOrders),
    lines: await suite.db.select().from(workingOrderLines),
    groups: await suite.db.select().from(orderGroups),
    events: await suite.db.select().from(orderGroupEvents),
    parties: await suite.db.select().from(parties),
    tables: await suite.db.select().from(partyTables),
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
describe("attendance for dishes arriving in a party", () => {
  it("captures both held and fired arrivals at the supplied command instant", async () => {
    const p = await seatedWith(v, "Ensalada", "Tarta");
    const lines = await suite.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, p.tabId));
    await suite.db
      .update(workingOrderLines)
      .set({ groupId: null })
      .where(eq(workingOrderLines.workingOrderId, p.tabId));
    await suite.db
      .update(workingOrderLines)
      .set({ sentAt: null })
      .where(eq(workingOrderLines.id, lines[1]!.id));
    await suite.db
      .update(ticketItems)
      .set({ firedAt: null, madeHere: false })
      .where(eq(ticketItems.workingOrderLineId, lines[1]!.id));
    const before = await state();
    const made = await run((tx) =>
      groupArrivingDishes(tx, p.partyId, p.tabId, v.operatorId, new Map(), {
        recorder: recordAttendanceFact,
        at: "2026-01-05T16:40:00.987Z",
      }),
    );
    expect(made.fired).not.toBeNull();
    expect(made.held).toHaveLength(1);
    const saved = await state();
    const events = saved.events.filter((e) => !before.events.some((old) => old.id === e.id));
    expect(events).toHaveLength(2);
    expect(saved.facts.map((f) => [f.key, f.personId, f.locationId, f.at])).toEqual(
      events.map((e) => [
        `group:${e.id}`,
        v.operatorId,
        v.cfg.locationId,
        "2026-01-05T16:40:00.000Z",
      ]),
    );
  });
  it.each(actions)(
    "%s snapshots the admitted mover at the trusted command instant",
    async (action) => {
      const p = await prepare(action);
      const before = await state();
      const reading = v.clock.now();
      const clock = vi
        .spyOn(v.clock, "now")
        .mockReturnValueOnce({ ...reading, instant: new Date("2026-01-05T16:40:00.987Z") });
      if (action === "split-table")
        clock.mockReturnValueOnce({
          ...reading,
          instant: new Date("2026-01-05T16:40:00.987Z"),
        });
      clock.mockReturnValue({ ...reading, instant: new Date("2026-01-05T17:00:00Z") });
      expect(await command(api(recordAttendanceFact), action, p)).toMatchObject({ status: 200 });
      const saved = await state();
      const events = saved.events.filter((e) => !before.events.some((old) => old.id === e.id));
      expect(events.map((e) => [e.kind, e.actorId])).toEqual([["lines_moved", v.operatorId]]);
      expect(saved.facts).toEqual([
        expect.objectContaining({
          source: "draft",
          key: `group:${events[0]!.id}`,
          personId: v.operatorId,
          locationId: v.cfg.locationId,
          kind: "order",
          at: "2026-01-05T16:40:00.000Z",
          outcome: "qualifying",
        }),
      ]);
      expect((await factsAt()).filter((f) => f.key === `group:${events[0]!.id}`)).toEqual([
        expect.objectContaining({ personId: v.operatorId, at: "2026-01-05T16:40:00.000Z" }),
      ]);
      expect(saved.days.map((d) => d.dirtyRevision)).toEqual([1]);
    },
  );
  it.each(actions)("%s rolls back the move and group when capture refuses", async (action) => {
    const p = await prepare(action),
      before = await state();
    const refusing: AttendanceRecorder = async (tx, fact) => {
      await recordAttendanceFact(tx, fact);
      throw new AppError("attendance.invalid", { reason: "capture refused" });
    };
    expect(await command(api(refusing), action, p)).toMatchObject({
      status: 400,
      json: { code: "attendance.invalid" },
    });
    expect(await state()).toEqual(before);
  });
  it.each(actions)("%s works without workforce capture", async (action) => {
    const p = await prepare(action);
    expect(await command(api(), action, p)).toMatchObject({ status: 200 });
    expect((await state()).facts).toEqual([]);
    expect((await state()).days).toEqual([]);
  });
  it("keeps the snapshot when the destination party later changes location", async () => {
    const p = await prepare("move-party");
    expect(await command(api(recordAttendanceFact), "move-party", p)).toMatchObject({
      status: 200,
    });
    const saved = await state();
    expect(saved.facts).toHaveLength(1);
    const [other] = await suite.db
      .insert(locations)
      .values({
        name: "Elsewhere",
        invoiceLocales: ["es-ES"],
        operationDescription: "Restaurant",
      })
      .returning();
    await suite.db
      .update(workingOrders)
      .set({ locationId: other!.id })
      .where(eq(workingOrders.partyId, p.destination!.partyId));
    expect((await factsAt()).filter((f) => f.key === saved.facts[0]!.key)).toEqual([
      expect.objectContaining({ locationId: v.cfg.locationId, at: "2026-01-05T16:40:00.000Z" }),
    ]);
    expect((await factsAt(other!.id)).filter((f) => f.key === saved.facts[0]!.key)).toEqual([]);
  });
});

const send = observedRelocationSender(() => suite.db, rawSend);
