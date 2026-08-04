import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedSale, seedSubstitution, seedVenue, seedVoid } from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import { computeCloseCounts } from "./counts.js";
import type { CloseCounts, DailyCloseInput } from "./types.js";

const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
let venue: SeededVenue;
const noon = new Date("2026-08-04T10:00:00Z").toISOString();
beforeEach(async () => {
  venue = await seedVenue(suite.db);
});
function run(): Promise<CloseCounts> {
  const input: DailyCloseInput = {
    tenantId: venue.tenantId,
    nodeId: venue.nodeId,
    businessDay: "2026-08-04",
    timeZone: "Europe/Madrid",
    dayCutover: "05:00",
  };
  return withTenant(suite.db, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    return computeCloseCounts(tx, input);
  });
}
const line = { vatRate: "21.00", lineTotal: "10.00" };

describe("computeCloseCounts", () => {
  it("counts sales, corrections and voids", async () => {
    const s1 = await seedSale(suite.db, venue, { invoiceNumber: 1, issuedAt: noon, total: "12.10", lines: [line] });
    await seedSale(suite.db, venue, { invoiceNumber: 2, issuedAt: noon, total: "12.10", lines: [line] });
    await seedSale(suite.db, venue, { invoiceNumber: 3, issuedAt: noon, total: "-1.21", correctsSaleId: s1, lines: [{ vatRate: "21.00", lineTotal: "-1.00" }] });
    await seedVoid(suite.db, { tenantId: venue.tenantId, saleId: s1 }, noon);
    // s1 is voided → not in sales count; s2 remains; the corrective counts; one void.
    expect(await run()).toEqual({ sales: 1, corrections: 1, voids: 1 });
  });

  it("excludes an F3 substitute from the sales count", async () => {
    const ticket = await seedSale(suite.db, venue, { invoiceNumber: 1, issuedAt: noon, total: "12.10", lines: [line] });
    const f3 = await seedSale(suite.db, venue, { invoiceNumber: 2, issuedAt: noon, total: "12.10", lines: [line] });
    await seedSubstitution(suite.db, { tenantId: venue.tenantId, substitutionSaleId: f3, substitutedSaleId: ticket });
    expect(await run()).toEqual({ sales: 1, corrections: 0, voids: 0 });
  });

  it("returns zeros for an empty day", async () => {
    expect(await run()).toEqual({ sales: 0, corrections: 0, voids: 0 });
  });
});
