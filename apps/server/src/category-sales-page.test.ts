import { describe, expect, it } from "vitest";
import type { CategoryReport, CategoryTotal } from "@waitron/reporting";
import { decimal } from "@waitron/shared";
import { formatCategorySalesPage, type CategorySalesPageInput } from "./category-sales-page.js";
import { printedCommands, printedLines } from "./testing/decode-ticket.js";

function node(
  over: Partial<Omit<CategoryTotal, "gross" | "net" | "direct">> & {
    gross: string;
    net: string;
    direct?: { gross: string; net: string; lines: number };
  },
): CategoryTotal {
  const direct = over.direct ?? { gross: "0.00", net: "0.00", lines: 0 };
  return {
    kind: over.kind ?? "category",
    id: over.id ?? "id",
    name: over.name ?? "",
    depth: over.depth ?? 0,
    gross: decimal(over.gross),
    net: decimal(over.net),
    direct: { gross: decimal(direct.gross), net: decimal(direct.net), lines: direct.lines },
    children: over.children ?? [],
  };
}

/** Drinks = Directly in Drinks (Water) + Softs (Cola); Food has children only; then the two
 * report-named roots, Not recorded with a free-text child. */
function sampleReport(overrides: Partial<CategoryReport> = {}): CategoryReport {
  return {
    mode: "at_time_of_sale",
    tree: [
      node({
        id: "drinks",
        name: "Drinks",
        gross: "5.50",
        net: "5.00",
        direct: { gross: "2.20", net: "2.00", lines: 1 },
        children: [
          node({
            id: "softs",
            name: "Softs",
            depth: 1,
            gross: "3.30",
            net: "3.00",
            direct: { gross: "3.30", net: "3.00", lines: 1 },
          }),
        ],
      }),
      node({
        id: "food",
        name: "Food",
        gross: "11.00",
        net: "10.00",
        children: [
          node({
            id: "tapas",
            name: "Tapas",
            depth: 1,
            gross: "11.00",
            net: "10.00",
            direct: { gross: "11.00", net: "10.00", lines: 2 },
          }),
        ],
      }),
      node({
        kind: "uncategorised",
        id: "uncategorised",
        gross: "1.21",
        net: "1.00",
        direct: { gross: "1.21", net: "1.00", lines: 1 },
      }),
      node({
        kind: "not_recorded",
        id: "not_recorded",
        gross: "0.00",
        net: "7.00",
        direct: { gross: "0.00", net: "4.00", lines: 1 },
        children: [
          node({
            kind: "free_text",
            id: "Cafés",
            name: "Cafés",
            depth: 1,
            gross: "0.00",
            net: "3.00",
            direct: { gross: "0.00", net: "3.00", lines: 1 },
          }),
        ],
      }),
    ],
    gross: decimal("17.71"),
    net: decimal("23.00"),
    grossComplete: false,
    linesWithoutGross: 2,
    ...overrides,
  };
}

function page(over: Partial<CategorySalesPageInput> = {}): string[] {
  return printedLines(
    formatCategorySalesPage({
      report: sampleReport(),
      from: "2026-06-10",
      to: "2026-06-11",
      extrasIntoDish: false,
      locale: "en-GB",
      printer: { paperWidth: "80mm", resolution: "180dpi" },
      ...over,
    }),
  );
}

/** The line that starts, after its indent, with `label`. */
function lineFor(lines: string[], label: string): string {
  const found = lines.find((line) => line.trimStart().startsWith(label));
  expect(found, `no line for ${label}`).toBeDefined();
  return found!;
}

describe("formatCategorySalesPage", () => {
  it("heads the page with the mode, in English and in Spanish", () => {
    expect(page()[0]).toBe("Categories at time of sale");
    expect(page({ report: sampleReport({ mode: "current" }) })[0]).toBe("Current categories");
    expect(page({ locale: "es-ES" })[0]).toBe("Categorías en el momento de la venta");
    expect(page({ locale: "es-ES", report: sampleReport({ mode: "current" }) })[0]).toBe(
      "Categorías actuales",
    );
  });

  it("prints the business-day range, and one day once", () => {
    expect(page()).toContain("From 2026-06-10 to 2026-06-11");
    expect(page({ locale: "es-ES" })).toContain("Desde 2026-06-10 hasta 2026-06-11");
    expect(page({ to: "2026-06-10" })).toContain("Business day 2026-06-10");
    expect(page({ to: "2026-06-10", locale: "es-ES" })).toContain("Día 2026-06-10");
  });

  it("says when extras are rolled into their dish, and says nothing otherwise", () => {
    expect(page({ extrasIntoDish: true })).toContain("Extras rolled into their dish");
    expect(page({ extrasIntoDish: true, locale: "es-ES" })).toContain(
      "Extras contados con su plato",
    );
    expect(page().join("\n")).not.toContain("Extras");
  });

  it("indents each category by its depth and prints its gross and net, money in the page's language", () => {
    const lines = page();
    expect(lineFor(lines, "Drinks")).toMatch(/^Drinks +€5\.50 +€5\.00$/);
    expect(lineFor(lines, "Drinks › Softs")).toMatch(/^ {2}Drinks › Softs +€3\.30 +€3\.00$/);
    expect(lineFor(lines, "Food › Tapas")).toMatch(/^ {2}Food › Tapas +€11\.00 +€10\.00$/);
    expect(lineFor(page({ locale: "es-ES" }), "Drinks")).toMatch(/^Drinks +5,50 € +5,00 €$/);
    expect(lines.find((line) => /Gross +Net$/.test(line))).toBeDefined();
    expect(page({ locale: "es-ES" }).find((line) => /Bruto +Neto$/.test(line))).toBeDefined();
  });

  it("right-aligns the gross and net columns across rows", () => {
    const lines = page();
    const drinks = lineFor(lines, "Drinks");
    const tapas = lineFor(lines, "Food › Tapas");
    expect(drinks.length).toBe(42);
    expect(tapas.length).toBe(42);
    expect(drinks.indexOf("€5.50") + "€5.50".length).toBe(tapas.indexOf("€11.00") + 6);
  });

  it("sizes the columns by the widest figure on the page, the total included", () => {
    const lines = page({
      report: sampleReport({ gross: decimal("1234.56"), net: decimal("98765.43") }),
    });
    const grossEnd = (line: string, amount: string) => line.indexOf(amount) + amount.length;
    const drinks = lineFor(lines, "Drinks");
    expect(grossEnd(lineFor(lines, "Total"), "€1,234.56")).toBe(grossEnd(drinks, "€5.50"));
  });

  it("prints a Directly-in row before a parent's children only when the parent has children and direct lines", () => {
    const lines = page();
    const direct = lines.findIndex((line) => line.trimStart().startsWith("Directly in Drinks"));
    expect(lines[direct]).toMatch(/^ {2}Directly in Drinks +€2\.20 +€2\.00$/);
    expect(direct).toBeGreaterThan(lines.indexOf(lineFor(lines, "Drinks")));
    expect(direct).toBeLessThan(lines.indexOf(lineFor(lines, "Drinks › Softs")));
    // Food has children but no direct lines; Softs has direct lines but no children.
    expect(lines.join("\n")).not.toContain("Directly in Food");
    expect(lines.join("\n")).not.toContain("Directly in Softs");
    expect(page({ locale: "es-ES" }).join("\n")).toContain("Directamente en Drinks");
  });

  it("prints each category by its whole path, so two with one name are told apart", () => {
    const branch = (id: string, name: string): CategoryTotal =>
      node({
        id,
        name,
        gross: "12.00",
        net: "10.80",
        direct: { gross: "4.00", net: "3.60", lines: 1 },
        children: [
          node({
            id: `${id}-mains`,
            name: "Mains",
            depth: 1,
            gross: "8.00",
            net: "7.20",
            direct: { gross: "6.00", net: "5.40", lines: 1 },
            children: [
              node({
                id: `${id}-fish`,
                name: "Fish",
                depth: 2,
                gross: "2.00",
                net: "1.80",
                direct: { gross: "2.00", net: "1.80", lines: 1 },
              }),
            ],
          }),
        ],
      });
    const report = sampleReport({ tree: [branch("food", "Food"), branch("lunch", "Lunch")] });
    const lines = page({ report });
    expect(lineFor(lines, "Food › Mains ")).toMatch(/^ {2}Food › Mains +€8\.00 +€7\.20$/);
    expect(lineFor(lines, "Lunch › Mains ")).toMatch(/^ {2}Lunch › Mains +€8\.00 +€7\.20$/);
    expect(lineFor(lines, "Food › Mains › Fish")).toMatch(
      /^ {4}Food › Mains › Fish +€2\.00 +€1\.80$/,
    );
    // A Directly-in row names its category by the same whole path; too long to share a line
    // with its amounts on 42 columns, it puts them on the next.
    const direct = lines.indexOf(lineFor(lines, "Directly in Lunch › Mains"));
    expect(lines[direct]).toBe("    Directly in Lunch › Mains");
    expect(lines[direct + 1]).toMatch(/^ +€6\.00 +€5\.40$/);
    expect(lines.some((line) => /^ +Mains /.test(line))).toBe(false);
    expect(
      lineFor(page({ report, locale: "es-ES" }), "Directamente en Food › Mains"),
    ).toBeDefined();
  });

  it("wraps a long path on narrow paper without starting a line with a separator", () => {
    // "Drinks › Alcoholic drink" fills the leaf's first line (30 columns less six of depth)
    // exactly, so a break at any space would start the next line with the separator.
    const names = ["Drinks", "Alcoholic drink", "Spirits and liqueurs", "Single malts"];
    const chain = (depth: number): CategoryTotal =>
      node({
        id: `c${depth}`,
        name: names[depth]!,
        depth,
        gross: "1.00",
        net: "1.00",
        direct: depth === names.length - 1 ? { gross: "1.00", net: "1.00", lines: 1 } : undefined,
        children: depth < names.length - 1 ? [chain(depth + 1)] : [],
      });
    const lines = page({
      report: sampleReport({ tree: [chain(0)] }),
      printer: { paperWidth: "58mm", resolution: "203dpi" },
    });
    // The leaf's row: six spaces of depth, then its continuation lines' own two.
    const start = lines.findIndex((line) => /^ {6}Drinks ›/.test(line));
    const end = lines.findIndex((line) => line.includes("malts"));
    const leaf = lines.slice(start, end + 1);
    expect(start).toBeGreaterThan(-1);
    expect(leaf.length).toBeGreaterThan(2);
    for (const line of leaf) expect(line.length, line).toBeLessThanOrEqual(30);
    for (const line of leaf.slice(1)) {
      expect(line).toMatch(/^ {8}\S/);
      expect(line.trimStart().startsWith("›")).toBe(false);
    }
    expect(leaf.map((line) => line.trim()).join(" ")).toMatch(
      /^Drinks › Alcoholic drink › Spirits and liqueurs › Single malts +€1\.00 +€1\.00$/,
    );
  });

  it.each([
    ["58mm", 30],
    ["80mm", 42],
  ] as const)(
    "on %s, splits a name inside itself when its separator does not fit, so the next line does not start with the separator",
    (paperWidth, columns) => {
      // The child's row has `columns - 2` columns after its indent; the parent's name and the no-break
      // space fill them, so a split at the room would start the next line with "›".
      const parent = "X".repeat(columns - 3);
      const lines = page({
        report: sampleReport({
          tree: [
            node({
              id: "parent",
              name: parent,
              gross: "1.00",
              net: "1.00",
              children: [
                node({
                  id: "child",
                  name: "Child",
                  depth: 1,
                  gross: "1.00",
                  net: "1.00",
                  direct: { gross: "1.00", net: "1.00", lines: 1 },
                }),
              ],
            }),
          ],
        }),
        printer: { paperWidth, resolution: "203dpi" },
      });
      const start = lines.findIndex((line) => line.startsWith(`  ${parent.slice(0, 5)}`));
      const leaf = lines.slice(start, start + 2);
      expect(start).toBeGreaterThan(-1);
      for (const line of leaf) expect(line.length, line).toBeLessThanOrEqual(columns);
      expect(leaf[1]!.trimStart().startsWith("›"), leaf[1]).toBe(false);
      expect(leaf.map((line) => line.trim()).join("")).toMatch(
        new RegExp(`^${parent} › Child +€1\\.00 +€1\\.00$`),
      );
    },
  );

  it("names Uncategorised and Not recorded, with Not recorded's free-text children beneath it", () => {
    const lines = page();
    expect(lineFor(lines, "Uncategorised")).toMatch(/^Uncategorised +€1\.21 +€1\.00$/);
    expect(lineFor(lines, "Not recorded")).toMatch(/^Not recorded +€0\.00 +€7\.00$/);
    expect(lineFor(lines, "No category recorded")).toMatch(
      /^ {2}No category recorded +€0\.00 +€4\.00$/,
    );
    expect(lines.join("\n")).not.toContain("Directly in Not recorded");
    expect(lineFor(lines, "Cafés")).toMatch(/^ {2}Cafés +€0\.00 +€3\.00$/);
    const es = page({ locale: "es-ES" });
    expect(lineFor(es, "Sin categoría")).toMatch(/^Sin categoría +1,21 € +1,00 €$/);
    expect(lineFor(es, "No registrada")).toMatch(/^No registrada +0,00 € +7,00 €$/);
    expect(lineFor(es, "Sin categoría registrada")).toMatch(
      /^ {2}Sin categoría registrada +0,00 € +4,00 €$/,
    );
    expect(es.join("\n")).not.toContain("Directamente en No registrada");
  });

  it("prints the total and no label section, in English and in Spanish", () => {
    const lines = page();
    expect(lineFor(lines, "Total")).toMatch(/^Total +€17\.71 +€23\.00$/);
    expect(lines).not.toContain("Labels");
    expect(lines.join(" ")).not.toContain("overlap");
    const es = page({ locale: "es-ES" });
    expect(es).not.toContain("Etiquetas");
    expect(es.join(" ")).not.toContain("solapan");
  });

  it("says the gross total is incomplete, with the count, only when it is", () => {
    expect(page().join(" ")).toContain(
      "Gross total incomplete: 2 lines recorded before classification began",
    );
    expect(page({ report: sampleReport({ linesWithoutGross: 1 }) }).join(" ")).toContain(
      "Gross total incomplete: 1 line recorded before classification began",
    );
    expect(page({ locale: "es-ES" }).join(" ")).toContain(
      "Total bruto incompleto: 2 líneas registradas antes de que empezara la clasificación",
    );
    expect(
      page({ locale: "es-ES", report: sampleReport({ linesWithoutGross: 1 }) }).join(" "),
    ).toContain(
      "Total bruto incompleto: 1 línea registrada antes de que empezara la clasificación",
    );
    const complete = page({ report: sampleReport({ grossComplete: true, linesWithoutGross: 0 }) });
    expect(complete.join(" ")).not.toContain("incomplete");
  });

  it("never prints a line wider than the paper, however long the names or deep the tree", () => {
    const long = "A category name far longer than any receipt paper is wide";
    const deep = (depth: number): CategoryTotal =>
      node({
        id: `c${depth}`,
        name: `${long} ${depth}`,
        depth,
        gross: "123456.78",
        net: "-102030.40",
        direct: { gross: "1.00", net: "1.00", lines: 1 },
        children: depth < 20 ? [deep(depth + 1)] : [],
      });
    const report = sampleReport({
      tree: [deep(0)],
      gross: decimal("123456.78"),
      net: decimal("-102030.40"),
    });
    for (const [paperWidth, columns] of [
      ["58mm", 30],
      ["80mm", 42],
    ] as const) {
      for (const locale of ["en-GB", "es-ES"] as const) {
        // Read command by command: the preview's text skips an image that does not read as text,
        // where here it is an undefined line.
        const lines = printedCommands(
          formatCategorySalesPage({
            report,
            from: "2026-06-10",
            to: "2026-06-11",
            locale,
            extrasIntoDish: true,
            printer: { paperWidth, resolution: "203dpi" },
          }),
        )
          .filter((command) => command.name === "GS v 0")
          .map((command) => command.text!);
        expect(lines.length).toBeGreaterThan(40);
        expect(lines).not.toContain(undefined);
        for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(columns);
      }
    }
  });

  it("replaces what the glyph table cannot draw, and measures what it draws", () => {
    const bytes = formatCategorySalesPage({
      report: sampleReport({
        tree: [node({ id: "x", name: "Čaj ☕", gross: "1.00", net: "1.00" })],
      }),
      from: "2026-06-10",
      to: "2026-06-10",
      extrasIntoDish: false,
      locale: "en-GB",
      printer: { paperWidth: "58mm", resolution: "180dpi" },
    });
    const lines = printedLines(bytes);
    // The replacement is measured, so the columns still end at the paper's edge.
    expect(lineFor(lines, "Čaj")).toMatch(/^Čaj \? +€1\.00 +€1\.00$/);
    expect(lineFor(lines, "Čaj")).toHaveLength(30);
  });
});
