import { esc, labelAmountLines, prepareText, wrapText, type EscSetting } from "@waitron/printing";
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
  printer: EscSetting;
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
    uncategorised: "No category",
    notRecorded: "Not recorded",
    noCategoryRecorded: "Category unknown",
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
    noCategoryRecorded: "Categoría desconocida",
    directlyIn: (name) => `Directamente en ${name}`,
    total: "Total",
    incomplete: (n) =>
      `Total bruto incompleto: ${n} ${n === 1 ? "línea registrada" : "líneas registradas"} antes de que empezara la clasificación`,
  },
};

const INDENT = 2;
const PATH_GLUE = "\u00a0";

/**
 * The category sales report as one ESC/POS document for a printer's paper width and resolution.
 * Every string goes through `prepareText` before it is measured, so no line is wider than the
 * paper, and the gross and net columns share one width so they line up down the page.
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
  const b = esc(printer);
  const { columns, widthDots } = b.grid;
  b.init().printArea(widthDots);
  const money = (value: string): string => prepareText(formatMoney(value, locale));

  const nameOf = (node: CategoryTotal): string =>
    node.kind === "uncategorised"
      ? s.uncategorised
      : node.kind === "not_recorded"
        ? s.notRecorded
        : node.name;

  // A category is printed by its whole path, so two with one name under different parents differ.
  // Not recorded is no category, so what sits under it is printed by its own name. The no-break
  // space keeps each separator on a line with at least the end of the name before it, whether the
  // label wraps or a long name is split (`wrapText`); a split on a line with under three columns of
  // room, or where a name's own no-break spaces leave no other place to split, can still start a
  // line with one.
  const labelOf = (node: CategoryTotal, ancestors: readonly string[]): string =>
    node.kind === "category" ? [...ancestors, node.name].join(`${PATH_GLUE}› `) : nameOf(node);

  // One pass collects every row, so the amount columns can be sized to the widest figure first.
  const rows: { label: string; depth: number; gross: string; net: string }[] = [];
  const walk = (node: CategoryTotal, ancestors: readonly string[]): void => {
    const label = labelOf(node, ancestors);
    rows.push({ label, depth: node.depth, gross: node.gross, net: node.net });
    if (node.children.length > 0 && node.direct.lines > 0) {
      rows.push({
        label: node.kind === "not_recorded" ? s.noCategoryRecorded : s.directlyIn(label),
        depth: node.depth + 1,
        gross: node.direct.gross,
        net: node.direct.net,
      });
    }
    const inside = node.kind === "category" ? [...ancestors, node.name] : ancestors;
    for (const child of node.children) walk(child, inside);
  };
  for (const root of report.tree) walk(root, []);
  const totalRow = { label: s.total, depth: 0, gross: report.gross, net: report.net };

  const all = [...rows, totalRow];
  const width = Math.max(
    prepareText(s.gross).length,
    prepareText(s.net).length,
    ...all.flatMap((row) => [money(row.gross).length, money(row.net).length]),
  );
  const amounts = (gross: string, net: string): string =>
    `${gross.padStart(width)} ${net.padStart(width)}`;

  const text = (value: string): void => {
    for (const line of wrapText(prepareText(value), columns)) b.line(line);
  };
  const row = ({ label, depth, gross, net }: (typeof all)[number]): void => {
    const indent = depth * INDENT;
    for (const line of labelAmountLines(
      prepareText(" ".repeat(indent) + label),
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
  for (const line of labelAmountLines(
    "",
    amounts(prepareText(s.gross), prepareText(s.net)),
    columns,
  ))
    b.line(line);
  for (const r of rows) row(r);
  b.line("-".repeat(columns));
  row(totalRow);
  if (!report.grossComplete) {
    b.line();
    text(s.incomplete(report.linesWithoutGross));
  }
  return b.feedAndCut().bytes();
}
