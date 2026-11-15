import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { newId } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";

import { SimulatorPaymentProvider } from "@waitron/payments";

import { staffActivity } from "@waitron/workforce";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";

import {
  takeBillPayment,
  takeReaderBillPayment,
  type BillPaymentRequest,
} from "./testing/bill-payment-fixture.js";

import { setupPartyVenue, seat, order, OPERATOR, type PartyVenue } from "./testing/party-venue.js";
import { openTillSession } from "./testing/session-device.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let v: PartyVenue, billId: string, collector: { personId: string; sessionId: string };
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-05T10:00:00Z"));
  v = await setupPartyVenue(suite.db);
  await seedPersons(suite.db, {
    id: OPERATOR,
    displayName: "Order author",
    pinHash: "scrypt$00$00",
  });
  const [worker] = await seedPersons(suite.db, {
    displayName: "Actual collector",
    pinHash: "scrypt$00$00",
  });
  collector = {
    personId: worker!.id,
    sessionId: await openTillSession(suite.db, {
      deviceId: v.cfg.origin.deviceId,
      personId: worker!.id,
    }),
  };
  ({ tabId: billId } = await seat(v, await v.table("Attendance payment")));
  await order(v, billId, "Burger");
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
function ask(card = false): BillPaymentRequest {
  return {
    submissionId: newId(),
    kind: "contribution",
    amount: "1.00",
    method: card ? "card" : "cash",
    ...(card ? { entry: "reader" as const } : { tendered: "1.00" }),
    applied: "1.00",
    tip: "0.00",
  };
}
function at(instant: string) {
  const reading = v.clock.now();
  vi.spyOn(v.clock, "now").mockReturnValue({ ...reading, instant: new Date(instant) });
}
const operations = () => suite.db.select().from(staffActivity);
const provider = () => new SimulatorPaymentProvider(suite.db);

function evidence() {
  return { personId: collector.personId, lastAt: "2026-01-05T11:00:00.000Z" };
}

describe("accepted bill payment attendance", () => {
  it.each(["cash", "manual"] as const)(
    "captures %s from its collector and trusted request time",
    async (method) => {
      at("2026-01-05T11:00:00.987Z");
      const request = method === "cash" ? ask() : { ...ask(true), entry: "manual" as const };
      const result = await takeBillPayment(
        { ...deps(), admission: testTradingAdmission() },
        v.cfg,
        billId,
        request,
        collector,
      );
      expect(result.payment.state).toBe("received");
      expect(result.balance.outstanding).toBe("11.00");
      expect(await operations()).toMatchObject([{ ...evidence() }]);
    },
  );
});

it("a reader initiation records its collector once and completion adds no activity", async () => {
  at("2026-01-05T11:00:00Z");
  const recorder = vi.fn(recordAttendanceFact);
  const result = await takeReaderBillPayment(
    { admission: testTradingAdmission(), ...deps(recorder), provider: provider() },
    v.cfg,
    billId,
    ask(true),
    collector,
  );
  expect(result.payment.state).toBe("received");
  expect(recorder).toHaveBeenCalledTimes(1);
  expect(await suite.db.select().from(staffActivity)).toMatchObject([
    { personId: collector.personId, firstAt: "2026-01-05T11:00:00.000Z" },
  ]);
});
