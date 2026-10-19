import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { billPayments, newId, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { persons } from "@waitron/identity";
import { SimulatorPaymentProvider } from "@waitron/payments";
import { AppError } from "@waitron/shared";
import { attendanceDayWork, attendanceOperationFacts } from "@waitron/workforce";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";
import { readAttendanceFacts } from "./attendance-facts.js";
import { completeBillPayment, failBillPayment } from "./bill-payments.js";
import {
  takeBillPayment,
  takeReaderBillPayment,
  type BillPaymentRequest,
} from "./testing/bill-payment-fixture.js";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
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
  await suite.db.insert(persons).values({
    id: OPERATOR,
    displayName: "Order author",
    pinHash: "scrypt$00$00",
  });
  const [worker] = await suite.db
    .insert(persons)
    .values({ displayName: "Actual collector", pinHash: "scrypt$00$00" })
    .returning({ id: persons.id });
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
const operations = () => suite.db.select().from(attendanceOperationFacts);
const provider = () => new SimulatorPaymentProvider(suite.db);
const reader = (p: SimulatorPaymentProvider, request = ask(true)) =>
  takeReaderBillPayment({ ...deps(), provider: p }, v.cfg, billId, request, collector);
function evidence(paymentId: string, outcome: string) {
  return {
    source: "bill-payment",
    key: paymentId,
    personId: collector.personId,
    locationId: v.cfg.locationId,
    kind: "payment",
    at: "2026-01-05T11:00:00.000Z",
    offsetMinutes: 60,
    businessDay: "2026-01-05",
    outcome,
  };
}

describe("accepted bill payment attendance", () => {
  it.each(["cash", "manual"] as const)(
    "captures %s from its collector and trusted request time",
    async (method) => {
      at("2026-01-05T11:00:00.987Z");
      const request = method === "cash" ? ask() : { ...ask(true), entry: "manual" as const };
      const result = await takeBillPayment(deps(), v.cfg, billId, request, collector);
      expect(result.payment.state).toBe("received");
      expect(result.balance.outstanding).toBe("11.00");
      expect(await operations()).toEqual([
        { sequence: 1, ...evidence(result.payment.id, "qualifying") },
      ]);
      const facts = await withTransaction(suite.db, (tx) =>
        readAttendanceFacts(tx, {
          locationId: v.cfg.locationId,
          businessDay: "2026-01-05",
          startAt: "2026-01-05T04:00:00.000Z",
          endAt: "2026-01-06T04:00:00.000Z",
        }),
      );
      expect(facts.filter((f) => f.kind === "payment")).toEqual([
        {
          source: "bill-payment",
          key: result.payment.id,
          personId: collector.personId,
          locationId: v.cfg.locationId,
          kind: "payment",
          at: "2026-01-05T11:00:00.000Z",
          offsetMinutes: 60,
        },
      ]);
    },
  );

  it("a cash replay neither captures again nor moves the original instant", async () => {
    at("2026-01-05T11:00:00Z");
    const request = ask();
    const first = await takeBillPayment(deps(), v.cfg, billId, request, collector);
    const before = await operations();
    at("2026-01-06T18:00:00Z");
    expect((await takeBillPayment(deps(), v.cfg, billId, request, collector)).payment.id).toBe(
      first.payment.id,
    );
    expect(await operations()).toEqual(before);
    expect(before).toHaveLength(1);
  });

  it("evidence failure rolls back the received payment and day work", async () => {
    at("2026-01-05T11:00:00Z");
    const rejected: AttendanceRecorder = async (tx, fact) => {
      await recordAttendanceFact(tx, fact);
      throw new AppError("attendance.invalid", { reason: "evidence failure" });
    };
    await expect(
      takeBillPayment(deps(rejected), v.cfg, billId, ask(), collector),
    ).rejects.toMatchObject({ code: "attendance.invalid" });
    expect(await suite.db.select().from(billPayments)).toEqual([]);
    expect(await operations()).toEqual([]);
    expect(await suite.db.select().from(attendanceDayWork)).toEqual([]);
  });

  it("without a recorder a payment succeeds without workforce operations", async () => {
    const result = await takeBillPayment(
      { db: suite.db, backend: v.backend, clock: v.clock },
      v.cfg,
      billId,
      ask(),
      collector,
    );
    expect(result.payment.state).toBe("received");
    expect(await operations()).toEqual([]);
    expect(await suite.db.select().from(attendanceDayWork)).toEqual([]);
  });

  it("records pending before collection and qualifies the original instant after delayed capture", async () => {
    at("2026-01-05T11:00:00Z");
    const p = provider();
    const collect = p.collect.bind(p);
    vi.spyOn(p, "collect").mockImplementation(async (params) => {
      expect(await operations()).toEqual([
        { sequence: 1, ...evidence(params.billPaymentId!, "pending") },
      ]);
      at("2026-01-06T18:00:00Z");
      return collect(params);
    });
    const result = await reader(p);
    expect(result.payment.state).toBe("received");
    expect(await operations()).toEqual([
      { sequence: 1, ...evidence(result.payment.id, "qualifying") },
    ]);
    expect((await suite.db.select().from(attendanceDayWork)).map((r) => r.businessDay)).toEqual([
      "2026-01-05",
    ]);
  });

  it("decline marks the request refused rather than qualifying it", async () => {
    at("2026-01-05T11:00:00Z");
    const result = await reader(provider(), { ...ask(true), simulationOutcome: "declined" });
    expect(result.payment.state).toBe("failed");
    expect(await operations()).toEqual([
      { sequence: 1, ...evidence(result.payment.id, "refused") },
    ]);
  });

  it("a refused reader start records refusal and an uncertain start keeps pending evidence", async () => {
    at("2026-01-05T11:00:00Z");
    const p = provider();
    vi.spyOn(p, "collect").mockRejectedValueOnce(
      new AppError("reader.not_held", { readerId: newId() }),
    );
    await expect(reader(p)).rejects.toMatchObject({ code: "reader.not_held" });
    const [failed] = await suite.db.select().from(billPayments);
    expect(failed!.state).toBe("failed");
    expect(await operations()).toEqual([{ sequence: 1, ...evidence(failed!.id, "refused") }]);
    vi.spyOn(p, "collect").mockRejectedValueOnce(new Error("transport disconnected"));
    await expect(reader(p)).rejects.toThrow("transport disconnected");
    const [pending] = await suite.db
      .select()
      .from(billPayments)
      .where(eq(billPayments.state, "pending"));
    expect((await operations()).find((r) => r.key === pending!.id)).toEqual({
      sequence: 2,
      ...evidence(pending!.id, "pending"),
    });
  });

  it("recovery completion preserves the requesting worker and time", async () => {
    at("2026-01-05T11:00:00Z");
    const p = provider();
    const collect = p.collect.bind(p);
    vi.spyOn(p, "collect").mockImplementation(async (params) => ({
      ...(await collect(params)),
      state: "attempting",
    }));
    const first = await reader(p);
    expect(first.payment.state).toBe("pending");
    at("2026-01-06T18:00:00Z");
    const pass = await settlePendingBillPayments({ ...deps(), cfg: v.cfg });
    expect(pass.received).toBe(1);
    expect(await operations()).toEqual([
      { sequence: 1, ...evidence(first.payment.id, "qualifying") },
    ]);
  });

  it("manual completion credits the initiator rather than the attesting manager", async () => {
    at("2026-01-05T11:00:00Z");
    const p = provider();
    vi.spyOn(p, "collect").mockRejectedValue(new Error("unknown outcome"));
    await expect(reader(p)).rejects.toThrow("unknown outcome");
    const [pending] = await suite.db.select().from(billPayments);
    await withTransaction(suite.db, (tx) =>
      completeBillPayment(tx, deps(), v.cfg, pending!.id, new Date("2026-01-06T18:00:00Z"), {
        attestedBy: OPERATOR,
        note: "Charged",
      }),
    );
    expect(await operations()).toEqual([{ sequence: 1, ...evidence(pending!.id, "qualifying") }]);
  });

  it("manual failure settles the original request evidence in the same transaction", async () => {
    at("2026-01-05T11:00:00Z");
    const p = provider();
    vi.spyOn(p, "collect").mockRejectedValue(new Error("unknown outcome"));
    await expect(reader(p)).rejects.toThrow("unknown outcome");
    const [pending] = await suite.db.select().from(billPayments);
    await withTransaction(suite.db, (tx) =>
      failBillPayment(
        tx,
        pending!.id,
        new Date("2026-01-06T18:00:00Z"),
        { attestedBy: OPERATOR, note: "Not charged" },
        recordAttendanceFact,
      ),
    );
    expect(await operations()).toEqual([{ sequence: 1, ...evidence(pending!.id, "refused") }]);
  });
});
