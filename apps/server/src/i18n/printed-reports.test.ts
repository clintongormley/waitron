import { describe, expect, it } from "vitest";

describe("working-time PDF wording", () => {
  it.each([
    [
      "en",
      "Working-time record",
      "From 2026-01-01  /  Before (excluded) 2026-02-01",
      "Shifts (continued)",
      "Page 2 / 3",
      "Characters unavailable in the font are shown as [U+XXXX].",
    ],
    [
      "es",
      "Registro de jornada",
      "Desde 2026-01-01  /  Antes de (excluido) 2026-02-01",
      "Shifts (continuación)",
      "Página 2 / 3",
      "Caracteres no disponibles en la fuente: se muestran como [U+XXXX].",
    ],
  ] as const)(
    "formats the %s frame with the supplied period and page numbers",
    async (language, title, period, continued, page, unavailableCharacters) => {
      const { ATTENDANCE_PDF_WORDS } = await import("./attendance-export-pdf.js");
      const words = ATTENDANCE_PDF_WORDS[language];
      expect(words.title).toBe(title);
      expect(words.period("2026-01-01", "2026-02-01")).toBe(period);
      expect(words.continued("Shifts")).toBe(continued);
      expect(words.page(2, 3)).toBe(page);
      expect(words.unavailableCharacters).toBe(unavailableCharacters);
    },
  );
});

describe("category sales wording", () => {
  it.each([
    [
      "en-GB",
      "From first to last",
      "Business day first",
      "Directly in Drinks",
      "Gross total incomplete: 1 line recorded before classification began",
      "Gross total incomplete: 2 lines recorded before classification began",
    ],
    [
      "es-ES",
      "Desde first hasta last",
      "Día first",
      "Directamente en Drinks",
      "Total bruto incompleto: 1 línea registrada antes de que empezara la clasificación",
      "Total bruto incompleto: 2 líneas registradas antes de que empezara la clasificación",
    ],
  ] as const)(
    "formats the %s range, category path and singular/plural warning",
    async (locale, range, day, directlyIn, singular, plural) => {
      const { CATEGORY_SALES_WORDS } = await import("./category-sales-page.js");
      const words = CATEGORY_SALES_WORDS[locale];
      expect(words.range("first", "last")).toBe(range);
      expect(words.day("first")).toBe(day);
      expect(words.directlyIn("Drinks")).toBe(directlyIn);
      expect(words.incomplete(1)).toBe(singular);
      expect(words.incomplete(2)).toBe(plural);
    },
  );
});
