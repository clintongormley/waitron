import { beforeEach, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { SaleLineClassification } from "@waitron/shared";
import { seedVenueWithSeries } from "../test/fixtures.js";
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
const CLASSES: Record<string, SaleLineClassification> = {
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
function specSale(sirloinId?: string) {
  return sellLines(suite.db, venue, at("2026-08-04"), [
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
});
