import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newId } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";

import { FakePaymentProvider } from "@waitron/payments/src/testing/fake-provider.js";

import { staffActivity } from "@waitron/workforce";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";

import {
  payWorkingOrderIntegrated,
  type IntegratedPayRequest,
} from "./testing/whole-payment-fixture.js";
import { setupPartyVenue, OPERATOR, type PartyVenue } from "./testing/party-venue.js";

import { openTillSession } from "./testing/session-device.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let v: PartyVenue,
  provider: FakePaymentProvider,
  collector: { personId: string; sessionId: string };
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-05T10:00:00Z"));
  await seedPersons(suite.db, {
    id: OPERATOR,
    displayName: "Order author",
    pinHash: "scrypt$00$00",
  });
  v = await setupPartyVenue(suite.db);
  provider = new FakePaymentProvider(suite.db);

  const [worker] = await seedPersons(suite.db, {
    displayName: "Collector",
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
  provider,
  attendance,
});
function at(instant = "2026-01-05T11:00:00.987Z") {
  const reading = v.clock.now();
  vi.spyOn(v.clock, "now").mockReturnValue({ ...reading, instant: new Date(instant) });
}

const request = (): IntegratedPayRequest => ({
  id: newId(),
  zoneId: v.counter.zoneId,
  lines: [{ menuItemId: v.counterItem("Burger"), quantity: "1" }],
});

it("a card initiation records its collector without keeping per-attempt discovery state", async () => {
  at("2026-01-05T11:00:00Z");
  const result = await payWorkingOrderIntegrated(
    { ...deps(), admission: testTradingAdmission() },
    v.cfg,
    request(),
    collector,
  );
  expect(result.outcome).toBe("captured");
  expect(await suite.db.select().from(staffActivity)).toMatchObject([
    { personId: collector.personId, firstAt: "2026-01-05T11:00:00.000Z" },
  ]);
});
