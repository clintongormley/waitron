import { testTradingAdmission } from "./testing/trading-admission.js";
import { closingEditsForTest } from "./testing/party-close-fixture.js";
import { placeOrder } from "./testing/order-writer-fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  orderAmendments,
  parties,
  printJobs,
  ticketItems,
  unpaidDepartures,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { AppError } from "@waitron/shared";
import { attendanceDayWork, attendanceOperationFacts } from "@waitron/workforce";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";
import { mountTillApi } from "./till-api.js";
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
describe("remaining accepted order attendance", () => {
  it.each([false, true])(
    "unpaid departure from a previously placed bill captures the reporting worker (refused: %s)",
    async (refused) => {
      const p = await seatedWith(v, "House salad");
      await placeOrder(
        { admission: testTradingAdmission(), db: suite.db, backend: v.backend, clock: v.clock },
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
          billId: p.tabId,
          expectedEdits: await closingEditsForTest(suite.db, p.partyId),
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
