import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedSale, seedTender, seedVenue } from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import { computeDailyClose } from "./daily-close.js";
import type { DailyCloseInput } from "./types.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
let venue: SeededVenue;
beforeEach(async () => {
  venue = await seedVenue(suite.db);
});
function input(overrides: Partial<DailyCloseInput> = {}): DailyCloseInput {
  return {
    nodeId: venue.nodeId,
    businessDay: "2026-08-04",
    timeZone: "Europe/Madrid",
    dayCutover: "05:00",
    ...overrides,
  };
}
function run(i: DailyCloseInput) {
  return withTransaction(suite.db, async (tx) => {
    return computeDailyClose(tx, i);
  });
}

describe("computeDailyClose", () => {
  it("validates inputs before touching the database", async () => {
    await expect(run(input({ timeZone: "Nowhere/Nope" }))).rejects.toThrow(/time zone/i);
    await expect(run(input({ dayCutover: "5:00" }))).rejects.toThrow(/cutover/i);
    await expect(run(input({ businessDay: "04/08/2026" }))).rejects.toThrow(/business day/i);
  });

  it("splits an invoice-first sale: VAT on the issuance day, cash on the settlement day", async () => {
    // Issued 2026-08-04 noon local; settled 2026-08-05 noon local.
    const issued = new Date("2026-08-04T10:00:00Z").toISOString();
    const settled = new Date("2026-08-05T10:00:00Z").toISOString();
    const saleId = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: issued,
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    await seedTender(
      suite.db,
      { saleId },
      { method: "card", amount: "121.00", settledAt: settled },
    );

    const day4 = await run(input({ businessDay: "2026-08-04" }));
    expect(day4.vat.byRate).toEqual([{ rate: "21.00", base: "100.00", tax: "21.00" }]);
    expect(day4.cash.byTill).toEqual([]); // not settled on the 4th

    const day5 = await run(input({ businessDay: "2026-08-05" }));
    expect(day5.vat.byRate).toEqual([]); // not issued on the 5th
    expect(day5.cash.byTill).toHaveLength(1);
    expect(day5.cash.tenderTotal).toBe("121.00");
  });

  it("Mode-I straddling the day_cutover: VAT on the placing day, cash on the settlement day", async () => {
    // Both instants fall on the SAME calendar date, 2026-08-05, an hour apart, so a wrong anchor
    // fails visibly where two instants a day apart could agree by coincidence.
    //   issued  2026-08-05T02:30:00.000Z = 04:30 Europe/Madrid (CEST, +02:00) — BEFORE the 05:00
    //     cutover, so business day 2026-08-04.
    //   settled 2026-08-05T03:30:00.000Z = 05:30 Europe/Madrid — AFTER the cutover, so 2026-08-05.
    const issued = "2026-08-05T02:30:00.000Z";
    const settled = "2026-08-05T03:30:00.000Z";
    const saleId = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: issued,
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    await seedTender(
      suite.db,
      { saleId },
      { method: "card", amount: "121.00", settledAt: settled },
    );

    const day4 = await run(
      input({ businessDay: "2026-08-04", dayCutover: "05:00", timeZone: "Europe/Madrid" }),
    );
    expect(day4.vat.byRate).toEqual([{ rate: "21.00", base: "100.00", tax: "21.00" }]); // VAT on the placing day
    expect(day4.cash.byTill).toEqual([]); // no cash yet — not settled until D2

    const day5 = await run(
      input({ businessDay: "2026-08-05", dayCutover: "05:00", timeZone: "Europe/Madrid" }),
    );
    expect(day5.vat.byRate).toEqual([]); // no VAT on the settlement day — it was already booked on D1
    expect(day5.cash.byTill).toHaveLength(1); // the cash lands here
    expect(day5.cash.tenderTotal).toBe("121.00");
  });

  it("assembles all three sections and echoes the request identity", async () => {
    const issued = new Date("2026-08-04T10:00:00Z").toISOString();
    const saleId = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: issued,
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    await seedTender(
      suite.db,
      { saleId },
      { method: "cash", amount: "121.00", tipAmount: "0.00", settledAt: issued },
    );
    const close = await run(input());
    expect(close).toMatchObject({
      nodeId: venue.nodeId,
      businessDay: "2026-08-04",
      timeZone: "Europe/Madrid",
      counts: { sales: 1, corrections: 0, voids: 0 },
    });
    expect(close.vat.grossTotal).toBe("121.00");
    expect(close.cash.byTill[0]!.cashTakings).toBe("121.00");
  });

  it("handles the spring-forward DST day without shifting the bucket", async () => {
    // 2026-03-29 is the EU spring-forward (02:00→03:00). A 12:00-local sale is unambiguous.
    const issued = new Date("2026-03-29T10:00:00Z").toISOString(); // 12:00 CEST after the jump
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: issued,
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    const close = await run(input({ businessDay: "2026-03-29" }));
    expect(close.vat.byRate).toEqual([{ rate: "21.00", base: "100.00", tax: "21.00" }]);
  });
});
