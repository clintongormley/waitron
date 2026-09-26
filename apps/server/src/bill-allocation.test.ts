import { describe, expect, it } from "vitest";
import { AppError, addDecimal, decimal, type Decimal } from "@waitron/shared";
import {
  confirmAllocation,
  equalShare,
  previewAllocation,
  type AllocationRequest,
  type BillFunds,
} from "./bill-allocation.js";

const d = (value: string): Decimal => decimal(value);
const BILL = "11111111-1111-4111-8111-111111111111";

function funds(
  total: string,
  received = "0.00",
  reserved = "0.00",
  hasPending = reserved !== "0.00",
): BillFunds {
  return {
    workingOrderId: BILL,
    total: d(total),
    received: d(received),
    reserved: d(reserved),
    hasPending,
  };
}

/** A count of cents as a money literal, without a float: 1005 is "10.05". */
function literal(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

const TIPS_ON = { tipsEnabled: true };
const TIPS_OFF = { tipsEnabled: false };

function thrown(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected an AppError, but nothing was thrown");
}

describe("equalShare: the available amount divided by the people still to pay, rounded up to the cent", () => {
  it("gives the plan's D16 sequence for €100.01 across 3, then 2, then 1, and the shares sum to the bill", () => {
    const first = equalShare(d("100.01"), 3);
    const second = equalShare(d("66.67"), 2);
    const third = equalShare(d("33.33"), 1);
    expect([first, second, third]).toEqual(["33.34", "33.34", "33.33"]);
    expect(addDecimal(addDecimal(first, second), third)).toBe("100.01");
  });

  it("rounds UP, not to nearest: €10.00 across 3 is €3.34", () => {
    expect(equalShare(d("10.00"), 3)).toBe("3.34");
  });

  it("matches D16's 'floor, then one extra cent to the first C mod n' for every amount to €30.00 and n to 12", () => {
    const mismatches: string[] = [];
    for (let cents = 0; cents <= 3000; cents += 1) {
      for (let n = 1; n <= 12; n += 1) {
        const floor = Math.floor(cents / n);
        const extra = cents % n;
        let left = cents;
        for (let person = 0; person < n; person += 1) {
          const expected = floor + (person < extra ? 1 : 0);
          const share = equalShare(d(literal(left)), n - person);
          if (share !== literal(expected)) {
            mismatches.push(`${cents}c/${n} person ${person}: ${share}`);
            break;
          }
          left -= expected;
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("refuses a share among fewer than one person", () => {
    const error = thrown(() => equalShare(d("10.00"), 0));
    expect(error.code).toBe("management.request_invalid");
    expect(error.params).toEqual({ field: "shareOf" });
  });
});

describe("previewAllocation: the design's §3.2 table", () => {
  const items40 = (payment: AllocationRequest["payment"]): AllocationRequest => ({
    kind: "items",
    due: d("40.00"),
    payment,
  });

  it("items €40.00, cash €50.00: applied €40.00, change €10.00, no tip", () => {
    expect(
      previewAllocation(
        funds("40.00"),
        items40({ method: "cash", tendered: d("50.00"), addedTip: d("0.00") }),
        TIPS_ON,
      ),
    ).toEqual({
      kind: "allocated",
      choice: null,
      applied: "40.00",
      tip: "0.00",
      change: "10.00",
      charged: null,
    });
  });

  it("the same, with the operator marking the €10.00 as a tip: no change", () => {
    expect(
      previewAllocation(
        funds("40.00"),
        items40({ method: "cash", tendered: d("50.00"), addedTip: d("10.00") }),
        TIPS_ON,
      ),
    ).toMatchObject({ applied: "40.00", tip: "10.00", change: "0.00", charged: null });
  });

  it("items €40.00, card €50.00: applied €40.00, tip €10.00, charged €50.00", () => {
    expect(
      previewAllocation(funds("40.00"), items40({ method: "card", addedTip: d("10.00") }), TIPS_ON),
    ).toEqual({
      kind: "allocated",
      choice: null,
      applied: "40.00",
      tip: "10.00",
      change: null,
      charged: "50.00",
    });
  });

  it("contribution €50.00 with €30.00 available, cash €50.00: applied €30.00, change €20.00", () => {
    expect(
      previewAllocation(
        funds("60.00", "30.00"),
        {
          kind: "contribution",
          amount: d("50.00"),
          payment: { method: "cash", tendered: d("50.00"), addedTip: d("0.00") },
        },
        TIPS_ON,
      ),
    ).toMatchObject({ applied: "30.00", tip: "0.00", change: "20.00", charged: null });
  });

  it("contribution €50.00 with €30.00 available, card: applied €30.00, tip €20.00, charged €50.00", () => {
    expect(
      previewAllocation(
        funds("60.00", "30.00"),
        {
          kind: "contribution",
          amount: d("50.00"),
          payment: { method: "card", addedTip: d("0.00") },
        },
        TIPS_ON,
      ),
    ).toMatchObject({ applied: "30.00", tip: "20.00", change: null, charged: "50.00" });
  });

  it("a pending card's reservation leaves less available: €30.00 of €60.00 reserved caps a €50.00 contribution at €10.00", () => {
    expect(
      previewAllocation(
        funds("60.00", "20.00", "30.00"),
        {
          kind: "contribution",
          amount: d("50.00"),
          payment: { method: "cash", tendered: d("50.00"), addedTip: d("0.00") },
        },
        TIPS_ON,
      ),
    ).toMatchObject({ applied: "10.00", change: "40.00" });
  });

  it("a share charges the available amount divided by n, rounded up", () => {
    expect(
      previewAllocation(
        funds("100.01"),
        { kind: "share", shareOf: 3, payment: { method: "card", addedTip: d("0.00") } },
        TIPS_ON,
      ),
    ).toMatchObject({ applied: "33.34", tip: "0.00", charged: "33.34" });
  });
});

describe("previewAllocation: what is refused", () => {
  it("refuses a bill with nothing outstanding: bill.nothing_outstanding", () => {
    const error = thrown(() =>
      previewAllocation(
        funds("50.00", "50.00"),
        {
          kind: "contribution",
          amount: d("5.00"),
          payment: { method: "card", addedTip: d("0.00") },
        },
        TIPS_ON,
      ),
    );
    expect(error.code).toBe("bill.nothing_outstanding");
    expect(error.params).toEqual({ workingOrderId: BILL });
  });

  it("refuses order.payment_in_flight when a pending card is what takes the bill to zero", () => {
    const error = thrown(() =>
      previewAllocation(
        funds("50.00", "20.00", "30.00"),
        {
          kind: "contribution",
          amount: d("5.00"),
          payment: { method: "cash", tendered: d("5.00"), addedTip: d("0.00") },
        },
        TIPS_ON,
      ),
    );
    expect(error.code).toBe("order.payment_in_flight");
    expect(error.params).toEqual({ workingOrderId: BILL });
  });

  it("with tips off, refuses a cash tip: bill.tip_not_allowed, naming what can be charged", () => {
    const error = thrown(() =>
      previewAllocation(
        funds("40.00"),
        {
          kind: "items",
          due: d("40.00"),
          payment: { method: "cash", tendered: d("50.00"), addedTip: d("1.00") },
        },
        TIPS_OFF,
      ),
    );
    expect(error.code).toBe("bill.tip_not_allowed");
    expect(error.params).toEqual({ workingOrderId: BILL, chargeable: "40.00" });
  });

  it("with tips off, refuses a card charge above the applied amount: bill.tip_not_allowed", () => {
    const error = thrown(() =>
      previewAllocation(
        funds("60.00", "30.00"),
        {
          kind: "contribution",
          amount: d("50.00"),
          payment: { method: "card", addedTip: d("0.00") },
        },
        TIPS_OFF,
      ),
    );
    expect(error.code).toBe("bill.tip_not_allowed");
    expect(error.params).toEqual({ workingOrderId: BILL, chargeable: "30.00" });
  });

  it("with tips off, lets through a payment with no tip (the control for the two refusals above)", () => {
    expect(
      previewAllocation(
        funds("60.00", "30.00"),
        {
          kind: "contribution",
          amount: d("30.00"),
          payment: { method: "card", addedTip: d("0.00") },
        },
        TIPS_OFF,
      ),
    ).toMatchObject({ applied: "30.00", tip: "0.00", charged: "30.00" });
  });

  it("refuses cash handed over below the applied amount plus the tip", () => {
    const error = thrown(() =>
      previewAllocation(
        funds("40.00"),
        {
          kind: "items",
          due: d("40.00"),
          payment: { method: "cash", tendered: d("45.00"), addedTip: d("6.00") },
        },
        TIPS_ON,
      ),
    );
    expect(error.code).toBe("management.request_invalid");
    expect(error.params).toEqual({ field: "tendered" });
  });

  it("accepts cash that exactly covers the applied amount plus the tip", () => {
    expect(
      previewAllocation(
        funds("40.00"),
        {
          kind: "items",
          due: d("40.00"),
          payment: { method: "cash", tendered: d("45.00"), addedTip: d("5.00") },
        },
        TIPS_ON,
      ),
    ).toMatchObject({ change: "0.00" });
  });

  it.each([
    ["a contribution of zero", { kind: "contribution", amount: d("0.00") }, "amount"],
    ["items costing nothing", { kind: "items", due: d("0.00") }, "lines"],
    ["a share among no one", { kind: "share", shareOf: 0 }, "shareOf"],
    ["a share among a fraction of a person", { kind: "share", shareOf: 1.5 }, "shareOf"],
  ] as const)("refuses %s: management.request_invalid", (_name, shape, field) => {
    const error = thrown(() =>
      previewAllocation(
        funds("40.00"),
        { ...shape, payment: { method: "card", addedTip: d("0.00") } } as AllocationRequest,
        TIPS_ON,
      ),
    );
    expect(error.code).toBe("management.request_invalid");
    expect(error.params).toEqual({ field });
  });

  it("refuses a negative tip", () => {
    const error = thrown(() =>
      previewAllocation(
        funds("40.00"),
        { kind: "items", due: d("40.00"), payment: { method: "card", addedTip: d("-1.00") } },
        TIPS_ON,
      ),
    );
    expect(error.code).toBe("management.request_invalid");
    expect(error.params).toEqual({ field: "tip" });
  });
});

describe("the €25 steak: the choices an item payment offers when its lines cost more than is available (§3.3)", () => {
  // A €120.00 bill with €105.00 of contributions: €15.00 available, the steak costs €25.00.
  const steak = (
    payment: AllocationRequest["payment"],
    choice?: "full_with_tip" | "use_pool",
  ): AllocationRequest => ({
    kind: "items",
    due: d("25.00"),
    payment,
    ...(choice === undefined ? {} : { choice }),
  });
  const card = { method: "card", addedTip: d("0.00") } as const;
  const FULL = { choice: "full_with_tip", applied: "15.00", tip: "10.00" };
  const POOL = { choice: "use_pool", applied: "15.00", tip: "0.00" };

  it("tips on, nothing pending: offers both", () => {
    expect(previewAllocation(funds("120.00", "105.00"), steak(card), TIPS_ON)).toEqual({
      kind: "choose",
      options: [FULL, POOL],
    });
  });

  it("tips off, nothing pending: offers only paying what is left from the pool", () => {
    expect(previewAllocation(funds("120.00", "105.00"), steak(card), TIPS_OFF)).toEqual({
      kind: "choose",
      options: [POOL],
    });
  });

  it("tips on, a card pending: offers only the full price with a tip", () => {
    expect(previewAllocation(funds("120.00", "95.00", "10.00"), steak(card), TIPS_ON)).toEqual({
      kind: "choose",
      options: [FULL],
    });
  });

  it("tips off, a card pending: offers neither, and refuses order.payment_in_flight", () => {
    const error = thrown(() =>
      previewAllocation(funds("120.00", "95.00", "10.00"), steak(card), TIPS_OFF),
    );
    expect(error.code).toBe("order.payment_in_flight");
    expect(error.params).toEqual({ workingOrderId: BILL });
  });

  it("the full price with a tip: pay €25.00, applied €15.00, tip €10.00", () => {
    expect(
      previewAllocation(funds("120.00", "105.00"), steak(card, "full_with_tip"), TIPS_ON),
    ).toEqual({
      kind: "allocated",
      choice: "full_with_tip",
      applied: "15.00",
      tip: "10.00",
      change: null,
      charged: "25.00",
    });
  });

  it("the full price with a tip records the €10.00 as a tip for cash too, not as change", () => {
    expect(
      previewAllocation(
        funds("120.00", "105.00"),
        steak({ method: "cash", tendered: d("30.00"), addedTip: d("0.00") }, "full_with_tip"),
        TIPS_ON,
      ),
    ).toMatchObject({ applied: "15.00", tip: "10.00", change: "5.00" });
  });

  it("what is left, using the earlier contribution: pay €15.00, applied €15.00, tip €0.00", () => {
    expect(
      previewAllocation(funds("120.00", "105.00"), steak(card, "use_pool"), TIPS_ON),
    ).toMatchObject({ kind: "allocated", choice: "use_pool", applied: "15.00", tip: "0.00" });
  });

  it("a named choice that is not offered is answered with the choices that are", () => {
    expect(
      previewAllocation(funds("120.00", "95.00", "10.00"), steak(card, "use_pool"), TIPS_ON),
    ).toEqual({ kind: "choose", options: [FULL] });
  });

  it("an item payment within what is available needs no choice", () => {
    expect(previewAllocation(funds("120.00", "80.00"), steak(card), TIPS_ON)).toMatchObject({
      kind: "allocated",
      choice: null,
      applied: "25.00",
      tip: "0.00",
    });
  });
});

describe("confirmAllocation: the applied amount and tip the operator saw must still be the server's (§3.6)", () => {
  const request: AllocationRequest = {
    kind: "contribution",
    amount: d("50.00"),
    payment: { method: "card", addedTip: d("0.00") },
  };

  it("returns the allocation when it is what the operator saw", () => {
    expect(
      confirmAllocation(funds("60.00", "30.00"), request, TIPS_ON, {
        applied: d("30.00"),
        tip: d("20.00"),
      }),
    ).toEqual({
      choice: null,
      applied: "30.00",
      tip: "20.00",
      change: null,
      charged: "50.00",
    });
  });

  it("compares by value, not by the literal: 30.0 is 30.00", () => {
    expect(
      confirmAllocation(funds("60.00", "30.00"), request, TIPS_ON, {
        applied: d("30.0"),
        tip: d("20"),
      }),
    ).toMatchObject({ applied: "30.00" });
  });

  it("refuses bill.allocation_changed, with the new preview, when another payment moved the balance", () => {
    const error = thrown(() =>
      confirmAllocation(funds("60.00", "40.00"), request, TIPS_ON, {
        applied: d("30.00"),
        tip: d("20.00"),
      }),
    );
    expect(error.code).toBe("bill.allocation_changed");
    expect(error.params).toEqual({
      workingOrderId: BILL,
      preview: {
        kind: "allocated",
        choice: null,
        applied: "20.00",
        tip: "30.00",
        change: null,
        charged: "50.00",
      },
    });
  });

  it("refuses bill.allocation_changed when only the tip differs", () => {
    const error = thrown(() =>
      confirmAllocation(funds("60.00", "30.00"), request, TIPS_ON, {
        applied: d("30.00"),
        tip: d("19.99"),
      }),
    );
    expect(error.code).toBe("bill.allocation_changed");
  });

  it("refuses bill.allocation_changed, with the choices, when a choice is needed and none was named", () => {
    const error = thrown(() =>
      confirmAllocation(
        funds("120.00", "105.00"),
        { kind: "items", due: d("25.00"), payment: { method: "card", addedTip: d("0.00") } },
        TIPS_OFF,
        { applied: d("15.00"), tip: d("0.00") },
      ),
    );
    expect(error.code).toBe("bill.allocation_changed");
    expect(error.params).toEqual({
      workingOrderId: BILL,
      preview: { kind: "choose", options: [{ choice: "use_pool", applied: "15.00", tip: "0.00" }] },
    });
  });

  it("passes the §3.1 refusals through unchanged", () => {
    const error = thrown(() =>
      confirmAllocation(funds("60.00", "60.00"), request, TIPS_ON, {
        applied: d("0.00"),
        tip: d("0.00"),
      }),
    );
    expect(error.code).toBe("bill.nothing_outstanding");
  });
});
