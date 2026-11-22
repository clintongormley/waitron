import { describe, expect, it } from "vitest";
import { receiptLabelsFor } from "@waitron/country-packs";
import {
  refusalsForVatBreakdown,
  VAT_SIGN_REFUSAL,
} from "@waitron/fiscal-verifactu/test/vat-breakdown-refusals.js";
import {
  addDecimal,
  compareDecimal,
  decimal,
  subtractDecimal,
  sumDecimals,
  type Decimal,
  type VatClass,
  VAT_RATE_TABLE,
} from "@waitron/shared";
import { rateLines, splitGross, vatSignRefused, type PricedLines } from "@waitron/menu";
import { deductAdvances, type AdvanceCredit } from "./advance-deduction.js";

const ON = "2026-11-19";
const LANGUAGES = ["en-GB", "es-ES"];
const TEN = decimal("10.00");
const TWENTY_ONE = decimal("21.00");

function meal(lines: readonly [string, VatClass][]): PricedLines {
  const gross = lines.map(([amount, vatClass], i) => ({
    lineNo: i + 1,
    name: `dish ${i + 1}`,
    descriptions: {},
    quantity: "1",
    vatRates: VAT_RATE_TABLE[vatClass],
    grossUnitPrice: decimal(amount),
    lineGross: decimal(amount),
  }));
  return rateLines({ lines: gross, total: sumDecimals(gross.map((l) => l.lineGross)) }, ON);
}

const times = (n: number, amount: string, vatClass: VatClass): [string, VatClass][] =>
  Array.from({ length: n }, () => [amount, vatClass]);

function advance(saleId: string, gross: string, rate: Decimal = TEN): AdvanceCredit {
  const { base, tax } = splitGross(decimal(gross), rate);
  return {
    saleId,
    invoiceNumber: `A/${saleId}`,
    issuedAt: "2026-11-19T20:30:00.000Z",
    groups: [{ rate, base, tax }],
    gross: decimal(gross),
  };
}

const deduct = (
  priced: PricedLines,
  advances: readonly AdvanceCredit[],
): ReturnType<typeof deductAdvances> => deductAdvances(priced, advances, { languages: LANGUAGES });

const breakdownOf = (priced: PricedLines) =>
  priced.vatBreakdown.map(({ rate, base, tax }) => ({ rate, base, tax }));

describe("deductAdvances — the worked examples", () => {
  it("example 1: €120 at 10% less A/12's €30 files 81.82 + 8.18 = 90.00", () => {
    const { priced, deductionLines } = deduct(meal([["120.00", "reduced"]]), [
      advance("12", "30.00"),
    ]);
    expect(breakdownOf(priced)).toEqual([{ rate: "10.00", base: "81.82", tax: "8.18" }]);
    expect(priced.total).toBe("90.00");
    expect(deductionLines).toHaveLength(1);
    expect(deductionLines[0]).toMatchObject({
      lineNo: 2,
      vatRate: "10.00",
      lineGross: "-30.00",
      lineTotal: "-27.27",
      quantity: "1",
      advanceRole: "deduction",
      deductsSaleId: "12",
    });
  });

  it("example 2: an advance at 10% against a bill mostly at 21% leaves a negative 10% row", () => {
    const priced = meal([
      ["20.00", "reduced"],
      ["80.00", "general"],
    ]);
    const rest = deduct(priced, [advance("12", "50.00")]);
    expect(breakdownOf(rest.priced)).toEqual([
      { rate: "10.00", base: "-27.27", tax: "-2.73" },
      { rate: "21.00", base: "66.12", tax: "13.88" },
    ]);
    expect(rest.priced.total).toBe("50.00");
    expect(rest.deductionLines.map((l) => [l.lineGross, l.lineTotal])).toEqual([
      ["-50.00", "-45.45"],
    ]);

    const lessWine = deduct(
      meal([
        ["20.00", "reduced"],
        ["30.00", "general"],
      ]),
      [advance("12", "50.00")],
    );
    expect(breakdownOf(lessWine.priced)).toEqual([
      { rate: "10.00", base: "-27.27", tax: "-2.73" },
      { rate: "21.00", base: "24.79", tax: "5.21" },
    ]);
    expect(lessWine.priced.total).toBe("0.00");
  });

  it("example 6 falls back to the gross: 0.04 and 0.01, deduction base −27.28", () => {
    const { priced, deductionLines } = deduct(meal([["30.05", "reduced"]]), [
      advance("12", "30.00"),
    ]);
    expect(breakdownOf(priced)).toEqual([{ rate: "10.00", base: "0.04", tax: "0.01" }]);
    expect(priced.total).toBe("0.05");
    expect(deductionLines.map((l) => [l.lineGross, l.lineTotal])).toEqual([["-30.00", "-27.28"]]);
  });

  it("example 8 subtracts the advance's own base and VAT: 3.92 and 0.43, not 3.95 and 0.40", () => {
    const { priced, deductionLines } = deduct(meal(times(7, "1.05", "reduced")), [
      advance("12", "3.00"),
    ]);
    expect(breakdownOf(priced)).toEqual([{ rate: "10.00", base: "3.92", tax: "0.43" }]);
    expect(priced.total).toBe("4.35");
    expect(deductionLines.map((l) => [l.lineNo, l.lineGross, l.lineTotal])).toEqual([
      [8, "-3.00", "-2.73"],
    ]);
    // The gross method, which the previous revision used, files a different base.
    expect(splitGross(decimal("4.35"), TEN)).toEqual({ base: "3.95", tax: "0.40" });
  });
});

describe("deductAdvances — the rules", () => {
  it("advances equal to the meal file 0.00 at every rate", () => {
    // Example 8's meal paid whole: subtracting leaves base −0.03 and VAT +0.03.
    const sevens = meal(times(7, "1.05", "reduced"));
    const raw = {
      base: subtractDecimal(sevens.vatBreakdown[0]!.base, splitGross(decimal("7.35"), TEN).base),
      tax: subtractDecimal(sevens.vatBreakdown[0]!.tax, splitGross(decimal("7.35"), TEN).tax),
    };
    expect(raw).toEqual({ base: "-0.03", tax: "0.03" });
    expect(vatSignRefused(raw.base, raw.tax, TEN)).toBe(true);
    const whole = deduct(sevens, [advance("12", "7.35")]);
    expect(breakdownOf(whole.priced)).toEqual([{ rate: "10.00", base: "0.00", tax: "0.00" }]);
    expect(whole.priced.total).toBe("0.00");
    expect(whole.deductionLines.map((l) => [l.lineGross, l.lineTotal])).toEqual([
      ["-7.35", "-6.65"],
    ]);

    const mixed = deduct(
      meal([
        ["20.00", "reduced"],
        ["80.00", "general"],
      ]),
      [advance("12", "20.00"), advance("13", "80.00", TWENTY_ONE)],
    );
    expect(breakdownOf(mixed.priced)).toEqual([
      { rate: "10.00", base: "0.00", tax: "0.00" },
      { rate: "21.00", base: "0.00", tax: "0.00" },
    ]);
    expect(mixed.priced.total).toBe("0.00");
  });

  it("two advances at one rate each take off their own base; on a fallback the last one takes the difference", () => {
    const own = deduct(meal([["50.00", "reduced"]]), [
      advance("12", "20.00"),
      advance("13", "10.00"),
    ]);
    expect(breakdownOf(own.priced)).toEqual([{ rate: "10.00", base: "18.18", tax: "1.82" }]);
    expect(own.deductionLines.map((l) => [l.lineNo, l.deductsSaleId, l.lineTotal])).toEqual([
      [2, "12", "-18.18"],
      [3, "13", "-9.09"],
    ]);

    // 27.32 − 18.18 − 9.09 leaves base 0.05 and VAT 0.00, which AEAT refuses.
    const fallback = deduct(meal([["30.05", "reduced"]]), [
      advance("12", "20.00"),
      advance("13", "10.00"),
    ]);
    expect(breakdownOf(fallback.priced)).toEqual([{ rate: "10.00", base: "0.04", tax: "0.01" }]);
    expect(fallback.deductionLines.map((l) => [l.deductsSaleId, l.lineGross, l.lineTotal])).toEqual(
      [
        ["12", "-20.00", "-18.18"],
        ["13", "-10.00", "-9.10"],
      ],
    );
  });

  it("a corrected advance takes off what is left of it", () => {
    const corrected: AdvanceCredit = {
      ...advance("12", "30.00"),
      // A/12 (27.27 + 2.73) and a corrective of −9.09 and −0.91.
      groups: [{ rate: TEN, base: decimal("18.18"), tax: decimal("1.82") }],
      gross: decimal("20.00"),
    };
    const { priced, deductionLines } = deduct(meal([["120.00", "reduced"]]), [corrected]);
    expect(breakdownOf(priced)).toEqual([{ rate: "10.00", base: "90.91", tax: "9.09" }]);
    expect(priced.total).toBe("100.00");
    expect(deductionLines.map((l) => [l.lineGross, l.lineTotal])).toEqual([["-20.00", "-18.18"]]);

    const given = meal([["120.00", "reduced"]]);
    const wholeBack: AdvanceCredit = {
      ...advance("12", "30.00"),
      groups: [{ rate: TEN, base: decimal("0.00"), tax: decimal("0.00") }],
      gross: decimal("0.00"),
    };
    const none = deduct(given, [wholeBack]);
    expect(none.priced).toBe(given);
    expect(none.deductionLines).toEqual([]);
  });

  it("advances worth more than the meal throw advance.exceeds_bill", () => {
    expect(() => deduct(meal([["800.00", "reduced"]]), [advance("3", "1000.00")])).toThrow(
      expect.objectContaining({
        code: "advance.exceeds_bill",
        params: { mealTotal: "800.00", advances: "1000.00" },
      }),
    );
  });

  it("each rate's line bases equal its breakdown base and its line grosses its base plus VAT", () => {
    const cases: [PricedLines, AdvanceCredit[]][] = [
      [meal([["120.00", "reduced"]]), [advance("12", "30.00")]],
      [
        meal([
          ["20.00", "reduced"],
          ["80.00", "general"],
        ]),
        [advance("12", "50.00")],
      ],
      [meal([["30.05", "reduced"]]), [advance("12", "30.00")]],
      [meal(times(7, "1.05", "reduced")), [advance("12", "3.00")]],
      [meal([["30.05", "reduced"]]), [advance("12", "20.00"), advance("13", "10.00")]],
    ];
    for (const [given, advances] of cases) {
      const { priced, deductionLines } = deduct(given, advances);
      expect(lineInvariantFailures(given, priced, deductionLines)).toEqual([]);
    }
  });

  it("no advances returns the priced lines unchanged", () => {
    const given = meal([["120.00", "reduced"]]);
    const { priced, deductionLines } = deduct(given, []);
    expect(priced).toBe(given);
    expect(deductionLines).toEqual([]);
  });

  it("a deduction line stores Payment on account, the Spanish words, and no number or date", () => {
    const { deductionLines } = deduct(meal([["120.00", "reduced"]]), [advance("12", "30.00")]);
    const line = deductionLines[0]!;
    expect(line.name).toBe("Payment on account");
    const spanish = receiptLabelsFor("es-ES").paymentOnAccount;
    expect(spanish).not.toBe("Payment on account");
    expect(line.descriptions).toEqual({ "en-GB": "Payment on account", "es-ES": spanish });
    expect(line.category).toBeNull();
    expect(JSON.stringify([line.name, line.descriptions])).not.toMatch(/\d/);
  });
});

type Deducted = ReturnType<typeof deductAdvances>;

function lineInvariantFailures(
  given: PricedLines,
  priced: PricedLines,
  deductionLines: Deducted["deductionLines"],
): string[] {
  const failures: string[] = [];
  const all = [...given.lines, ...deductionLines];
  for (const row of priced.vatBreakdown) {
    const at = all.filter((l) => compareDecimal(decimal(l.vatRate), row.rate) === 0);
    const bases = sumDecimals(at.map((l) => decimal(l.lineTotal)));
    const grosses = sumDecimals(at.map((l) => decimal(l.lineGross)));
    if (compareDecimal(bases, row.base) !== 0) failures.push(`${row.rate} base ${bases}`);
    if (compareDecimal(grosses, addDecimal(row.base, row.tax)) !== 0) {
      failures.push(`${row.rate} gross ${grosses}`);
    }
  }
  const total = sumDecimals(all.map((l) => decimal(l.lineGross)));
  if (compareDecimal(total, priced.total) !== 0) failures.push(`total ${total}`);
  return failures;
}

// The sweep. `validate` from `@waitron/verifactu` judges every rest's record.

const NOW = new Date("2026-11-19T22:00:00.000Z");

const errorsOf = (rows: readonly { rate: Decimal; base: Decimal; tax: Decimal }[]) =>
  refusalsForVatBreakdown(rows, { now: NOW });

// mulberry32: a seeded generator, so the sweep is the same on every run.
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const euros = (cents: number): string => {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
};

interface SweepCase {
  lines: [string, VatClass][];
  advance: string;
}

function sweepCases(): SweepCase[] {
  const random = seeded(20261119);
  const between = (low: number, high: number) => low + Math.floor(random() * (high - low + 1));
  const randomMeal = (mixed: boolean): [number, VatClass][] =>
    Array.from({ length: between(1, 15) }, () => [
      between(105, 2200),
      mixed && random() < 0.5 ? "general" : "reduced",
    ]);
  const sum = (lines: [number, VatClass][], only?: VatClass) =>
    lines
      .filter(([, vatClass]) => only === undefined || vatClass === only)
      .reduce((total, [cents]) => total + cents, 0);
  const inEuros = (lines: [number, VatClass][]): [string, VatClass][] =>
    lines.map(([cents, vatClass]) => [euros(cents), vatClass]);
  const cases: SweepCase[] = [];
  for (const mixed of [false, true]) {
    for (let i = 0; i < 400; i += 1) {
      const lines = randomMeal(mixed);
      cases.push({ lines: inEuros(lines), advance: euros(between(1, sum(lines))) });
    }
  }
  // Every remainder from −0.60 to 0.60 at 10%; a negative one only where 21% dishes keep the
  // bill's own total above the advance.
  for (let i = 0; i < 60; i += 1) {
    const lines = randomMeal(i % 2 === 1);
    const shared = inEuros(lines);
    for (let rest = -60; rest <= 60; rest += 1) {
      const paid = sum(lines, "reduced") - rest;
      if (paid >= 1 && paid <= sum(lines)) cases.push({ lines: shared, advance: euros(paid) });
    }
  }
  const big = inEuros(Array.from({ length: 12 }, () => [between(1700, 2200), "reduced"]));
  for (let paid = 1; paid <= 20000; paid += 1) cases.push({ lines: big, advance: euros(paid) });
  cases.push({
    lines: [
      ["20.00", "reduced"],
      ["80.00", "general"],
    ],
    advance: "50.00",
  });
  return cases;
}

interface SweepResult {
  cases: number;
  failures: string[];
  rawRefused: number;
  predicateDisagrees: string[];
  grossMethodDiffers: number;
  subtractionUsed: number;
}

function runSweep(): SweepResult {
  const result: SweepResult = {
    cases: 0,
    failures: [],
    rawRefused: 0,
    predicateDisagrees: [],
    grossMethodDiffers: 0,
    subtractionUsed: 0,
  };
  const meals = new Map<SweepCase["lines"], PricedLines>();
  for (const c of sweepCases()) {
    result.cases += 1;
    let given = meals.get(c.lines);
    if (given === undefined) {
      given = meal(c.lines);
      meals.set(c.lines, given);
    }
    const credit = advance("1", c.advance);
    const own = credit.groups[0]!;
    const { priced, deductionLines } = deduct(given, [credit]);
    const label = `${c.lines.map(([a, v]) => `${a}${v[0]}`).join("+")} less ${c.advance}`;

    const restErrors = errorsOf(priced.vatBreakdown);
    if (restErrors.length > 0) result.failures.push(`${label}: ${restErrors.join(",")}`);
    const lineFailures = lineInvariantFailures(given, priced, deductionLines);
    if (lineFailures.length > 0) result.failures.push(`${label}: ${lineFailures.join(",")}`);
    if (compareDecimal(priced.total, subtractDecimal(given.total, credit.gross)) !== 0) {
      result.failures.push(`${label}: total ${priced.total}`);
    }

    const zero = decimal("0.00");
    const mealAt = given.vatBreakdown.find((row) => compareDecimal(row.rate, own.rate) === 0) ?? {
      rate: own.rate,
      base: zero,
      tax: zero,
    };
    const restAt = priced.vatBreakdown.find((row) => compareDecimal(row.rate, own.rate) === 0)!;
    // The subtraction alone, without the fallback.
    const raw = [
      ...given.vatBreakdown.filter((row) => row !== mealAt),
      {
        rate: own.rate,
        base: subtractDecimal(mealAt.base, own.base),
        tax: subtractDecimal(mealAt.tax, own.tax),
      },
    ];
    const rawSign = errorsOf(raw).includes(VAT_SIGN_REFUSAL);
    const predicted = raw.some((row) => vatSignRefused(row.base, row.tax, row.rate));
    if (rawSign) result.rawRefused += 1;
    if (rawSign !== predicted) result.predicateDisagrees.push(label);

    if (!predicted) {
      result.subtractionUsed += 1;
      if (compareDecimal(addDecimal(restAt.base, own.base), mealAt.base) !== 0) {
        result.failures.push(`${label}: bases ${restAt.base} + ${own.base} ≠ ${mealAt.base}`);
      }
      if (compareDecimal(addDecimal(restAt.tax, own.tax), mealAt.tax) !== 0) {
        result.failures.push(`${label}: VAT ${restAt.tax} + ${own.tax} ≠ ${mealAt.tax}`);
      }
      // The previous revision's method: what is left, worked out from its gross.
      const leftGross = subtractDecimal(addDecimal(mealAt.base, mealAt.tax), credit.gross);
      if (compareDecimal(splitGross(leftGross, own.rate).base, restAt.base) !== 0) {
        result.grossMethodDiffers += 1;
      }
    }
  }
  return result;
}

describe("deductAdvances — the sweep", () => {
  let sweep: SweepResult | undefined;
  const swept = (): SweepResult => (sweep ??= runSweep());

  it("every rest passes @waitron/verifactu's validate, and the bases filed across advance and rest add up to the meal's wherever the subtraction is used", () => {
    const { cases, failures, rawRefused, grossMethodDiffers, subtractionUsed } = swept();
    expect(failures.slice(0, 20)).toEqual([]);
    // Controls: without the fallback validate refuses some rests, and working from the gross
    // files a different base in some.
    expect(rawRefused).toBeGreaterThan(0);
    expect(grossMethodDiffers).toBeGreaterThan(0);
    expect(subtractionUsed).toBeGreaterThan(cases / 2);
    console.log(
      `sweep: ${cases} rests, ${rawRefused} refused without the fallback, ` +
        `${grossMethodDiffers} where the gross method files another base`,
    );
  });

  it("the sign-rule predicate agrees with validate on every refusal the sweep finds", () => {
    const { rawRefused, predicateDisagrees } = swept();
    expect(rawRefused).toBeGreaterThan(0);
    expect(predicateDisagrees.slice(0, 20)).toEqual([]);
  });
});
