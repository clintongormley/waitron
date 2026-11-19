import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { newId, sales } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";

import { staffActivity } from "@waitron/workforce";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";

import { takeBillPayment } from "./bill-payments.js";
import { paySavedBillInCash } from "./testing/bill-payment-fixture.js";
import {
  setupPartyVenue,
  seat,
  order,
  placeByHand,
  OPERATOR,
  type PartyVenue,
} from "./testing/party-venue.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { openTillSession } from "./testing/session-device.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let v: PartyVenue, collector: { personId: string; sessionId: string };
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-05T10:00:00Z"));
  await seedPersons(suite.db, {
    id: OPERATOR,
    displayName: "Invoice author",
    pinHash: "scrypt$00$00",
  });
  v = await setupPartyVenue(suite.db);

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
function at(instant = "2026-01-05T11:00:00.987Z") {
  const reading = v.clock.now();
  vi.spyOn(v.clock, "now").mockReturnValue({ ...reading, instant: new Date(instant) });
}
const operations = () => suite.db.select().from(staffActivity);
function evidence() {
  return { personId: collector.personId, lastAt: "2026-01-05T11:00:00.000Z" };
}
async function bill(issued = false) {
  const { tabId } = await seat(v, await v.table("Attendance collection"));
  await order(v, tabId, "Burger");
  await placeByHand(v, tabId);
  if (issued)
    await issueOrderInvoice(
      { ...deps(), admission: testTradingAdmission() },
      v.cfg,
      tabId,
      OPERATOR,
    );
  return tabId;
}

describe("accepted whole-order payment attendance", () => {
  it.each(["cash", "card"] as const)(
    "captures a %s counter sale from the collector",
    async (method) => {
      at();
      const id = newId();
      const paid = await takeBillPayment(
        { ...deps(), admission: testTradingAdmission() },
        v.cfg,
        id,
        {
          expectedEdit: null,
          submissionId: id,
          kind: "share",
          shareOf: 1,
          method,
          ...(method === "cash"
            ? { tendered: "20.00" }
            : { entry: "manual", externalRef: "hand keyed" }),
          applied: "0.00",
          tip: "0.00",
        },
        collector,
        {
          zoneId: v.counter.zoneId,
          lines: [{ menuItemId: v.counterItem("Burger"), quantity: "1" }],
        },
      );
      expect(paid.invoice?.total).toBe("12.00");
      expect(paid.invoice?.tender).toEqual(
        method === "cash"
          ? { method: "cash", change: "8.00" }
          : { method: "card", charged: "12.00", tip: "0.00", reference: "hand keyed" },
      );
      expect(await operations()).toMatchObject([evidence()]);
    },
  );
  it("captures a retrieved open order from the paying worker", async () => {
    const { tabId } = await seat(v, await v.table("Retrieved attendance"));
    await order(v, tabId, "Burger");
    at();
    const ticket = await paySavedBillInCash(
      { ...deps(), admission: testTradingAdmission() },
      v.cfg,
      collector,
      tabId,
      "20.00",
    );
    expect(ticket.total).toBe("12.00");
    expect(await operations()).toMatchObject([evidence()]);
  });
  it.each([false, true])(
    "captures placed collection (issued=%s) without crediting the invoice author",
    async (issued) => {
      const id = await bill(issued);
      const before = await suite.db.select().from(sales);
      at();
      const ticket = await paySavedBillInCash(
        { ...deps(), admission: testTradingAdmission() },
        v.cfg,
        collector,
        id,
        "20.00",
      );
      expect(ticket.total).toBe("12.00");
      expect(await operations()).toMatchObject([evidence()]);
      const after = await suite.db.select().from(sales);
      expect(after).toHaveLength(1);
      if (issued) expect(after).toEqual(before);
    },
  );
});
