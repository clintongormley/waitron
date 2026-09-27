import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { SaleLineClassification } from "@waitron/shared";
import { seedVenue, seedVoid } from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import {
  at,
  chain,
  classified,
  CUTOVER,
  labelRows,
  rows,
  sellLines,
  TZ,
} from "../test/category-fixtures.js";
import type { LineSpec } from "../test/category-fixtures.js";
import { computeCategorySales } from "./category-sales.js";
import type { CategoryReport, CategorySalesInput } from "./category-sales.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

let venue: SeededVenue;

beforeEach(async () => {
  venue = await seedVenue(suite.db);
});

function sell(day: string, lines: LineSpec[]) {
  return sellLines(suite.db, venue, at(day), lines);
}

/** Today's set-up, as the catalogue's `currentClassifications` would answer it. */
const TODAY: Record<string, SaleLineClassification> = {
  "p-negroni": classified(
    chain(["cat-drinks", "Drinks"], ["cat-spirits", "Spirits"], ["cat-cocktails", "Cocktails"]),
    [{ id: "lab-happy", name: "Two for one" }],
  ),
  "p-cola": classified(chain(["cat-softs", "Refrescos"])),
  "p-water": classified([]),
  "p-burger": classified(chain(["cat-food", "Food"], ["cat-burgers", "Burgers"])),
  "p-cheese": classified(chain(["cat-extras", "Extras"])),
};

function todaysClassifier() {
  return vi.fn(async (ids: readonly string[]) => {
    const known = ids.filter((id) => TODAY[id] !== undefined);
    return new Map(known.map((id) => [id, TODAY[id]!]));
  });
}

function run(
  classifier: ReturnType<typeof todaysClassifier>,
  overrides: Partial<CategorySalesInput> = {},
): Promise<CategoryReport> {
  const input: CategorySalesInput = {
    nodeId: venue.nodeId,
    fromBusinessDay: "2026-08-01",
    toBusinessDay: "2026-08-31",
    timeZone: TZ,
    dayCutover: CUTOVER,
    mode: "current",
    ...overrides,
  };
  return withTransaction(suite.db, (tx) => computeCategorySales(tx, input, classifier));
}

describe("computeCategorySales in current categories", () => {
  it("puts every line of a product under today's chain and today's names, whatever each recorded", async () => {
    await sell("2026-08-03", [
      {
        productId: "p-negroni",
        net: "10.00",
        gross: "11.00",
        cls: classified(
          chain(
            ["cat-drinks", "Drinks"],
            ["cat-alcoholic", "Alcoholic drinks"],
            ["cat-cocktails", "Cocktails"],
          ),
          [{ id: "lab-happy", name: "Happy hour" }],
        ),
      },
    ]);
    await sell("2026-08-20", [
      {
        productId: "p-negroni",
        net: "20.00",
        gross: "22.00",
        cls: classified(
          chain(
            ["cat-drinks", "Drinks"],
            ["cat-spirits", "Spirits"],
            ["cat-cocktails", "Cocktails"],
          ),
        ),
      },
      {
        productId: "p-cola",
        net: "3.00",
        gross: "3.30",
        cls: classified(chain(["cat-softs", "Soft drinks"])),
      },
    ]);

    const report = await run(todaysClassifier());

    expect(report.mode).toBe("current");
    expect(rows(report.tree).map((r) => `${r.path}: ${r.gross}/${r.net} ${r.direct}`)).toEqual([
      "Drinks: 33.00/30.00 0.00/0.00/0",
      "Drinks > Spirits: 33.00/30.00 0.00/0.00/0",
      "Drinks > Spirits > Cocktails: 33.00/30.00 33.00/30.00/2",
      "Refrescos: 3.30/3.00 3.30/3.00/1",
    ]);
    expect(labelRows(report)).toEqual(["Two for one [lab-happy]: 33.00/30.00"]);
  });

  it("puts a line with no product, or a product that no longer exists, under Not recorded with no children", async () => {
    await sell("2026-08-04", [
      { net: "1.00", category: "Tapas" },
      {
        productId: "p-deleted",
        net: "2.00",
        gross: "2.20",
        category: "Tapas",
        cls: classified([]),
      },
      { productId: "p-water", net: "4.00", gross: "4.40" },
    ]);

    const report = await run(todaysClassifier());

    expect(rows(report.tree)).toEqual([
      {
        path: "(uncategorised)",
        id: "uncategorised",
        depth: 0,
        gross: "4.40",
        net: "4.00",
        direct: "4.40/4.00/1",
      },
      {
        path: "(not_recorded)",
        id: "not_recorded",
        depth: 0,
        gross: "2.20",
        net: "3.00",
        direct: "2.20/3.00/2",
      },
    ]);
    expect(report).toMatchObject({ grossComplete: false, linesWithoutGross: 1 });
  });

  it("subtracts a void under today's classification of its product", async () => {
    const sale = await sell("2026-07-30", [
      {
        productId: "p-cola",
        net: "3.00",
        gross: "3.30",
        cls: classified(chain(["cat-softs", "Softs"])),
      },
    ]);
    await seedVoid(suite.db, { saleId: sale }, at("2026-08-02"));

    const report = await run(todaysClassifier());

    expect(rows(report.tree).map((r) => `${r.path}: ${r.gross}/${r.net}`)).toEqual([
      "Refrescos: -3.30/-3.00",
    ]);
  });

  it("asks the classifier once, with each product id once", async () => {
    await sell("2026-08-04", [
      { productId: "p-cola", net: "1.00", gross: "1.10" },
      { productId: "p-water", net: "1.00", gross: "1.10" },
      { productId: "p-cola", net: "1.00", gross: "1.10" },
      { net: "1.00" },
    ]);
    await sell("2026-08-05", [{ productId: "p-water", net: "1.00", gross: "1.10" }]);
    const classifier = todaysClassifier();

    await run(classifier);

    expect(classifier).toHaveBeenCalledTimes(1);
    expect([...classifier.mock.calls[0]![0]].sort()).toEqual(["p-cola", "p-water"]);
  });

  it("classifies an extra by its dish's product with extrasIntoDish, and by its own without", async () => {
    const dish = randomUUID();
    await sell("2026-08-04", [
      { id: dish, productId: "p-burger", net: "10.00", gross: "11.00" },
      { parentLineId: dish, productId: "p-cheese", net: "1.00", gross: "1.10" },
    ]);

    const ownClassifier = todaysClassifier();
    const own = await run(ownClassifier);

    expect(rows(own.tree).map((r) => `${r.path}: ${r.gross}/${r.net}`)).toEqual([
      "Extras: 1.10/1.00",
      "Food: 11.00/10.00",
      "Food > Burgers: 11.00/10.00",
    ]);
    expect([...ownClassifier.mock.calls[0]![0]].sort()).toEqual(["p-burger", "p-cheese"]);

    const rolledClassifier = todaysClassifier();
    const rolled = await run(rolledClassifier, { extrasIntoDish: true });

    expect(rows(rolled.tree).map((r) => `${r.path}: ${r.gross}/${r.net} ${r.direct}`)).toEqual([
      "Food: 12.10/11.00 0.00/0.00/0",
      "Food > Burgers: 12.10/11.00 12.10/11.00/2",
    ]);
    expect(rolledClassifier.mock.calls[0]![0]).toEqual(["p-burger"]);
  });
});
