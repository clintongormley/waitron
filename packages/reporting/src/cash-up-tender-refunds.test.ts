import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  seedBillPayment,
  seedBillRefund,
  seedNodeAndSeries,
  seedOpenOrder,
  seedVenue,
  seedVenueDevice,
} from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import { seedRefundableSale, seedTenderRefund } from "../test/tender-refund-fixtures.js";
import { computeCashUp } from "./cash-up.js";
import type { DailyCloseInput } from "./types.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
const DAY1 = "2026-08-04T10:00:00.000Z";
const DAY2 = "2026-08-05T10:00:00.000Z";
let venue: SeededVenue;
beforeEach(async () => {
  venue = await seedVenue(suite.db);
});

function run(input: Partial<DailyCloseInput> = {}) {
  return withTransaction(suite.db, (tx) =>
    computeCashUp(tx, {
      nodeId: venue.nodeId,
      businessDay: "2026-08-05",
      timeZone: "Europe/Madrid",
      dayCutover: "05:00",
      cutoverChanges: [],
      ...input,
    }),
  );
}

async function target(method: "cash" | "card" = "cash", invoiceNumber = 1) {
  return seedRefundableSale(suite.db, venue, {
    method,
    applied: "100.00",
    tip: "7.25",
    at: DAY1,
    invoiceNumber,
  });
}

describe("computeCashUp — settled-tender refunds", () => {
  it.each(["cash", "card"] as const)(
    "subtracts a %s return and its tip on completion day and the returning device",
    async (method) => {
      const paid = await target(method);
      const deviceId = await seedVenueDevice(suite.db, venue.locationId);
      await seedTenderRefund(suite.db, paid, {
        applied: "100.00",
        tip: "7.25",
        state: "completed",
        createdAt: DAY1,
        at: DAY2,
        origin: { ...venue, deviceId },
      });
      expect(await run({ businessDay: "2026-08-04" })).toEqual({
        byOrigin: [
          {
            source: "device",
            deviceId: venue.deviceId,
            byMethod: [{ method, amount: "107.25", tip: "7.25" }],
            cashTakings: method === "cash" ? "107.25" : "0.00",
          },
        ],
        tenderTotal: "107.25",
        tipTotal: "7.25",
      });
      expect(await run()).toEqual({
        byOrigin: [
          {
            source: "device",
            deviceId,
            byMethod: [{ method, amount: "-107.25", tip: "-7.25" }],
            cashTakings: method === "cash" ? "-107.25" : "0.00",
          },
        ],
        tenderTotal: "-107.25",
        tipTotal: "-7.25",
      });
    },
  );

  it("does not count pending or failed attempts beside a completed partial return", async () => {
    const paid = await target();
    for (const [state, applied, at] of [
      ["completed", "12.34", DAY2],
      ["failed", "23.45", DAY2],
      ["pending", "34.56", null],
    ] as const) {
      await seedTenderRefund(suite.db, paid, {
        applied,
        tip: "0.00",
        state,
        createdAt: DAY1,
        at,
      });
    }
    expect(await run()).toEqual({
      byOrigin: [
        {
          source: "device",
          deviceId: venue.deviceId,
          byMethod: [{ method: "cash", amount: "-12.34", tip: "0.00" }],
          cashTakings: "-12.34",
        },
      ],
      tenderTotal: "-12.34",
      tipTotal: "0.00",
    });
  });

  it("uses the refund's recorded node even when the original sale belongs to another node", async () => {
    const paid = await target();
    const other = { ...venue, ...(await seedNodeAndSeries(suite.db, venue)) };
    await seedTenderRefund(suite.db, paid, {
      applied: "20.00",
      tip: "0.00",
      state: "completed",
      createdAt: DAY1,
      at: DAY2,
      origin: other,
    });
    expect(await run()).toEqual({ byOrigin: [], tenderTotal: "0.00", tipTotal: "0.00" });
    expect(await run({ nodeId: other.nodeId })).toEqual({
      byOrigin: [
        {
          source: "device",
          deviceId: venue.deviceId,
          byMethod: [{ method: "cash", amount: "-20.00", tip: "0.00" }],
          cashTakings: "-20.00",
        },
      ],
      tenderTotal: "-20.00",
      tipTotal: "0.00",
    });
    expect(await run({ nodeId: undefined })).toEqual(await run({ nodeId: other.nodeId }));
  });

  it("groups the refund's job source separately from its sale's device", async () => {
    await seedTenderRefund(suite.db, await target(), {
      applied: "3.45",
      tip: "0.00",
      state: "completed",
      createdAt: DAY1,
      at: DAY2,
      source: "demo_seed",
    });
    expect(await run()).toEqual({
      byOrigin: [
        {
          source: "demo_seed",
          deviceId: null,
          byMethod: [{ method: "cash", amount: "-3.45", tip: "0.00" }],
          cashTakings: "-3.45",
        },
      ],
      tenderTotal: "-3.45",
      tipTotal: "0.00",
    });
  });

  it("nets multiple partial returns and mixed methods without losing a zero cash line", async () => {
    const cash = await seedRefundableSale(suite.db, venue, {
      method: "cash",
      applied: "100.00",
      tip: "0.00",
      at: DAY2,
      invoiceNumber: 1,
    });
    const card = await target("card", 2);
    for (const applied of ["30.00", "70.00"]) {
      await seedTenderRefund(suite.db, cash, {
        applied,
        tip: "0.00",
        state: "completed",
        createdAt: DAY2,
        at: DAY2,
      });
    }
    await seedTenderRefund(suite.db, card, {
      applied: "4.00",
      tip: "0.00",
      state: "completed",
      createdAt: DAY1,
      at: DAY2,
    });
    expect(await run()).toEqual({
      byOrigin: [
        {
          source: "device",
          deviceId: venue.deviceId,
          byMethod: [
            { method: "card", amount: "-4.00", tip: "0.00" },
            { method: "cash", amount: "0.00", tip: "0.00" },
          ],
          cashTakings: "0.00",
        },
      ],
      tenderTotal: "-4.00",
      tipTotal: "0.00",
    });
  });

  it("counts a bill-derived return once beside its earlier pre-invoice return", async () => {
    const { orderId } = await seedOpenOrder(suite.db, venue, 1);
    const billPaymentId = await seedBillPayment(
      suite.db,
      { workingOrderId: orderId, deviceId: venue.deviceId },
      { method: "card", applied: "100.00", tip: "7.25", state: "received", at: DAY1 },
    );
    await seedBillRefund(
      suite.db,
      { billPaymentId, deviceId: venue.deviceId },
      { applied: "20.00", tip: "0.00", state: "completed", at: DAY1 },
    );
    const paid = await seedRefundableSale(suite.db, venue, {
      method: "card",
      applied: "80.00",
      tip: "7.25",
      at: DAY1,
      invoiceNumber: 1,
      billPaymentId,
    });
    await seedTenderRefund(suite.db, paid, {
      applied: "80.00",
      tip: "7.25",
      state: "completed",
      createdAt: DAY1,
      at: DAY2,
    });
    expect((await run({ businessDay: "2026-08-04" })).tenderTotal).toBe("87.25");
    expect((await run()).tenderTotal).toBe("-87.25");
    expect((await run()).tipTotal).toBe("-7.25");
  });

  it.each([
    [
      "summer cutover",
      "2026-08-05T02:59:59.999Z",
      "2026-08-05T03:00:00.000Z",
      "2026-08-04",
      "2026-08-05",
      "05:00",
    ],
    [
      "midnight",
      "2026-08-04T21:59:59.999Z",
      "2026-08-04T22:00:00.000Z",
      "2026-08-04",
      "2026-08-05",
      "00:00",
    ],
    [
      "spring-forward",
      "2026-03-29T02:59:59.999Z",
      "2026-03-29T03:00:00.000Z",
      "2026-03-28",
      "2026-03-29",
      "05:00",
    ],
    [
      "fall-back",
      "2026-10-25T03:59:59.999Z",
      "2026-10-25T04:00:00.000Z",
      "2026-10-24",
      "2026-10-25",
      "05:00",
    ],
  ])(
    "uses completedAt at the %s boundary with an exclusive end",
    async (_name, before, at, previous, next, dayCutover) => {
      const paid = await seedRefundableSale(suite.db, venue, {
        method: "cash",
        applied: "100.00",
        tip: "0.00",
        at: "2026-01-01T12:00:00.000Z",
        invoiceNumber: 1,
      });
      await seedTenderRefund(suite.db, paid, {
        applied: "1.23",
        tip: "0.00",
        state: "completed",
        createdAt: "2026-01-02T12:00:00.000Z",
        at: before,
      });
      await seedTenderRefund(suite.db, paid, {
        applied: "4.56",
        tip: "0.00",
        state: "completed",
        createdAt: "2026-01-02T12:00:00.000Z",
        at,
      });
      expect((await run({ businessDay: previous, dayCutover })).tenderTotal).toBe("-1.23");
      expect((await run({ businessDay: next, dayCutover })).tenderTotal).toBe("-4.56");
    },
  );
});
