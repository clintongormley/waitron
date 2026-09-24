import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
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

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

let venue: SeededVenue;
const DAY = "2026-08-04";
const TZ = "Europe/Madrid";
// 2026-08-04 12:00 local (Madrid is UTC+2 in August), well inside the 05:00-cutover business day.
const noonUtc = new Date("2026-08-04T10:00:00Z").toISOString();

// Every product below carries a STAFF name and a customer-facing name that deliberately differ, so a
// test that reads the customer text instead of the staff name fails rather than passing by
// coincidence (this branch has already shipped one report defect for exactly that reason).
const coffeeName = "Coffee";
const coffeeText = { es: "Café" };
const toastName = "Toast";
const toastText = { es: "Tostada" };
const juiceName = "Juice";
const juiceText = { es: "Zumo" };
const doubleName = "Double";
const doubleText = { es: "Doble" };
const singleName = "Single";
const singleText = { es: "Sencillo" };

beforeEach(async () => {
  venue = await seedVenue(suite.db);
});

function run(overrides: Partial<TopSellersInput> = {}): Promise<TopSeller[]> {
  const input: TopSellersInput = {
    nodeId: venue.nodeId,
    fromBusinessDay: DAY,
    toBusinessDay: DAY,
    timeZone: TZ,
    dayCutover: "05:00",
    limit: 5,
    ...overrides,
  };
  return withTransaction(suite.db, async (tx) => {
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

  it("totals sub-euro line amounts exactly — the money column counts whole cents", async () => {
    // Amounts with a non-zero cents part, and two lines of the same product so the sum is taken in
    // cents and converted once: 1234 + 1 = 1235 cents is 12.35. Every other case in this file uses
    // whole euros, which a wrongly-scaled read can still render plausibly.
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "12.35",
      lines: [
        {
          vatRate: "10.00",
          lineTotal: "12.34",
          name: coffeeName,
          descriptions: coffeeText,
          quantity: "1.000",
        },
        {
          vatRate: "10.00",
          lineTotal: "0.01",
          name: coffeeName,
          descriptions: coffeeText,
          quantity: "1.000",
        },
      ],
    });
    expect(await run()).toEqual([
      { name: coffeeName, quantity: "2.000", total: "12.35", variants: [] },
    ]);
  });

  it("ranks products by summed quantity desc and respects the limit, labelled with the STAFF name", async () => {
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "90.00",
      lines: [
        {
          vatRate: "10.00",
          lineTotal: "50.00",
          name: coffeeName,
          descriptions: coffeeText,
          quantity: "5.000",
        },
        {
          vatRate: "10.00",
          lineTotal: "30.00",
          name: toastName,
          descriptions: toastText,
          quantity: "3.000",
        },
        {
          vatRate: "10.00",
          lineTotal: "10.00",
          name: juiceName,
          descriptions: juiceText,
          quantity: "1.000",
        },
      ],
    });
    const rows = await run({ limit: 2 });
    // The staff names ("Coffee"/"Toast"), never the customer text ("Café"/"Tostada").
    expect(rows.map((r) => r.name)).toEqual([coffeeName, toastName]);
    expect(rows[0]!.quantity).toBe("5.000");
  });

  it("breaks a quantity tie between products by staff name", async () => {
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "30.00",
      lines: [
        {
          vatRate: "10.00",
          lineTotal: "20.00",
          name: toastName,
          descriptions: toastText,
          quantity: "2.000",
        },
        {
          vatRate: "10.00",
          lineTotal: "10.00",
          name: juiceName,
          descriptions: juiceText,
          quantity: "2.000",
        },
      ],
    });
    // "Juice" before "Toast", whichever was sold first; with `limit: 1` only "Juice" is returned.
    expect((await run()).map((r) => r.name)).toEqual([juiceName, toastName]);
    expect((await run({ limit: 1 })).map((r) => r.name)).toEqual([juiceName]);
  });

  it("collapses two sales of the same product into one summed row", async () => {
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "20.00",
      lines: [
        {
          vatRate: "10.00",
          lineTotal: "20.00",
          name: coffeeName,
          descriptions: coffeeText,
          quantity: "2.000",
        },
      ],
    });
    await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: noonUtc,
      total: "20.00",
      lines: [
        {
          vatRate: "10.00",
          lineTotal: "20.00",
          name: coffeeName,
          descriptions: coffeeText,
          quantity: "2.000",
        },
      ],
    });
    const rows = await run();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ name: coffeeName, quantity: "4.000", total: "40.00", variants: [] });
  });

  it("nests a product's variants under it, each labelled with its own STAFF variant name", async () => {
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "83.00",
      lines: [
        {
          vatRate: "10.00",
          lineTotal: "50.00",
          name: coffeeName,
          descriptions: coffeeText,
          kitchenName: "CAFE",
          variantName: doubleName,
          variantDescriptions: doubleText,
          variantKitchenName: "DBL",
          quantity: "5.000",
        },
        {
          vatRate: "10.00",
          lineTotal: "20.00",
          name: coffeeName,
          descriptions: coffeeText,
          kitchenName: "CAFE",
          variantName: singleName,
          variantDescriptions: singleText,
          variantKitchenName: "SGL",
          quantity: "2.000",
        },
        // Coffee sold as itself, with no variant: it counts in Coffee's own figures and is not a
        // nested row.
        {
          vatRate: "10.00",
          lineTotal: "3.00",
          name: coffeeName,
          descriptions: coffeeText,
          kitchenName: "CAFE",
          quantity: "1.000",
        },
        {
          vatRate: "10.00",
          lineTotal: "10.00",
          name: toastName,
          descriptions: toastText,
          quantity: "1.000",
        },
      ],
    });

    expect(await run()).toEqual([
      {
        name: coffeeName,
        quantity: "8.000",
        total: "73.00",
        variants: [
          { name: doubleName, quantity: "5.000", total: "50.00" },
          { name: singleName, quantity: "2.000", total: "20.00" },
        ],
      },
      { name: toastName, quantity: "1.000", total: "10.00", variants: [] },
    ]);
  });

  it("counts a line frozen with an empty variant name as the product itself, as a blank name falls back", async () => {
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "3.00",
      lines: [
        {
          vatRate: "10.00",
          lineTotal: "3.00",
          name: coffeeName,
          descriptions: coffeeText,
          variantName: "",
          quantity: "1.000",
        },
      ],
    });
    expect(await run()).toEqual([
      { name: coffeeName, quantity: "1.000", total: "3.00", variants: [] },
    ]);
  });

  describe("the wine-by-the-glass fixture (spec §12)", () => {
    const wineName = "Wine by the glass";
    const wineText = { es: "Vino por copas" };
    const wine125Name = "Wine 125";
    const wine125Text = { es: "Copa pequeña" };
    const wine175Name = "Wine 175";
    const wine175Text = { es: "Copa grande" };
    const teaName = "Tea";
    const teaText = { es: "Té" };

    beforeEach(async () => {
      await seedSale(suite.db, venue, {
        invoiceNumber: 1,
        issuedAt: noonUtc,
        total: "28.50",
        lines: [
          {
            vatRate: "10.00",
            lineTotal: "8.00",
            name: wineName,
            descriptions: wineText,
            kitchenName: "VINO",
            variantName: wine125Name,
            variantDescriptions: wine125Text,
            variantKitchenName: "V125",
            quantity: "2.000",
          },
          {
            vatRate: "10.00",
            lineTotal: "16.50",
            name: wineName,
            descriptions: wineText,
            kitchenName: "VINO",
            variantName: wine175Name,
            variantDescriptions: wine175Text,
            variantKitchenName: "V175",
            quantity: "3.000",
          },
          {
            vatRate: "10.00",
            lineTotal: "4.00",
            name: teaName,
            descriptions: teaText,
            kitchenName: "TE",
            quantity: "2.000",
          },
        ],
      });
    });

    it("rolls the variants up into their parent's row, the larger seller nested first", async () => {
      expect(await run()).toEqual([
        {
          name: wineName,
          quantity: "5.000",
          total: "24.50",
          variants: [
            { name: wine175Name, quantity: "3.000", total: "16.50" },
            { name: wine125Name, quantity: "2.000", total: "8.00" },
          ],
        },
        { name: teaName, quantity: "2.000", total: "4.00", variants: [] },
      ]);
    });

    it("counts PARENT rows against the limit, and keeps every variant of the ones returned", async () => {
      expect(await run({ limit: 1 })).toEqual([
        {
          name: wineName,
          quantity: "5.000",
          total: "24.50",
          variants: [
            { name: wine175Name, quantity: "3.000", total: "16.50" },
            { name: wine125Name, quantity: "2.000", total: "8.00" },
          ],
        },
      ]);
    });

    it("nets a correction of one variant into that variant's row and into its parent's", async () => {
      await seedSale(suite.db, venue, {
        invoiceNumber: 2,
        issuedAt: noonUtc,
        total: "-5.50",
        correctsSaleId: await seedSale(suite.db, venue, {
          invoiceNumber: 3,
          issuedAt: noonUtc,
          total: "5.50",
          lines: [
            {
              vatRate: "10.00",
              lineTotal: "5.50",
              name: wineName,
              descriptions: wineText,
              variantName: wine175Name,
              variantDescriptions: wine175Text,
              quantity: "1.000",
            },
          ],
        }),
        lines: [
          {
            vatRate: "10.00",
            lineTotal: "-5.50",
            name: wineName,
            descriptions: wineText,
            variantName: wine175Name,
            variantDescriptions: wine175Text,
            quantity: "-1.000",
          },
        ],
      });
      // One more Wine 175 sold and then returned: every figure is back where it was.
      const rows = await run({ limit: 1 });
      expect(rows[0]!.quantity).toBe("5.000");
      expect(rows[0]!.total).toBe("24.50");
      expect(rows[0]!.variants).toEqual([
        { name: wine175Name, quantity: "3.000", total: "16.50" },
        { name: wine125Name, quantity: "2.000", total: "8.00" },
      ]);
    });

    it("leaves a variant line of a voided sale out of both its row and its parent's", async () => {
      const voided = await seedSale(suite.db, venue, {
        invoiceNumber: 2,
        issuedAt: noonUtc,
        total: "44.00",
        lines: [
          {
            vatRate: "10.00",
            lineTotal: "44.00",
            name: wineName,
            descriptions: wineText,
            variantName: wine125Name,
            variantDescriptions: wine125Text,
            quantity: "11.000",
          },
        ],
      });
      await seedVoid(suite.db, { saleId: voided }, noonUtc);
      expect(await run({ limit: 1 })).toEqual([
        {
          name: wineName,
          quantity: "5.000",
          total: "24.50",
          variants: [
            { name: wine175Name, quantity: "3.000", total: "16.50" },
            { name: wine125Name, quantity: "2.000", total: "8.00" },
          ],
        },
      ]);
    });
  });

  it("totals a parent exactly from variant amounts a binary float cannot hold — 0.10 + 0.20 is 0.30", async () => {
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "0.30",
      lines: [
        {
          vatRate: "10.00",
          lineTotal: "0.10",
          name: coffeeName,
          descriptions: coffeeText,
          variantName: singleName,
          variantDescriptions: singleText,
          quantity: "1.000",
        },
        {
          vatRate: "10.00",
          lineTotal: "0.20",
          name: coffeeName,
          descriptions: coffeeText,
          variantName: doubleName,
          variantDescriptions: doubleText,
          quantity: "1.000",
        },
      ],
    });
    expect(await run()).toEqual([
      {
        name: coffeeName,
        quantity: "2.000",
        total: "0.30",
        // Equal quantities: the variants fall back to name order.
        variants: [
          { name: doubleName, quantity: "1.000", total: "0.20" },
          { name: singleName, quantity: "1.000", total: "0.10" },
        ],
      },
    ]);
  });

  it("scopes to nodeId: a line under another node in the same tenant is excluded", async () => {
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "30.00",
      lines: [
        {
          vatRate: "10.00",
          lineTotal: "30.00",
          name: coffeeName,
          descriptions: coffeeText,
          quantity: "3.000",
        },
      ],
    });
    const nodeB = await seedNodeAndSeries(suite.db, venue);
    await seedSale(
      suite.db,
      { ...venue, nodeId: nodeB.nodeId, seriesId: nodeB.seriesId },
      {
        invoiceNumber: 1,
        issuedAt: noonUtc,
        total: "100.00",
        lines: [
          {
            vatRate: "10.00",
            lineTotal: "100.00",
            name: coffeeName,
            descriptions: coffeeText,
            quantity: "10.000",
          },
        ],
      },
    );
    // Only node A's 3.000 — never node B's 10.000. Dropping the node predicate would total 13.000.
    const rows = await run();
    expect(rows).toEqual([{ name: coffeeName, quantity: "3.000", total: "30.00", variants: [] }]);
  });

  it("aggregates across all nodes when nodeId is omitted", async () => {
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "30.00",
      lines: [
        {
          vatRate: "10.00",
          lineTotal: "30.00",
          name: coffeeName,
          descriptions: coffeeText,
          quantity: "3.000",
        },
      ],
    });
    const nodeB = await seedNodeAndSeries(suite.db, venue);
    await seedSale(
      suite.db,
      { ...venue, nodeId: nodeB.nodeId, seriesId: nodeB.seriesId },
      {
        invoiceNumber: 1,
        issuedAt: noonUtc,
        total: "100.00",
        lines: [
          {
            vatRate: "10.00",
            lineTotal: "100.00",
            name: coffeeName,
            descriptions: coffeeText,
            quantity: "10.000",
          },
        ],
      },
    );
    const rows = await run({ nodeId: undefined });
    expect(rows).toEqual([{ name: coffeeName, quantity: "13.000", total: "130.00", variants: [] }]);
  });

  it("excludes a voided sale", async () => {
    const voided = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "50.00",
      lines: [
        {
          vatRate: "10.00",
          lineTotal: "50.00",
          name: coffeeName,
          descriptions: coffeeText,
          quantity: "5.000",
        },
      ],
    });
    await seedVoid(suite.db, { saleId: voided }, noonUtc);
    await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: noonUtc,
      total: "10.00",
      lines: [
        {
          vatRate: "10.00",
          lineTotal: "10.00",
          name: toastName,
          descriptions: toastText,
          quantity: "1.000",
        },
      ],
    });
    // The voided Coffee is gone; only the live Toast remains.
    const rows = await run();
    expect(rows).toEqual([{ name: toastName, quantity: "1.000", total: "10.00", variants: [] }]);
  });

  it("excludes an F3-canje substitute but keeps the substituted ticket", async () => {
    const ticket = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "20.00",
      lines: [
        {
          vatRate: "10.00",
          lineTotal: "20.00",
          name: coffeeName,
          descriptions: coffeeText,
          quantity: "2.000",
        },
      ],
    });
    const f3 = await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: noonUtc,
      total: "20.00",
      lines: [
        {
          vatRate: "10.00",
          lineTotal: "20.00",
          name: coffeeName,
          descriptions: coffeeText,
          quantity: "2.000",
        },
      ],
    });
    await seedSubstitution(suite.db, {
      substitutionSaleId: f3,
      substitutedSaleId: ticket,
    });
    // Only the ticket's 2.000, not doubled to 4.000 by the excluded F3 substitute.
    const rows = await run();
    expect(rows).toEqual([{ name: coffeeName, quantity: "2.000", total: "20.00", variants: [] }]);
  });

  it("nets a correction's signed quantity down into the product total", async () => {
    const original = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "30.00",
      lines: [
        {
          vatRate: "10.00",
          lineTotal: "30.00",
          name: coffeeName,
          descriptions: coffeeText,
          quantity: "3.000",
        },
      ],
    });
    await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: noonUtc,
      total: "-10.00",
      correctsSaleId: original,
      lines: [
        {
          vatRate: "10.00",
          lineTotal: "-10.00",
          name: coffeeName,
          descriptions: coffeeText,
          quantity: "-1.000",
        },
      ],
    });
    // 3.000 sold − 1.000 returned = 2.000 net; 30.00 − 10.00 = 20.00 net.
    const rows = await run();
    expect(rows).toEqual([{ name: coffeeName, quantity: "2.000", total: "20.00", variants: [] }]);
  });

  it("buckets by issuance and the cutover: a 01:30-local sale is outside its calendar day", async () => {
    // 2026-08-04 01:30 Madrid = 2026-08-03T23:30Z. With a 05:00 cutover it is business day 08-03.
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: new Date("2026-08-03T23:30:00Z").toISOString(),
      total: "50.00",
      lines: [
        {
          vatRate: "10.00",
          lineTotal: "50.00",
          name: coffeeName,
          descriptions: coffeeText,
          quantity: "5.000",
        },
      ],
    });
    expect(await run({ fromBusinessDay: "2026-08-04", toBusinessDay: "2026-08-04" })).toEqual([]);
    expect(await run({ fromBusinessDay: "2026-08-03", toBusinessDay: "2026-08-03" })).toEqual([
      { name: coffeeName, quantity: "5.000", total: "50.00", variants: [] },
    ]);
  });

  it("returns [] for an empty range", async () => {
    expect(await run()).toEqual([]);
  });
});
