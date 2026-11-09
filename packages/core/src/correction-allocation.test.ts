import { describe, expect, it } from "vitest";
import { decimal, addDecimal, subtractDecimal, multiplyDecimal, compareDecimal, sumDecimals } from "@waitron/shared";
import {
  allocateCorrectionAmounts,
  type CorrectionAmountHistory,
} from "./correction-allocation.js";

const d = decimal;

function oneRate(): CorrectionAmountHistory {
  return {
    lines: [{ id: "dish", lineNo: 1, rate: d("10"), gross: d("11.00"), base: d("10.00") }],
    vatBreakdown: [{ rate: d("10"), base: d("10.00"), tax: d("1.00") }],
    consumed: [],
  };
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
    const history = oneRate();
    history.lines.push({ id: "wine", lineNo: 2, rate: d("21"), gross: d("12.10"), base: d("10") });
    history.vatBreakdown.push({ rate: d("21"), base: d("10"), tax: d("2.10") });
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
    const history: CorrectionAmountHistory = {
      lines: [{ id: "dish", lineNo: 1, rate: d("21"), gross: d("0.03"), base: d("0.02") }],
      vatBreakdown: [{ rate: d("21"), base: d("0.02"), tax: d("0.01") }],
      consumed: [],
      };
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
    const history: CorrectionAmountHistory = {
      lines: [{ id: "dish", lineNo: 1, rate: d("21"), gross: d("0.09"), base: d("0.07") }],
      vatBreakdown: [{ rate: d("21"), base: d("0.07"), tax: d("0.02") }],
      consumed: [],
      };
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

  it.each(["consumed"] as const)(
    "counts %s allocation against line and rate capacity",
    (field) => {
      const history = oneRate();
      history.lines.push({
        id: "second",
        lineNo: 2,
        rate: d("10"),
        gross: d("11.00"),
        base: d("10.00"),
      });
      history.vatBreakdown = [{ rate: d("10"), base: d("20.00"), tax: d("2.00") }];
      history[field].push({
        saleLineId: "dish",
        rate: d("10"),
        gross: d("9.90"),
        base: d("9.00"),
        tax: d("0.90"),
      });
      expect(allocateCorrectionAmounts(history, { gross: d("2.20") })).toEqual({
        gross: "2.20",
        allocations: [
          { saleLineId: "dish", rate: "10.00", gross: "0.20", base: "0.18", tax: "0.02" },
          { saleLineId: "second", rate: "10.00", gross: "2.00", base: "1.82", tax: "0.18" },
        ],
        vatBreakdown: [{ rate: "10.00", base: "2.00", tax: "0.20" }],
      });
    },
  );

  it("distributes the authoritative stored rate base across uneven lines", () => {
    const history: CorrectionAmountHistory = {
      lines: [
        { id: "rounding-cent", lineNo: 1, rate: d("21"), gross: d("0.01"), base: d("0.00") },
        { id: "base", lineNo: 2, rate: d("21"), gross: d("0.02"), base: d("0.02") },
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
        { id: "z", lineNo: 2, rate: d("0"), gross: d("1.00"), base: d("1.00") },
        { id: "b", lineNo: 1, rate: d("0"), gross: d("1.00"), base: d("1.00") },
        { id: "a", lineNo: 1, rate: d("0"), gross: d("1.00"), base: d("1.00") },
      ],
      vatBreakdown: [{ rate: d("0"), base: d("3.00"), tax: d("0") }],
      consumed: [],
      };
    expect(allocateCorrectionAmounts(history, { gross: d("0.01") }).allocations).toEqual([
      { saleLineId: "a", rate: "0.00", gross: "0.01", base: "0.01", tax: "0.00" },
    ]);
  });

  it("credits a line only within its selected scope", () => {
    const history = oneRate();
    history.lines.push({
      id: "other",
      lineNo: 2,
      rate: d("10"),
      gross: d("11.00"),
      base: d("10.00"),
    });
    history.vatBreakdown = [{ rate: d("10"), base: d("20.00"), tax: d("2.00") }];
    expect(
      allocateCorrectionAmounts(history, { gross: d("2.00"), lineIds: ["other"] }).allocations,
    ).toEqual([{ saleLineId: "other", rate: "10.00", gross: "2.00", base: "1.82", tax: "0.18" }]);
  });

  it("keeps exact cents at the largest supported money value", () => {
    const history: CorrectionAmountHistory = {
      lines: [
        {
          id: "dish",
          lineNo: 1,
          rate: d("0"),
          gross: d("999999999999.99"),
          base: d("999999999999.99"),
        },
      ],
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
    const history = oneRate();
    history.lines.push({ id: "wine", lineNo: 2, rate: d("21"), gross: d("12.10"), base: d("10") });
    history.vatBreakdown.push({ rate: d("21"), base: d("10"), tax: d("2.10") });
    expect(() => allocateCorrectionAmounts(history, { gross: d("2") })).toThrowError(
      expect.objectContaining({
        code: "sale.correction_scope_invalid",
        params: { reason: "required" },
      }),
    );
  });

  it("does not credit an exhausted line again", () => {
    const history = oneRate();
    history.consumed.push({
      saleLineId: "dish",
      rate: d("10"),
      gross: d("11"),
      base: d("10"),
      tax: d("1"),
    });
    expect(() => allocateCorrectionAmounts(history, { gross: d("0.01") })).toThrowError(
      expect.objectContaining({ code: "sale.correction_amount_invalid" }),
    );
  });

  it.each([
    ["0.11", "0.00"],
    ["0.00", "0.11"],
  ])("refuses historical base/VAT %s/%s that would need a negative new delta", (base, tax) => {
    const history: CorrectionAmountHistory = {
      lines: [{ id: "dish", lineNo: 1, rate: d("21"), gross: d("1.21"), base: d("1.00") }],
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
    const history = oneRate();
    history.lines.push({ id: "wine", lineNo: 2, rate: d("21"), gross: d("12.10"), base: d("10") });
    history.vatBreakdown.push({ rate: d("21"), base: d("10"), tax: d("2.10") });
    history.consumed.push({
      saleLineId: "wine",
      rate: d("21"),
      gross: d("12.10"),
      base: d("10"),
      tax: d("2.10"),
    });
    expect(allocateCorrectionAmounts(history, { gross: d("2") }).allocations).toEqual([
      { saleLineId: "dish", rate: "10.00", gross: "2.00", base: "1.82", tax: "0.18" },
    ]);
  });

  it("gives a free dish no refund while another line has value", () => {
    const history = oneRate();
    history.lines.push({
      id: "complimentary",
      lineNo: 2,
      rate: d("10"),
      gross: d("0"),
      base: d("0"),
    });
    expect(allocateCorrectionAmounts(history, { gross: d("2") }).allocations).toEqual([
      { saleLineId: "dish", rate: "10.00", gross: "2.00", base: "1.82", tax: "0.18" },
    ]);
  });

  it.each([
    ["10.01", "10.01", "0.00"],
    ["1.01", "0.00", "1.01"],
  ])("refuses overspent unselected rate history %s/%s/%s", (gross, base, tax) => {
    const history = oneRate();
    history.lines.push({ id: "wine", lineNo: 2, rate: d("21"), gross: d("12.10"), base: d("10") });
    history.vatBreakdown.push({ rate: d("21"), base: d("10"), tax: d("2.10") });
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

  it.each<[string, (history: CorrectionAmountHistory) => void]>([
    [
      "duplicate original id",
      (history) => {
        history.lines.push({ ...history.lines[0]! });
      },
    ],
    [
      "missing original rate",
      (history) => {
        history.vatBreakdown = [];
      },
    ],
    [
      "duplicate original rate spelling",
      (history) => {
        history.vatBreakdown.push({ rate: d("10.00"), base: d("0"), tax: d("0") });
      },
    ],
    [
      "unexplained original rate",
      (history) => {
        history.vatBreakdown.push({ rate: d("21"), base: d("0"), tax: d("0") });
      },
    ],
    [
      "negative original gross",
      (history) => {
        history.lines[0]!.gross = d("-11");
      },
    ],
    [
      "negative original base",
      (history) => {
        history.lines[0]!.base = d("-1");
      },
    ],
    [
      "base above original gross",
      (history) => {
        history.lines[0]!.base = d("12");
      },
    ],
    [
      "fractional original gross",
      (history) => {
        history.lines[0]!.gross = d("11.001");
      },
    ],
    [
      "fractional original base",
      (history) => {
        history.lines[0]!.base = d("10.001");
      },
    ],
    [
      "oversized original gross",
      (history) => {
        history.lines[0]!.gross = d("1000000000000");
      },
    ],
    [
      "invalid original line number",
      (history) => {
        history.lines[0]!.lineNo = 0;
      },
    ],
    [
      "negative rate",
      (history) => {
        history.lines[0]!.rate = d("-1");
      },
    ],
    [
      "fractional basis point",
      (history) => {
        history.lines[0]!.rate = d("10.001");
      },
    ],
    [
      "rate above one hundred percent",
      (history) => {
        history.lines[0]!.rate = d("100.01");
      },
    ],
    [
      "base not reconciled to stored rate",
      (history) => {
        history.vatBreakdown[0]!.base = d("9.99");
      },
    ],
    [
      "tax not reconciled to stored gross",
      (history) => {
        history.vatBreakdown[0]!.tax = d("1.01");
      },
    ],
    [
      "negative original tax",
      (history) => {
        history.vatBreakdown[0]!.tax = d("-1");
      },
    ],
    [
      "foreign prior line",
      (history) => {
        history.consumed.push({
          saleLineId: "foreign",
          rate: d("10"),
          gross: d("1.10"),
          base: d("1"),
          tax: d("0.10"),
        });
      },
    ],
    [
      "wrong prior rate",
      (history) => {
        history.consumed.push({
          saleLineId: "dish",
          rate: d("21"),
          gross: d("1.10"),
          base: d("1"),
          tax: d("0.10"),
        });
      },
    ],
    [
      "negative prior gross",
      (history) => {
        history.consumed.push({
          saleLineId: "dish",
          rate: d("10"),
          gross: d("-1.10"),
          base: d("-1"),
          tax: d("-0.10"),
        });
      },
    ],
    [
      "fractional prior cent",
      (history) => {
        history.consumed.push({
          saleLineId: "dish",
          rate: d("10"),
          gross: d("1.101"),
          base: d("1.001"),
          tax: d("0.10"),
        });
      },
    ],
    [
      "prior gross mismatch",
      (history) => {
        history.consumed.push({
          saleLineId: "dish",
          rate: d("10"),
          gross: d("1.11"),
          base: d("1"),
          tax: d("0.10"),
        });
      },
    ],
    [
      "prior base above line budget",
      (history) => {
        history.consumed.push({
          saleLineId: "dish",
          rate: d("10"),
          gross: d("10.01"),
          base: d("10.01"),
          tax: d("0"),
        });
      },
    ],
    [
      "prior tax above line budget",
      (history) => {
        history.consumed.push({
          saleLineId: "dish",
          rate: d("10"),
          gross: d("1.01"),
          base: d("0"),
          tax: d("1.01"),
        });
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
    ["21", "1.00", "0.82", 10, "9.90", "8.20", "1.70"],
    ["10", "1.80", "1.64", 8, "14.30", "13.02", "1.28"],
  ] as const)("keeps stored rate budgets on a near-full %s%% refund", (rate, gross, base, count, refund, wantBase, wantTax) => {
    const history = smallBill(rate, gross, base, count);
    const result = allocateCorrectionAmounts(history, { gross: d(refund) });
    expect(result.vatBreakdown).toEqual([{ rate: d(rate).concat(".00"), base: wantBase, tax: wantTax }]);
    history.consumed.push(...result.allocations);
    const rest = allocateCorrectionAmounts(history, { gross: d("0.10") });
    expect(rest.vatBreakdown).toEqual([{ rate: d(rate).concat(".00"), base: rate === "21" ? "0.00" : "0.10", tax: rate === "21" ? "0.10" : "0.00" }]);
  });

  it("can refund every cent of small line-rounded bills without overspending base or VAT", () => {
    for (const [rate, gross, base, count, cents, totalBase, totalTax] of [
      ["21", "1.00", "0.82", 10, 1000, "8.20", "1.80"],
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
          const rest = allocateCorrectionAmounts(history, { gross: d(((cents - cent) / 100).toFixed(2)) });
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

  it("leaves the frozen source and earlier allocations unchanged", () => {
    const history = oneRate();
    const before = structuredClone(history);
    allocateCorrectionAmounts(history, { gross: d("2") });
    expect(history).toEqual(before);
  });
});

function smallBill(rate: string, gross: string, base: string, count: number): CorrectionAmountHistory {
  const totalBase = multiplyDecimal(d(base), d(String(count)));
  return {
    lines: Array.from({length: count}, (_, index) => ({id: String(index), lineNo: index + 1, rate: d(rate), gross: d(gross), base: d(base)})),
    vatBreakdown: [{rate: d(rate), base: totalBase, tax: subtractDecimal(multiplyDecimal(d(gross), d(String(count))), totalBase)}],
    consumed: [],
  };
}
