import { describe, expect, it } from "vitest";
import { decimal, sumDecimals } from "@waitron/shared";
import type { DatedRate } from "@waitron/shared";
import { rateLines, shareFreeItems, shareSetMenus } from "./pricing.js";
import type { GrossLine, GrossLines } from "./pricing.js";

const ON = "2026-11-24";
const AT_4: readonly DatedRate[] = [{ from: null, rate: "4.00" }];
const AT_10: readonly DatedRate[] = [{ from: null, rate: "10.00" }];
const AT_21: readonly DatedRate[] = [{ from: null, rate: "21.00" }];

interface Options {
  quantity?: string;
  unit?: string;
  list?: string;
  parentLineNo?: number;
  parts?: [number, string][];
}

const row = (
  lineNo: number,
  name: string,
  gross: string,
  vatRates: readonly DatedRate[],
  role: GrossLine["setMenuRole"],
  options: Options = {},
): GrossLine => ({
  lineNo,
  name,
  descriptions: {},
  quantity: options.quantity ?? "1",
  vatRates,
  grossUnitPrice: decimal(options.unit ?? gross),
  lineGross: decimal(gross),
  ...(role == null ? {} : { setMenuRole: role }),
  ...(options.parentLineNo === undefined ? {} : { parentLineNo: options.parentLineNo }),
  ...(options.list === undefined
    ? {}
    : { listGross: options.list, listUnitPriceGross: options.list }),
  ...(options.parts === undefined
    ? {}
    : {
        setMenuParts: options.parts.map(([setMenuLineNo, weight]) => ({
          setMenuLineNo,
          weight: decimal(weight),
        })),
      }),
});
const menu = (lineNo: number, gross: string, rates = AT_10, options: Options = {}) =>
  row(lineNo, "Daily menu", gross, rates, "set_menu", options);
const dish = (
  lineNo: number,
  name: string,
  rates: readonly DatedRate[],
  parts: [number, string][],
  options: Options = {},
) => row(lineNo, name, options.unit ?? "0.00", rates, "dish", { ...options, parts });
const lines = (...items: GrossLine[]): GrossLines => ({
  lines: items,
  total: sumDecimals(items.map((item) => item.lineGross)),
});
const workedExample = (extra: GrossLine[] = [], hake: Options = {}) =>
  lines(
    menu(1, "14.00"),
    dish(2, "Soup", AT_10, [[1, "5.50"]]),
    dish(3, "Hake", AT_10, [[1, "12.50"]], hake),
    dish(4, "Lemonade", AT_21, [[1, "3.50"]]),
    ...extra,
  );
const figures = (gross: GrossLines) =>
  gross.lines.map((l) => [l.name, l.lineGross, l.setMenuPart ?? null]);
const rated = (gross: GrossLines) =>
  rateLines(gross, ON).lines.map((l) => [l.name, l.lineGross, l.vatRate]);

describe("shareSetMenus — a takeaway set menu's price divided between its dishes", () => {
  it("divides the worked example's 14.00 by the dishes' own prices", () => {
    const shared = shareSetMenus(workedExample(), ON);
    expect(figures(shared)).toEqual([
      ["Daily menu", "0.00", "-14.00"],
      ["Soup", "3.58", "3.58"],
      ["Hake", "8.14", "8.14"],
      ["Lemonade", "2.28", "2.28"],
    ]);
    expect(shared.total).toBe("14.00");
    const priced = rateLines(shared, ON);
    expect(priced.lines.map((l) => [l.name, l.lineGross, l.vatRate])).toEqual([
      ["Daily menu", "0.00", "10.00"],
      ["Soup", "3.58", "10.00"],
      ["Hake", "8.14", "10.00"],
      ["Lemonade", "2.28", "21.00"],
    ]);
    expect(priced.vatBreakdown).toEqual([
      { rate: "10.00", base: "10.65", tax: "1.07" },
      { rate: "21.00", base: "1.88", tax: "0.40" },
    ]);
  });

  it("gives a divided row the new total over its quantity as its unit price", () => {
    const shared = shareSetMenus(workedExample(), ON);
    expect(shared.lines.map((l) => l.grossUnitPrice)).toEqual(["0.00", "3.58", "8.14", "2.28"]);
  });

  it("leaves a set menu whose dishes share one rate whole at that rate", () => {
    const gross = lines(
      menu(1, "14.00"),
      dish(2, "Soup", AT_10, [[1, "5.50"]]),
      dish(3, "Hake", AT_10, [[1, "12.50"]]),
    );
    const shared = shareSetMenus(gross, ON);
    expect(figures(shared)).toEqual([
      ["Daily menu", "14.00", null],
      ["Soup", "0.00", null],
      ["Hake", "0.00", null],
    ]);
    for (const line of shared.lines) expect(line).not.toHaveProperty("setMenuPart");
    const priced = rateLines(shared, ON);
    expect(rated(shared)).toEqual([
      ["Daily menu", "14.00", "10.00"],
      ["Soup", "0.00", "10.00"],
      ["Hake", "0.00", "10.00"],
    ]);
    expect(priced.vatBreakdown).toEqual([{ rate: "10.00", base: "12.73", tax: "1.27" }]);
  });

  it("gives a tied cent to the earlier dish", () => {
    const gross = lines(
      menu(1, "10.00"),
      dish(2, "First", AT_10, [[1, "3.00"]]),
      dish(3, "Second", AT_10, [[1, "3.00"]]),
      dish(4, "Third", AT_21, [[1, "3.00"]]),
    );
    const shared = shareSetMenus(gross, ON);
    expect(figures(shared).slice(1)).toEqual([
      ["First", "3.34", "3.34"],
      ["Second", "3.33", "3.33"],
      ["Third", "3.33", "3.33"],
    ]);
    expect(rateLines(shared, ON).vatBreakdown).toEqual([
      { rate: "10.00", base: "6.07", tax: "0.60" },
      { rate: "21.00", base: "2.75", tax: "0.58" },
    ]);
  });

  it("divides the adviser's 12.00 burger and cola as 9.12 and 2.88", () => {
    const gross = lines(
      menu(1, "12.00"),
      dish(2, "Burger", AT_10, [[1, "9.50"]]),
      dish(3, "Cola", AT_21, [[1, "3.00"]]),
    );
    const shared = shareSetMenus(gross, ON);
    expect(figures(shared)).toEqual([
      ["Daily menu", "0.00", "-12.00"],
      ["Burger", "9.12", "9.12"],
      ["Cola", "2.88", "2.88"],
    ]);
    expect(rateLines(shared, ON).vatBreakdown).toEqual([
      { rate: "10.00", base: "8.29", tax: "0.83" },
      { rate: "21.00", base: "2.38", tax: "0.50" },
    ]);
  });

  it("keeps a supplement on its dish's row and out of the weight", () => {
    const shared = shareSetMenus(workedExample([], { unit: "2.00" }), ON);
    expect(figures(shared)).toEqual([
      ["Daily menu", "0.00", "-14.00"],
      ["Soup", "3.58", "3.58"],
      ["Hake", "10.14", "8.14"],
      ["Lemonade", "2.28", "2.28"],
    ]);
    expect(shared.total).toBe("16.00");
    expect(rated(shared)[2]).toEqual(["Hake", "10.14", "10.00"]);
    expect(rateLines(shared, ON).vatBreakdown).toEqual([
      { rate: "10.00", base: "12.47", tax: "1.25" },
      { rate: "21.00", base: "1.88", tax: "0.40" },
    ]);
  });

  it("leaves a paid extra at its own price and rate", () => {
    const cheese = row(5, "Cheese", "1.50", AT_21, null, { parentLineNo: 3 });
    const shared = shareSetMenus(workedExample([cheese]), ON);
    expect(shared.lines[4]).toBe(cheese);
    expect(figures(shared).slice(1, 4)).toEqual([
      ["Soup", "3.58", "3.58"],
      ["Hake", "8.14", "8.14"],
      ["Lemonade", "2.28", "2.28"],
    ]);
    expect(rated(shared)[4]).toEqual(["Cheese", "1.50", "21.00"]);
  });

  it("gives a dish with no weight no part, and files its 0.00 at the set menu's lead rate", () => {
    const bread = dish(5, "Bread", AT_4, [[1, "0.00"]]);
    const shared = shareSetMenus(workedExample([bread]), ON);
    expect(shared.lines[4]).not.toHaveProperty("setMenuPart");
    expect(shared.lines[4]!.lineGross).toBe("0.00");
    expect(figures(shared).slice(1, 4)).toEqual([
      ["Soup", "3.58", "3.58"],
      ["Hake", "8.14", "8.14"],
      ["Lemonade", "2.28", "2.28"],
    ]);
    const priced = rateLines(shared, ON);
    expect(priced.lines[4]!.vatRate).toBe("10.00");
    expect(priced.vatBreakdown.map((v) => v.rate)).toEqual(["10.00", "21.00"]);
  });

  it("files a free extra on an a la carte takeaway dish at its dish's rate", () => {
    const gross = lines(
      row(1, "Salad", "10.00", AT_10, null),
      row(2, "Croutons", "0.00", AT_4, null, { parentLineNo: 1 }),
    );
    expect(shareSetMenus(gross, ON)).toBe(gross);
    const priced = rateLines(gross, ON);
    expect(rated(gross)).toEqual([
      ["Salad", "10.00", "10.00"],
      ["Croutons", "0.00", "10.00"],
    ]);
    expect(priced.vatBreakdown).toEqual([{ rate: "10.00", base: "9.09", tax: "0.91" }]);
  });

  it("leaves a set menu with no dish that has a weight whole at its own list", () => {
    const gross = lines(
      menu(1, "14.00", AT_21),
      dish(2, "Soup", AT_10, [[1, "0.00"]]),
      dish(3, "Hake", AT_4, [[1, "0.00"]]),
    );
    expect(shareSetMenus(gross, ON)).toBe(gross);
    const priced = rateLines(gross, ON);
    expect(rated(gross)).toEqual([
      ["Daily menu", "14.00", "21.00"],
      ["Soup", "0.00", "21.00"],
      ["Hake", "0.00", "21.00"],
    ]);
    expect(priced.vatBreakdown).toEqual([{ rate: "21.00", base: "11.57", tax: "2.43" }]);
  });

  it("divides the share A445 gives a comped set menu beside a burger at 21%", () => {
    const comped = workedExample([row(5, "Burger", "6.00", AT_21, null)]);
    comped.lines[0] = menu(1, "0.00", AT_10, { list: "14.00" });
    comped.total = decimal("6.00");
    const freeShared = shareFreeItems(comped, ON);
    expect(freeShared.lines.map((l) => l.lineGross)).toEqual([
      "4.20",
      "0.00",
      "0.00",
      "0.00",
      "1.80",
    ]);
    const shared = shareSetMenus(freeShared, ON);
    expect(figures(shared)).toEqual([
      ["Daily menu", "0.00", "-4.20"],
      ["Soup", "1.08", "1.08"],
      ["Hake", "2.44", "2.44"],
      ["Lemonade", "0.68", "0.68"],
      ["Burger", "1.80", null],
    ]);
    expect(shared.total).toBe("6.00");
    expect(rateLines(shared, ON).vatBreakdown).toEqual([
      { rate: "10.00", base: "3.20", tax: "0.32" },
      { rate: "21.00", base: "2.05", tax: "0.43" },
    ]);
  });

  it("counts a set menu at 21% whose dishes are all at 10% as one rate beside a comped coffee", () => {
    const gross = lines(
      menu(1, "14.00", AT_21),
      dish(2, "Soup", AT_10, [[1, "5.50"]]),
      dish(3, "Hake", AT_10, [[1, "12.50"]]),
      row(4, "Coffee", "0.00", AT_10, null, { list: "1.50" }),
    );
    expect(shareFreeItems(gross, ON)).toBe(gross);
    const shared = shareSetMenus(gross, ON);
    expect(figures(shared)).toEqual([
      ["Daily menu", "14.00", null],
      ["Soup", "0.00", null],
      ["Hake", "0.00", null],
      ["Coffee", "0.00", null],
    ]);
    expect(rated(shared)[0]).toEqual(["Daily menu", "14.00", "10.00"]);
    expect(rateLines(shared, ON).vatBreakdown).toEqual([
      { rate: "10.00", base: "12.73", tax: "1.27" },
    ]);
  });

  it("counts a set menu at 10% whose dishes have two rates as two rates beside a comped coffee", () => {
    const gross = workedExample([row(5, "Coffee", "0.00", AT_10, null, { list: "1.50" })]);
    const freeShared = shareFreeItems(gross, ON);
    expect(freeShared.lines.map((l) => l.lineGross)).toEqual([
      "12.65",
      "0.00",
      "0.00",
      "0.00",
      "1.35",
    ]);
    expect(figures(shareSetMenus(freeShared, ON)).slice(0, 4)).toEqual([
      ["Daily menu", "0.00", "-12.65"],
      ["Soup", "3.24", "3.24"],
      ["Hake", "7.35", "7.35"],
      ["Lemonade", "2.06", "2.06"],
    ]);
  });

  it("divides two set menus each over its own dishes", () => {
    const gross = workedExample([
      menu(5, "12.00"),
      dish(6, "Burger", AT_10, [[5, "9.50"]]),
      dish(7, "Cola", AT_21, [[5, "3.00"]]),
    ]);
    const shared = shareSetMenus(gross, ON);
    expect(figures(shared)).toEqual([
      ["Daily menu", "0.00", "-14.00"],
      ["Soup", "3.58", "3.58"],
      ["Hake", "8.14", "8.14"],
      ["Lemonade", "2.28", "2.28"],
      ["Daily menu", "0.00", "-12.00"],
      ["Burger", "9.12", "9.12"],
      ["Cola", "2.88", "2.88"],
    ]);
    expect(shared.total).toBe("26.00");
  });

  it("gives a grouped row the sum of its working lines' parts in their own set menus", () => {
    const gross = lines(
      menu(1, "14.00"),
      menu(2, "12.00"),
      dish(
        3,
        "Soup",
        AT_10,
        [
          [1, "5.50"],
          [2, "5.50"],
        ],
        { quantity: "2" },
      ),
      dish(4, "Hake", AT_10, [[1, "12.50"]]),
      dish(
        5,
        "Lemonade",
        AT_21,
        [
          [1, "3.50"],
          [2, "3.50"],
        ],
        { quantity: "2" },
      ),
    );
    const shared = shareSetMenus(gross, ON);
    expect(figures(shared)).toEqual([
      ["Daily menu", "0.00", "-14.00"],
      ["Daily menu", "0.00", "-12.00"],
      ["Soup", "10.91", "10.91"],
      ["Hake", "8.14", "8.14"],
      ["Lemonade", "6.95", "6.95"],
    ]);
    expect(shared.lines.map((l) => l.grossUnitPrice)).toEqual([
      "0.00",
      "0.00",
      "5.46",
      "8.14",
      "3.48",
    ]);
    const priced = rateLines(shared, ON);
    expect(priced.lines.slice(0, 2).map((l) => l.vatRate)).toEqual(["10.00", "10.00"]);
    expect(priced.vatBreakdown).toEqual([
      { rate: "10.00", base: "17.32", tax: "1.73" },
      { rate: "21.00", base: "5.74", tax: "1.21" },
    ]);
  });

  it("drops setMenuParts from the rated lines", () => {
    for (const gross of [workedExample(), shareSetMenus(workedExample(), ON)]) {
      for (const line of rateLines(gross, ON).lines)
        expect(line).not.toHaveProperty("setMenuParts");
    }
  });

  it("divides nothing of a set menu charged nothing, filing its row at its heaviest dish's rate", () => {
    const gross = workedExample();
    gross.lines[0] = menu(1, "0.00", AT_21, { list: "14.00" });
    gross.total = decimal("0.00");
    const shared = shareSetMenus(gross, ON);
    expect(figures(shared)).toEqual([
      ["Daily menu", "0.00", null],
      ["Soup", "0.00", null],
      ["Hake", "0.00", null],
      ["Lemonade", "0.00", null],
    ]);
    expect(shared.lines[0]!.vatRates).toBe(AT_10);
    expect(rateLines(shared, ON).vatBreakdown).toEqual([
      { rate: "10.00", base: "0.00", tax: "0.00" },
    ]);
  });

  it("files a comped set menu whose row says 21% at its dishes' one rate, with no empty VAT row", () => {
    const gross = lines(
      menu(1, "0.00", AT_21, { list: "14.00" }),
      dish(2, "Soup", AT_10, [[1, "5.50"]]),
      dish(3, "Hake", AT_10, [[1, "12.50"]]),
      row(4, "Burger", "9.00", AT_10, null),
    );
    const shared = shareSetMenus(shareFreeItems(gross, ON), ON);
    expect(rated(shared)).toEqual([
      ["Daily menu", "0.00", "10.00"],
      ["Soup", "0.00", "10.00"],
      ["Hake", "0.00", "10.00"],
      ["Burger", "9.00", "10.00"],
    ]);
    expect(rateLines(shared, ON).vatBreakdown).toEqual([
      { rate: "10.00", base: "8.18", tax: "0.82" },
    ]);
  });

  it("files a set menu priced 0.00 at a paid rate among its dishes', not its heaviest dish's unpaid one", () => {
    const gross = lines(
      menu(1, "0.00"),
      dish(2, "Soup", AT_10, [[1, "5.50"]]),
      dish(3, "Wine", AT_21, [[1, "12.00"]]),
      row(4, "Burger", "9.00", AT_10, null),
    );
    const shared = shareSetMenus(shareFreeItems(gross, ON), ON);
    expect(rated(shared)).toEqual([
      ["Daily menu", "0.00", "10.00"],
      ["Soup", "0.00", "10.00"],
      ["Wine", "0.00", "10.00"],
      ["Burger", "9.00", "10.00"],
    ]);
    expect(rateLines(shared, ON).vatBreakdown).toEqual([
      { rate: "10.00", base: "8.18", tax: "0.82" },
    ]);
  });

  it("files a set menu priced 0.00 with no weighted dish at the first rate that carries money", () => {
    const gross = lines(
      menu(1, "0.00", AT_21),
      dish(2, "Soup", AT_10, [[1, "0.00"]]),
      row(3, "Burger", "9.00", AT_10, null),
    );
    const shared = shareSetMenus(shareFreeItems(gross, ON), ON);
    expect(rated(shared)).toEqual([
      ["Daily menu", "0.00", "10.00"],
      ["Soup", "0.00", "10.00"],
      ["Burger", "9.00", "10.00"],
    ]);
    expect(rateLines(shared, ON).vatBreakdown).toEqual([
      { rate: "10.00", base: "8.18", tax: "0.82" },
    ]);
  });

  it("leaves a set menu priced 0.00 with no weighted dish at its own rate when nothing carries money", () => {
    const gross = lines(menu(1, "0.00", AT_21), dish(2, "Soup", AT_10, [[1, "0.00"]]));
    expect(rated(gross)).toEqual([
      ["Daily menu", "0.00", "21.00"],
      ["Soup", "0.00", "21.00"],
    ]);
  });

  it("files a 0.00 dish whose set menu is not on the ticket at a rate that carries money", () => {
    const gross = lines(
      row(1, "Burger", "9.00", AT_10, null),
      dish(2, "Lemonade", AT_21, [[7, "3.50"]]),
    );
    expect(shareSetMenus(gross, ON)).toBe(gross);
    expect(rated(gross)).toEqual([
      ["Burger", "9.00", "10.00"],
      ["Lemonade", "0.00", "10.00"],
    ]);
    expect(rateLines(gross, ON).vatBreakdown).toEqual([
      { rate: "10.00", base: "8.18", tax: "0.82" },
    ]);
  });

  it("leaves a 0.00 dish whose set menu is absent at its own rate when nothing carries money", () => {
    const gross = lines(dish(1, "Lemonade", AT_21, [[7, "3.50"]]));
    expect(rated(gross)).toEqual([["Lemonade", "0.00", "21.00"]]);
  });

  it("returns a ticket with a line whose rate list is empty unchanged, for rateLines to refuse", () => {
    const gross = workedExample([row(5, "Bread", "1.00", [], null)]);
    expect(shareSetMenus(gross, ON)).toBe(gross);
  });
});
