import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { readVenueClock, withTransaction } from "@waitron/db";
import { closeOfDayConfig, issueBillAtClose } from "./close-of-day.js";
import { provisionBillVenue, seatedWith, type BillVenue } from "./testing/bill-venue.js";
import { clockAtIso as clockAt, filedFor } from "./testing/later-sale-date-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import "./errors.js";

// A release that ships a general rate of 10% from Wednesday 18 March 2026, the shipped table
// otherwise.
vi.mock("@waitron/shared/src/menu-document/vat-rates.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@waitron/shared/src/menu-document/vat-rates.js")>();
  const table = {
    ...original.VAT_RATE_TABLE,
    general: [
      { from: null, rate: "21.00" },
      { from: "2026-03-18", rate: "10.00" },
    ],
  };
  return {
    ...original,
    VAT_RATE_TABLE: table,
    vatRatesOn: (...[date, given]: Parameters<typeof original.vatRatesOn>) =>
      original.vatRatesOn(date, given ?? table),
  };
});

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

// Europe/Madrid, UTC+1 in March, its business day turning over at 05:00. 16 March 2026 is a Monday.
const MON_2200 = "2026-03-16T21:00:00.000Z";
const TUE_0500 = "2026-03-17T04:00:00.000Z";
const TUE_0501 = "2026-03-17T04:01:00.000Z";
const THU_0500 = "2026-03-19T04:00:00.000Z";
const THU_1200 = "2026-03-19T11:00:00.000Z";

async function mondayBill(venue: BillVenue): Promise<string> {
  const party = await seatedWith(venue, "Croquettes");
  venue.db.run(
    sql`update working_orders set trusted_opened_at = ${MON_2200} where id = ${party.tabId}`,
  );
  return party.tabId;
}

function closeAt(venue: BillVenue, billId: string, at: string, dayStartedAt: string) {
  return withTransaction(venue.db, async (tx) =>
    issueBillAtClose(
      tx,
      {
        admission: testTradingAdmission(),
        db: venue.db,
        backend: venue.backend,
        clock: clockAt(at),
      },
      closeOfDayConfig(venue.cfg),
      billId,
      { dayStartedAt: new Date(dayStartedAt), venueClock: await readVenueClock(tx) },
    ),
  );
}

describe("a close-of-day ticket's sale date", () => {
  it("is the close's day, at that day's VAT rate, when the box was off over the day's end and issues it two days later", async () => {
    const venue = await provisionBillVenue(suite.db);
    const billId = await mondayBill(venue);

    const outcome = await closeAt(venue, billId, THU_1200, THU_0500);

    expect(outcome.kind).toBe("issued");
    const { supplyDay, ticket, record, rates } = await filedFor(venue, billId);
    expect(supplyDay).toBe("2026-03-17");
    expect(ticket.saleDay).toBe("2026-03-17");
    expect(record).toEqual({ operationDate: "2026-03-17", issueDate: "2026-03-19" });
    expect(rates).toEqual([2100]);
    expect(ticket.vatBreakdown.map((band) => band.rate)).toEqual(["21.00"]);
  });

  it("is not carried by a ticket the close issues on time", async () => {
    const venue = await provisionBillVenue(suite.db);
    const billId = await mondayBill(venue);

    const outcome = await closeAt(venue, billId, TUE_0501, TUE_0500);

    expect(outcome.kind).toBe("issued");
    const { supplyDay, ticket, record } = await filedFor(venue, billId);
    expect(supplyDay).toBeNull();
    expect(ticket).not.toHaveProperty("saleDay");
    expect(record).toEqual({ operationDate: null, issueDate: "2026-03-17" });
  });
});
