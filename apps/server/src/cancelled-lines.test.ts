import { describe, expect, it } from "vitest";
import {
  allocateCorrectionAmounts,
  type CorrectionAmountAllocation,
} from "@waitron/core/src/correction-allocation.js";
import { centsToDecimal, decimal, decimalToCents, sumDecimals } from "@waitron/shared";
import { cancelLinks } from "./cancelled-lines.js";

/** A line at 10% VAT, its base rounded as a ticket's is. */
const line = (id: string, lineNo: number, gross: string) => ({
  id,
  lineNo,
  rate: decimal("10"),
  gross: decimal(gross),
  base: centsToDecimal(Math.round(decimalToCents(decimal(gross)) / 1.1)),
  menu: decimal(gross),
});

const PAELLA_AND_STEAK = [line("paella", 1, "18.50"), line("steak", 2, "18.50")];
const CROQUETAS_AND_STEAK = [line("croquetas", 1, "12.00"), line("steak", 2, "18.00")];

/** A press: what it gives back and, ticked, the lines it names. */
type Press = { gross: string; lineIds?: string[] };
/** After a press, of the cancelled dish: what the corrective takes off it and links to its cancels,
 * then what they still owe (shown as no more than is left) and what is left. */
type After = { off: string; linked: string; owed: string; left: string };

/** Section 5's table: every press filed at once, in cash, one leg each. */
function run(
  lines: ReturnType<typeof line>[],
  dish: string,
  cancels: string[],
  presses: Press[],
): After[] {
  const consumed: CorrectionAmountAllocation[] = [];
  const linked = cancels.map(() => 0);
  const gross = decimalToCents(lines.find((row) => row.id === dish)!.gross);
  const vatBreakdown = [
    {
      rate: decimal("10"),
      base: sumDecimals(lines.map((row) => row.base)),
      tax: centsToDecimal(
        lines.reduce(
          (total, row) => total + decimalToCents(row.gross) - decimalToCents(row.base),
          0,
        ),
      ),
    },
  ];
  return presses.map((press, index) => {
    const preview = allocateCorrectionAmounts(
      { lines, vatBreakdown, consumed },
      {
        gross: decimal(press.gross),
        ...(press.lineIds === undefined ? {} : { lineIds: press.lineIds }),
      },
    );
    consumed.push(...preview.allocations);
    const off = preview.allocations
      .filter((part) => part.saleLineId === dish)
      .reduce((total, part) => total + decimalToCents(part.gross), 0);
    const links = cancelLinks(
      [
        {
          off,
          cancels: cancels.map((value, at) => ({
            id: `cancel-${at}`,
            owed: decimalToCents(decimal(value)) - linked[at]!,
          })),
        },
      ],
      [{ id: `leg-${index}`, amount: decimalToCents(preview.gross) }],
    );
    for (const link of links) {
      expect(link.refundId).toBe(`leg-${index}`);
      linked[Number(link.adjustmentId.slice("cancel-".length))]! += link.amount;
    }
    const left =
      gross -
      consumed
        .filter((part) => part.saleLineId === dish)
        .reduce((total, part) => total + decimalToCents(part.gross), 0);
    const owed = cancels.reduce(
      (total, value, at) => total + decimalToCents(decimal(value)) - linked[at]!,
      0,
    );
    return {
      off: centsToDecimal(off),
      linked: centsToDecimal(links.reduce((total, link) => total + link.amount, 0)),
      owed: centsToDecimal(Math.min(owed, left)),
      left: centsToDecimal(left),
    };
  });
}

describe("what is left of a cancelled dish (section 5's table)", () => {
  it.each([
    {
      name: "goodwill 18.50 with the paella cancelled, then the steak ticked 9.25, then the paella 9.25",
      lines: PAELLA_AND_STEAK,
      dish: "paella",
      cancels: ["18.50"],
      presses: [
        { gross: "18.50" },
        { gross: "9.25", lineIds: ["steak"] },
        { gross: "9.25", lineIds: ["paella"] },
      ],
      after: [
        { off: "9.25", linked: "9.25", owed: "9.25", left: "9.25" },
        { off: "0.00", linked: "0.00", owed: "9.25", left: "9.25" },
        { off: "9.25", linked: "9.25", owed: "0.00", left: "0.00" },
      ],
    },
    {
      name: "both ticked, 20.00 of 37.00",
      lines: PAELLA_AND_STEAK,
      dish: "paella",
      cancels: ["18.50"],
      presses: [{ gross: "20.00", lineIds: ["paella", "steak"] }],
      after: [{ off: "10.00", linked: "10.00", owed: "8.50", left: "8.50" }],
    },
    {
      name: "the paella alone, 10.00 then 8.50",
      lines: PAELLA_AND_STEAK,
      dish: "paella",
      cancels: ["18.50"],
      presses: [
        { gross: "10.00", lineIds: ["paella"] },
        { gross: "8.50", lineIds: ["paella"] },
      ],
      after: [
        { off: "10.00", linked: "10.00", owed: "8.50", left: "8.50" },
        { off: "8.50", linked: "8.50", owed: "0.00", left: "0.00" },
      ],
    },
    {
      name: "both croquetas cancelled, ticked 6.00 twice",
      lines: CROQUETAS_AND_STEAK,
      dish: "croquetas",
      cancels: ["6.00", "6.00"],
      presses: [
        { gross: "6.00", lineIds: ["croquetas"] },
        { gross: "6.00", lineIds: ["croquetas"] },
      ],
      after: [
        { off: "6.00", linked: "6.00", owed: "6.00", left: "6.00" },
        { off: "6.00", linked: "6.00", owed: "0.00", left: "0.00" },
      ],
    },
    {
      name: "goodwill 6.00 on both croquetas cancelled and a steak of 18.00, then ticked 6.00",
      lines: CROQUETAS_AND_STEAK,
      dish: "croquetas",
      cancels: ["6.00", "6.00"],
      presses: [{ gross: "6.00" }, { gross: "6.00", lineIds: ["croquetas"] }],
      after: [
        { off: "2.40", linked: "2.40", owed: "9.60", left: "9.60" },
        { off: "6.00", linked: "6.00", owed: "3.60", left: "3.60" },
      ],
    },
  ])("$name", ({ lines, dish, cancels, presses, after }) => {
    expect(run(lines, dish, cancels, presses)).toEqual(after);
  });

  it("puts what the cancels take on the legs in order, none past its amount", () => {
    expect(
      cancelLinks(
        [
          {
            off: 900,
            cancels: [
              { id: "a", owed: 500 },
              { id: "b", owed: 800 },
            ],
          },
          { off: 300, cancels: [{ id: "c", owed: 1000 }] },
        ],
        [
          { id: "cash", amount: 600 },
          { id: "card", amount: 600 },
        ],
      ),
    ).toEqual([
      { refundId: "cash", adjustmentId: "a", amount: 500 },
      { refundId: "cash", adjustmentId: "b", amount: 100 },
      { refundId: "card", adjustmentId: "b", amount: 300 },
      { refundId: "card", adjustmentId: "c", amount: 300 },
    ]);
  });
});
