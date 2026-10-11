import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dailyCloseChain, dailyCloses, locations, sales, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { addDecimal, decimal, saleId as brandSaleId } from "@waitron/shared";
import {
  computeCategorySales,
  computeDailyClose,
  computeTopSellers,
  computeVatSummaryForPeriod,
  readLocationClock,
  recordDailyClose,
  verifyDailyCloseChain,
} from "@waitron/reporting";
import { loginWithPin, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { recordKitchenNotices } from "@waitron/venue-service";
import { settleSale } from "@waitron/core";
import { SESSION_COOKIE } from "./till-session.js";
import { send } from "./testing/bill-venue.js";
import {
  computeAdjustmentReport,
  createAdjustmentReason,
  policySnapshotOf,
  recordAdjustment,
} from "@waitron/adjustments";
import {
  billlessSale,
  contribute,
  parked,
  placedIssuedBill,
  voidInvoice,
  provisionOrderVenue,
  type OrderVenue,
} from "./testing/order-venue.js";
import { venueFiscalSelection } from "@waitron/provisioning";
import { ALL_MODULES } from "./modules.js";
import { mountLocationSettingsApi } from "./location-settings-api.js";
import { mountReportApi } from "./report-api.js";
import { listOrders } from "./orders-list.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let venue: OrderVenue;
let app: Hono;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-02T12:00:00.000Z"));
  venue = await provisionOrderVenue(suite.db);
  app = new Hono();
  mountReportApi(app, { db: suite.db, cfg: venue.cfg, venueLocale: "es-ES" }, () => {});
  mountLocationSettingsApi(
    app,
    {
      db: suite.db,
      cfg: venue.cfg,
      now: () => new Date("2026-11-02T12:00:00.000Z"),
      fiscal: venueFiscalSelection(ALL_MODULES, "ES-common").contribution!,
    },
    () => {},
  );
});
afterEach(() => vi.useRealTimers());
const inTx = <T>(fn: Parameters<typeof withTransaction<T>>[1]) => withTransaction(suite.db, fn);
async function managerCookie() {
  const session = await inTx((tx) => startManagementSession(tx, { personId: venue.adminId }));
  return `${MANAGEMENT_COOKIE}=${session.token}`;
}
const report = async (path: string) => {
  const response = await app.request(`/management-api/reports/${path}`, {
    headers: { Cookie: await managerCookie() },
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<Record<string, unknown>>;
};
async function schedule(cutover: string) {
  const response = await app.request("/management-api/venue-details/business-day-start", {
    method: "PUT",
    headers: { Cookie: await managerCookie(), "content-type": "application/json" },
    body: JSON.stringify({
      effectiveBusinessDay: "2026-11-04",
      dayCutover: cutover,
      expectedClockRevision: 0,
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ changed: true });
}

async function frozen() {
  return inTx(async (tx) => {
    const result: Record<string, unknown> = {};
    for (const table of [
      "sales",
      "sale_lines",
      "sale_settlements",
      "sale_voids",
      "tenders",
      "bill_payments",
      "bill_payment_refunds",
      "invoice_series",
      "registros_facturacion",
      "daily_closes",
      "daily_close_chain",
      "adjustments",
      "working_orders",
      "kitchen_notices",
    ]) {
      // Identifiers are fixed above; quote them through the engine's identifier builder.
      result[table] = (
        await tx.execute(sql`select * from ${sql.identifier(table)} order by rowid`)
      ).rows;
    }
    return result;
  });
}
async function derived(day: string) {
  return inTx(async (tx) => {
    const clock = await readLocationClock(tx, venue.cfg.locationId);
    const range = { ...clock, nodeId: venue.cfg.nodeId, fromBusinessDay: day, toBusinessDay: day };
    const close = await computeDailyClose(tx, {
      ...clock,
      nodeId: venue.cfg.nodeId,
      businessDay: day,
    });
    const vat = await computeVatSummaryForPeriod(tx, range);
    const top = await computeTopSellers(tx, { ...range, limit: 10 });
    const categories = await computeCategorySales(tx, { ...range, mode: "at_time_of_sale" });
    const adjustments = await computeAdjustmentReport(tx, range);
    return { close, vat, top, categories, adjustments };
  });
}

describe("dated business-day reporting through real storage", () => {
  it("preserves historical reports and complete frozen fiscal and close rows", async () => {
    await billlessSale(venue);
    await parked(venue, "Caña");
    await inTx((tx) =>
      recordDailyClose(tx, {
        nodeId: venue.cfg.nodeId,
        businessDay: "2026-11-02",
        timeZone: "Europe/Madrid",
        closedBy: venue.adminId,
        cashCounts: [
          {
            deviceId: venue.cfg.origin.deviceId,
            openingFloat: "0.00",
            payouts: "0.00",
            countedCash: "12.10",
          },
        ],
      }),
    );
    await inTx((tx) =>
      recordDailyClose(tx, {
        nodeId: venue.cfg.nodeId,
        businessDay: "2026-11-01",
        timeZone: "Europe/Madrid",
        closedBy: venue.adminId,
        cashCounts: [],
      }),
    );
    vi.setSystemTime(new Date("2026-11-03T12:00:00.000Z"));
    const deferred = await placedIssuedBill(venue, "Caña");
    const voided = await placedIssuedBill(venue, "Tarta");
    await voidInvoice(venue, voided);
    const bill = await parked(venue, "Tarta");
    const session = await inTx((tx) =>
      loginWithPin(tx, { deviceId: venue.deviceId, personId: venue.operatorId, pin: "5555" }),
    );
    venue.cookie = venue.cookie.replace(
      /waitron_till_session=[^;]+/,
      `${SESSION_COOKIE}=${session.token}`,
    );
    await contribute(venue, bill, "5.00");
    const payment = await inTx(
      async (tx) =>
        (
          await tx.execute<{ id: string }>(
            sql`select id from bill_payments where working_order_id = ${bill}`,
          )
        ).rows[0]!,
    );
    const refund = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${bill}/payments/${payment.id}/refunds`,
      {
        submissionId: randomUUID(),
        appliedAmount: "2.00",
        tipAmount: "0.00",
        reason: "Too much",
        override: { personId: venue.adminId, pin: "1234" },
      },
    );
    expect(refund.status).toBe(200);
    await inTx(async (tx) => {
      const reason = await createAdjustmentReason(tx, {
        name: "Clock fixture",
        names: {},
        actions: ["discount_amount"],
        maxPercentBp: null,
        maxAmount: null,
        applyRole: "staff",
        approverRole: "manager",
        noteRequired: false,
      });
      await recordAdjustment(tx, {
        workingOrderId: bill,
        line: null,
        quantity: null,
        reason: { id: reason.id, name: reason.name, policy: policySnapshotOf(reason) },
        action: "discount_amount",
        percentBp: null,
        beforeAmount: decimal("18.00"),
        afterAmount: decimal("17.00"),
        reduction: decimal("1.00"),
        nominalValue: decimal("18.00"),
        requestedBy: venue.operatorId,
        approvedBy: null,
        note: null,
      });
    });
    vi.setSystemTime(new Date("2026-11-04T01:00:00.000Z"));
    await inTx(async (tx) => {
      const [sale] = await tx
        .select({ id: sales.id })
        .from(sales)
        .where(eq(sales.workingOrderId, deferred));
      await settleSale(tx, {
        saleId: brandSaleId(sale!.id),
        tenders: [{ method: "cash", amount: "3.00", tipAmount: "0.00", settledAt: new Date() }],
      });
    });
    const mixedBefore = await derived("2026-11-03");
    expect(mixedBefore.close.vat.grossTotal).toBe("3.00");
    expect(mixedBefore.close.cash.tenderTotal).toBe("6.00");
    expect(mixedBefore.adjustments.overall).toMatchObject({ count: 1, reduction: "1.00" });
    const rows = await frozen();
    for (const table of [
      "sale_settlements",
      "sale_voids",
      "bill_payments",
      "bill_payment_refunds",
      "adjustments",
    ])
      expect((rows[table] as unknown[]).length).toBeGreaterThan(0);
    expect((rows.registros_facturacion as unknown[]).length).toBeGreaterThan(0);
    expect((await suite.db.select().from(dailyCloses)).length).toBe(2);
    expect((await suite.db.select().from(dailyCloseChain))[0]!.sequenceNo).toBe(2);
    const before = await derived("2026-11-02");
    expect(before.close.vat.grossTotal).toBe("12.10");
    expect(before.close.cash.tenderTotal).toBe("12.10");
    const httpBefore = await report("daily-close?businessDay=2026-11-02");
    await schedule("03:00");
    expect(await frozen()).toEqual(rows);
    expect(await derived("2026-11-02")).toEqual(before);
    expect(await derived("2026-11-03")).toEqual(mixedBefore);
    expect(await report("daily-close?businessDay=2026-11-02")).toEqual(httpBefore);
    expect(await inTx((tx) => verifyDailyCloseChain(tx, venue.cfg.nodeId))).toMatchObject({
      ok: true,
    });
  });
  it.each(["03:00", "07:00"])(
    "reads close, period, overview and order filters at the %s boundary",
    async (cutover) => {
      await schedule(cutover);
      const at = cutover === "03:00" ? "2026-11-04T02:00:00.000Z" : "2026-11-04T06:00:00.000Z";
      vi.setSystemTime(new Date(new Date(at).getTime() - 1));
      const beforeSale = await billlessSale(venue);
      vi.setSystemTime(new Date(at));
      const atSale = await billlessSale(venue);
      const preceding = await report("daily-close?businessDay=2026-11-03");
      const following = await report("daily-close?businessDay=2026-11-04");
      expect(preceding.vat).toMatchObject({ grossTotal: "12.10" });
      expect(following.vat).toMatchObject({ grossTotal: "12.10" });
      const period = await report("period?from=2026-11-03&to=2026-11-04");
      expect(period.vat).toMatchObject({ grossTotal: "24.20" });
      const day3 = await derived("2026-11-03");
      const day4 = await derived("2026-11-04");
      expect(addDecimal(day3.close.vat.grossTotal, day4.close.vat.grossTotal)).toBe(
        decimal("24.20"),
      );
      const page = await inTx(async (tx) => {
        const clock = await readLocationClock(tx, venue.cfg.locationId);
        return listOrders(tx, {
          status: "all",
          credited: false,
          scope: "all",
          limit: 50,
          dates: { ...clock, from: "2026-11-03", to: "2026-11-03" },
        });
      });
      expect(page.rows.map((row) => row.id)).toEqual([beforeSale]);
      expect(page.rows.map((row) => row.id)).not.toContain(atSale);
      const ordersResponse = await venue.orders.request(
        "/management-api/orders?status=all&from=2026-11-03&to=2026-11-03",
        { headers: { Cookie: await managerCookie() } },
      );
      expect(ordersResponse.status).toBe(200);
      const orders = (await ordersResponse.json()) as { rows: { id: string }[] };
      expect(orders.rows.map((row) => row.id)).toEqual([beforeSale]);

      const overviewResponse = await app.request("/management-api/reports/overview", {
        headers: { Cookie: await managerCookie() },
      });
      expect(overviewResponse.status).toBe(200);
      expect(await overviewResponse.json()).toMatchObject({
        businessDay: "2026-11-04",
        takings: { grossTotal: "12.10" },
      });
    },
  );
  it("resolves the recorded close from its node rather than a caller's scalar", async () => {
    await schedule("07:00");
    vi.setSystemTime(new Date("2026-11-04T05:30:00.000Z"));
    await billlessSale(venue);
    const record = await inTx((tx) =>
      recordDailyClose(tx, {
        nodeId: venue.cfg.nodeId,
        businessDay: "2026-11-03",
        timeZone: "Europe/Madrid",
        closedBy: venue.adminId,
        cashCounts: [
          {
            deviceId: venue.cfg.origin.deviceId,
            openingFloat: "0.00",
            payouts: "0.00",
            countedCash: "12.10",
          },
        ],
      }),
    );
    expect(record.snapshot.close.vat.grossTotal).toBe("12.10");
    expect(record.snapshot.close.cash.tenderTotal).toBe("12.10");
  });
  it("refuses a supplied zone which disagrees with the node's stored zone before creating a chain", async () => {
    await expect(
      inTx((tx) =>
        recordDailyClose(tx, {
          nodeId: venue.cfg.nodeId,
          businessDay: "2026-11-03",
          timeZone: "UTC",
          closedBy: venue.adminId,
          cashCounts: [],
        }),
      ),
    ).rejects.toThrow(/time zone.*match/i);
    expect(await suite.db.select().from(dailyCloseChain)).toEqual([]);
    expect(await suite.db.select().from(dailyCloses)).toEqual([]);
    expect(
      (await suite.db.select().from(locations).where(eq(locations.id, venue.cfg.locationId)))[0]!
        .dayCutover,
    ).toBe("05:00:00");
  });
});

describe("recorded facts refuse retrospective boundary changes", () => {
  it("refuses a close dated on the transitional day and preserves its complete chain", async () => {
    await inTx((tx) =>
      recordDailyClose(tx, {
        nodeId: venue.cfg.nodeId,
        businessDay: "2026-11-03",
        timeZone: "Europe/Madrid",
        closedBy: venue.adminId,
        cashCounts: [],
      }),
    );
    const before = await frozen();
    const response = await app.request("/management-api/venue-details/business-day-start", {
      method: "PUT",
      headers: { Cookie: await managerCookie(), "content-type": "application/json" },
      body: JSON.stringify({
        effectiveBusinessDay: "2026-11-04",
        dayCutover: "07:00",
        expectedClockRevision: 0,
      }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "venue.business_day_locked", params: { reason: "daily_close" } },
    });
    expect(await frozen()).toEqual(before);
  });
  it("refuses future issuance without rewriting any sale, filing, number or close", async () => {
    await billlessSale({
      ...venue,
      clock: {
        ...venue.clock,
        now: () => ({ ...venue.clock.now(), instant: new Date("2026-11-04T03:00:00.000Z") }),
      },
    });
    const before = await frozen();
    const response = await app.request("/management-api/venue-details/business-day-start", {
      method: "PUT",
      headers: { Cookie: await managerCookie(), "content-type": "application/json" },
      body: JSON.stringify({
        effectiveBusinessDay: "2026-11-04",
        dayCutover: "03:00",
        expectedClockRevision: 0,
      }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "venue.business_day_locked", params: { reason: "future_history" } },
    });
    expect(await frozen()).toEqual(before);
  });
});

it.each(["void", "tender", "payment", "refund", "notice"])(
  "refuses an isolated future %s anchor and preserves its rows",
  async (kind) => {
    let bill: string;
    if (kind === "void" || kind === "tender") bill = await placedIssuedBill(venue, "Caña");
    else bill = await parked(venue, "Tarta");
    if (kind === "refund") await contribute(venue, bill, "5.00");
    vi.setSystemTime(new Date("2026-11-04T02:00:00.000Z"));
    if (kind === "void") await voidInvoice(venue, bill);
    else if (kind === "tender")
      await inTx(async (tx) => {
        const [sale] = await tx
          .select({ id: sales.id })
          .from(sales)
          .where(eq(sales.workingOrderId, bill));
        await settleSale(tx, {
          saleId: brandSaleId(sale!.id),
          tenders: [{ method: "cash", amount: "3.00", tipAmount: "0.00", settledAt: new Date() }],
        });
      });
    else if (kind === "notice")
      await inTx(async (tx) => {
        const line = (
          await tx.execute<{ id: string }>(
            sql`select id from working_order_lines where working_order_id = ${bill} limit 1`,
          )
        ).rows[0]!;
        const station = (
          await tx.execute<{ id: string }>(
            sql`select id from kitchen_stations where location_id = ${venue.cfg.locationId} limit 1`,
          )
        ).rows[0]!;
        await recordKitchenNotices(
          tx,
          venue.cfg,
          bill,
          [
            {
              workingOrderLineId: line.id,
              stationId: station.id,
              quantity: decimal("1"),
              wasStarted: false,
            },
          ],
          "recalled",
        );
      });
    else {
      const session = await inTx((tx) =>
        loginWithPin(tx, { deviceId: venue.deviceId, personId: venue.operatorId, pin: "5555" }),
      );
      venue.cookie = venue.cookie.replace(
        /waitron_till_session=[^;]+/,
        `${SESSION_COOKIE}=${session.token}`,
      );
      if (kind === "payment") await contribute(venue, bill, "5.00");
      else {
        const payment = (
          await suite.db.execute<{ id: string }>(
            sql`select id from bill_payments where working_order_id = ${bill} limit 1`,
          )
        ).rows[0]!;
        const refund = await send(
          venue.app,
          venue.cookie,
          "POST",
          `/api/working-orders/${bill}/payments/${payment.id}/refunds`,
          {
            submissionId: randomUUID(),
            appliedAmount: "2.00",
            tipAmount: "0.00",
            reason: "Clock fixture",
            override: { personId: venue.adminId, pin: "1234" },
          },
        );
        expect(refund.status).toBe(200);
      }
    }
    const before = await frozen();
    const response = await app.request("/management-api/venue-details/business-day-start", {
      method: "PUT",
      headers: { Cookie: await managerCookie(), "content-type": "application/json" },
      body: JSON.stringify({
        effectiveBusinessDay: "2026-11-04",
        dayCutover: "03:00",
        expectedClockRevision: 0,
      }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "venue.business_day_locked", params: { reason: "future_history" } },
    });
    expect(await frozen()).toEqual(before);
  },
);
