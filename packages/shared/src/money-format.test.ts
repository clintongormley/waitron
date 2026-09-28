import { afterEach, expect, it, vi } from "vitest";
import { currencySymbol, formatMoney } from "./money-format.js";

afterEach(() => {
  vi.restoreAllMocks();
});

// The Spanish separator before the € is U+00A0 or U+202F depending on the ICU build, so it is
// normalised rather than pinned.
const norm = (s: string): string => s.replace(/[\u00A0\u202F]/g, " ");

it("writes an amount as Spanish euros", () => {
  expect(norm(formatMoney("12.27", "es-ES"))).toBe("12,27 €");
  expect(norm(formatMoney("1500.00", "es-ES"))).toBe("1500,00 €");
  expect(norm(formatMoney("12345.60", "es-ES"))).toBe("12.345,60 €");
});

it("writes an amount as English euros", () => {
  expect(formatMoney("12.27", "en")).toBe("€12.27");
  expect(formatMoney("1500.00", "en")).toBe("€1,500.00");
});

it("always shows two decimal places, rounding a third", () => {
  expect(formatMoney("3", "en")).toBe("€3.00");
  expect(formatMoney("2.5", "en")).toBe("€2.50");
  expect(formatMoney("0.005", "en")).toBe("€0.01");
  expect(formatMoney("0.004", "en")).toBe("€0.00");
});

it("writes zero and negative amounts", () => {
  expect(formatMoney("0.00", "en")).toBe("€0.00");
  expect(formatMoney("-4.50", "en")).toBe("-€4.50");
  expect(norm(formatMoney("-4.50", "es-ES"))).toBe("-4,50 €");
});

it("builds one formatter per locale and reuses it", () => {
  const Original = Intl.NumberFormat;
  const built: string[] = [];
  vi.spyOn(Intl, "NumberFormat").mockImplementation(function (
    locale?: Intl.LocalesArgument,
    options?: Intl.NumberFormatOptions,
  ) {
    built.push(String(locale));
    return new Original(locale, options);
  } as typeof Intl.NumberFormat);
  formatMoney("1.00", "fr-FR");
  formatMoney("2.00", "fr-FR");
  expect(built).toEqual(["fr-FR"]);
  formatMoney("1.00", "de-DE");
  expect(built).toEqual(["fr-FR", "de-DE"]);
  expect(norm(formatMoney("1.00", "fr-FR"))).toBe("1,00 €");
});

it("puts the euro sign before the amount in English, as the dashboard's English writes it", () => {
  expect(currencySymbol("en")).toEqual({ symbol: "€", side: "before" });
  expect(currencySymbol("en-GB")).toEqual({ symbol: "€", side: "before" });
});

it("puts the euro sign after the amount in Spanish", () => {
  expect(currencySymbol("es-ES")).toEqual({ symbol: "€", side: "after" });
});

it("reads the side from where the locale writes the sign, not from its decimal comma", () => {
  // Dutch writes a decimal comma, as Spanish does, but puts the sign first: "€ 9,00".
  expect(currencySymbol("nl-NL")).toEqual({ symbol: "€", side: "before" });
});

it("reads the sign itself from the locale", () => {
  // Swiss German writes euros with the code rather than the sign: "EUR 9.00".
  expect(currencySymbol("de-CH")).toEqual({ symbol: "EUR", side: "before" });
});

it("shares one formatter per locale with formatMoney", () => {
  const Original = Intl.NumberFormat;
  const built: string[] = [];
  vi.spyOn(Intl, "NumberFormat").mockImplementation(function (
    locale?: Intl.LocalesArgument,
    options?: Intl.NumberFormatOptions,
  ) {
    built.push(String(locale));
    return new Original(locale, options);
  } as typeof Intl.NumberFormat);
  currencySymbol("it-IT");
  formatMoney("1.00", "it-IT");
  currencySymbol("it-IT");
  expect(built).toEqual(["it-IT"]);
});
