import {
  columnsFor,
  esc,
  labelAmountLines,
  prepareText,
  safeWidthDots,
  wrapText,
  type CharacterSet,
  type PaperWidth,
} from "@waitron/printing";
import type { CategoryReport, CategoryReportMode, CategoryTotal } from "@waitron/reporting";
import type { SupportedLocale } from "@waitron/shared";
import { formatMoney } from "./receipt-money.js";

export interface CategorySalesPageInput {
  report: CategoryReport;
  /** The business-day range the report covers, as "YYYY-MM-DD". */
  from: string;
  to: string;
  extrasIntoDish: boolean;
  locale: SupportedLocale;
  printer: { paperWidth: PaperWidth; characterSet: CharacterSet; characterTable: number };
}

interface Strings {
  heading: Record<CategoryReportMode, string>;
  range: (from: string, to: string) => string;
  day: (day: string) => string;
  extrasIntoDish: string;
  gross: string;
  net: string;
  uncategorised: string;
  notRecorded: string;
  /** Not recorded's own part: its lines that carry no free-text category either. */
  noCategoryRecorded: string;
  directlyIn: (name: string) => string;
  total: string;
  incomplete: (lines: number) => string;
}

const STRINGS: Readonly<Record<SupportedLocale, Strings>> = {
  "en-GB": {
    heading: { at_time_of_sale: "Categories at time of sale", current: "Current categories" },
    range: (from, to) => `From ${from} to ${to}`,
    day: (day) => `Business day ${day}`,
    extrasIntoDish: "Extras rolled into their dish",
    gross: "Gross",
    net: "Net",
    uncategorised: "Uncategorised",
    notRecorded: "Not recorded",
    noCategoryRecorded: "No category recorded",
    directlyIn: (name) => `Directly in ${name}`,
    total: "Total",
    incomplete: (n) =>
      `Gross total incomplete: ${n} ${n === 1 ? "line" : "lines"} recorded before classification began`,
  },
  "es-ES": {
    heading: {
      at_time_of_sale: "Categorías en el momento de la venta",
      current: "Categorías actuales",
    },
    range: (from, to) => `Desde ${from} hasta ${to}`,
    day: (day) => `Día ${day}`,
    extrasIntoDish: "Extras contados con su plato",
    gross: "Bruto",
    net: "Neto",
    uncategorised: "Sin categoría",
    notRecorded: "No registrada",
    noCategoryRecorded: "Sin categoría registrada",
    directlyIn: (name) => `Directamente en ${name}`,
    total: "Total",
    incomplete: (n) =>
      `Total bruto incompleto: ${n} ${n === 1 ? "línea registrada" : "líneas registradas"} antes de que empezara la clasificación`,
  },
};

const INDENT = 2;

/**
 * The category sales report as one ESC/POS document for a printer's paper width and character set.
 * Every string is prepared for the character set before it is measured, so no line is wider than
 * the paper, and the gross and net columns share one width so they line up down the page.
 */
export function formatCategorySalesPage({
  report,
  from,
  to,
  extrasIntoDish,
  locale,
  printer,
}: CategorySalesPageInput): Uint8Array {
  const s = STRINGS[locale];
  const columns = columnsFor(printer.paperWidth);
  const p = (text: string): string => prepareText(text, printer.characterSet);
  const money = (value: string): string => p(formatMoney(value, locale));
  const b = esc(printer.characterSet, printer.characterTable)
    .init()
    .printArea(safeWidthDots(printer.paperWidth));

  const nameOf = (node: CategoryTotal): string =>
    node.kind === "uncategorised"
      ? s.uncategorised
      : node.kind === "not_recorded"
        ? s.notRecorded
        : node.name;

  // One pass collects every row, so the amount columns can be sized to the widest figure first.
  const rows: { label: string; depth: number; gross: string; net: string }[] = [];
  const walk = (node: CategoryTotal): void => {
    rows.push({ label: nameOf(node), depth: node.depth, gross: node.gross, net: node.net });
    if (node.children.length > 0 && node.direct.lines > 0) {
      rows.push({
        label: node.kind === "not_recorded" ? s.noCategoryRecorded : s.directlyIn(nameOf(node)),
        depth: node.depth + 1,
        gross: node.direct.gross,
        net: node.direct.net,
      });
    }
    for (const child of node.children) walk(child);
  };
  for (const root of report.tree) walk(root);
  const totalRow = { label: s.total, depth: 0, gross: report.gross, net: report.net };

  const all = [...rows, totalRow];
  const width = Math.max(
    p(s.gross).length,
    p(s.net).length,
    ...all.flatMap((row) => [money(row.gross).length, money(row.net).length]),
  );
  const amounts = (gross: string, net: string): string =>
    `${gross.padStart(width)} ${net.padStart(width)}`;

  const text = (value: string): void => {
    for (const line of wrapText(p(value), columns)) b.line(line);
  };
  const row = ({ label, depth, gross, net }: (typeof all)[number]): void => {
    const indent = depth * INDENT;
    for (const line of labelAmountLines(
      p(" ".repeat(indent) + label),
      amounts(money(gross), money(net)),
      columns,
      indent + INDENT,
    )) {
      b.line(line);
    }
  };

  text(s.heading[report.mode]);
  text(from === to ? s.day(from) : s.range(from, to));
  if (extrasIntoDish) text(s.extrasIntoDish);
  b.line();
  for (const line of labelAmountLines("", amounts(p(s.gross), p(s.net)), columns)) b.line(line);
  for (const r of rows) row(r);
  b.line("-".repeat(columns));
  row(totalRow);
  if (!report.grossComplete) {
    b.line();
    text(s.incomplete(report.linesWithoutGross));
  }
  return b.feedAndCut().bytes();
}
