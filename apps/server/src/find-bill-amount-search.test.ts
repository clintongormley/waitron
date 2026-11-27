import { describe, expect, it } from "vitest";
import { amountSearchCents } from "./find-bill-transactions.js";

describe("Find Transactions amount search", () => {
  it.each([
    ["80,52", 8052, true],
    ["80.52", 8052, true],
    ["€80.52", 8052, true],
    ["80,52 €", 8052, true],
    ["−€8.50", 850, true],
    ["€-8.50", 850, true],
    ["-8,50", 850, true],
    ["12,5", 1250, true],
    ["12", 1200, false],
    ["0,50", 50, true],
  ])("reads %s as %i cents", (q, cents, strong) => {
    expect(amountSearchCents(q)).toEqual({ cents, strong });
  });
  it.each([
    "0412",
    "00",
    "1.234,50",
    "80.525",
    "Table 12",
    "€80.52€",
    "--8.50",
    "-€-8.50",
    "8.",
    ",50",
    "1234567890123",
    "",
  ])("reads %s as no amount", (q) => {
    expect(amountSearchCents(q)).toBeNull();
  });
});
