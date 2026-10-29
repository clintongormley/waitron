import type { CategoryReportMode } from "@waitron/reporting";
import type { SupportedLocale } from "@waitron/shared";

interface CategorySalesWords {
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

export const CATEGORY_SALES_WORDS: Readonly<Record<SupportedLocale, CategorySalesWords>> = {
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
