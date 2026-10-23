import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { send } from "./testing/bill-venue.js";
import {
  collect,
  placedIssuedBill,
  provisionOrderVenue,
  type OrderVenue,
} from "./testing/order-venue.js";

// These cases issue invoices on a fixed past clock, so their database holds no record from a later
// clock: the chain refuses a record more than a minute earlier than the latest one.

let venue: OrderVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionOrderVenue(db);
  },
});

const post = (cookie: string, billId: string, printerId?: string) =>
  send(
    venue.orders,
    cookie,
    "POST",
    `/management-api/orders/${billId}/reprint`,
    printerId === undefined ? {} : { printerId },
  );

async function counts() {
  const [jobs, opens, saleRows, fiscalRows, settlements, tenders, reprints] = await Promise.all([
    venue.db.all<{ n: number }>(sql`select count(*) as n from print_jobs`),
    venue.db.all<{ n: number }>(sql`select count(*) as n from drawer_opens`),
    venue.db.all<{ n: number }>(sql`select count(*) as n from sales`),
    venue.db.all<{ n: number }>(sql`select count(*) as n from registros_facturacion`),
    venue.db.all<{ n: number }>(sql`select count(*) as n from sale_settlements`),
    venue.db.all<{ n: number }>(sql`select count(*) as n from tenders`),
    venue.db.all<{ n: number }>(sql`select count(*) as n from receipt_reprints`),
  ]);
  return {
    jobs: jobs[0]!.n,
    opens: opens[0]!.n,
    saleRows: saleRows[0]!.n,
    fiscalRows: fiscalRows[0]!.n,
    settlements: settlements[0]!.n,
    tenders: tenders[0]!.n,
    reprints: reprints[0]!.n,
  };
}

describe("dashboard receipt reprint", () => {
  it("does not let staff copy an older finished bill hidden from their Orders detail", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
    let oldPaid: string;
    try {
      oldPaid = await placedIssuedBill(venue, "Caña");
      expect((await collect(venue, oldPaid, "3.00")).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
    const before = await counts();
    expect(await post(venue.staffDashboard, oldPaid, venue.printerId)).toMatchObject({
      status: 404,
      json: { code: "working_order.not_found" },
    });
    expect(await counts()).toEqual(before);
    expect((await post(venue.adminDashboard, oldPaid, venue.printerId)).status).toBe(202);
  });
});
