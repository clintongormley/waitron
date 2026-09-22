import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedSale, seedVenue } from "./fixtures.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

describe("fixtures", () => {
  it("seedVenue + seedSale insert a sale with its lines", async () => {
    const venue = await seedVenue(suite.db);
    const saleId = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: new Date("2026-08-04T10:00:00Z").toISOString(),
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    const { rows } = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from sale_lines where sale_id = ${saleId}`,
    );
    expect(rows[0]!.n).toBe(1);
  });
});
