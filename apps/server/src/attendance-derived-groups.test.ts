import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  locations,
  newId,
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
import { createCourse, createStation } from "./kitchen.js";
import { submitGroups } from "./order-groups.js";
import { mountTillApi } from "./till-api.js";
import { fireCourse } from "./working-order.js";
import { provisionBillVenue, seatedWith, send, type BillVenue } from "./testing/bill-venue.js";

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
    await createStation(tx, v.cfg, { name: "Kitchen", isDefault: true });
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

type Action = "course-fire" | "empty-move";
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
async function prepare() {
  const party = await seatedWith(v);
  const submitted = await withTransaction(suite.db, (tx) =>
    submitGroups(tx, v.cfg, party.partyId, {
      submissionId: newId(),
      expectedPartyRevision: party.revision,
      operatorId: v.adminId,
      groups: ["Ensalada", "Tarta"].map((name) => ({
        release: "hold" as const,
        lines: [{ menuItemId: v.offerFor(name), quantity: "2", courseId }],
      })),
    }),
  );
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
function command(app: Hono, action: Action, p: Awaited<ReturnType<typeof prepare>>) {
  if (action === "course-fire")
    return send(app, v.cookie, "POST", `/api/orders/${p.tabId}/courses/${courseId}/fire`, {
      operatorId: v.adminId,
      at: "2026-01-06T22:00:00Z",
    });
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
    events: await suite.db.select().from(orderGroupEvents),
    orders: await suite.db.select().from(workingOrders),
    lines: await suite.db.select().from(workingOrderLines),
    tickets: await suite.db.select().from(ticketItems),
    parties: await suite.db.select().from(parties),
    commands: await suite.db.select().from(serviceCommands),
    facts: await suite.db.select().from(attendanceOperationFacts),
    days: await suite.db.select().from(attendanceDayWork),
  };
}
async function factsAt(locationId: string = v.cfg.locationId) {
  return withTransaction(suite.db, (tx) =>
    readAttendanceFacts(tx, {
      locationId,
      businessDay: "2026-01-05",
      startAt: "2026-01-05T00:00:00Z",
      endAt: "2026-01-06T00:00:00Z",
    }),
  );
}
describe("group events derived from accepted commands", () => {
  it.each(["course-fire", "empty-move"] as const)(
    "%s uses one trusted instant for the whole accepted command",
    async (action) => {
      const p = await prepare();
      const reading = v.clock.now();
      vi.spyOn(v.clock, "now")
        .mockReturnValueOnce({ ...reading, instant: new Date("2026-01-05T16:40:00.987Z") })
        .mockReturnValue({ ...reading, instant: new Date("2026-01-05T17:00:00Z") });
      expect(await command(api(recordAttendanceFact), action, p)).toMatchObject({ status: 200 });
      expect((await state()).facts.map((f) => f.at)).toEqual([
        "2026-01-05T16:40:00.000Z",
        "2026-01-05T16:40:00.000Z",
      ]);
    },
  );
  it.each(["course-fire", "empty-move"] as const)(
    "%s snapshots every derived event at the admitted instant",
    async (action) => {
      const p = await prepare();
      expect(await command(api(recordAttendanceFact), action, p)).toMatchObject({ status: 200 });
      const saved = await state();
      const events = saved.events.filter((e) => e.actorId === v.operatorId);
      expect(events.map((e) => e.kind).sort()).toEqual(
        action === "course-fire" ? ["fired", "fired"] : ["lines_moved", "removed"],
      );
      expect(saved.facts.map((f) => [f.key, f.personId, f.locationId, f.at]).sort()).toEqual(
        events
          .map((e) => [`group:${e.id}`, v.operatorId, v.cfg.locationId, "2026-01-05T16:40:00.000Z"])
          .sort(),
      );
      const read = (await factsAt()).filter(
        (f) => f.personId === v.operatorId && f.kind === "order",
      );
      expect(read.map((f) => [f.key, f.at]).sort()).toEqual(
        events.map((e) => [`group:${e.id}`, "2026-01-05T16:40:00.000Z"]).sort(),
      );
      vi.spyOn(v.clock, "now").mockImplementation(() => {
        throw new Error("no repeated action clock");
      });
      expect(await command(api(recordAttendanceFact), action, p)).toMatchObject({ status: 200 });
      expect(await state()).toEqual(saved);
    },
  );
  it.each(["course-fire", "empty-move"] as const)(
    "%s keeps all derived events in the original location after bills move",
    async (action) => {
      const p = await prepare();
      expect(await command(api(recordAttendanceFact), action, p)).toMatchObject({ status: 200 });
      const events = (await state()).events.filter((e) => e.actorId === v.operatorId);
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
        .where(eq(workingOrders.partyId, p.partyId));
      expect(
        (await factsAt())
          .filter((f) => f.personId === v.operatorId && f.kind === "order")
          .map((f) => [f.key, f.locationId, f.at])
          .sort(),
      ).toEqual(
        events.map((e) => [`group:${e.id}`, v.cfg.locationId, "2026-01-05T16:40:00.000Z"]).sort(),
      );
      expect(
        (await factsAt(other!.id)).filter((f) => f.personId === v.operatorId && f.kind === "order"),
      ).toEqual([]);
    },
  );
  it.each(["course-fire", "empty-move"] as const)(
    "%s rolls back the command when a later derived snapshot is refused",
    async (action) => {
      const p = await prepare(),
        before = await state();
      let captures = 0;
      const refusing: AttendanceRecorder = async (tx, fact) => {
        await recordAttendanceFact(tx, fact);
        if (++captures === 2)
          throw new AppError("attendance.invalid", { reason: "second derived event refused" });
      };
      expect(await command(api(refusing), action, p)).toMatchObject({
        status: 400,
        json: { code: "attendance.invalid" },
      });
      expect(await state()).toEqual(before);
    },
  );
  it("a device course release creates no human fact", async () => {
    const p = await prepare();
    await withTransaction(suite.db, (tx) =>
      fireCourse(
        tx,
        v.cfg,
        p.tabId,
        courseId,
        { deviceId: v.deviceId },
        { recorder: recordAttendanceFact, clock: v.clock },
      ),
    );
    const saved = await state();
    expect(saved.groups.map((g) => [g.state, g.firedBy, g.firedByDeviceId])).toEqual([
      ["fired", null, v.deviceId],
      ["fired", null, v.deviceId],
    ]);
    expect(saved.facts).toEqual([]);
  });
  it.each(["course-fire", "empty-move"] as const)(
    "%s without capture changes groups without workforce rows",
    async (action) => {
      const p = await prepare();
      expect(await command(api(), action, p)).toMatchObject({ status: 200 });
      expect((await state()).groups.filter((g) => g.state !== "held")).toHaveLength(
        action === "course-fire" ? 2 : 1,
      );
      expect((await state()).facts).toEqual([]);
    },
  );
});
