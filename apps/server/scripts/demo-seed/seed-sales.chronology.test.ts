import { afterEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { sales } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedSales } from "./seed-sales.js";
import { createDemoVenueProvisioner } from "./testing/provision-venue.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const provisionVenue = createDemoVenueProvisioner(() => suite.db, {
  nifBase: 81_000_000,
  nifFormat: "calculated",
  invoiceLocale: "es-ES",
});

afterEach(() => vi.useRealTimers());

it("numbers demo sales in ascending issue time across and within days", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-01T09:30:00.000Z") });
  const venue = await provisionVenue();
  const { count } = await seedSales(suite.db, {
    venue: { nodeId: venue.nodeId, seriesId: venue.seriesId },
    invoiceLocale: "es-ES",
    days: 3,
    products: [
      { id: "soup", name: "Soup", customerName: null, unitPrice: "2.40", vatClass: "reduced" },
    ],
  });
  vi.useRealTimers();
  const rows = await suite.db
    .select({ number: sales.invoiceNumber, at: sales.issuedAt, source: sales.source })
    .from(sales)
    .where(eq(sales.seriesId, venue.seriesId))
    .orderBy(sales.invoiceNumber);
  expect(count).toBeGreaterThan(1);
  expect(rows).toHaveLength(count);
  expect(new Set(rows.map((row) => row.source))).toEqual(new Set(["demo_seed"]));
  for (let index = 1; index < rows.length; index += 1) {
    expect(rows[index]!.number).toBe(rows[index - 1]!.number + 1);
    expect(rows[index]!.at >= rows[index - 1]!.at).toBe(true);
  }
});
