import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  seedBillPayment,
  seedNodeAndSeries,
  seedOpenOrder,
  seedSale,
  seedVenueWithSeries,
  settleOrder,
} from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import { computeClosedBills } from "./closed-bills.js";
import type { DailyCloseInput } from "./types.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
let venue: SeededVenue;
const DAY = "2026-08-04";
const NEXT_DAY = "2026-08-05";
const noon = "2026-08-04T10:00:00.000Z";
const evening = "2026-08-04T20:00:00.000Z";
const nextNoon = "2026-08-05T10:00:00.000Z";

beforeEach(async () => {
  venue = await seedVenueWithSeries(suite.db);
});

async function run(overrides: Partial<DailyCloseInput> = {}) {
  const input: DailyCloseInput = {
    cutoverChanges: [],
    nodeIds: [venue.nodeId],
    businessDay: DAY,
    timeZone: "Europe/Madrid",
    dayCutover: "05:00",
    ...overrides,
  };
  return withTransaction(suite.db, (tx) => computeClosedBills(tx, input));
}

async function bill(
  seed: Pick<SeededVenue, "deviceId" | "locationId" | "nodeId" | "seriesId">,
  orderNumber: number,
  opts: { total: string; issuedAt: string; settledAt?: string },
): Promise<string> {
  const { orderId } = await seedOpenOrder(suite.db, seed, orderNumber);
  await seedSale(suite.db, seed, {
    invoiceNumber: orderNumber,
    issuedAt: opts.issuedAt,
    total: opts.total,
    lines: [{ vatRate: "10.00", lineTotal: opts.total }],
    workingOrderId: orderId,
  });
  if (opts.settledAt !== undefined) await settleOrder(suite.db, orderId, opts.settledAt);
  return orderId;
}

describe("computeClosedBills", () => {
  it("counts settled bills at their invoice totals, leaving out open bills and unsettled invoices", async () => {
    await bill(venue, 1, { total: "220.00", issuedAt: noon, settledAt: noon });
    await bill(venue, 2, { total: "100.00", issuedAt: noon, settledAt: noon });
    const { orderId: openOrder } = await seedOpenOrder(suite.db, venue, 3);
    await seedBillPayment(
      suite.db,
      { workingOrderId: openOrder, deviceId: venue.deviceId },
      { method: "cash", applied: "10.00", state: "received", at: noon },
    );
    await bill(venue, 4, { total: "50.00", issuedAt: noon });

    expect(await run()).toEqual({ count: 2, total: "320.00" });
  });

  it("counts a bill on the business day it was settled, not the day it was invoiced", async () => {
    await bill(venue, 1, { total: "100.00", issuedAt: evening, settledAt: nextNoon });

    expect(await run()).toEqual({ count: 0, total: "0.00" });
    expect(await run({ businessDay: NEXT_DAY })).toEqual({ count: 1, total: "100.00" });
  });

  it("leaves out a bill settled on another box unless the read is venue-wide", async () => {
    await bill(venue, 1, { total: "100.00", issuedAt: noon, settledAt: noon });
    const second = await seedNodeAndSeries(suite.db, venue);
    await bill({ ...venue, ...second }, 2, { total: "40.00", issuedAt: noon, settledAt: noon });

    expect(await run()).toEqual({ count: 1, total: "100.00" });
    expect(await run({ nodeIds: undefined })).toEqual({ count: 2, total: "140.00" });
  });
});
