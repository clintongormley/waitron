import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newId, sales, tenders, withTransaction, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { persons } from "@waitron/identity";
import { payments, captureAttempting } from "@waitron/payments";
import { paymentPolicy } from "@waitron/payments/src/schema/payment-policy.js";
import { FakePaymentProvider } from "@waitron/payments/src/testing/fake-provider.js";
import { AppError } from "@waitron/shared";
import { attendanceDayWork, attendanceOperationFacts } from "@waitron/workforce";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";
import { readAttendanceFacts } from "./attendance-facts.js";
import {
  payWorkingOrderIntegrated,
  payWorkingOrderIntegratedOrchestration,
  type IntegratedPayRequest,
} from "./testing/whole-payment-fixture.js";
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
let v: PartyVenue,
  provider: FakePaymentProvider,
  collector: { personId: string; sessionId: string };
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-05T10:00:00Z"));
  v = await setupPartyVenue(suite.db);
  provider = new FakePaymentProvider(suite.db);
  await suite.db
    .insert(persons)
    .values({ id: OPERATOR, displayName: "Order author", pinHash: "scrypt$00$00" });
  const [worker] = await suite.db
    .insert(persons)
    .values({ displayName: "Collector", pinHash: "scrypt$00$00" })
    .returning({ id: persons.id });
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
const operations = () => suite.db.select().from(attendanceOperationFacts);
const request = (): IntegratedPayRequest => ({
  id: newId(),
  zoneId: v.counter.zoneId,
  lines: [{ menuItemId: v.counterItem("Burger"), quantity: "1" }],
});
async function bill(issued: boolean) {
  const { tabId } = await seat(v, await v.table("Integrated attendance"));
  await order(v, tabId, "Burger");
  await placeByHand(v, tabId);
  if (issued) await issueOrderInvoice(deps(), v.cfg, tabId, OPERATOR);
  return { id: tabId, lines: [] };
}
function evidence(
  outcome: string,
  personId = collector.personId,
  instant = "2026-01-05T11:00:00.000Z",
) {
  return {
    source: "whole-payment",
    personId,
    locationId: v.cfg.locationId,
    kind: "payment",
    at: instant,
    offsetMinutes: 60,
    businessDay: "2026-01-05",
    outcome,
  };
}
async function paymentFacts() {
  return withTransaction(suite.db, async (tx) =>
    (
      await readAttendanceFacts(tx, {
        locationId: v.cfg.locationId,
        businessDay: "2026-01-05",
        startAt: "2026-01-05T04:00:00.000Z",
        endAt: "2026-01-06T04:00:00.000Z",
      })
    ).filter((f) => f.kind === "payment"),
  );
}

describe("integrated whole-order attendance", () => {
  it.each(["counter", "placed", "issued"] as const)(
    "records the original %s request before charging and qualifies it after a delayed result",
    async (path) => {
      const req = path === "counter" ? request() : await bill(path === "issued");
      at();
      const collect = provider.collect.bind(provider);
      vi.spyOn(provider, "collect").mockImplementation(async (params) => {
        expect(await operations()).toEqual([
          { sequence: 1, key: expect.any(String), ...evidence("pending") },
        ]);
        expect(await paymentFacts()).toEqual([]);
        at("2026-01-06T18:00:00Z");
        return collect(params);
      });
      const result = await payWorkingOrderIntegrated(deps(), v.cfg, req, collector);
      expect(result.outcome).toBe("captured");
      const rows = await operations();
      expect(rows).toEqual([{ sequence: 1, key: expect.any(String), ...evidence("qualifying") }]);
      expect((await paymentFacts()).map((f) => [f.personId, f.at])).toEqual([
        [collector.personId, "2026-01-05T11:00:00.000Z"],
      ]);
      expect((await suite.db.select().from(attendanceDayWork)).map((r) => r.businessDay)).toEqual([
        "2026-01-05",
      ]);
      at("2026-01-07T18:00:00Z");
      expect(await payWorkingOrderIntegrated(deps(), v.cfg, req, v.operator)).toEqual(result);
      expect(await operations()).toEqual(rows);
      expect(provider.collectCalls).toHaveLength(1);
    },
  );

  it("keeps a declined attempt separate from a later successful worker request", async () => {
    const req = request();
    at();
    provider.failNextCollect();
    expect(await payWorkingOrderIntegrated(deps(), v.cfg, req, collector)).toEqual({
      outcome: "declined",
    });
    const [refused] = await operations();
    expect(refused).toEqual({ sequence: 1, key: expect.any(String), ...evidence("refused") });
    expect(await paymentFacts()).toEqual([]);
    at("2026-01-05T15:00:00Z");
    expect((await payWorkingOrderIntegrated(deps(), v.cfg, req, v.operator)).outcome).toBe(
      "captured",
    );
    expect(await operations()).toEqual([
      refused,
      {
        sequence: 2,
        key: expect.any(String),
        ...evidence("qualifying", OPERATOR, "2026-01-05T15:00:00.000Z"),
      },
    ]);
    expect((await operations())[1]!.key).not.toBe(refused!.key);
    expect((await paymentFacts()).map((f) => [f.personId, f.at])).toEqual([
      [OPERATOR, "2026-01-05T15:00:00.000Z"],
    ]);
  });

  it("replaces an abandoned request with no provider row before another worker retries", async () => {
    const req = request();
    at();
    const interrupted = vi
      .spyOn(provider, "collect")
      .mockRejectedValueOnce(new Error("transport stopped before row"));
    await expect(payWorkingOrderIntegrated(deps(), v.cfg, req, collector)).rejects.toThrow(
      "transport stopped before row",
    );
    const [old] = await operations();
    expect(old).toMatchObject(evidence("pending"));
    expect(await suite.db.select().from(payments)).toEqual([]);
    interrupted.mockRestore();
    at("2026-01-05T15:00:00Z");
    expect((await payWorkingOrderIntegrated(deps(), v.cfg, req, v.operator)).outcome).toBe(
      "captured",
    );
    expect(await operations()).toEqual([
      { ...old, outcome: "refused" },
      {
        sequence: 2,
        key: expect.any(String),
        ...evidence("qualifying", OPERATOR, "2026-01-05T15:00:00.000Z"),
      },
    ]);
    expect((await paymentFacts()).map((f) => [f.personId, f.at])).toEqual([
      [OPERATOR, "2026-01-05T15:00:00.000Z"],
    ]);
  });

  it.each([false, true])(
    "a captured crash recovers the original collector (issued=%s)",
    async (issued) => {
      const req = await bill(issued);
      at();
      provider.crashNextCollect("captured");
      await expect(payWorkingOrderIntegrated(deps(), v.cfg, req, collector)).rejects.toThrow(
        "fake provider",
      );
      expect(await operations()).toEqual([
        { sequence: 1, key: expect.any(String), ...evidence("pending") },
      ]);
      at("2026-01-06T18:00:00Z");
      const recovered = await payWorkingOrderIntegratedOrchestration(deps(), v.cfg, req, OPERATOR);
      expect(recovered.outcome).toBe("captured");
      expect(await operations()).toEqual([
        { sequence: 1, key: expect.any(String), ...evidence("qualifying") },
      ]);
      expect(provider.collectCalls).toHaveLength(1);
    },
  );

  it("a timed-out request stays pending until its captured recovery", async () => {
    const req = request();
    at();
    provider.stallNextCollect();
    expect(await payWorkingOrderIntegrated(deps(), v.cfg, req, collector)).toEqual({
      outcome: "timeout",
    });
    expect(await operations()).toEqual([
      { sequence: 1, key: expect.any(String), ...evidence("pending") },
    ]);
    expect(await paymentFacts()).toEqual([]);
    const [row] = await suite.db.select().from(payments);
    await withTransaction(suite.db, (tx) =>
      captureAttempting(tx, {
        provider: provider.provider,
        paymentRef: row!.paymentRef,
        settledAt: new Date("2026-01-06T18:00:00Z"),
        externalRef: "late processor capture",
      }),
    );
    at("2026-01-06T18:00:00Z");
    expect(
      (await payWorkingOrderIntegratedOrchestration(deps(), v.cfg, req, OPERATOR)).outcome,
    ).toBe("captured");
    expect(await operations()).toEqual([
      { sequence: 1, key: expect.any(String), ...evidence("qualifying") },
    ]);
  });

  it("parallel recovery appends one qualified fact and never a manager activity instant", async () => {
    const req = request();
    at();
    provider.crashNextCollect("captured");
    await expect(payWorkingOrderIntegrated(deps(), v.cfg, req, collector)).rejects.toThrow(
      "fake provider",
    );
    at("2026-01-06T18:00:00Z");
    const outcomes = await Promise.all([
      payWorkingOrderIntegratedOrchestration(deps(), v.cfg, req, OPERATOR),
      payWorkingOrderIntegratedOrchestration(deps(), v.cfg, req, OPERATOR),
    ]);
    expect(outcomes[0]).toEqual(outcomes[1]);
    expect(outcomes[0]!.outcome).toBe("captured");
    expect(await operations()).toEqual([
      { sequence: 1, key: expect.any(String), ...evidence("qualifying") },
    ]);
    expect(await suite.db.select().from(sales)).toHaveLength(1);
  });

  it("legacy recovery with no request snapshot does not credit its current operator", async () => {
    const req = request();
    at();
    provider.crashNextCollect("captured");
    await expect(
      payWorkingOrderIntegrated(
        { db: suite.db, backend: v.backend, clock: v.clock, provider },
        v.cfg,
        req,
        collector,
      ),
    ).rejects.toThrow("fake provider");
    at("2026-01-06T18:00:00Z");
    expect(
      (await payWorkingOrderIntegratedOrchestration(deps(), v.cfg, req, OPERATOR)).outcome,
    ).toBe("captured");
    expect(await operations()).toEqual([]);
  });

  it("settled integrated replay does not read a new action clock", async () => {
    const req = request();
    at();
    const first = await payWorkingOrderIntegrated(deps(), v.cfg, req, collector);
    vi.spyOn(v.clock, "now").mockImplementation(() => {
      throw new Error("Current action clock unavailable");
    });
    expect(await payWorkingOrderIntegrated(deps(), v.cfg, req, collector)).toEqual(first);
    expect(await operations()).toHaveLength(1);
  });

  it.each([false, true])(
    "offline consent=%s activates only an accepted human request",
    async (accept) => {
      const req = { ...request(), allowOffline: accept };
      at();
      await suite.db
        .insert(paymentPolicy)
        .values({ offlineMode: "accept_offline", offlineAmountCap: 2000 });
      provider.offlineNextCollect();
      expect((await payWorkingOrderIntegrated(deps(), v.cfg, req, collector)).outcome).toBe(
        accept ? "captured" : "network_unavailable",
      );
      const before = await operations();
      expect(before).toEqual([
        { sequence: 1, key: expect.any(String), ...evidence(accept ? "qualifying" : "refused") },
      ]);
      if (accept) {
        const [payment] = await suite.db.select().from(payments);
        provider.declineForwardFor(payment!.paymentRef);
        await provider.forward(new Date("2026-01-06T18:00:00Z"));
        expect((await suite.db.select().from(payments))[0]!.state).toBe("declined");
        expect(await operations()).toEqual(before);
      }
    },
  );

  it("a snapshot refusal rolls back the start before any reader charge", async () => {
    const req = request();
    at();
    const refusing: AttendanceRecorder = async (tx, fact) => {
      await recordAttendanceFact(tx, fact);
      throw new AppError("attendance.invalid", { reason: "capture refused" });
    };
    await expect(
      payWorkingOrderIntegrated(deps(refusing), v.cfg, req, collector),
    ).rejects.toMatchObject({ code: "attendance.invalid" });
    expect(provider.collectCalls).toEqual([]);
    expect(await operations()).toEqual([]);
    expect(await suite.db.select().from(attendanceDayWork)).toEqual([]);
    expect(await suite.db.select().from(workingOrders)).toEqual([]);
  });

  it("a qualification refusal rolls back filing and recovery retains the snapshot", async () => {
    const req = request();
    at();
    const refusing: AttendanceRecorder = async (tx, fact) => {
      await recordAttendanceFact(tx, fact);
      if (fact.outcome === "qualified")
        throw new AppError("attendance.invalid", { reason: "qualification refused" });
    };
    await expect(
      payWorkingOrderIntegrated(deps(refusing), v.cfg, req, collector),
    ).rejects.toMatchObject({ code: "attendance.invalid" });
    expect(await suite.db.select().from(sales)).toEqual([]);
    expect(await suite.db.select().from(tenders)).toEqual([]);
    expect((await suite.db.select().from(payments)).map((r) => r.saleId)).toEqual([null]);
    expect(await operations()).toEqual([
      { sequence: 1, key: expect.any(String), ...evidence("pending") },
    ]);
    at("2026-01-06T18:00:00Z");
    expect(
      (await payWorkingOrderIntegratedOrchestration(deps(), v.cfg, req, OPERATOR)).outcome,
    ).toBe("captured");
    expect(await operations()).toEqual([
      { sequence: 1, key: expect.any(String), ...evidence("qualifying") },
    ]);
  });

  it("an unattributed orchestration captures money without inventing worker activity", async () => {
    at();
    expect((await payWorkingOrderIntegratedOrchestration(deps(), v.cfg, request())).outcome).toBe(
      "captured",
    );
    expect(await operations()).toEqual([]);
    expect(await suite.db.select().from(attendanceDayWork)).toEqual([]);
  });

  describe("workforce never migrated", () => {
    const withoutWorkforce = useVenueDb({
      migrations: migrationOptionsFor(
        manifestSets().filter((set) => set.name !== "workforce" && set.name !== "staffing"),
        null,
      ),
      timeoutMs: 60_000,
    });
    it("pays without a recorder or attendance tables", async () => {
      const venue = await setupPartyVenue(withoutWorkforce.db);
      const card = new FakePaymentProvider(withoutWorkforce.db);
      const result = await payWorkingOrderIntegrated(
        { db: withoutWorkforce.db, backend: venue.backend, clock: venue.clock, provider: card },
        venue.cfg,
        {
          id: newId(),
          zoneId: venue.counter.zoneId,
          lines: [{ menuItemId: venue.counterItem("Burger"), quantity: "1" }],
        },
        venue.operator,
      );
      expect(result.outcome).toBe("captured");
      await withTransaction(withoutWorkforce.db, async (tx) => {
        expect(
          (
            await tx.execute<{ name: string }>(
              "select name from sqlite_master where name like 'attendance_%' or name = 'time_entries'",
            )
          ).rows,
        ).toEqual([]);
      });
    });
  });
});
