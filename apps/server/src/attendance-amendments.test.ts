import { closingEditsForTest } from "./testing/party-close-fixture.js";
import { placeOrder } from "./testing/order-writer-fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  locations,
  newId,
  orderAmendments,
  parties,
  sales,
  ticketItems,
  unpaidDepartures,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createPinThrottle, persons } from "@waitron/identity";
import { AppError, locationId } from "@waitron/shared";
import { attendanceDayWork, attendanceOperationFacts } from "@waitron/workforce";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";
import { readAttendanceFacts } from "./attendance-facts.js";
import { cancelPlacedOrder, markOrderPlaced, parkOrder } from "./working-order.js";
import { recordUnpaidDeparture } from "./unpaid-departure.js";
import { overridePinAttempts } from "./till-api.js";
import {
  setupPartyVenue,
  seat,
  orderForParty,
  revisionOf,
  OPERATOR,
  type PartyVenue,
} from "./testing/party-venue.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let v: PartyVenue, worker: string;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-05T09:00:00Z"));
  v = await setupPartyVenue(suite.db);
  await suite.db.insert(persons).values({
    id: OPERATOR,
    displayName: "Original author",
    pinHash: "scrypt$00$00",
    role: "admin",
  });
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: "Actual actor", pinHash: "scrypt$00$00" })
    .returning({ id: persons.id });
  worker = person!.id;
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
const deps = (attendance: AttendanceRecorder | undefined = recordAttendanceFact) => ({
  db: suite.db,
  backend: v.backend,
  clock: v.clock,
  attendance,
});
const run = <T>(body: Parameters<typeof withTransaction<T>>[1]) => withTransaction(suite.db, body);
const operator = (personId = worker) => ({
  personId,
  sessionId: v.operator.sessionId,
  attempts: overridePinAttempts(createPinThrottle(), "attendance"),
});
async function parked() {
  const id = newId();
  await parkOrder({ db: suite.db }, v.cfg, {
    id,
    operatorId: OPERATOR,
    zoneId: v.counter.zoneId,
    lines: [{ menuItemId: v.counterItem("Burger"), quantity: "1" }],
  });
  return id;
}
async function state() {
  return {
    orders: await suite.db.select().from(workingOrders),
    amendments: await suite.db.select().from(orderAmendments),
    tickets: await suite.db.select().from(ticketItems),
    facts: await suite.db.select().from(attendanceOperationFacts),
    days: await suite.db.select().from(attendanceDayWork),
    sales: await suite.db.select().from(sales),
    departures: await suite.db.select().from(unpaidDepartures),
    parties: await suite.db.select().from(parties),
  };
}
async function expectFact(id: string, kind: "order_placed" | "order_cancelled", actor = worker) {
  const rows = (
    await suite.db.select().from(orderAmendments).where(eq(orderAmendments.workingOrderId, id))
  ).filter((r) => r.kind === kind);
  expect(rows).toHaveLength(1);
  const amendment = rows[0]!;
  expect([amendment.actorId, amendment.eventAt]).toEqual([actor, "2026-01-05T16:40:00.000Z"]);
  expect(
    (await suite.db.select().from(attendanceOperationFacts)).map((r) => [
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
      amendment.id,
      actor,
      v.cfg.locationId,
      "order",
      "2026-01-05T16:40:00.000Z",
      60,
      "qualifying",
    ],
  ]);
  expect(
    (await suite.db.select().from(attendanceDayWork)).map((r) => [
      r.locationId,
      r.businessDay,
      r.dirtyRevision,
    ]),
  ).toEqual([[v.cfg.locationId, "2026-01-05", 1]]);
  const facts = await run((tx) =>
    readAttendanceFacts(tx, {
      locationId: v.cfg.locationId,
      businessDay: "2026-01-05",
      startAt: "2026-01-05T03:00:00.000Z",
      endAt: "2026-01-06T03:00:00.000Z",
    }),
  );
  expect(facts.filter((f) => f.source === "order" && f.key === amendment.id)).toEqual([
    {
      source: "order",
      key: amendment.id,
      personId: actor,
      locationId: v.cfg.locationId,
      kind: "order",
      at: "2026-01-05T16:40:00.000Z",
      offsetMinutes: 60,
    },
  ]);
}
const refuse: AttendanceRecorder = async (tx, fact) => {
  await recordAttendanceFact(tx, fact);
  throw new AppError("attendance.invalid", { reason: "amendment capture refused" });
};
async function act(
  action: "place" | "cancel",
  id: string,
  attendance: AttendanceRecorder = recordAttendanceFact,
) {
  if (action === "place") return placeOrder(deps(attendance), v.cfg, id, worker);
  return cancelPlacedOrder(deps(attendance), v.cfg, id, "Guest left", operator());
}
describe("amendment attendance in the command transaction", () => {
  it.each(["place", "cancel"] as const)(
    "%s retains the actor and exact amendment identity without a second activity",
    async (action) => {
      const id = await parked();
      if (action === "cancel")
        await placeOrder({ db: suite.db, backend: v.backend, clock: v.clock }, v.cfg, id, OPERATOR);
      await act(action, id);
      await expectFact(id, action === "place" ? "order_placed" : "order_cancelled");
      expect(
        (await suite.db.select().from(workingOrders).where(eq(workingOrders.id, id)))[0]!.status,
      ).toBe(action === "place" ? "placed" : "abandoned");
    },
  );
  it.each(["place", "cancel"] as const)(
    "a refused recorder rolls back %s including its amendment and kitchen work",
    async (action) => {
      const id = await parked();
      if (action === "cancel")
        await placeOrder({ db: suite.db, backend: v.backend, clock: v.clock }, v.cfg, id, OPERATOR);
      const before = await state();
      await expect(act(action, id, refuse)).rejects.toMatchObject({ code: "attendance.invalid" });
      expect(await state()).toEqual(before);
    },
  );
  it.each(["place", "cancel"] as const)(
    "a repeated %s is refused before reading a new activity clock",
    async (action) => {
      const id = await parked();
      if (action === "cancel")
        await placeOrder({ db: suite.db, backend: v.backend, clock: v.clock }, v.cfg, id, OPERATOR);
      await act(action, id);
      const before = await state();
      vi.spyOn(v.clock, "now").mockImplementation(() => {
        throw new Error("repeat amendment clock");
      });
      await expect(act(action, id)).rejects.toMatchObject({
        code: action === "place" ? "working_order.not_open" : "working_order.not_placed",
      });
      expect(await state()).toEqual(before);
    },
  );
  it("marking an order placed captures its stored location with the writer's original clock reading", async () => {
    const id = await parked();
    const [other] = await suite.db
      .insert(locations)
      .values({
        name: "Another venue",
        invoiceLocales: ["es-ES"],
        operationDescription: "Restaurant",
      })
      .returning({ id: locations.id });
    const now = v.clock.now();
    vi.spyOn(v.clock, "now")
      .mockReturnValueOnce(now)
      .mockImplementation(() => {
        throw new Error("second amendment clock");
      });
    await run((tx) =>
      markOrderPlaced(
        tx,
        v.clock,
        { ...v.cfg, locationId: locationId(other!.id) },
        id,
        worker,
        recordAttendanceFact,
      ),
    );
    await expectFact(id, "order_placed");
  });
  it("an empty cancellation reason changes neither command nor attendance", async () => {
    const id = await parked();
    await placeOrder({ db: suite.db, backend: v.backend, clock: v.clock }, v.cfg, id, OPERATOR);
    const before = await state();
    await expect(cancelPlacedOrder(deps(), v.cfg, id, " ", operator())).rejects.toMatchObject({
      code: "working_order.reason_required",
    });
    expect(await state()).toEqual(before);
  });
  it("legacy place and cancel omit attendance writes", async () => {
    const id = await parked();
    const legacy = { db: suite.db, backend: v.backend, clock: v.clock };
    await placeOrder(legacy, v.cfg, id, worker);
    await cancelPlacedOrder(legacy, v.cfg, id, "Guest left", operator());
    expect((await state()).facts).toEqual([]);
    expect((await state()).days).toEqual([]);
    expect((await state()).amendments.map((r) => r.kind)).toEqual([
      "order_placed",
      "order_cancelled",
    ]);
  });
  it.each([false, true])(
    "unpaid departure forwards amendment capture (refused: %s)",
    async (rejected) => {
      const { partyId, tabId } = await seat(v, await v.table("Unpaid attendance"));
      await orderForParty(v, partyId, ["Burger"], tabId);
      const before = await state();
      const expectedPartyRevision = await revisionOf(v, partyId);
      const command = () =>
        run(async (tx) =>
          recordUnpaidDeparture(
            tx,
            deps(rejected ? refuse : recordAttendanceFact),
            v.cfg,
            partyId,
            {
              expectedPartyRevision,
              expectedEdits: await closingEditsForTest(tx, partyId),
              reason: "Guests left",
            },
            operator(OPERATOR),
          ),
        );
      if (rejected) {
        await expect(command()).rejects.toMatchObject({ code: "attendance.invalid" });
        expect(await state()).toEqual(before);
      } else {
        expect(await command()).toMatchObject({
          state: "closed",
          departures: [{ workingOrderId: tabId, amount: "12.00" }],
        });
        await expectFact(tabId, "order_placed", OPERATOR);
      }
    },
  );
});

describe("amendments without workforce installed", () => {
  const withoutWorkforce = useVenueDb({
    migrations: migrationOptionsFor(
      manifestSets().filter((set) => set.name !== "workforce" && set.name !== "staffing"),
      null,
    ),
    timeoutMs: 60_000,
  });
  it("places and cancels with no attendance or time tables", async () => {
    const venue = await setupPartyVenue(withoutWorkforce.db);
    await withoutWorkforce.db
      .insert(persons)
      .values({ id: OPERATOR, displayName: "Worker", pinHash: "scrypt$00$00" });
    const id = newId();
    await parkOrder({ db: withoutWorkforce.db }, venue.cfg, {
      id,
      operatorId: OPERATOR,
      zoneId: venue.counter.zoneId,
      lines: [{ menuItemId: venue.counterItem("Burger"), quantity: "1" }],
    });
    const legacy = { db: withoutWorkforce.db, backend: venue.backend, clock: venue.clock };
    await placeOrder(legacy, venue.cfg, id, OPERATOR);
    await cancelPlacedOrder(legacy, venue.cfg, id, "Guest left", {
      ...venue.operator,
      attempts: overridePinAttempts(createPinThrottle(), "disabled"),
    });
    expect(
      (await withoutWorkforce.db.select().from(workingOrders).where(eq(workingOrders.id, id)))[0]!
        .status,
    ).toBe("abandoned");
    expect((await withoutWorkforce.db.select().from(orderAmendments)).map((r) => r.kind)).toEqual([
      "order_placed",
      "order_cancelled",
    ]);
    await withTransaction(withoutWorkforce.db, async (tx) => {
      const { rows } = await tx.execute<{ name: string }>(
        "select name from sqlite_master where name like 'attendance_%' or name = 'time_entries'",
      );
      expect(rows).toEqual([]);
    });
  });
});
