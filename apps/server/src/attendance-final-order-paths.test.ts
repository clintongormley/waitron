import { placeOrder } from "./testing/order-writer-fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  kitchenStations,
  newId,
  orderAmendments,
  parties,
  printJobs,
  ticketItems,
  unpaidDepartures,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { AppError } from "@waitron/shared";
import { attendanceDayWork, attendanceOperationFacts } from "@waitron/workforce";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";
import { createStation } from "./kitchen.js";
import { mountTillApi } from "./till-api.js";
import { sendToPrep } from "./working-order.js";
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
async function state() {
  return {
    orders: await suite.db.select().from(workingOrders),
    lines: await suite.db.select().from(workingOrderLines),
    amendments: await suite.db.select().from(orderAmendments),
    parties: await suite.db.select().from(parties),
    tickets: await suite.db.select().from(ticketItems),
    prints: await suite.db.select().from(printJobs),
    departures: await suite.db.select().from(unpaidDepartures),
    facts: await suite.db.select().from(attendanceOperationFacts),
    days: await suite.db.select().from(attendanceDayWork),
  };
}
async function awaitingPrep() {
  const station = await withTransaction(suite.db, (tx) =>
    createStation(tx, v.cfg, { name: "Prep", isDefault: true }),
  );
  await suite.db
    .update(kitchenStations)
    .set({ active: false })
    .where(eq(kitchenStations.id, station.id));
  const id = newId();
  expect(
    await send(v.app, v.cookie, "POST", "/api/sales", {
      workingOrderId: id,
      lines: [{ menuItemId: v.offerFor("Ensalada"), quantity: "1" }],
      tender: { method: "cash", amount: "12.00" },
    }),
  ).toMatchObject({ status: 200 });
  expect((await state()).tickets).toEqual([]);
  await suite.db
    .update(kitchenStations)
    .set({ active: true })
    .where(eq(kitchenStations.id, station.id));
  return id;
}
describe("remaining accepted order attendance", () => {
  it("a paid order's first legacy prep captures the admitted worker at the trusted command instant", async () => {
    const id = await awaitingPrep(),
      app = api(recordAttendanceFact);
    expect(
      await send(app, v.cookie, "POST", `/api/working-orders/${id}/prep`, {
        personId: v.adminId,
        at: "2026-01-06T22:00:00Z",
      }),
    ).toMatchObject({ status: 200 });
    const saved = await state();
    expect(saved.tickets).toHaveLength(1);
    expect(saved.facts).toEqual([
      expect.objectContaining({
        source: "order",
        personId: v.operatorId,
        locationId: v.cfg.locationId,
        kind: "order",
        at: "2026-01-05T16:40:00.000Z",
        outcome: "qualifying",
      }),
    ]);
    vi.spyOn(v.clock, "now").mockImplementation(() => {
      throw new Error("refused prep clock");
    });
    expect(await send(app, v.cookie, "POST", `/api/working-orders/${id}/prep`, {})).toMatchObject({
      status: 409,
      json: { code: "ticket.already_fired" },
    });
    expect(await state()).toEqual(saved);
  });
  it("legacy prep capture refusal rolls back sending and printing", async () => {
    const id = await awaitingPrep(),
      before = await state();
    expect(
      await send(
        api(async () => {
          throw new AppError("attendance.invalid", { reason: "capture refused" });
        }),
        v.cookie,
        "POST",
        `/api/working-orders/${id}/prep`,
        {},
      ),
    ).toMatchObject({ status: 400, json: { code: "attendance.invalid" } });
    expect(await state()).toEqual(before);
  });
  it("legacy prep without an admitted worker supplies no invented actor", async () => {
    const id = await awaitingPrep();
    await sendToPrep({ db: suite.db }, v.cfg, id);
    expect((await state()).tickets).toHaveLength(1);
    expect((await state()).facts).toEqual([]);
  });
  it.each([false, true])(
    "unpaid departure from a previously placed bill captures the reporting worker (refused: %s)",
    async (refused) => {
      const p = await seatedWith(v, "Ensalada");
      await placeOrder(
        { db: suite.db, backend: v.backend, clock: v.clock },
        v.cfg,
        p.tabId,
        v.adminId,
      );
      const [party] = await suite.db.select().from(parties).where(eq(parties.id, p.partyId));
      const before = await state();
      const recorder: AttendanceRecorder = async (tx, fact) => {
        await recordAttendanceFact(tx, fact);
        if (refused) throw new AppError("attendance.invalid", { reason: "capture refused" });
      };
      const response = await send(
        api(recorder),
        v.cookie,
        "POST",
        `/api/parties/${p.partyId}/unpaid-departure`,
        {
          expectedPartyRevision: party!.revision,
          reason: "Guests left",
          operatorId: v.adminId,
          override: { personId: v.adminId, pin: "1234" },
          at: "2026-01-06T22:00:00Z",
        },
      );
      if (refused) {
        expect(response).toMatchObject({ status: 400, json: { code: "attendance.invalid" } });
        expect(await state()).toEqual(before);
      } else {
        expect(response).toMatchObject({
          status: 200,
          json: { state: "closed", departures: [{ workingOrderId: p.tabId, amount: "12.00" }] },
        });
        const saved = await state();
        expect(saved.facts).toEqual([
          expect.objectContaining({
            source: "order",
            personId: v.operatorId,
            locationId: v.cfg.locationId,
            at: "2026-01-05T16:40:00.000Z",
            outcome: "qualifying",
          }),
        ]);
        expect(saved.amendments).toEqual(before.amendments);
        expect(saved.departures[0]!.recordedBy).toBe(v.operatorId);
      }
    },
  );
});
