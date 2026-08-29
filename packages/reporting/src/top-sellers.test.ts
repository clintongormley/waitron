import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import {
  seedNodeAndSeries,
  seedSale,
  seedSubstitution,
  seedVenue,
  seedVoid,
} from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import { computeTopSellers } from "./top-sellers.js";
import type { TopSeller, TopSellersInput } from "./types.js";

const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

let venue: SeededVenue;
const DAY = "2026-08-04";
const TZ = "Europe/Madrid";
// 2026-08-04 12:00 local (Madrid is UTC+2 in August), well inside the 05:00-cutover business day.
const noonUtc = new Date("2026-08-04T10:00:00Z").toISOString();

const cafe = { es: "Café" };
const tostada = { es: "Tostada" };
const zumo = { es: "Zumo" };

beforeEach(async () => {
  venue = await seedVenue(suite.db);
});

function run(overrides: Partial<TopSellersInput> = {}): Promise<TopSeller[]> {
  const input: TopSellersInput = {
    tenantId: venue.tenantId,
    nodeId: venue.nodeId,
    fromBusinessDay: DAY,
    toBusinessDay: DAY,
    timeZone: TZ,
    dayCutover: "05:00",
    limit: 5,
    ...overrides,
  };
  return withTenant(suite.db, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    return computeTopSellers(tx, input);
  });
}

describe("computeTopSellers", () => {
  it("validates inputs before touching the database", async () => {
    await expect(run({ timeZone: "Nowhere/Nope" })).rejects.toThrow(/time zone/i);
    await expect(run({ dayCutover: "5:00" })).rejects.toThrow(/cutover/i);
    await expect(run({ fromBusinessDay: "04/08/2026" })).rejects.toThrow(/business day/i);
    await expect(run({ fromBusinessDay: "2026-08-05" })).rejects.toThrow(/on or before/i);
    await expect(run({ limit: 0 })).rejects.toThrow(/limit/i);
    await expect(run({ limit: 2.5 })).rejects.toThrow(/limit/i);
    await expect(run({ limit: -1 })).rejects.toThrow(/limit/i);
  });

  it("ranks products by summed quantity desc and respects the limit", async () => {
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "90.00",
      lines: [
        { vatRate: "10.00", lineTotal: "50.00", descriptions: cafe, quantity: "5.000" },
        { vatRate: "10.00", lineTotal: "30.00", descriptions: tostada, quantity: "3.000" },
        { vatRate: "10.00", lineTotal: "10.00", descriptions: zumo, quantity: "1.000" },
      ],
    });
    const rows = await run({ limit: 2 });
    expect(rows.map((r) => r.descriptions.es)).toEqual(["Café", "Tostada"]);
    expect(rows[0]!.quantity).toBe("5.000");
  });

  it("collapses two sales of the same product into one summed row", async () => {
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "20.00",
      lines: [{ vatRate: "10.00", lineTotal: "20.00", descriptions: cafe, quantity: "2.000" }],
    });
    await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: noonUtc,
      total: "20.00",
      lines: [{ vatRate: "10.00", lineTotal: "20.00", descriptions: cafe, quantity: "2.000" }],
    });
    const rows = await run();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ descriptions: cafe, quantity: "4.000", total: "40.00" });
  });

  it("returns the frozen descriptions map intact (jsonb → object)", async () => {
    const label = { es: "Café", en: "Coffee" };
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "10.00",
      lines: [{ vatRate: "10.00", lineTotal: "10.00", descriptions: label, quantity: "1.000" }],
    });
    const rows = await run();
    expect(rows[0]!.descriptions).toEqual(label);
    expect(rows[0]!.descriptions.es).toBe("Café");
  });

  it("scopes to nodeId: a line under another node in the same tenant is excluded", async () => {
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "30.00",
      lines: [{ vatRate: "10.00", lineTotal: "30.00", descriptions: cafe, quantity: "3.000" }],
    });
    const nodeB = await seedNodeAndSeries(suite.db, venue);
    await seedSale(
      suite.db,
      { ...venue, nodeId: nodeB.nodeId, seriesId: nodeB.seriesId },
      {
        invoiceNumber: 1,
        issuedAt: noonUtc,
        total: "100.00",
        lines: [{ vatRate: "10.00", lineTotal: "100.00", descriptions: cafe, quantity: "10.000" }],
      },
    );
    // Only node A's 3.000 — never node B's 10.000. Dropping the node predicate would total 13.000.
    const rows = await run();
    expect(rows).toEqual([{ descriptions: cafe, quantity: "3.000", total: "30.00" }]);
  });

  it("aggregates across all nodes when nodeId is omitted", async () => {
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "30.00",
      lines: [{ vatRate: "10.00", lineTotal: "30.00", descriptions: cafe, quantity: "3.000" }],
    });
    const nodeB = await seedNodeAndSeries(suite.db, venue);
    await seedSale(
      suite.db,
      { ...venue, nodeId: nodeB.nodeId, seriesId: nodeB.seriesId },
      {
        invoiceNumber: 1,
        issuedAt: noonUtc,
        total: "100.00",
        lines: [{ vatRate: "10.00", lineTotal: "100.00", descriptions: cafe, quantity: "10.000" }],
      },
    );
    const rows = await run({ nodeId: undefined });
    expect(rows).toEqual([{ descriptions: cafe, quantity: "13.000", total: "130.00" }]);
  });

  it("excludes a voided sale", async () => {
    const voided = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "50.00",
      lines: [{ vatRate: "10.00", lineTotal: "50.00", descriptions: cafe, quantity: "5.000" }],
    });
    await seedVoid(suite.db, { tenantId: venue.tenantId, saleId: voided }, noonUtc);
    await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: noonUtc,
      total: "10.00",
      lines: [{ vatRate: "10.00", lineTotal: "10.00", descriptions: tostada, quantity: "1.000" }],
    });
    // The voided Café is gone; only the live Tostada remains.
    const rows = await run();
    expect(rows).toEqual([{ descriptions: tostada, quantity: "1.000", total: "10.00" }]);
  });

  it("excludes an F3-canje substitute but keeps the substituted ticket", async () => {
    const ticket = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "20.00",
      lines: [{ vatRate: "10.00", lineTotal: "20.00", descriptions: cafe, quantity: "2.000" }],
    });
    const f3 = await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: noonUtc,
      total: "20.00",
      lines: [{ vatRate: "10.00", lineTotal: "20.00", descriptions: cafe, quantity: "2.000" }],
    });
    await seedSubstitution(suite.db, {
      tenantId: venue.tenantId,
      substitutionSaleId: f3,
      substitutedSaleId: ticket,
    });
    // Only the ticket's 2.000, not doubled to 4.000 by the excluded F3 substitute.
    const rows = await run();
    expect(rows).toEqual([{ descriptions: cafe, quantity: "2.000", total: "20.00" }]);
  });

  it("nets a correction's signed quantity down into the product total", async () => {
    const original = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "30.00",
      lines: [{ vatRate: "10.00", lineTotal: "30.00", descriptions: cafe, quantity: "3.000" }],
    });
    await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: noonUtc,
      total: "-10.00",
      correctsSaleId: original,
      lines: [{ vatRate: "10.00", lineTotal: "-10.00", descriptions: cafe, quantity: "-1.000" }],
    });
    // 3.000 sold − 1.000 returned = 2.000 net; 30.00 − 10.00 = 20.00 net.
    const rows = await run();
    expect(rows).toEqual([{ descriptions: cafe, quantity: "2.000", total: "20.00" }]);
  });

  it("buckets by issuance and the cutover: a 01:30-local sale is outside its calendar day", async () => {
    // 2026-08-04 01:30 Madrid = 2026-08-03T23:30Z. With a 05:00 cutover it is business day 08-03.
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: new Date("2026-08-03T23:30:00Z").toISOString(),
      total: "50.00",
      lines: [{ vatRate: "10.00", lineTotal: "50.00", descriptions: cafe, quantity: "5.000" }],
    });
    expect(await run({ fromBusinessDay: "2026-08-04", toBusinessDay: "2026-08-04" })).toEqual([]);
    expect(await run({ fromBusinessDay: "2026-08-03", toBusinessDay: "2026-08-03" })).toEqual([
      { descriptions: cafe, quantity: "5.000", total: "50.00" },
    ]);
  });

  it("returns [] for an empty range", async () => {
    expect(await run()).toEqual([]);
  });

  it("excludes another tenant's sales (RLS + the tenant predicate)", async () => {
    const other = await seedVenue(suite.db);
    await seedSale(suite.db, other, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "50.00",
      lines: [{ vatRate: "10.00", lineTotal: "50.00", descriptions: cafe, quantity: "5.000" }],
    });
    expect(await run()).toEqual([]);
  });
});
