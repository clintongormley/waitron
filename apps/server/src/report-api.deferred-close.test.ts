import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { departments, devices, drawerEntries, withTransaction } from "@waitron/db";
import { startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { mountReportApi } from "./report-api.js";
import { randomUUID } from "node:crypto";
import {
  clockAt,
  deferredCloseVenue,
  type DeferredCloseKit,
} from "./testing/deferred-close-fixture.js";
import { cashPayment, send } from "./testing/bill-venue.js";
import "./errors.js";

let t: DeferredCloseKit;
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-22T12:00:00.000Z"));
  t = await deferredCloseVenue(suite.db);
});
afterEach(() => vi.useRealTimers());

async function get(path: string) {
  const { token } = await withTransaction(t.venue.db, (tx) =>
    startManagementSession(tx, { method: "password", personId: t.venue.adminId }),
  );
  const app = new Hono();
  mountReportApi(
    app,
    { db: t.venue.db, cfg: { nodeId: t.venue.cfg.nodeId }, venueLocale: "es-ES" },
    () => {},
  );
  const res = await app.request(path, { headers: { cookie: `${MANAGEMENT_COOKIE}=${token}` } });
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown> & { businessDay: string };
}

function dayBefore(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

describe("reports, a bill closed as a deferred payment", () => {
  it("counts it once among the bills closed, apart from the money received", async () => {
    const deferredBill = await t.counterOrder("placed");
    await t.close(await t.requestFor(deferredBill, "18.00", null));
    const cash = await t.counterOrder("open");
    const cashPaid = await cashPayment(t.venue, t.venue.cookie, cash, "18.00");
    expect(cashPaid.status, JSON.stringify(cashPaid.json)).toBe(200);
    const card = await t.counterOrder("open");
    const paid = await send(
      t.venue.app,
      t.venue.cookie,
      "POST",
      `/api/working-orders/${card}/payments`,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "18.00",
        method: "card",
        entry: "reader",
        applied: "18.00",
        tip: "2.00",
        addedTip: "2.00",
      },
    );
    expect(paid).toMatchObject({ status: 200, json: { outcome: "received" } });

    const summary = {
      billsClosed: { count: 3, total: "54.00" },
      deferredPayments: "18.00",
      received: "38.00",
    };
    const overview = await get("/management-api/reports/overview");
    expect(overview.closureSummary).toEqual(summary);
    expect(overview.takings).toMatchObject({ tenderTotal: "56.00", grossTotal: "54.00" });
    expect(overview.counts).toMatchObject({ sales: 3 });

    const close = await get(
      `/management-api/reports/daily-close?businessDay=${overview.businessDay}`,
    );
    expect(close.closureSummary).toEqual(summary);
    expect(close.departmentTakings).toEqual(overview.departmentTakings);
    expect(close.departmentTakings).toEqual([
      expect.objectContaining({
        departmentName: expect.any(String),
        active: true,
        byMethod: [
          { method: "card", amount: "20.00", tip: "2.00" },
          { method: "cash", amount: "18.00", tip: "0.00" },
          { method: "deferred", amount: "18.00", tip: "0.00" },
        ],
        billsClosed: { count: 3, total: "54.00" },
      }),
    ]);
    const methods = (
      close.cash as { byOrigin: { byMethod: { method: string }[] }[] }
    ).byOrigin.flatMap((row) => row.byMethod.map((line) => line.method));
    expect(methods.sort()).toEqual(["card", "cash", "deferred"]);

    const before = await get(
      `/management-api/reports/daily-close?businessDay=${dayBefore(overview.businessDay)}`,
    );
    expect(before.closureSummary).toEqual({
      billsClosed: { count: 0, total: "0.00" },
      deferredPayments: "0.00",
      received: "0.00",
    });
  });
  it("reads the department name again after it changes", async () => {
    const order = await t.counterOrder("open");
    const paid = await cashPayment(t.venue, t.venue.cookie, order, "18.00");
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const overview = await get("/management-api/reports/overview");
    const path = `/management-api/reports/daily-close?businessDay=${overview.businessDay}`;
    const before = await get(path);
    const [department] = await t.venue.db.select().from(departments);
    await t.venue.db
      .update(departments)
      .set({ name: "Renamed dining" })
      .where(eq(departments.id, department!.id));
    const after = await get(path);
    expect(after.departmentTakings).toEqual([
      expect.objectContaining({ departmentName: "Renamed dining" }),
    ]);
    expect((await get("/management-api/reports/overview")).departmentTakings).not.toEqual(
      before.departmentTakings,
    );
    expect(after.closureSummary).toEqual(before.closureSummary);
  });
  it("updates an earlier date without revising a finished drawer close", async () => {
    const { venue } = t;
    const overview = await get("/management-api/reports/overview");
    const yesterday = dayBefore(overview.businessDay);
    const reportPath = `/management-api/reports/daily-close?businessDay=${yesterday}`;
    const [device] = await venue.db.select().from(devices).where(eq(devices.id, venue.deviceId));
    const printerId = device!.cashDrawerPrinterId!;
    const post = (path: string, body: Record<string, unknown>) =>
      send(venue.app, venue.cookie, "POST", path, body);
    expect(
      await post("/api/drawer/entries", {
        submissionId: randomUUID(),
        printerId,
        kind: "cash_in",
        amount: "10.00",
        reason: "Starting change",
      }),
    ).toMatchObject({ status: 200 });
    const count = await post("/api/drawer/close/count", {
      printerId,
      startSequence: 1,
      counted: "10.00",
    });
    expect(count.status).toBe(200);
    const first = count.json.first as { id: string };
    const done = await post(`/api/drawer/close/${first.id}/finish`, {
      confirmSequence: count.json.confirmSequence,
      amountLeft: "4.00",
    });
    expect(done).toMatchObject({ status: 200, json: { bankWithdrawal: "6.00" } });

    const drawerPath = `/management-api/reports/drawer-closes?from=${overview.businessDay}&to=${overview.businessDay}`;
    const drawerHistory = await get(drawerPath);
    expect(drawerHistory).toMatchObject({
      closes: [{ first: { counted: "10.00" }, finished: { bankWithdrawal: "6.00" } }],
    });
    expect((await get(reportPath)).closureSummary).toEqual({
      billsClosed: { count: 0, total: "0.00" },
      deferredPayments: "0.00",
      received: "0.00",
    });

    const order = await t.counterOrder("placed");
    const request = await t.requestFor(order, "18.00", null);
    const clock = clockAt(Date.parse(`${yesterday}T12:00:00Z`));
    expect(await t.close(request, t.depsWith({ clock }))).toMatchObject({ businessDay: yesterday });
    const cash = await t.counterOrder("open");
    const paid = await cashPayment(
      { db: venue.db, app: venue.appAt(clock) },
      venue.cookie,
      cash,
      "18.00",
    );
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect((await get(reportPath)).closureSummary).toEqual({
      billsClosed: { count: 2, total: "36.00" },
      deferredPayments: "18.00",
      received: "18.00",
    });
    expect(
      await venue.db
        .select({ kind: drawerEntries.kind, amount: drawerEntries.amount })
        .from(drawerEntries)
        .where(eq(drawerEntries.printerId, printerId))
        .orderBy(drawerEntries.sequence),
    ).toEqual([
      { kind: "cash_in", amount: 1000 },
      { kind: "count", amount: 1000 },
      { kind: "finish", amount: 600 },
      { kind: "cash_payment", amount: 1800 },
    ]);
    expect(await get(drawerPath)).toEqual(drawerHistory);
  });
});
