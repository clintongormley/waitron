import { expect, it } from "vitest";
import { deductionsTaken } from "./deductions-taken.js";

const line = (id: string, rate: number, base: number, gross: number) => ({ id, rate, base, gross });

it("spreads a deduction over its rate's lines from the last back, keeping its own base", () => {
  const meal = [line("a", 1000, 95, 105), line("b", 2100, 100, 121), line("c", 1000, 95, 105)];

  expect(deductionsTaken(meal, [{ rate: 1000, base: -136, gross: -150 }])).toEqual([
    { saleLineId: "c", rate: 1000, base: 105, gross: 105 },
    { saleLineId: "a", rate: 1000, base: 31, gross: 45 },
  ]);
});

it("takes the whole rate, base and VAT, where the deduction is worth more than the meal there", () => {
  const meal = [line("a", 1000, 1818, 2000), line("b", 2100, 6612, 8000)];

  expect(deductionsTaken(meal, [{ rate: 1000, base: -4545, gross: -5000 }])).toEqual([
    { saleLineId: "a", rate: 1000, base: 1818, gross: 2000 },
  ]);
});

it("never takes more VAT than the meal holds at the rate, nor more base", () => {
  const meal = [line("a", 1000, 5, 5), line("b", 1000, 5, 5), line("c", 1000, 5, 5)];

  expect(deductionsTaken(meal, [{ rate: 1000, base: -7, gross: -10 }])).toEqual([
    { saleLineId: "c", rate: 1000, base: 5, gross: 5 },
    { saleLineId: "b", rate: 1000, base: 5, gross: 5 },
  ]);
  expect(deductionsTaken([line("a", 1000, 0, 4)], [{ rate: 1000, base: 1, gross: -1 }])).toEqual([
    { saleLineId: "a", rate: 1000, base: 0, gross: 1 },
  ]);
});

it("skips a line with nothing in it and a deduction that takes nothing off", () => {
  const meal = [line("a", 1000, 91, 100), line("b", 1000, 0, 0)];

  expect(deductionsTaken(meal, [{ rate: 1000, base: -27, gross: -30 }])).toEqual([
    { saleLineId: "a", rate: 1000, base: 27, gross: 30 },
  ]);
  expect(deductionsTaken(meal, [{ rate: 1000, base: 0, gross: 0 }])).toEqual([]);
});
