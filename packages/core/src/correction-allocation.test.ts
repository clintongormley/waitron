import { describe, expect, it } from "vitest";
import {
  decimal,
  addDecimal,
  subtractDecimal,
  multiplyDecimal,
  compareDecimal,
  sumDecimals,
} from "@waitron/shared";
import {
  allocateCorrectionAmounts,
  type CorrectionAmountHistory,
} from "./correction-allocation.js";

const d = decimal;
const line = (id: string, lineNo: number, rate: string, gross: string, base: string) => ({
  id,
  lineNo,
  rate: d(rate),
  gross: d(gross),
  base: d(base),
});
const part = (saleLineId: string, rate: string, gross: string, base: string, tax: string) => ({
  saleLineId,
  rate: d(rate),
  gross: d(gross),
  base: d(base),
  tax: d(tax),
});

const oneRate = () => smallBill("10", "11.00", "10.00", 1);

function mixedRates(): CorrectionAmountHistory {
  const history = oneRate();
  history.lines.push(line("wine", 2, "21", "12.10", "10"));
  history.vatBreakdown.push({ rate: d("21"), base: d("10"), tax: d("2.10") });
  return history;
}

describe("correction amount allocation", () => {
  it.each([
    ["2.00", "1.82", "0.18"],
    ["5.50", "5.00", "0.50"],
  ])("keeps %s gross at 10%% as %s base and %s VAT", (gross, base, tax) => {
    expect(allocateCorrectionAmounts(oneRate(), { gross: d(gross) })).toEqual({
      gross,
      allocations: [{ saleLineId: "dish", rate: "10.00", gross, base, tax }],
      vatBreakdown: [{ rate: "10.00", base, tax }],
    });
  });

  it("shares two euros across the selected original rates by remaining gross", () => {
    const history = mixedRates();
    expect(
      allocateCorrectionAmounts(history, { gross: d("2.00"), lineIds: ["wine", "dish"] }),
    ).toEqual({
      gross: "2.00",
      allocations: [
        { saleLineId: "dish", rate: "10.00", gross: "0.95", base: "0.86", tax: "0.09" },
        { saleLineId: "wine", rate: "21.00", gross: "1.05", base: "0.87", tax: "0.18" },
      ],
      vatBreakdown: [
        { rate: "10.00", base: "0.86", tax: "0.09" },
        { rate: "21.00", base: "0.87", tax: "0.18" },
      ],
    });
  });

  it("takes the stored final VAT cent after two one-cent reductions", () => {
    const history = smallBill("21", "0.03", "0.02", 1);
    const first = allocateCorrectionAmounts(history, { gross: d("0.01") });
    expect(first.vatBreakdown).toEqual([{ rate: "21.00", base: "0.01", tax: "0.00" }]);
    history.consumed.push(...first.allocations);
    const second = allocateCorrectionAmounts(history, { gross: d("0.01") });
    expect(second.vatBreakdown).toEqual([{ rate: "21.00", base: "0.01", tax: "0.00" }]);
    history.consumed.push(...second.allocations);
    const last = allocateCorrectionAmounts(history, { gross: d("0.01") });
    expect(last.allocations).toEqual([
      { saleLineId: "dish", rate: "21.00", gross: "0.01", base: "0.00", tax: "0.01" },
    ]);
  });

  it("uses cumulative base rather than rounding every three-cent return separately", () => {
    const history = smallBill("21", "0.09", "0.07", 1);
    const first = allocateCorrectionAmounts(history, { gross: d("0.03") });
    expect(first.vatBreakdown).toEqual([{ rate: "21.00", base: "0.02", tax: "0.01" }]);
    history.consumed.push(...first.allocations);
    const second = allocateCorrectionAmounts(history, { gross: d("0.03") });
    expect(second.vatBreakdown).toEqual([{ rate: "21.00", base: "0.03", tax: "0.00" }]);
    history.consumed.push(...second.allocations);
    expect(allocateCorrectionAmounts(history, { gross: d("0.03") }).vatBreakdown).toEqual([
      { rate: "21.00", base: "0.02", tax: "0.01" },
    ]);
  });

  it("counts consumed allocation against line and rate capacity", () => {
    const history = oneRate();
    history.lines.push(line("second", 2, "10", "11.00", "10.00"));
    history.vatBreakdown = [{ rate: d("10"), base: d("20.00"), tax: d("2.00") }];
    history.consumed.push(part("dish", "10", "9.90", "9.00", "0.90"));
    expect(allocateCorrectionAmounts(history, { gross: d("2.20") })).toEqual({
      gross: "2.20",
      allocations: [
        { saleLineId: "dish", rate: "10.00", gross: "0.20", base: "0.18", tax: "0.02" },
        { saleLineId: "second", rate: "10.00", gross: "2.00", base: "1.82", tax: "0.18" },
      ],
      vatBreakdown: [{ rate: "10.00", base: "2.00", tax: "0.20" }],
    });
  });

  it("distributes the authoritative stored rate base across uneven lines", () => {
    const history: CorrectionAmountHistory = {
      lines: [
        line("rounding-cent", 1, "21", "0.01", "0.00"),
        line("base", 2, "21", "0.02", "0.02"),
      ],
      vatBreakdown: [{ rate: d("21"), base: d("0.02"), tax: d("0.01") }],
      consumed: [],
    };
    expect(allocateCorrectionAmounts(history, { gross: d("0.03") }).allocations).toEqual([
      { saleLineId: "rounding-cent", rate: "21.00", gross: "0.01", base: "0.01", tax: "0.00" },
      { saleLineId: "base", rate: "21.00", gross: "0.02", base: "0.01", tax: "0.01" },
    ]);
  });

  it("keeps four one-cent lines correctable as cumulative VAT rounding moves between them", () => {
    const history: CorrectionAmountHistory = {
      lines: ["a", "b", "c", "d"].map((id, index) => ({
        id,
        lineNo: index + 1,
        rate: d("21"),
        gross: d("0.01"),
        base: d(index === 3 ? "0.00" : "0.01"),
      })),
      vatBreakdown: [{ rate: d("21"), base: d("0.03"), tax: d("0.01") }],
      consumed: [],
    };
    for (const [id, base, tax] of [
      ["a", "0.01", "0.00"],
      ["b", "0.01", "0.00"],
      ["c", "0.00", "0.01"],
      ["d", "0.01", "0.00"],
    ]) {
      const next = allocateCorrectionAmounts(history, { gross: d("0.01") });
      expect(next.allocations).toEqual([
        { saleLineId: id, rate: "21.00", gross: "0.01", base, tax },
      ]);
      history.consumed.push(...next.allocations);
    }
  });

  it("breaks equal remainders by original line number then id, independently of input order", () => {
    const history: CorrectionAmountHistory = {
      lines: [
        line("z", 2, "0", "1.00", "1.00"),
        line("b", 1, "0", "1.00", "1.00"),
        line("a", 1, "0", "1.00", "1.00"),
      ],
      vatBreakdown: [{ rate: d("0"), base: d("3.00"), tax: d("0") }],
      consumed: [],
    };
    for (const lines of [
      history.lines,
      [...history.lines].reverse(),
      [...history.lines.slice(1), history.lines[0]!],
    ]) {
      expect(
        allocateCorrectionAmounts(
          { ...history, lines },
          { gross: d("0.01"), lineIds: lines.map((l) => l.id) },
        ).allocations,
      ).toEqual([{ saleLineId: "a", rate: "0.00", gross: "0.01", base: "0.01", tax: "0.00" }]);
    }
  });

  it("credits a line only within its selected scope", () => {
    const history = oneRate();
    history.lines.push(line("other", 2, "10", "11.00", "10.00"));
    history.vatBreakdown = [{ rate: d("10"), base: d("20.00"), tax: d("2.00") }];
    expect(
      allocateCorrectionAmounts(history, { gross: d("2.00"), lineIds: ["other"] }).allocations,
    ).toEqual([{ saleLineId: "other", rate: "10.00", gross: "2.00", base: "1.82", tax: "0.18" }]);
  });

  it("keeps exact cents at the largest supported money value", () => {
    const history: CorrectionAmountHistory = {
      lines: [line("dish", 1, "0", "999999999999.99", "999999999999.99")],
      vatBreakdown: [{ rate: d("0"), base: d("999999999999.99"), tax: d("0") }],
      consumed: [],
    };
    expect(allocateCorrectionAmounts(history, { gross: d("999999999999.98") }).allocations).toEqual(
      [
        {
          saleLineId: "dish",
          rate: "0.00",
          gross: "999999999999.98",
          base: "999999999999.98",
          tax: "0.00",
        },
      ],
    );
  });

  it.each(["0", "-1", "0.001", "1.001", "1000000000000"])(
    "refuses a nonpositive, fractional-cent or oversized request %s",
    (gross) => {
      expect(() => allocateCorrectionAmounts(oneRate(), { gross: d(gross) })).toThrowError(
        expect.objectContaining({ code: "sale.correction_amount_invalid" }),
      );
    },
  );

  it("accepts extra zero places without changing the amount", () => {
    expect(allocateCorrectionAmounts(oneRate(), { gross: d("2.0000") }).gross).toBe("2.00");
  });

  it("refuses value beyond the selected line's remaining gross", () => {
    expect(() => allocateCorrectionAmounts(oneRate(), { gross: d("11.01") })).toThrowError(
      expect.objectContaining({ code: "sale.correction_amount_invalid" }),
    );
  });

  it.each([
    [[], "empty"],
    [["missing"], "missing"],
    [["dish", "dish"], "duplicate"],
  ] as const)("refuses an invalid explicit scope %j", (lineIds, reason) => {
    expect(() => allocateCorrectionAmounts(oneRate(), { gross: d("1"), lineIds })).toThrowError(
      expect.objectContaining({
        code: "sale.correction_scope_invalid",
        params: { reason },
      }),
    );
  });

  it("requires a visible explicit scope when more than one rate remains", () => {
    const history = mixedRates();
    expect(() => allocateCorrectionAmounts(history, { gross: d("2") })).toThrowError(
      expect.objectContaining({
        code: "sale.correction_scope_invalid",
        params: { reason: "required" },
      }),
    );
  });

  it("does not credit an exhausted line again", () => {
    const history = oneRate();
    history.consumed.push(part("dish", "10", "11", "10", "1"));
    expect(() => allocateCorrectionAmounts(history, { gross: d("0.01") })).toThrowError(
      expect.objectContaining({ code: "sale.correction_amount_invalid" }),
    );
  });

  it.each([
    ["0.11", "0.00"],
    ["0.00", "0.11"],
  ])("refuses historical base/VAT %s/%s that would need a negative new delta", (base, tax) => {
    const history: CorrectionAmountHistory = {
      lines: [line("dish", 1, "21", "1.21", "1.00")],
      vatBreakdown: [{ rate: d("21"), base: d("1.00"), tax: d("0.21") }],
      consumed: [
        { saleLineId: "dish", rate: d("21"), gross: d("0.11"), base: d(base), tax: d(tax) },
      ],
    };
    expect(() => allocateCorrectionAmounts(history, { gross: d("0.01") })).toThrowError(
      expect.objectContaining({ code: "sale.correction_history_unusable" }),
    );
  });

  it("starts the amount scope automatically once only one rate has remaining value", () => {
    const history = mixedRates();
    history.consumed.push(part("wine", "21", "12.10", "10", "2.10"));
    expect(allocateCorrectionAmounts(history, { gross: d("2") }).allocations).toEqual([
      { saleLineId: "dish", rate: "10.00", gross: "2.00", base: "1.82", tax: "0.18" },
    ]);
  });

  it("gives a free dish no refund while another line has value", () => {
    const history = oneRate();
    history.lines.push(line("complimentary", 2, "10", "0", "0"));
    expect(allocateCorrectionAmounts(history, { gross: d("2") }).allocations).toEqual([
      { saleLineId: "dish", rate: "10.00", gross: "2.00", base: "1.82", tax: "0.18" },
    ]);
  });

  it.each([
    ["10.01", "10.01", "0.00"],
    ["1.01", "0.00", "1.01"],
  ])("refuses overspent unselected rate history %s/%s/%s", (gross, base, tax) => {
    const history = mixedRates();
    history.consumed.push({
      saleLineId: "dish",
      rate: d("10"),
      gross: d(gross),
      base: d(base),
      tax: d(tax),
    });
    expect(() =>
      allocateCorrectionAmounts(history, { gross: d("2"), lineIds: ["wine"] }),
    ).toThrowError(expect.objectContaining({ code: "sale.correction_history_unusable" }));
  });

  it.each([
    ["line", "gross", "-11"],
    ["line", "base", "-1"],
    ["line", "base", "12"],
    ["line", "gross", "11.001"],
    ["line", "base", "10.001"],
    ["line", "gross", "1000000000000"],
    ["line", "rate", "-1"],
    ["line", "rate", "10.001"],
    ["line", "rate", "100.01"],
    ["vat", "base", "9.99"],
    ["vat", "tax", "1.01"],
    ["vat", "tax", "-1"],
    ["prior", "saleLineId", "foreign"],
    ["prior", "rate", "21"],
    ["prior", "gross", "-1.10"],
    ["prior", "gross", "1.101"],
    ["prior", "gross", "1.11"],
  ])("refuses inconsistent %s %s %s", (target, field, value) => {
    const history = oneRate();
    history.consumed.push(part("dish", "10", "1.10", "1", "0.10"));
    expect(allocateCorrectionAmounts(history, { gross: d("0.01") }).gross).toBe("0.01");
    const row =
      target === "line"
        ? history.lines[0]!
        : target === "vat"
          ? history.vatBreakdown[0]!
          : history.consumed[0]!;
    Object.assign(row, { [field!]: field === "saleLineId" ? value : d(value!) });
    expect(() => allocateCorrectionAmounts(history, { gross: d("0.01") })).toThrowError(
      expect.objectContaining({ code: "sale.correction_history_unusable" }),
    );
  });

  it.each<[string, (h: CorrectionAmountHistory) => void]>([
    [
      "duplicate original id",
      (h) => {
        h.lines.push({ ...h.lines[0]! });
      },
    ],
    [
      "missing original rate",
      (h) => {
        h.vatBreakdown = [];
      },
    ],
    [
      "duplicate rate spelling",
      (h) => {
        h.vatBreakdown.push({ rate: d("10.00"), base: d("0"), tax: d("0") });
      },
    ],
    [
      "unexplained rate",
      (h) => {
        h.vatBreakdown.push({ rate: d("21"), base: d("0"), tax: d("0") });
      },
    ],
    [
      "invalid line number",
      (h) => {
        h.lines[0]!.lineNo = 0;
      },
    ],
    [
      "overspent prior base",
      (h) => {
        h.consumed.push(part("dish", "10", "10.01", "10.01", "0"));
      },
    ],
    [
      "overspent prior VAT",
      (h) => {
        h.consumed.push(part("dish", "10", "1.01", "0", "1.01"));
      },
    ],
  ])("refuses an unreconciled history: %s", (_label, change) => {
    const history = oneRate();
    expect(allocateCorrectionAmounts(history, { gross: d("0.01") }).gross).toBe("0.01");
    change(history);
    expect(() => allocateCorrectionAmounts(history, { gross: d("0.01") })).toThrowError(
      expect.objectContaining({ code: "sale.correction_history_unusable" }),
    );
  });

  it.each([
    ["21", "1.00", "0.83", 10, "9.90", "8.20", "1.70"],
    ["10", "1.80", "1.64", 8, "14.30", "13.02", "1.28"],
  ] as const)(
    "keeps stored rate budgets on a near-full %s%% refund",
    (rate, gross, base, count, refund, wantBase, wantTax) => {
      const history = smallBill(rate, gross, base, count);
      const result = allocateCorrectionAmounts(history, { gross: d(refund) });
      expect(result.vatBreakdown).toEqual([
        { rate: d(rate).concat(".00"), base: wantBase, tax: wantTax },
      ]);
      history.consumed.push(...result.allocations);
      const rest = allocateCorrectionAmounts(history, { gross: d("0.10") });
      expect(rest.vatBreakdown).toEqual([{ rate: rate + ".00", base: "0.10", tax: "0.00" }]);
    },
  );

  it("can refund every cent of small line-rounded bills without overspending base or VAT", () => {
    for (const [rate, gross, base, count, cents, totalBase, totalTax] of [
      ["21", "1.00", "0.83", 10, 1000, "8.30", "1.70"],
      ["10", "1.80", "1.64", 8, 1440, "13.12", "1.28"],
    ] as const) {
      for (let cent = 1; cent <= cents; cent++) {
        const history = smallBill(rate, gross, base, count);
        const amount = d((cent / 100).toFixed(2));
        const result = allocateCorrectionAmounts(history, { gross: amount });
        expect(result.gross).toBe(amount);
        const group = result.vatBreakdown[0]!;
        expect(compareDecimal(group.base, d(totalBase))).toBeLessThanOrEqual(0);
        expect(compareDecimal(group.tax, d(totalTax))).toBeLessThanOrEqual(0);
        history.consumed.push(...result.allocations);
        if (cent < cents) {
          const rest = allocateCorrectionAmounts(history, {
            gross: d(((cents - cent) / 100).toFixed(2)),
          });
          expect(addDecimal(group.base, rest.vatBreakdown[0]!.base)).toBe(d(totalBase));
          expect(addDecimal(group.tax, rest.vatBreakdown[0]!.tax)).toBe(d(totalTax));
        }
      }
      const history = smallBill(rate, gross, base, count);
      for (let cent = 0; cent < cents; cent++) {
        const next = allocateCorrectionAmounts(history, { gross: d("0.01") });
        history.consumed.push(...next.allocations);
      }
      expect(sumDecimals(history.consumed.map((part) => part.base))).toBe(d(totalBase));
      expect(sumDecimals(history.consumed.map((part) => part.tax))).toBe(d(totalTax));
    }
  });

  it.each([
    ["4", "1.04", "1.00", "0.13", "0.13", "0.00"],
    ["0", "1.00", "1.00", "0.03", "0.03", "0.00"],
  ])(
    "pins gross/base/VAT for a partial %s%% refund",
    (rate, gross, base, refund, wantBase, tax) => {
      expect(
        allocateCorrectionAmounts(smallBill(rate!, gross!, base!, 1), { gross: d(refund!) })
          .vatBreakdown,
      ).toEqual([{ rate: rate + ".00", base: wantBase, tax }]);
    },
  );

  it("weights remaining gross after an earlier return", () => {
    const history = smallBill("0", "10", "10", 2);
    history.consumed.push(part("0", "0", "5", "5", "0"));
    expect(allocateCorrectionAmounts(history, { gross: d("3") }).allocations).toEqual([
      { saleLineId: "0", rate: "0.00", gross: "1.00", base: "1.00", tax: "0.00" },
      { saleLineId: "1", rate: "0.00", gross: "2.00", base: "2.00", tax: "0.00" },
    ]);
  });

  it("splits a three-cent return across unequal original lines", () => {
    const history: CorrectionAmountHistory = {
      lines: [line("a", 1, "21", "0.05", "0.04"), line("b", 2, "21", "0.04", "0.03")],
      vatBreakdown: [{ rate: d("21"), base: d("0.07"), tax: d("0.02") }],
      consumed: [],
    };
    expect(allocateCorrectionAmounts(history, { gross: d("0.03") }).allocations).toEqual([
      { saleLineId: "a", rate: "21.00", gross: "0.02", base: "0.01", tax: "0.01" },
      { saleLineId: "b", rate: "21.00", gross: "0.01", base: "0.01", tax: "0.00" },
    ]);
  });

  it("leaves the frozen source and earlier allocations unchanged", () => {
    const history = oneRate();
    history.consumed.push(part("dish", "10", "1.10", "1", "0.10"));
    const before = structuredClone(history);
    allocateCorrectionAmounts(history, { gross: d("2") });
    expect(history).toEqual(before);
  });
});

function smallBill(
  rate: string,
  gross: string,
  base: string,
  count: number,
): CorrectionAmountHistory {
  const totalBase = multiplyDecimal(d(base), d(String(count)));
  return {
    lines: Array.from({ length: count }, (_, index) => ({
      id: count === 1 ? "dish" : String(index),
      lineNo: index + 1,
      rate: d(rate),
      gross: d(gross),
      base: d(base),
    })),
    vatBreakdown: [
      {
        rate: d(rate),
        base: totalBase,
        tax: subtractDecimal(multiplyDecimal(d(gross), d(String(count))), totalBase),
      },
    ],
    consumed: [],
  };
}
