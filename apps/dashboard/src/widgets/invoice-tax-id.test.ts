import { describe, expect, it } from "vitest";
import { invoiceTaxIdProblem, normaliseInvoiceTaxId } from "./invoice-tax-id.js";

// Copied verbatim from apps/server/src/invoice-customer-tax-id.test.ts; change both together.
const ACCEPT: [string, string][] = [
  ["es 12345678z", "12345678Z"],
  ["ES12345678Z", "12345678Z"],
  ["12345678 Z", "12345678Z"],
  ["12.345.678-Z", "12345678Z"],
  ["\t12345678z\u00a0", "12345678Z"],
  ["12345678\u00a0Z", "12345678Z"],
  ["Es12345678z", "12345678Z"],
  ["12345678\u2011Z", "12345678Z"],
  ["12345678\u2013Z", "12345678Z"],
  ["12345678z\u200b", "12345678Z"],
  ["E12345674", "E12345674"],
  ["ESE12345674", "E12345674"],
  ["es e1234567-4", "E12345674"],
  ["X1234567L", "X1234567L"],
  ["esx1234567l", "X1234567L"],
  ["B76543214", "B76543214"],
  ["ESES12345678Z", "ES12345678Z"],
  ["12345678", "12345678"],
  ["A".repeat(20), "A".repeat(20)],
  ["1234567L", "01234567L"],
  ["01234567L", "01234567L"],
  ["es 1234567l", "01234567L"],
  ["12345678Z" + " ".repeat(55), "12345678Z"],
];

const REFUSE: [string, string | undefined][] = [
  ["missing", undefined],
  ["empty", ""],
  ["only spaces", "   "],
  ["only the prefix", "ES"],
  ["65 characters", "12345678Z" + " ".repeat(56)],
  ["a letter outside A-Z", "12345678Ñ"],
  ["a slash", "1234/5678Z"],
  ["21 letters", "A".repeat(21)],
  ["a long s", "e\u017f12345678z"],
  ["a dotless i", "\u0131234"],
];

// The field always holds a string; the missing row is the server's alone.
const REFUSED_STRINGS = REFUSE.filter((row): row is [string, string] => row[1] !== undefined);

describe("invoiceTaxIdProblem", () => {
  it.each(ACCEPT)("accepts %j", (typed) => {
    expect(invoiceTaxIdProblem(typed)).toBeNull();
  });

  it.each(REFUSED_STRINGS)("refuses %s", (_label, typed) => {
    expect(invoiceTaxIdProblem(typed)).toBe("invoice_customer.tax_id_invalid");
  });
});

describe("normaliseInvoiceTaxId", () => {
  it.each(ACCEPT)("writes %j as %j", (typed, expected) => {
    expect(normaliseInvoiceTaxId(typed)).toBe(expected);
  });
});
