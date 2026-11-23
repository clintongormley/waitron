import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedSale, seedVenueWithSeries } from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import { computeTopSellers } from "./top-sellers.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

let venue: SeededVenue;

beforeEach(async () => {
  venue = await seedVenueWithSeries(suite.db);
});

const line = (name: string, setMenuRole: "set_menu" | "dish", lineTotal = "0.00") => ({
  name,
  descriptions: { es: `Cliente ${name}` },
  vatRate: "10.00",
  lineTotal,
  setMenuRole,
});

describe("computeTopSellers with set menus", () => {
  it("top sellers show each set menu as an item", async () => {
    // The spec bill as filed; a line's total is its net, so 14.00 gross is 12.73.
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: new Date("2026-08-04T10:00:00Z").toISOString(),
      total: "73.00",
      lines: [
        line("Daily menu", "set_menu", "12.73"),
        line("Daily menu", "set_menu", "12.73"),
        line("Special menu", "set_menu", "18.18"),
        line("Special menu", "set_menu", "18.18"),
        ...Array.from({ length: 4 }, () => line("Soup", "dish")),
        line("Hake", "dish"),
        line("Sea bass", "dish"),
        line("Sirloin", "dish"),
        line("Sirloin", "dish", "4.55"),
      ],
    });

    const sellers = await withTransaction(suite.db, (tx) =>
      computeTopSellers(tx, {
        cutoverChanges: [],
        nodeIds: [venue.nodeId],
        fromBusinessDay: "2026-08-04",
        toBusinessDay: "2026-08-04",
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
        limit: 10,
      }),
    );

    expect(sellers.map(({ name, quantity, total }) => [name, quantity, total])).toEqual([
      ["Soup", "4.000", "0.00"],
      ["Daily menu", "2.000", "25.46"],
      ["Sirloin", "2.000", "4.55"],
      ["Special menu", "2.000", "36.36"],
      ["Hake", "1.000", "0.00"],
      ["Sea bass", "1.000", "0.00"],
    ]);
  });
});
