import { expect, test } from "vitest";
import { parseDecimalInput, formatDecimalInput, decimalMark } from "./decimal-input.js";

test.each(["2.80", "2,80", " 2,80 "])("parses %s without losing precision", (value) => {
  expect(parseDecimalInput(value)).toBe("2.80");
});
test.each(["", "1.2.3", "1,234.56", "1.234,56", "1 234", "1e3", "Infinity", "0.", "0,"])(
  "refuses %s without guessing grouping",
  (value) => {
    expect(parseDecimalInput(value)).toBeNull();
  },
);
test("decimal display preserves digits and trailing zeros, without grouping", () => {
  expect(formatDecimalInput("123456789012.123456789", "es")).toBe("123456789012,123456789");
  expect(formatDecimalInput("2,80", "en")).toBe("2.80");
  expect(formatDecimalInput("2.80", "es")).toBe("2,80");
  expect(formatDecimalInput("2.80", "en")).toBe("2.80");
  expect(formatDecimalInput("2", "es")).toBe("2");
  expect(formatDecimalInput("0.", "es")).toBe("0,");
  expect(formatDecimalInput("-0.125", "es")).toBe("-0,125");
  expect(formatDecimalInput("1,234.56", "es")).toBe("1,234.56");
  expect(formatDecimalInput("", "es")).toBe("");
  expect(decimalMark("en")).toBe(".");
  expect(decimalMark("es")).toBe(",");
});
