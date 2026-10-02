import { describe, expect, it } from "vitest";
import { formatMoney } from "./receipt-money.js";

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
