import { describe, expect, it } from "vitest";
import { formatAmount, formatMoney, formatVatRate } from "./receipt-money.js";

describe("formatMoney", () => {
  it("separates the amount from the euro sign with an ASCII space", () => {
    const s = formatMoney("12.50", "es-ES");
    expect(s).toBe("12,50 €");
    expect(s.charCodeAt(5)).toBe(0x20);
  });

  it("prints a negative amount with the ASCII hyphen-minus in every receipt language", () => {
    for (const locale of ["es-ES", "ca-ES", "gl-ES", "eu-ES"])
      expect(formatMoney("-2.00", locale), locale).toBe("-2,00 €");
  });
});

describe("formatVatRate", () => {
  it.each([
    ["10.00", "es-ES", "10%"],
    ["10", "es-ES", "10%"],
    ["17.50", "es-ES", "17,5%"],
    ["17.5", "ca-ES", "17,5%"],
    ["5.25", "eu-ES", "5,25%"],
    ["0.00", "es-ES", "0%"],
    ["17.50", "en-GB", "17.5%"],
  ])("writes %s in %s as %s", (rate, locale, expected) => {
    expect(formatVatRate(rate, locale)).toBe(expected);
  });
});

describe("formatAmount", () => {
  it.each([
    ["13.64", "es-ES", "13,64"],
    ["1234.56", "es-ES", "1234,56"],
    ["10000.00", "es-ES", "10.000,00"],
    ["-1.21", "eu-ES", "-1,21"],
  ])("writes %s in %s as %s", (value, locale, expected) => {
    expect(formatAmount(value, locale)).toBe(expected);
  });
});
