import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withTransaction } from "@waitron/db";
import { startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { mountReportApi } from "./report-api.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { transferCloseVenue, type TransferCloseKit } from "./testing/transfer-close-fixture.js";
import {
  payWorkingOrder,
  payWorkingOrderIntegratedOrchestration,
} from "./testing/whole-payment-fixture.js";
import "./errors.js";

// Its own database: the case closes bills in today's business day, which the overview reads.
let t: TransferCloseKit;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    t = await transferCloseVenue(db);
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

describe("reports, a bill closed by transfer", () => {
  it("counts it once among the bills closed, apart from the money received", async () => {
    const deps = { db: t.venue.db, backend: t.venue.backend, clock: t.venue.clock };
    const transferred = await t.counterOrder("placed");
    await t.close(await t.requestFor(transferred, "18.00", null));
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
      toBePaidByTransfer: "18.00",
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
    const methods = (
      close.cash as { byOrigin: { byMethod: { method: string }[] }[] }
    ).byOrigin.flatMap((row) => row.byMethod.map((line) => line.method));
    expect(methods.sort()).toEqual(["card", "cash", "transfer"]);

    const before = await get(
      `/management-api/reports/daily-close?businessDay=${dayBefore(overview.businessDay)}`,
    );
    expect(before.closureSummary).toEqual({
      billsClosed: { count: 0, total: "0.00" },
      toBePaidByTransfer: "0.00",
      received: "0.00",
    });
  });
});
