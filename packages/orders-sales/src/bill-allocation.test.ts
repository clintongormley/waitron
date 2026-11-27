import { describe, expect, it } from "vitest";
import { AppError, decimal, type Decimal } from "@waitron/shared";
import {
  cashChange,
  confirmAllocation,
  previewAllocation,
  type AllocationRequest,
  type BillFunds,
} from "./bill-allocation.js";

const d = (value: string): Decimal => decimal(value);
const BILL = "11111111-1111-4111-8111-111111111111";

function funds(total: string, received = "0.00", reserved = "0.00"): BillFunds {
  return {
    workingOrderId: BILL,
    total: d(total),
    received: d(received),
    reserved: d(reserved),
  };
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

describe("previewAllocation: the design's §3.2 table", () => {
  const pay40 = (payment: AllocationRequest["payment"]): AllocationRequest => ({
    kind: "contribution",
    amount: d("40.00"),
    payment,
  });

  it("contribution €40.00, cash €50.00: applied €40.00, change €10.00, no tip", () => {
    expect(
      previewAllocation(
        funds("40.00"),
        pay40({ method: "cash", tendered: d("50.00"), addedTip: d("0.00") }),
        TIPS_ON,
      ),
    ).toEqual({
      kind: "allocated",
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
        pay40({ method: "cash", tendered: d("50.00"), addedTip: d("10.00") }),
        TIPS_ON,
      ),
    ).toMatchObject({ applied: "40.00", tip: "10.00", change: "0.00", charged: null });
  });

  it("contribution €40.00, card €50.00: applied €40.00, tip €10.00, charged €50.00", () => {
    expect(
      previewAllocation(funds("40.00"), pay40({ method: "card", addedTip: d("10.00") }), TIPS_ON),
    ).toEqual({
      kind: "allocated",
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
          kind: "contribution",
          amount: d("40.00"),
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

  it("refuses cash handed over below the applied amount, naming the money handed over", () => {
    const error = thrown(() =>
      previewAllocation(
        funds("40.00"),
        {
          kind: "contribution",
          amount: d("40.00"),
          payment: { method: "cash", tendered: d("39.00"), addedTip: d("1.00") },
        },
        TIPS_ON,
      ),
    );
    expect(error.code).toBe("management.request_invalid");
    expect(error.params).toEqual({ field: "tendered" });
  });

  it.each([
    ["no change at all", "20.00", "20.00", "5.00"],
    ["less change than the tip", "45.00", "40.00", "6.00"],
  ])(
    "refuses an added tip larger than the change when the cash covers the bill (%s), naming the tip",
    (_name, tendered, due, addedTip) => {
      const error = thrown(() =>
        previewAllocation(
          funds(due),
          {
            kind: "contribution",
            amount: d(due),
            payment: { method: "cash", tendered: d(tendered), addedTip: d(addedTip) },
          },
          TIPS_ON,
        ),
      );
      expect(error.code).toBe("management.request_invalid");
      expect(error.params).toEqual({ field: "addedTip" });
    },
  );

  it("accepts cash that exactly covers the applied amount plus the tip", () => {
    expect(
      previewAllocation(
        funds("40.00"),
        {
          kind: "contribution",
          amount: d("40.00"),
          payment: { method: "cash", tendered: d("45.00"), addedTip: d("5.00") },
        },
        TIPS_ON,
      ),
    ).toMatchObject({ change: "0.00" });
  });

  it.each([
    ["a contribution of zero", { kind: "contribution", amount: d("0.00") }, "amount"],
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
        {
          kind: "contribution",
          amount: d("40.00"),
          payment: { method: "card", addedTip: d("-1.00") },
        },
        TIPS_ON,
      ),
    );
    expect(error.code).toBe("management.request_invalid");
    expect(error.params).toEqual({ field: "tip" });
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

describe("cashChange", () => {
  it("subtracts the amount applied to the bill and the tip from cash tendered", () => {
    expect(cashChange(5000, 4000, 250)).toBe("7.50");
  });
});
