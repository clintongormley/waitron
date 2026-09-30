import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { SaleLineClassification } from "@waitron/shared";
import { seedNodeAndSeries, seedSubstitution, seedVenue, seedVoid } from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import { at, chain, classified, CUTOVER, rows, sellLines, TZ } from "../test/category-fixtures.js";
import type { LineSpec } from "../test/category-fixtures.js";
import { computeCategorySales } from "./category-sales.js";
import type { CategoryReport, CategorySalesInput, CurrentClassifier } from "./category-sales.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

let venue: SeededVenue;

beforeEach(async () => {
  venue = await seedVenue(suite.db);
});

const DRINKS: [string, string] = ["cat-drinks", "Drinks"];
const ALCOHOLIC: [string, string] = ["cat-alcoholic", "Alcoholic drinks"];
const SPIRITS: [string, string] = ["cat-spirits", "Spirits"];
const COCKTAILS: [string, string] = ["cat-cocktails", "Cocktails"];
const SOFTS: [string, string] = ["cat-softs", "Softs"];

function sell(day: string, lines: LineSpec[]) {
  return sellLines(suite.db, venue, at(day), lines);
}

function run(
  overrides: Partial<CategorySalesInput> = {},
  classifier?: CurrentClassifier,
): Promise<CategoryReport> {
  const input: CategorySalesInput = {
    nodeId: venue.nodeId,
    fromBusinessDay: "2026-08-01",
    toBusinessDay: "2026-08-31",
    timeZone: TZ,
    dayCutover: CUTOVER,
    mode: "at_time_of_sale",
    ...overrides,
  };
  return withTransaction(suite.db, (tx) => computeCategorySales(tx, input, classifier));
}

describe("computeCategorySales: preconditions", () => {
  it.each<[string, Partial<CategorySalesInput>, RegExp]>([
    ["an unknown time zone", { timeZone: "Nowhere/Nope" }, /time zone/i],
    ["a malformed cutover", { dayCutover: "5:00" }, /cutover/i],
    ["a malformed business day", { fromBusinessDay: "01/08/2026" }, /business day/i],
    ["a range that ends before it starts", { fromBusinessDay: "2026-09-01" }, /on or before/i],
    ["an unknown mode", { mode: "yesterday" as never }, /mode/i],
    ["current mode with no classifier", { mode: "current" }, /classifier/i],
  ])("refuses %s before any query runs", async (_case, overrides, message) => {
    const execute = vi.fn();
    const tx = { execute } as unknown as Transaction;
    const input: CategorySalesInput = {
      fromBusinessDay: "2026-08-01",
      toBusinessDay: "2026-08-31",
      timeZone: TZ,
      dayCutover: CUTOVER,
      mode: "at_time_of_sale",
      ...overrides,
    };

    await expect(computeCategorySales(tx, input)).rejects.toThrow(message);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("computeCategorySales at time of sale", () => {
  it("reports an empty period as an empty, complete report in its mode", async () => {
    expect(await run()).toEqual({
      mode: "at_time_of_sale",
      tree: [],
      gross: "0.00",
      net: "0.00",
      grossComplete: true,
      linesWithoutGross: 0,
    });
  });

  it("sums many sub-euro lines exactly, over whole cents", async () => {
    const line: LineSpec = { net: "0.10", gross: "0.11", cls: classified(chain(DRINKS)) };
    await sell(
      "2026-08-04",
      Array.from({ length: 30 }, () => line),
    );

    const report = await run();

    expect(rows(report.tree)).toEqual([
      {
        path: "Drinks",
        id: "cat-drinks",
        depth: 0,
        gross: "3.30",
        net: "3.00",
        direct: "3.30/3.00/30",
      },
    ]);
    expect([report.gross, report.net]).toEqual(["3.30", "3.00"]);
  });

  it("splits a category moved mid-period across each parent it had, never grouping by its id alone", async () => {
    await sell("2026-08-03", [
      { net: "10.00", gross: "11.00", cls: classified(chain(DRINKS, ALCOHOLIC, COCKTAILS)) },
    ]);
    await sell("2026-08-20", [
      { net: "20.00", gross: "22.00", cls: classified(chain(DRINKS, SPIRITS, COCKTAILS)) },
    ]);

    const report = await run();

    expect(rows(report.tree)).toEqual([
      {
        path: "Drinks",
        id: "cat-drinks",
        depth: 0,
        gross: "33.00",
        net: "30.00",
        direct: "0.00/0.00/0",
      },
      {
        path: "Drinks > Alcoholic drinks",
        id: "cat-alcoholic",
        depth: 1,
        gross: "11.00",
        net: "10.00",
        direct: "0.00/0.00/0",
      },
      {
        path: "Drinks > Alcoholic drinks > Cocktails",
        id: "cat-cocktails",
        depth: 2,
        gross: "11.00",
        net: "10.00",
        direct: "11.00/10.00/1",
      },
      {
        path: "Drinks > Spirits",
        id: "cat-spirits",
        depth: 1,
        gross: "22.00",
        net: "20.00",
        direct: "0.00/0.00/0",
      },
      {
        path: "Drinks > Spirits > Cocktails",
        id: "cat-cocktails",
        depth: 2,
        gross: "22.00",
        net: "20.00",
        direct: "22.00/20.00/1",
      },
    ]);
    expect([report.gross, report.net]).toEqual(["33.00", "30.00"]);
  });

  it("subtracts a sale voided the next day under the chain it recorded, and cancels a sale voided inside the window", async () => {
    const before = await sell("2026-08-04", [
      { net: "10.00", gross: "11.00", cls: classified(chain(DRINKS, ALCOHOLIC, COCKTAILS)) },
    ]);
    await seedVoid(suite.db, { saleId: before }, at("2026-08-05"));
    await sell("2026-08-05", [
      { net: "20.00", gross: "22.00", cls: classified(chain(DRINKS, SPIRITS, COCKTAILS)) },
    ]);
    const sameDay = await sell("2026-08-05", [
      { net: "7.00", gross: "7.70", cls: classified(chain(SOFTS)) },
    ]);
    await seedVoid(suite.db, { saleId: sameDay }, at("2026-08-05", "11:00"));

    const fifth = await run({ fromBusinessDay: "2026-08-05", toBusinessDay: "2026-08-05" });

    expect(rows(fifth.tree)).toEqual([
      {
        path: "Drinks",
        id: "cat-drinks",
        depth: 0,
        gross: "11.00",
        net: "10.00",
        direct: "0.00/0.00/0",
      },
      {
        path: "Drinks > Alcoholic drinks",
        id: "cat-alcoholic",
        depth: 1,
        gross: "-11.00",
        net: "-10.00",
        direct: "0.00/0.00/0",
      },
      {
        path: "Drinks > Alcoholic drinks > Cocktails",
        id: "cat-cocktails",
        depth: 2,
        gross: "-11.00",
        net: "-10.00",
        direct: "-11.00/-10.00/1",
      },
      {
        path: "Drinks > Spirits",
        id: "cat-spirits",
        depth: 1,
        gross: "22.00",
        net: "20.00",
        direct: "0.00/0.00/0",
      },
      {
        path: "Drinks > Spirits > Cocktails",
        id: "cat-cocktails",
        depth: 2,
        gross: "22.00",
        net: "20.00",
        direct: "22.00/20.00/1",
      },
    ]);

    const both = await run({ fromBusinessDay: "2026-08-04", toBusinessDay: "2026-08-05" });

    expect(rows(both.tree).map((r) => `${r.path}: ${r.gross}/${r.net}`)).toEqual([
      "Drinks: 22.00/20.00",
      "Drinks > Spirits: 22.00/20.00",
      "Drinks > Spirits > Cocktails: 22.00/20.00",
    ]);
  });

  it("shows a parent's direct products as its own part, beside a child with none of its own", async () => {
    await sell("2026-08-04", [
      { net: "2.00", gross: "2.20", cls: classified(chain(DRINKS)) },
      { net: "3.00", gross: "3.30", cls: classified(chain(DRINKS, SOFTS)) },
    ]);

    const report = await run();

    expect(rows(report.tree)).toEqual([
      {
        path: "Drinks",
        id: "cat-drinks",
        depth: 0,
        gross: "5.50",
        net: "5.00",
        direct: "2.20/2.00/1",
      },
      {
        path: "Drinks > Softs",
        id: "cat-softs",
        depth: 1,
        gross: "3.30",
        net: "3.00",
        direct: "3.30/3.00/1",
      },
    ]);
    expect(report.tree[0]!.children[0]!.children).toEqual([]);
  });

  it("orders categories by name, then Uncategorised, then Not recorded with its free-text children by text", async () => {
    await sell("2026-08-04", [
      { net: "1.00", gross: "1.10", cls: classified(chain(["cat-wine", "Wine"])) },
      { net: "2.00", gross: "2.20", cls: classified([]) },
      { net: "3.00", category: "Tapas" },
      { net: "4.00", category: "Cafés" },
      { net: "5.00", category: "Tapas" },
      { net: "6.00" },
      { net: "7.00", category: "" },
      { net: "8.00", gross: "8.80", cls: classified(chain(["cat-beer", "Beer"])) },
    ]);

    const report = await run();

    expect(rows(report.tree)).toEqual([
      { path: "Beer", id: "cat-beer", depth: 0, gross: "8.80", net: "8.00", direct: "8.80/8.00/1" },
      { path: "Wine", id: "cat-wine", depth: 0, gross: "1.10", net: "1.00", direct: "1.10/1.00/1" },
      {
        path: "(uncategorised)",
        id: "uncategorised",
        depth: 0,
        gross: "2.20",
        net: "2.00",
        direct: "2.20/2.00/1",
      },
      {
        path: "(not_recorded)",
        id: "not_recorded",
        depth: 0,
        gross: "0.00",
        net: "25.00",
        direct: "0.00/13.00/2",
      },
      {
        path: "(not_recorded) > Cafés",
        id: "Cafés",
        depth: 1,
        gross: "0.00",
        net: "4.00",
        direct: "0.00/4.00/1",
      },
      {
        path: "(not_recorded) > Tapas",
        id: "Tapas",
        depth: 1,
        gross: "0.00",
        net: "8.00",
        direct: "0.00/8.00/2",
      },
    ]);
    expect(report.tree.map((n) => [n.kind, n.name])).toEqual([
      ["category", "Beer"],
      ["category", "Wine"],
      ["uncategorised", ""],
      ["not_recorded", ""],
    ]);
    expect(report.tree[3]!.children.map((n) => n.kind)).toEqual(["free_text", "free_text"]);
  });

  it("puts a line that names its product but recorded no classification under Not recorded, by its free-text category", async () => {
    await sell("2026-08-04", [
      { net: "1.00", productId: "prod-negroni", category: "Cócteles" },
      { net: "2.00", productId: "prod-water" },
    ]);

    const report = await run();

    expect(rows(report.tree)).toEqual([
      {
        path: "(not_recorded)",
        id: "not_recorded",
        depth: 0,
        gross: "0.00",
        net: "3.00",
        direct: "0.00/2.00/1",
      },
      {
        path: "(not_recorded) > Cócteles",
        id: "Cócteles",
        depth: 1,
        gross: "0.00",
        net: "1.00",
        direct: "0.00/1.00/1",
      },
    ]);
  });

  it("marks the gross total incomplete by the count of lines, issued or reversed, that recorded none", async () => {
    const old = await sell("2026-07-20", [{ net: "9.00" }]);
    await seedVoid(suite.db, { saleId: old }, at("2026-08-06"));
    await sell("2026-08-04", [
      { net: "4.00" },
      { net: "3.00", gross: "3.30", cls: classified(chain(DRINKS)) },
    ]);

    const report = await run();

    expect(report).toMatchObject({
      grossComplete: false,
      linesWithoutGross: 2,
      gross: "3.30",
      net: "-2.00",
    });
  });

  it("reports a period whose lines all recorded a gross as complete (the control)", async () => {
    await sell("2026-07-20", [{ net: "9.00" }]);
    await sell("2026-08-04", [{ net: "3.00", gross: "3.30", cls: classified(chain(DRINKS)) }]);

    expect(await run()).toMatchObject({ grossComplete: true, linesWithoutGross: 0 });
  });

  it("names a node by the latest-issued line through it, whatever order the sales were written in", async () => {
    await sell("2026-08-20", [
      {
        net: "2.00",
        gross: "2.20",
        cls: classified(chain(["cat-softs", "Softs"], ["cat-cola", "Cola"])),
      },
    ]);
    await sell("2026-08-03", [
      {
        net: "1.00",
        gross: "1.10",
        cls: classified(chain(["cat-softs", "Soft drinks"], ["cat-cola", "Colas"])),
      },
    ]);

    const report = await run();

    expect(rows(report.tree).map((r) => r.path)).toEqual(["Softs", "Softs > Cola"]);
  });

  it("breaks a tie in issue time by the sale id, then by the line number", async () => {
    const saleA = await sell("2026-08-04", [
      { net: "1.00", gross: "1.10", cls: classified(chain(["cat-x", "From A"])) },
    ]);
    const saleB = await sell("2026-08-04", [
      { net: "1.00", gross: "1.10", cls: classified(chain(["cat-x", "From B"])) },
    ]);
    await sell("2026-08-05", [
      { net: "1.00", gross: "1.10", cls: classified(chain(["cat-y", "Line one"])) },
      { net: "1.00", gross: "1.10", cls: classified(chain(["cat-y", "Line two"])) },
    ]);
    await sell("2026-08-06", [
      { net: "1.00", gross: "1.10", cls: classified(chain(["cat-z", "Line two"])) },
      { net: "1.00", gross: "1.10", cls: classified(chain(["cat-z", "Line one"])) },
    ]);

    const report = await run();

    expect(report.tree.map((n) => [n.id, n.name])).toEqual(
      expect.arrayContaining([
        ["cat-x", saleA > saleB ? "From A" : "From B"],
        ["cat-y", "Line two"],
        ["cat-z", "Line one"],
      ]),
    );
  });

  it("reports no label totals, and ignores a stored line that still carries labels", async () => {
    const storedWithLabels = {
      reporting: chain(DRINKS),
      labels: [{ id: "lab-alcoholic", name: "Alcoholic" }],
    } as SaleLineClassification;
    await sell("2026-08-04", [{ net: "1.00", gross: "1.10", cls: storedWithLabels }]);

    const report = await run();

    expect(report).not.toHaveProperty("labels");
    expect(rows(report.tree).map((r) => `${r.path}: ${r.gross}/${r.net} ${r.direct}`)).toEqual([
      "Drinks: 1.10/1.00 1.10/1.00/1",
    ]);
  });

  it("counts an extra under its own classification by default, and under its dish's with extrasIntoDish", async () => {
    const dish = randomUUID();
    await sell("2026-08-04", [
      {
        id: dish,
        net: "10.00",
        gross: "11.00",
        cls: classified(chain(["cat-food", "Food"], ["cat-burgers", "Burgers"])),
      },
      {
        parentLineId: dish,
        net: "1.00",
        gross: "1.10",
        cls: classified(chain(["cat-extras", "Extras"])),
      },
    ]);

    const own = await run();

    expect(rows(own.tree).map((r) => `${r.path}: ${r.gross}/${r.net} ${r.direct}`)).toEqual([
      "Extras: 1.10/1.00 1.10/1.00/1",
      "Food: 11.00/10.00 0.00/0.00/0",
      "Food > Burgers: 11.00/10.00 11.00/10.00/1",
    ]);

    const rolled = await run({ extrasIntoDish: true });

    expect(rows(rolled.tree).map((r) => `${r.path}: ${r.gross}/${r.net} ${r.direct}`)).toEqual([
      "Food: 12.10/11.00 0.00/0.00/0",
      "Food > Burgers: 12.10/11.00 12.10/11.00/2",
    ]);
  });

  it("rolls an extra of an unclassified dish into Not recorded under the dish's free-text category", async () => {
    const dish = randomUUID();
    await sell("2026-08-04", [
      { id: dish, net: "10.00", category: "Hamburguesas" },
      {
        parentLineId: dish,
        net: "1.00",
        gross: "1.10",
        category: "Extras de la casa",
        cls: classified(chain(["cat-extras", "Extras"])),
      },
    ]);

    const rolled = await run({ extrasIntoDish: true });

    expect(rows(rolled.tree).map((r) => `${r.path}: ${r.gross}/${r.net} ${r.direct}`)).toEqual([
      "(not_recorded): 1.10/11.00 0.00/0.00/0",
      "(not_recorded) > Hamburguesas: 1.10/11.00 1.10/11.00/2",
    ]);
    expect(rolled).toMatchObject({ grossComplete: false, linesWithoutGross: 1 });
  });

  it("leaves out a substitute invoice and nets a correction's negative lines in", async () => {
    const ticket = await sell("2026-08-04", [
      { net: "10.00", gross: "11.00", cls: classified(chain(DRINKS)) },
    ]);
    const substitute = await sell("2026-08-04", [
      { net: "10.00", gross: "11.00", cls: classified(chain(DRINKS)) },
    ]);
    await seedSubstitution(suite.db, { substitutionSaleId: substitute, substitutedSaleId: ticket });
    await sellLines(
      suite.db,
      venue,
      at("2026-08-05"),
      [{ net: "-4.00", gross: "-4.40", quantity: "-1.000", cls: classified(chain(DRINKS)) }],
      ticket,
    );

    const report = await run();

    expect(rows(report.tree)).toEqual([
      {
        path: "Drinks",
        id: "cat-drinks",
        depth: 0,
        gross: "6.60",
        net: "6.00",
        direct: "6.60/6.00/2",
      },
    ]);
  });

  it("counts only the node asked for, and every node when none is", async () => {
    const other = await seedNodeAndSeries(suite.db, venue);
    await sell("2026-08-04", [{ net: "1.00", gross: "1.10", cls: classified(chain(DRINKS)) }]);
    await sellLines(suite.db, { ...venue, ...other }, at("2026-08-04"), [
      { net: "2.00", gross: "2.20", cls: classified(chain(DRINKS)) },
    ]);

    expect((await run()).net).toBe("1.00");
    expect((await run({ nodeId: undefined })).net).toBe("3.00");
  });

  it("leaves out lines issued outside the period", async () => {
    await sell("2026-07-31", [{ net: "1.00", gross: "1.10", cls: classified(chain(DRINKS)) }]);
    await sell("2026-09-01", [{ net: "2.00", gross: "2.20", cls: classified(chain(DRINKS)) }]);

    expect((await run()).tree).toEqual([]);
  });
});
