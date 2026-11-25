import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedSale, seedVenueWithSeries, seedVoid } from "../test/fixtures.js";
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

/** A row of a divided takeaway set menu as filed: its net, gross and stored part. */
const divided = (
  name: string,
  setMenuRole: "set_menu" | "dish",
  [lineTotal, lineGross, setMenuPart]: [string, string, string],
  vatRate = "10.00",
  id?: string,
) => ({
  ...line(name, setMenuRole, lineTotal),
  vatRate,
  lineGross,
  setMenuPart,
  ...(id === undefined ? {} : { id }),
});

/** A takeaway Lunch menu at 14.00 divided between soup (3.58, base 3.25) and
 * hake (8.14, base 7.40) at 10% and lemonade (2.28, base 1.88) at 21%; hake can carry a 2.00
 * supplement on its row. */
const lunchRows = (hake: [string, string, string] = ["7.40", "8.14", "8.14"], hakeId?: string) => [
  divided("Lunch menu", "set_menu", ["0.00", "0.00", "-14.00"]),
  divided("Soup", "dish", ["3.25", "3.58", "3.58"]),
  divided("Hake", "dish", hake, "10.00", hakeId),
  divided("Lemonade", "dish", ["1.88", "2.28", "2.28"], "21.00"),
];

const range = (fromBusinessDay: string) => ({
  cutoverChanges: [],
  fromBusinessDay,
  toBusinessDay: "2026-08-05",
  timeZone: "Europe/Madrid",
  dayCutover: "05:00",
  limit: 10,
});

async function sellers(fromBusinessDay = "2026-08-04") {
  const top = await withTransaction(suite.db, (tx) =>
    computeTopSellers(tx, { ...range(fromBusinessDay), nodeIds: [venue.nodeId] }),
  );
  return top.map(({ name, quantity, total }) => [name, quantity, total]);
}

const AUG_4 = new Date("2026-08-04T10:00:00Z").toISOString();

describe("computeTopSellers with a divided takeaway set menu", () => {
  it("counts the set menu at the net of its whole price and its dishes at 0.00", async () => {
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: AUG_4,
      total: "14.00",
      lines: lunchRows(),
    });

    expect(await sellers()).toEqual([
      ["Hake", "1.000", "0.00"],
      ["Lemonade", "1.000", "0.00"],
      ["Lunch menu", "1.000", "12.53"],
      ["Soup", "1.000", "0.00"],
    ]);
  });

  it("keeps a supplement's net on its dish", async () => {
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: AUG_4,
      total: "16.00",
      lines: lunchRows(["9.22", "10.14", "8.14"]),
    });

    expect(await sellers()).toEqual([
      ["Hake", "1.000", "1.82"],
      ["Lemonade", "1.000", "0.00"],
      ["Lunch menu", "1.000", "12.53"],
      ["Soup", "1.000", "0.00"],
    ]);
  });

  it("takes a void off the set menu by its net", async () => {
    const saleId = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: new Date("2026-08-02T10:00:00Z").toISOString(),
      total: "14.00",
      lines: lunchRows(),
    });
    await seedVoid(suite.db, { saleId }, AUG_4);

    expect(await sellers()).toEqual([
      ["Hake", "-1.000", "0.00"],
      ["Lemonade", "-1.000", "0.00"],
      ["Lunch menu", "-1.000", "-12.53"],
      ["Soup", "-1.000", "0.00"],
    ]);
  });

  it("takes goodwill off a covered dish's part from the set menu it was sold in", async () => {
    const hake = crypto.randomUUID();
    const original = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: AUG_4,
      total: "14.00",
      lines: lunchRows(undefined, hake),
    });
    await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: new Date("2026-08-05T10:00:00Z").toISOString(),
      total: "-1.00",
      correctsSaleId: original,
      lines: [{ ...divided("Hake", "dish", ["-0.91", "-1.00", "-1.00"]), correctsLineId: hake }],
    });

    expect(await sellers()).toEqual([
      ["Hake", "1.000", "0.00"],
      ["Lemonade", "1.000", "0.00"],
      ["Lunch menu", "1.000", "11.62"],
      ["Soup", "1.000", "0.00"],
    ]);
  });

  it("shares the moved net between two divided set menus of one sale by their prices", async () => {
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: AUG_4,
      total: "20.00",
      lines: [
        ...lunchRows(),
        divided("Kids menu", "set_menu", ["0.00", "0.00", "-6.00"]),
        divided("Pasta", "dish", ["3.64", "4.00", "4.00"]),
        divided("Juice", "dish", ["1.65", "2.00", "2.00"], "21.00"),
      ],
    });

    // 17.82 of net moved over 20.00 of set-menu prices: 14.00 of it is 12.47, the rest 5.35.
    expect(await sellers()).toEqual([
      ["Hake", "1.000", "0.00"],
      ["Juice", "1.000", "0.00"],
      ["Kids menu", "1.000", "5.35"],
      ["Lemonade", "1.000", "0.00"],
      ["Lunch menu", "1.000", "12.47"],
      ["Pasta", "1.000", "0.00"],
      ["Soup", "1.000", "0.00"],
    ]);
  });
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
