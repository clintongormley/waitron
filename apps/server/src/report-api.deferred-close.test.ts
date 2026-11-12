import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { departments, withTransaction } from "@waitron/db";
import { startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { mountReportApi } from "./report-api.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { deferredCloseVenue, type DeferredCloseKit } from "./testing/deferred-close-fixture.js";
import {
  payWorkingOrder,
  payWorkingOrderIntegratedOrchestration,
} from "./testing/whole-payment-fixture.js";
import "./errors.js";

// Its own database: the case closes bills in today's business day, which the overview reads.
let t: DeferredCloseKit;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    t = await deferredCloseVenue(db);
  },
});

async function get(path: string) {
  const { token } = await withTransaction(t.venue.db, (tx) =>
    startManagementSession(tx, { personId: t.venue.adminId }),
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
    const deps = { db: t.venue.db, backend: t.venue.backend, clock: t.venue.clock };
    const deferredBill = await t.counterOrder("placed");
    await t.close(await t.requestFor(deferredBill, "18.00", null));
    const cash = await t.counterOrder("open");
    await payWorkingOrder({ ...deps, admission: testTradingAdmission() }, t.venue.cfg, {
      id: cash,
      tender: { method: "cash", amount: "18.00" },
      lines: [],
    });
    // The manual card tender takes no tip; the reader path does, with tips on.
    const card = await t.counterOrder("open");
    const paid = await payWorkingOrderIntegratedOrchestration(
      { ...deps, admission: testTradingAdmission(), provider: t.venue.card },
      { ...t.venue.cfg, tipsEnabled: true },
      { id: card, lines: [], tip: "2.00" },
    );
    expect(paid).toMatchObject({ outcome: "captured" });

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
  it("uses saved department figures for a frozen day after its department is renamed", async () => {
    const order = await t.counterOrder("open");
    await payWorkingOrder(
      {
        db: t.venue.db,
        backend: t.venue.backend,
        clock: t.venue.clock,
        admission: testTradingAdmission(),
      },
      t.venue.cfg,
      { id: order, tender: { method: "cash", amount: "18.00" }, lines: [] },
    );
    const overview = await get("/management-api/reports/overview");
    const path = `/management-api/reports/daily-close?businessDay=${overview.businessDay}`;
    const before = await get(path);
    await t.freezeDay(overview.businessDay);
    const [department] = await t.venue.db.select().from(departments);
    await t.venue.db
      .update(departments)
      .set({ name: "Renamed dining" })
      .where(eq(departments.id, department!.id));
    const after = await get(path);
    expect(after.departmentTakings).toEqual(before.departmentTakings);
    expect((await get("/management-api/reports/overview")).departmentTakings).not.toEqual(
      before.departmentTakings,
    );
    expect(after.closureSummary).toEqual(before.closureSummary);
  });
});
