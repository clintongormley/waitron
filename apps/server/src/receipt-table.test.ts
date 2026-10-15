import { describe, expect, it } from "vitest";
import { tableLines, type ReceiptTable } from "./receipt-table.js";

const HEADER = { units: "Uds", item: "Concepto", price: "Precio", amount: "Importe", rate: "IVA" };
const table = (withRate: boolean): ReceiptTable => ({
  header: HEADER,
  withRate,
  rows: [
    { units: "1", item: "Bloody Mary", price: "13,64", amount: "13,64", rate: "10%" },
    { units: "4", item: "Agua, pan y aceite", price: "5,45", amount: "21,82", rate: "21%" },
  ],
});

describe("tableLines", () => {
  it("lays out one rate on 42 columns, one line a row", () => {
    expect(tableLines(table(false), 42).map((l) => l.text)).toEqual([
      "Uds Concepto                Precio Importe",
      "  1 Bloody Mary              13,64   13,64",
      "  4 Agua, pan y aceite        5,45   21,82",
    ]);
  });

  it("marks the header row's lines", () => {
    expect(tableLines(table(false), 42).map((l) => l.header)).toEqual([true, false, false]);
  });

  it("prints no header line when the table has none", () => {
    const { header: _, ...headless } = table(false);
    expect(tableLines(headless, 42).map((l) => l.header)).toEqual([false, false]);
  });

  it("adds a rate column with several rates", () => {
    expect(tableLines(table(true), 42)[1]!.text).toBe("  1 Bloody Mary          13,64   13,64 10%");
  });

  it("prints a discount row with empty units and price, its words indented under the item", () => {
    const discounted: ReceiptTable = {
      header: HEADER,
      withRate: false,
      rows: [
        { units: "1", item: "Bloody Mary", price: "13,64", amount: "13,64" },
        { units: "", item: "Descuento 10%", itemIndent: 2, price: "", amount: "-1,36" },
      ],
    };
    expect(
      tableLines(discounted, 42)
        .map((l) => l.text)
        .slice(1),
    ).toEqual([
      "  1 Bloody Mary              13,64   13,64",
      "      Descuento 10%                  -1,36",
    ]);
  });

  it("wraps a long item inside its column", () => {
    const long = {
      ...table(false),
      rows: [
        {
          units: "1",
          item: "Menú degustación con maridaje de la casa",
          price: "72,73",
          amount: "72,73",
        },
      ],
    };
    for (const line of tableLines(long, 30)) expect(line.text.length).toBeLessThanOrEqual(30);
    expect(
      tableLines(long, 30)
        .map((l) => l.text)
        .join(" "),
    ).toContain("maridaje");
  });

  it("widens the units column for a weighed line", () => {
    const weighed: ReceiptTable = {
      header: HEADER,
      withRate: false,
      rows: [
        { units: "1", item: "Bloody Mary", price: "13,64", amount: "13,64" },
        { units: "0.35 kg", item: "Jamón ibérico", price: "109,09", amount: "38,18" },
      ],
    };
    expect(tableLines(weighed, 42).map((l) => l.text)).toEqual([
      "    Uds Concepto            Precio Importe",
      "      1 Bloody Mary          13,64   13,64",
      "0.35 kg Jamón ibérico       109,09   38,18",
    ]);
    const narrow = tableLines(weighed, 30).map((l) => l.text);
    expect(narrow).toContain("0.35 kg Jamón ibérico");
    expect(narrow.some((line) => line.endsWith("109,09   38,18"))).toBe(true);
    for (const line of narrow) expect(line.length).toBeLessThanOrEqual(30);
  });

  it("falls back to two lines a row when the item column would be under 10 on 58 mm", () => {
    const lines = tableLines(table(true), 30).map((l) => l.text);
    expect(lines).toContain("  1 Bloody Mary");
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(30);
    expect(lines.some((line) => line.endsWith("13,64   13,64 10%"))).toBe(true);
  });
});

describe("a row with no figures", () => {
  const answered = (withRate: boolean): ReceiptTable => ({
    header: HEADER,
    withRate,
    rows: [
      { units: "1", item: "Bloody Mary", price: "13,64", amount: "13,64", rate: "10%" },
      { units: "", item: "Sin hielo", itemIndent: 2, price: "", amount: "" },
    ],
  });

  it("prints its words alone, with no trailing spaces, on one line a row", () => {
    expect(tableLines(answered(true), 42).at(-1)!.text).toBe("      Sin hielo");
  });

  it("prints no blank figures line in the two-line form", () => {
    expect(
      tableLines(answered(true), 30)
        .map((l) => l.text)
        .slice(-3),
    ).toEqual(["  1 Bloody Mary", "             13,64   13,64 10%", "      Sin hielo"]);
  });
});
