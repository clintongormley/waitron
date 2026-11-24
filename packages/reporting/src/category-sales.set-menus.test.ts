import { beforeEach, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { SaleLineClassification } from "@waitron/shared";
import { seedVenueWithSeries, seedVoid } from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import { at, chain, classified, CUTOVER, rows, sellLines, TZ } from "../test/category-fixtures.js";
import type { LineSpec } from "../test/category-fixtures.js";
import { computeCategorySales } from "./category-sales.js";
import type { CategoryReport, CategoryReportMode } from "./category-sales.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

let venue: SeededVenue;

beforeEach(async () => {
  venue = await seedVenueWithSeries(suite.db);
});

const STARTERS = classified(chain(["cat-starters", "Starters"]));
const MAINS = classified(chain(["cat-mains", "Mains"]));
const DRINKS = classified(chain(["cat-drinks", "Drinks"]));
const CLASSES: Record<string, SaleLineClassification> = {
  "p-lemonade": DRINKS,
  "p-soup": STARTERS,
  "p-hake": MAINS,
  "p-sea-bass": MAINS,
  "p-sirloin": MAINS,
};

const setMenu = (net: string, gross: string): LineSpec => ({ net, gross, setMenuRole: "set_menu" });
const dish = (productId: string, net = "0.00", gross = "0.00", id?: string): LineSpec => ({
  net,
  gross,
  productId,
  cls: CLASSES[productId],
  setMenuRole: "dish",
  ...(id === undefined ? {} : { id }),
});

/** The plan's bill as filed: 2 Daily at 14.00, 2 Special at 20.00, 4 Soup, Hake, Sea bass and
 * 2 Sirloin, one with a 5.00 supplement; 73.00. A set-menu line records no product. */
function specSale(sirloinId?: string, day = "2026-08-04") {
  return sellLines(suite.db, venue, at(day), [
    setMenu("12.73", "14.00"),
    setMenu("12.73", "14.00"),
    setMenu("18.18", "20.00"),
    setMenu("18.18", "20.00"),
    ...Array.from({ length: 4 }, () => dish("p-soup")),
    dish("p-hake"),
    dish("p-sea-bass"),
    dish("p-sirloin"),
    dish("p-sirloin", "4.55", "5.00", sirloinId),
  ]);
}

function run(mode: CategoryReportMode): Promise<CategoryReport> {
  const classifier = vi.fn(async (ids: readonly string[]) => {
    return new Map(ids.filter((id) => CLASSES[id]).map((id) => [id, CLASSES[id]!]));
  });
  return withTransaction(suite.db, (tx) =>
    computeCategorySales(
      tx,
      {
        cutoverChanges: [],
        nodeIds: [venue.nodeId],
        fromBusinessDay: "2026-08-01",
        toBusinessDay: "2026-08-31",
        timeZone: TZ,
        dayCutover: CUTOVER,
        mode,
      },
      classifier,
    ),
  );
}

describe("computeCategorySales with set menus", () => {
  it("category sales put set menus in their own group", async () => {
    await specSale();

    for (const mode of ["at_time_of_sale", "current"] as const) {
      const report = await run(mode);

      expect(rows(report.tree), mode).toEqual([
        {
          path: "Mains",
          id: "cat-mains",
          depth: 0,
          gross: "5.00",
          net: "4.55",
          direct: "5.00/4.55/4",
        },
        {
          path: "Starters",
          id: "cat-starters",
          depth: 0,
          gross: "0.00",
          net: "0.00",
          direct: "0.00/0.00/4",
        },
        {
          path: "(set_menus)",
          id: "set_menus",
          depth: 0,
          gross: "68.00",
          net: "61.82",
          direct: "68.00/61.82/4",
        },
      ]);
      expect([report.gross, report.net], mode).toEqual(["73.00", "66.37"]);
    }
  });

  it.each<CategoryReportMode>(["at_time_of_sale", "current"])(
    "counts a correction of one set-menu dish alone under its product's category (%s)",
    async (mode) => {
      const sirloin = crypto.randomUUID();
      const original = await specSale(sirloin);
      await sellLines(
        suite.db,
        venue,
        at("2026-08-05"),
        [{ ...dish("p-sirloin", "-4.55", "-5.00"), correctsLineId: sirloin }],
        original,
      );

      const report = await run(mode);

      expect(rows(report.tree).map(({ path, gross, direct }) => [path, gross, direct])).toEqual([
        ["Mains", "0.00", "0.00/0.00/5"],
        ["Starters", "0.00", "0.00/0.00/4"],
        ["(set_menus)", "68.00", "68.00/61.82/4"],
      ]);
    },
  );

  it("takes a void of a set-menu sale off the Set menus group, in both modes", async () => {
    // Sold before the range, voided inside it: only the reversed lines count.
    const sale = await specSale(undefined, "2026-07-31");
    await seedVoid(suite.db, { saleId: sale }, at("2026-08-05"));

    for (const mode of ["at_time_of_sale", "current"] as const) {
      const report = await run(mode);

      expect(
        rows(report.tree).map(({ path, gross, direct }) => [path, gross, direct]),
        mode,
      ).toEqual([
        ["Mains", "-5.00", "-5.00/-4.55/4"],
        ["Starters", "0.00", "0.00/0.00/4"],
        ["(set_menus)", "-68.00", "-68.00/-61.82/4"],
      ]);
      expect([report.gross, report.net], mode).toEqual(["-73.00", "-66.37"]);
    }
  });
});

/** A takeaway Lunch menu at 14.00 as filed, divided between soup (3.58,
 * base 3.25) and hake (8.14, base 7.40) at 10% and lemonade (2.28, base 1.88) at 21%; hake can
 * carry a supplement on its row. */
function lunchLines(hakeSupplement: "none" | "2.00" = "none", hakeId?: string): LineSpec[] {
  const part = (spec: LineSpec, setMenuPart: string, vatRate = "10.00"): LineSpec => ({
    ...spec,
    setMenuPart,
    vatRate,
  });
  return [
    part(setMenu("0.00", "0.00"), "-14.00"),
    part(dish("p-soup", "3.25", "3.58"), "3.58"),
    hakeSupplement === "none"
      ? part(dish("p-hake", "7.40", "8.14", hakeId), "8.14")
      : part(dish("p-hake", "9.22", "10.14", hakeId), "8.14"),
    part(dish("p-lemonade", "1.88", "2.28"), "2.28", "21.00"),
  ];
}

describe("computeCategorySales with a divided takeaway set menu", () => {
  it("counts the whole set menu under Set menus and its dishes at 0.00, in both modes", async () => {
    await sellLines(suite.db, venue, at("2026-08-04"), lunchLines());

    for (const mode of ["at_time_of_sale", "current"] as const) {
      const report = await run(mode);

      expect(
        rows(report.tree).map(({ path, gross, net, direct }) => [path, gross, net, direct]),
        mode,
      ).toEqual([
        ["Drinks", "0.00", "0.00", "0.00/0.00/1"],
        ["Mains", "0.00", "0.00", "0.00/0.00/1"],
        ["Starters", "0.00", "0.00", "0.00/0.00/1"],
        ["(set_menus)", "14.00", "12.53", "14.00/12.53/1"],
      ]);
      expect([report.gross, report.net], mode).toEqual(["14.00", "12.53"]);
    }
  });

  it("keeps a supplement under its dish's category, its net the remainder", async () => {
    await sellLines(suite.db, venue, at("2026-08-04"), lunchLines("2.00"));

    const report = await run("at_time_of_sale");

    expect(rows(report.tree).map(({ path, gross, net }) => [path, gross, net])).toEqual([
      ["Drinks", "0.00", "0.00"],
      ["Mains", "2.00", "1.82"],
      ["Starters", "0.00", "0.00"],
      ["(set_menus)", "14.00", "12.53"],
    ]);
    expect([report.gross, report.net]).toEqual(["16.00", "14.35"]);
  });

  it("takes a void off Set menus by the sold amounts", async () => {
    const sale = await sellLines(suite.db, venue, at("2026-07-31"), lunchLines("2.00"));
    await seedVoid(suite.db, { saleId: sale }, at("2026-08-05"));

    const report = await run("at_time_of_sale");

    expect(rows(report.tree).map(({ path, gross, net }) => [path, gross, net])).toEqual([
      ["Drinks", "0.00", "0.00"],
      ["Mains", "-2.00", "-1.82"],
      ["Starters", "0.00", "0.00"],
      ["(set_menus)", "-14.00", "-12.53"],
    ]);
    expect([report.gross, report.net]).toEqual(["-16.00", "-14.35"]);
  });

  it("takes goodwill off a covered dish's part from Set menus", async () => {
    const hake = crypto.randomUUID();
    const original = await sellLines(suite.db, venue, at("2026-08-04"), lunchLines("none", hake));
    await sellLines(
      suite.db,
      venue,
      at("2026-08-05"),
      [{ ...dish("p-hake", "-0.91", "-1.00"), setMenuPart: "-1.00", correctsLineId: hake }],
      original,
    );

    const report = await run("at_time_of_sale");

    expect(
      rows(report.tree).map(({ path, gross, net, direct }) => [path, gross, net, direct]),
    ).toEqual([
      ["Drinks", "0.00", "0.00", "0.00/0.00/1"],
      ["Mains", "0.00", "0.00", "0.00/0.00/2"],
      ["Starters", "0.00", "0.00", "0.00/0.00/1"],
      ["(set_menus)", "13.00", "11.62", "13.00/11.62/1"],
    ]);
    expect([report.gross, report.net]).toEqual(["13.00", "11.62"]);
  });
});
