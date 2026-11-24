import { persons, withFoldedPersonChanges } from "@waitron/db";
import { seedPersons, setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { testTradingAdmission } from "./testing/trading-admission.js";

import { placeOrder } from "./testing/order-writer-fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { newId, orderAmendments, withTransaction, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createPinThrottle } from "@waitron/identity";

import { attendanceDays, staffActivity } from "@waitron/workforce";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";
import { readAttendanceFacts } from "./attendance-facts.js";
import { cancelPlacedOrder, markOrderPlaced } from "./working-order-counter.js";
import { parkOrder } from "./working-order-open.js";

import { overridePinAttempts } from "./till-api.js";
import { setupPartyVenue, OPERATOR, type PartyVenue } from "./testing/party-venue.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let v: PartyVenue, worker: string;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-05T09:00:00Z"));
  v = await setupPartyVenue(suite.db);
  await suite.db
    .update(persons)
    .set(withFoldedPersonChanges({ displayName: "Original author", pinHash: "scrypt$00$00" }))
    .where(eq(persons.id, OPERATOR));
  await setBuiltInRoleForTest(suite.db, OPERATOR, "admin");
  const [person] = await seedPersons(suite.db, {
    displayName: "Actual actor",
    pinHash: "scrypt$00$00",
  });
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

async function expectFact(id: string, kind: "order_placed" | "order_cancelled", actor = worker) {
  const rows = (
    await suite.db.select().from(orderAmendments).where(eq(orderAmendments.workingOrderId, id))
  ).filter((r) => r.kind === kind);
  expect(rows).toHaveLength(1);
  const amendment = rows[0]!;
  expect([amendment.actorId, amendment.eventAt]).toEqual([actor, "2026-01-05T16:40:00.000Z"]);
  expect(
    (await suite.db.select().from(staffActivity)).map((row) => [row.personId, row.lastAt]),
  ).toEqual([[actor, "2026-01-05T16:40:00.000Z"]]);
  expect(
    (await suite.db.select().from(attendanceDays)).map((r) => [r.businessDay, r.dirtyRevision]),
  ).toEqual([["2026-01-05", 1]]);
  await run((tx) =>
    readAttendanceFacts(tx, {
      businessDay: "2026-01-05",
      startAt: "2026-01-05T03:00:00.000Z",
      endAt: "2026-01-06T03:00:00.000Z",
    }),
  );
}

async function act(
  action: "place" | "cancel",
  id: string,
  attendance: AttendanceRecorder = recordAttendanceFact,
) {
  if (action === "place")
    return placeOrder(
      { ...deps(attendance), admission: testTradingAdmission() },
      v.cfg,
      id,
      worker,
    );
  return cancelPlacedOrder(
    { ...deps(attendance), admission: testTradingAdmission() },
    v.cfg,
    id,
    "Guest left",
    operator(),
  );
}
describe("amendment attendance in the command transaction", () => {
  it.each(["place", "cancel"] as const)(
    "%s retains the actor and exact amendment identity without a second activity",
    async (action) => {
      const id = await parked();
      if (action === "cancel")
        await placeOrder(
          { admission: testTradingAdmission(), db: suite.db, backend: v.backend, clock: v.clock },
          v.cfg,
          id,
          OPERATOR,
        );
      await act(action, id);
      await expectFact(id, action === "place" ? "order_placed" : "order_cancelled");
      expect(
        (await suite.db.select().from(workingOrders).where(eq(workingOrders.id, id)))[0]!.status,
      ).toBe(action === "place" ? "placed" : "abandoned");
    },
  );
  it("marking an order placed captures the writer's original clock reading", async () => {
    const id = await parked();
    const now = v.clock.now();
    vi.spyOn(v.clock, "now")
      .mockReturnValueOnce(now)
      .mockImplementation(() => {
        throw new Error("second amendment clock");
      });
    await run((tx) => markOrderPlaced(tx, v.clock, v.cfg, id, worker, recordAttendanceFact));
    await expectFact(id, "order_placed");
  });
});
