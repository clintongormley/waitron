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
import { mountTillApi } from "./till-api.js";
import { fireGroup, submitGroups } from "./order-groups.js";
import { provisionBillVenue, seatedWith, send, type BillVenue } from "./testing/bill-venue.js";

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
const actions = ["submit", "join", "fire", "reorder", "move", "split"] as const;
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
async function prepare() {
  const party = await seatedWith(v);
  const result = await withTransaction(suite.db, (tx) =>
    submitGroups(tx, v.cfg, party.partyId, {
      submissionId: newId(),
      expectedPartyRevision: party.revision,
      operatorId: v.adminId,
      groups: ["Ensalada", "Tarta"].map((name) => ({
        release: "hold" as const,
        lines: [{ menuItemId: v.offerFor(name), quantity: "2" }],
      })),
    }),
  );
  const [line] = await suite.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, result.tabId));
  return {
    ...party,
    tabId: result.tabId,
    revision: result.revision,
    groupId: result.groups[0]!.id,
    otherGroupId: result.groups[1]!.id,
    lineId: line!.id,
    submissionId: newId(),
  };
}
function command(app: Hono, action: Action, p: Awaited<ReturnType<typeof prepare>>) {
  const base = `/api/parties/${p.partyId}/groups`;
  const common = {
    submissionId: p.submissionId,
    expectedPartyRevision: p.revision,
    operatorId: v.adminId,
    personId: v.adminId,
    at: "2026-01-06T22:00:00Z",
  };
  if (action === "submit" || action === "join")
    return send(app, v.cookie, "POST", base, {
      ...common,
      groups: [{ release: "hold", lines: [{ menuItemId: v.offerFor("Caña"), quantity: "1" }] }],
      ...(action === "join" ? { joinGroupId: p.groupId } : {}),
    });
  if (action === "fire") return send(app, v.cookie, "POST", `${base}/${p.groupId}/fire`, common);
  if (action === "reorder")
    return send(app, v.cookie, "PUT", `${base}/order`, {
      ...common,
      heldGroupIds: [p.otherGroupId, p.groupId],
    });
  if (action === "split")
    return send(app, v.cookie, "POST", `${base}/split-line`, { ...common, lineId: p.lineId });
  return send(app, v.cookie, "POST", `${base}/move`, {
    ...common,
    moves: [{ lineId: p.lineId, quantity: "1" }],
    target: { groupId: p.otherGroupId },
  });
}
async function state() {
  return {
    orders: await suite.db.select().from(workingOrders),
    lines: await suite.db.select().from(workingOrderLines),
    groups: await suite.db.select().from(orderGroups),
    events: await suite.db.select().from(orderGroupEvents),
    parties: await suite.db.select().from(parties),
    commands: await suite.db.select().from(serviceCommands),
    facts: await suite.db.select().from(attendanceOperationFacts),
    days: await suite.db.select().from(attendanceDayWork),
  };
}
describe("accepted group attendance snapshots", () => {
  it.each(actions)(
    "%s retains the admitted worker and trusted instant once, replacing the retained event",
    async (action) => {
      const p = await prepare(),
        app = api(recordAttendanceFact);
      expect(await command(app, action, p)).toMatchObject({ status: 200 });
      const saved = await state();
      const event = saved.events.find((e) => e.actorId === v.operatorId)!;
      expect(saved.facts).toEqual([
        expect.objectContaining({
          source: "draft",
          key: `group:${event.id}`,
          kind: "order",
          personId: v.operatorId,
          locationId: v.cfg.locationId,
          at: "2026-01-05T16:40:00.000Z",
          outcome: "qualifying",
        }),
      ]);
      expect(saved.days.map((r) => r.dirtyRevision)).toEqual([1]);
      const facts = await withTransaction(suite.db, (tx) =>
        readAttendanceFacts(tx, {
          locationId: v.cfg.locationId,
          businessDay: "2026-01-05",
          startAt: "2026-01-05T00:00:00Z",
          endAt: "2026-01-06T00:00:00Z",
        }),
      );
      expect(facts.filter((f) => f.personId === v.operatorId && f.kind === "order")).toEqual([
        expect.objectContaining({ key: `group:${event.id}`, at: "2026-01-05T16:40:00.000Z" }),
      ]);
      vi.spyOn(v.clock, "now").mockImplementation(() => {
        throw new Error("replay clock read");
      });
      expect(await command(app, action, p)).toMatchObject({ status: 200 });
      expect(await state()).toEqual(saved);
    },
  );
  it.each(actions)("%s rolls its accepted command back if capture is refused", async (action) => {
    const p = await prepare(),
      before = await state();
    const reject: AttendanceRecorder = async () => {
      throw new AppError("attendance.invalid", { reason: "capture refused" });
    };
    expect(await command(api(reject), action, p)).toMatchObject({
      status: 400,
      json: { code: "attendance.invalid" },
    });
    expect(await state()).toEqual(before);
  });
  it("a captured group keeps its original location when its party's bills move", async () => {
    const p = await prepare();
    expect(await command(api(recordAttendanceFact), "fire", p)).toMatchObject({ status: 200 });
    const [other] = await suite.db
      .insert(locations)
      .values({ name: "Elsewhere", invoiceLocales: ["es-ES"], operationDescription: "Restaurant" })
      .returning();
    await suite.db
      .update(workingOrders)
      .set({ locationId: other!.id })
      .where(eq(workingOrders.partyId, p.partyId));
    const facts = await withTransaction(suite.db, (tx) =>
      readAttendanceFacts(tx, {
        locationId: v.cfg.locationId,
        businessDay: "2026-01-05",
        startAt: "2026-01-05T00:00:00Z",
        endAt: "2026-01-06T00:00:00Z",
      }),
    );
    expect(facts.filter((f) => f.personId === v.operatorId && f.kind === "order")).toEqual([
      expect.objectContaining({ locationId: v.cfg.locationId, at: "2026-01-05T16:40:00.000Z" }),
    ]);
  });
  it("a device-only release is not attributed to the command's operator", async () => {
    const p = await prepare();
    await withTransaction(suite.db, (tx) =>
      fireGroup(
        tx,
        v.cfg,
        p.partyId,
        p.groupId,
        {
          submissionId: p.submissionId,
          expectedPartyRevision: p.revision,
          operatorId: v.operatorId,
        },
        { deviceId: v.deviceId },
        { recorder: recordAttendanceFact, clock: v.clock },
      ),
    );
    expect((await state()).facts).toEqual([]);
    expect((await state()).groups.find((g) => g.id === p.groupId)!.state).toBe("fired");
  });
  it.each(actions)(
    "%s without workforce capture preserves the existing command",
    async (action) => {
      const p = await prepare();
      expect(await command(api(), action, p)).toMatchObject({ status: 200 });
      expect((await state()).facts).toEqual([]);
    },
  );
});
