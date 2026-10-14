import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { newId, sales, tenders, withTransaction, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { persons } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { attendanceDayWork, attendanceOperationFacts } from "@waitron/workforce";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";
import { readAttendanceFacts } from "./attendance-facts.js";
import { collectOrder, payWorkingOrder, recordTillSale } from "./till-sale.js";
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
  v = await setupPartyVenue(suite.db);
  await suite.db
    .insert(persons)
    .values({ id: OPERATOR, displayName: "Invoice author", pinHash: "scrypt$00$00" });
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
const operations = () => suite.db.select().from(attendanceOperationFacts);
const tender = (method: "cash" | "card") => ({
  method,
  amount: "20.00",
  ...(method === "card" ? { externalRef: "hand keyed" } : {}),
});
const request = (id: string = newId()) => ({
  workingOrderId: id,
  zoneId: v.counter.zoneId,
  lines: [{ menuItemId: v.counterItem("Burger"), quantity: "1" }],
  tender: tender("cash"),
});
function evidence(key: string) {
  return {
    sequence: 1,
    source: "whole-payment",
    key,
    personId: collector.personId,
    locationId: v.cfg.locationId,
    kind: "payment",
    at: "2026-01-05T11:00:00.000Z",
    offsetMinutes: 60,
    businessDay: "2026-01-05",
    outcome: "qualifying",
  };
}
async function bill(issued = false) {
  const { tabId } = await seat(v, await v.table("Attendance collection"));
  await order(v, tabId, "Burger");
  await placeByHand(v, tabId);
  if (issued) await issueOrderInvoice(deps(), v.cfg, tabId, OPERATOR);
  return tabId;
}

describe("accepted whole-order payment attendance", () => {
  it("an unattributed orchestration does not invent a collector", async () => {
    at();
    const req = request();
    const ticket = await payWorkingOrder(deps(), v.cfg, {
      id: req.workingOrderId,
      lines: req.lines,
      zoneId: req.zoneId,
      tender: req.tender,
    });
    expect(ticket.total).toBe("12.00");
    expect(await operations()).toEqual([]);
    expect(await suite.db.select().from(attendanceDayWork)).toEqual([]);
  });

  it.each(["counter", "collection"] as const)(
    "a %s replay does not consult a new action clock",
    async (path) => {
      const id = path === "collection" ? await bill(true) : newId();
      at();
      const pay = () =>
        path === "collection"
          ? collectOrder(deps(), v.cfg, { id, lines: [], tender: tender("cash") }, collector)
          : recordTillSale(deps(), v.cfg, request(id), collector);
      const first = await pay();
      const before = await operations();
      vi.spyOn(v.clock, "now").mockImplementation(() => {
        throw new Error("Current clock unavailable");
      });
      expect(await pay()).toEqual(first);
      expect(await operations()).toEqual(before);
      expect(before).toHaveLength(1);
    },
  );

  it.each(["cash", "card"] as const)(
    "captures a %s counter sale from the collector",
    async (method) => {
      at();
      const req = { ...request(), tender: tender(method) };
      const ticket = await recordTillSale(deps(), v.cfg, req, collector);
      expect(ticket.total).toBe("12.00");
      expect(ticket.tender).toEqual(
        method === "cash"
          ? { method: "cash", change: "8.00" }
          : { method: "card", charged: "12.00", tip: "0.00", reference: "hand keyed" },
      );
      expect(await operations()).toEqual([evidence(req.workingOrderId)]);
    },
  );
  it("captures a retrieved open order from the paying worker", async () => {
    const { tabId } = await seat(v, await v.table("Retrieved attendance"));
    await order(v, tabId, "Burger");
    at();
    const ticket = await recordTillSale(deps(), v.cfg, { ...request(tabId), lines: [] }, collector);
    expect(ticket.total).toBe("12.00");
    expect(await operations()).toEqual([evidence(tabId)]);
  });
  it.each([false, true])(
    "captures placed collection (issued=%s) without crediting the invoice author",
    async (issued) => {
      const id = await bill(issued);
      const before = await suite.db.select().from(sales);
      at();
      const ticket = await collectOrder(
        deps(),
        v.cfg,
        { id, lines: [], tender: tender("cash") },
        collector,
      );
      expect(ticket.total).toBe("12.00");
      expect(await operations()).toEqual([evidence(id)]);
      const after = await suite.db.select().from(sales);
      expect(after).toHaveLength(1);
      if (issued) expect(after).toEqual(before);
      const facts = await withTransaction(suite.db, (tx) =>
        readAttendanceFacts(tx, {
          locationId: v.cfg.locationId,
          businessDay: "2026-01-05",
          startAt: "2026-01-05T04:00:00.000Z",
          endAt: "2026-01-06T04:00:00.000Z",
        }),
      );
      expect(facts.filter((f) => f.kind === "payment").map((f) => [f.personId, f.at])).toEqual([
        [collector.personId, "2026-01-05T11:00:00.000Z"],
      ]);
    },
  );
  it("replays a counter sale without new attendance or a later instant", async () => {
    const req = request();
    at();
    const first = await recordTillSale(deps(), v.cfg, req, collector);
    const before = await operations();
    at("2026-01-06T18:00:00Z");
    expect(await recordTillSale(deps(), v.cfg, req, v.operator)).toEqual(first);
    expect(await operations()).toEqual(before);
    expect(before).toHaveLength(1);
    expect((await suite.db.select().from(attendanceDayWork)).map((r) => r.businessDay)).toEqual([
      "2026-01-05",
    ]);
  });
  it("replays a placed collection without crediting the retrying worker", async () => {
    const id = await bill(true);
    at();
    const req = { id, lines: [], tender: tender("cash") };
    const first = await collectOrder(deps(), v.cfg, req, collector);
    const before = await operations();
    at("2026-01-06T18:00:00Z");
    expect(await collectOrder(deps(), v.cfg, req, v.operator)).toEqual(first);
    expect(await operations()).toEqual(before);
    expect(before).toHaveLength(1);
  });
  it("a short tender writes neither a sale nor attendance", async () => {
    at();
    await expect(
      recordTillSale(
        deps(),
        v.cfg,
        { ...request(), tender: { method: "cash", amount: "1.00" } },
        collector,
      ),
    ).rejects.toMatchObject({ code: "sale.tender_shortfall" });
    expect(await operations()).toEqual([]);
    expect(await suite.db.select().from(sales)).toEqual([]);
    expect(await suite.db.select().from(attendanceDayWork)).toEqual([]);
  });
  it.each([false, true])(
    "evidence refusal rolls back the payment transaction (issued=%s)",
    async (issued) => {
      const id = issued ? await bill(true) : newId();
      const beforeSales = await suite.db.select().from(sales);
      at();
      const refusing: AttendanceRecorder = async (tx, fact) => {
        await recordAttendanceFact(tx, fact);
        throw new AppError("attendance.invalid", { reason: "capture refused" });
      };
      const payment = issued
        ? collectOrder(deps(refusing), v.cfg, { id, lines: [], tender: tender("cash") }, collector)
        : recordTillSale(deps(refusing), v.cfg, request(id), collector);
      await expect(payment).rejects.toMatchObject({ code: "attendance.invalid" });
      expect(await operations()).toEqual([]);
      expect(await suite.db.select().from(attendanceDayWork)).toEqual([]);
      expect(await suite.db.select().from(sales)).toEqual(beforeSales);
      expect(await suite.db.select().from(tenders)).toEqual([]);
      const rows = await suite.db.select().from(workingOrders).where(eq(workingOrders.id, id));
      expect(rows.map((r) => r.status)).toEqual(issued ? ["placed"] : []);
    },
  );
  it("without a recorder a counter sale writes no workforce operations", async () => {
    const ticket = await recordTillSale(
      { db: suite.db, backend: v.backend, clock: v.clock },
      v.cfg,
      request(),
      collector,
    );
    expect(ticket.total).toBe("12.00");
    expect(await operations()).toEqual([]);
    expect(await suite.db.select().from(attendanceDayWork)).toEqual([]);
  });
});
