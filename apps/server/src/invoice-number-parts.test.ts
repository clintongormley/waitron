import { describe, expect, it } from "vitest";
import { formatInvoiceNumber } from "@waitron/core";
import { invoiceNumberParts } from "./invoice-number-parts.js";

describe("invoiceNumberParts", () => {
  it("takes back the series code and number formatInvoiceNumber joined", () => {
    for (const [code, number] of [
      ["FA", 1],
      ["T-2026", 40_123],
      ["A/B", 7],
      ["9", 12],
    ] as const)
      expect(invoiceNumberParts(formatInvoiceNumber(code, number))).toEqual({
        series: code,
        number,
      });
  });

  it("keeps a value with no number after its last slash whole, with no number", () => {
    for (const value of ["FA", "FA/", "FA/1a", "/"])
      expect(invoiceNumberParts(value)).toEqual({ series: value, number: null });
  });
});
