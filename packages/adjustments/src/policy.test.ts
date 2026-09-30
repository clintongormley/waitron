import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import {
  billCancelNeedsManager,
  billDiscountNeedsManager,
  evaluateAdjustment,
  policySnapshotOf,
  type AdjustmentReason,
  type AdjustmentRequest,
} from "./policy.js";

const COMPLAINT: AdjustmentReason = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Complaint",
  names: { en: "Complaint", es: "Queja" },
  actions: ["comp", "discount_percent"],
  maxPercentBp: 5000,
  maxAmount: decimal("30.00"),
  applyRole: "supervisor",
  approverRole: "manager",
  noteRequired: true,
  active: true,
  position: 0,
};

/** A €12.00 comp by a supervisor, with a note, on a bill this reason has not touched yet. */
function comp(overrides: Partial<AdjustmentRequest> = {}): AdjustmentRequest {
  return {
    action: "comp",
    reduction: decimal("12.00"),
    percentBp: null,
    actorRole: "supervisor",
    note: "Cold soup",
    priorReductionOnBill: decimal("0.00"),
    priorPercentOnLineBp: 0,
    ...overrides,
  };
}

/** A percentage discount on a €10.00 line, so its reduction stays far under the €30.00 cap. */
function percent(percentBp: number, overrides: Partial<AdjustmentRequest> = {}): AdjustmentRequest {
  return comp({
    action: "discount_percent",
    percentBp,
    reduction: decimal(((10 * percentBp) / 10000).toFixed(2)),
    ...overrides,
  });
}

describe("evaluateAdjustment", () => {
  it("allows a €12.00 comp by a supervisor with a note", () => {
    expect(evaluateAdjustment(COMPLAINT, comp())).toEqual({ kind: "allowed" });
  });

  it("sends the same comp by staff for approval by a manager", () => {
    expect(evaluateAdjustment(COMPLAINT, comp({ actorRole: "staff" }))).toEqual({
      kind: "needs_approval",
      approverRole: "manager",
    });
  });

  it("allows a role above the applying role without approval", () => {
    expect(evaluateAdjustment(COMPLAINT, comp({ actorRole: "admin" }))).toEqual({
      kind: "allowed",
    });
  });

  it("refuses an action the reason does not list", () => {
    expect(
      evaluateAdjustment(
        COMPLAINT,
        comp({ action: "discount_amount", reduction: decimal("5.00") }),
      ),
    ).toEqual({ kind: "refused", code: "adjustment.action_not_allowed" });
  });

  it("refuses a 60% discount under a 50% limit", () => {
    expect(evaluateAdjustment(COMPLAINT, percent(6000))).toEqual({
      kind: "refused",
      code: "adjustment.over_limit",
    });
  });

  it("allows a discount of exactly the percentage limit", () => {
    expect(evaluateAdjustment(COMPLAINT, percent(5000))).toEqual({ kind: "allowed" });
  });

  it("adds this reason's earlier percentage on the same line to the one asked", () => {
    expect(evaluateAdjustment(COMPLAINT, percent(3000, { priorPercentOnLineBp: 3000 }))).toEqual({
      kind: "refused",
      code: "adjustment.over_limit",
    });
    expect(evaluateAdjustment(COMPLAINT, percent(3000, { priorPercentOnLineBp: 2000 }))).toEqual({
      kind: "allowed",
    });
  });

  it.each<[string, Partial<AdjustmentRequest>]>([
    ["a negative reduction", { reduction: decimal("-1.00") }],
    ["a negative prior reduction on the bill", { priorReductionOnBill: decimal("-0.01") }],
    ["a negative prior percentage on the line", { priorPercentOnLineBp: -1 }],
    ["a percentage discount with no percentage", { action: "discount_percent", percentBp: null }],
    ["a percentage discount of 0%", { action: "discount_percent", percentBp: 0 }],
    ["a percentage discount above 100%", { action: "discount_percent", percentBp: 10001 }],
    [
      "a percentage discount of a fraction of a basis point",
      { action: "discount_percent", percentBp: 12.5 },
    ],
  ])("throws on %s, which is a caller's bug and not a verdict", (_case, overrides) => {
    expect(() => evaluateAdjustment(COMPLAINT, comp(overrides))).toThrow(RangeError);
    // Even on a reason that would refuse anyway: malformed input is never answered with a verdict.
    expect(() => evaluateAdjustment({ ...COMPLAINT, active: false }, comp(overrides))).toThrow(
      RangeError,
    );
  });

  it("accepts a percentage discount at the edges of 1..10000 basis points", () => {
    const open = { ...COMPLAINT, maxPercentBp: null, maxAmount: null };
    expect(evaluateAdjustment(open, percent(1))).toEqual({ kind: "allowed" });
    expect(evaluateAdjustment(open, percent(10000))).toEqual({ kind: "allowed" });
  });

  it("counts a cancel's reduction against the bill limit", () => {
    const voids = { ...COMPLAINT, actions: ["cancel" as const] };
    const cancel = (priorReductionOnBill: string) =>
      comp({
        action: "cancel",
        reduction: decimal("12.00"),
        priorReductionOnBill: decimal(priorReductionOnBill),
      });
    expect(evaluateAdjustment(voids, cancel("18.01"))).toEqual({
      kind: "refused",
      code: "adjustment.over_limit",
    });
    expect(evaluateAdjustment(voids, cancel("18.00"))).toEqual({ kind: "allowed" });
  });

  it("allows a euro discount under a reason that lists it", () => {
    expect(
      evaluateAdjustment(
        { ...COMPLAINT, actions: ["discount_amount"] },
        comp({ action: "discount_amount", reduction: decimal("5.00") }),
      ),
    ).toEqual({ kind: "allowed" });
  });

  it("asks for approval from the reason's own approving role", () => {
    expect(
      evaluateAdjustment(
        { ...COMPLAINT, applyRole: "manager", approverRole: "admin" },
        comp({ actorRole: "supervisor" }),
      ),
    ).toEqual({ kind: "needs_approval", approverRole: "admin" });
  });

  it("refuses a missing note before asking for approval", () => {
    expect(evaluateAdjustment(COMPLAINT, comp({ actorRole: "staff", note: null }))).toEqual({
      kind: "refused",
      code: "adjustment.note_required",
    });
  });

  it("never measures a comp against the percentage limit", () => {
    expect(
      evaluateAdjustment(COMPLAINT, comp({ percentBp: 10000, priorPercentOnLineBp: 5000 })),
    ).toEqual({ kind: "allowed" });
  });

  it("adds this reason's earlier reductions on the bill to the one asked", () => {
    expect(evaluateAdjustment(COMPLAINT, comp({ priorReductionOnBill: decimal("20.00") }))).toEqual(
      { kind: "refused", code: "adjustment.over_limit" },
    );
    expect(evaluateAdjustment(COMPLAINT, comp({ priorReductionOnBill: decimal("18.00") }))).toEqual(
      { kind: "allowed" },
    );
  });

  it("counts a percentage discount's cent amount against the bill limit", () => {
    expect(
      evaluateAdjustment(
        COMPLAINT,
        percent(1000, { reduction: decimal("4.00"), priorReductionOnBill: decimal("26.01") }),
      ),
    ).toEqual({ kind: "refused", code: "adjustment.over_limit" });
  });

  it("refuses a request with no note when the reason requires one", () => {
    expect(evaluateAdjustment(COMPLAINT, comp({ note: null }))).toEqual({
      kind: "refused",
      code: "adjustment.note_required",
    });
    expect(evaluateAdjustment(COMPLAINT, comp({ note: "   " }))).toEqual({
      kind: "refused",
      code: "adjustment.note_required",
    });
  });

  it("accepts no note when the reason does not require one", () => {
    expect(evaluateAdjustment({ ...COMPLAINT, noteRequired: false }, comp({ note: null }))).toEqual(
      { kind: "allowed" },
    );
  });

  it("refuses an inactive reason", () => {
    expect(evaluateAdjustment({ ...COMPLAINT, active: false }, comp())).toEqual({
      kind: "refused",
      code: "adjustment.reason_inactive",
    });
  });

  it("puts no cap on the bill when max_amount is null", () => {
    expect(
      evaluateAdjustment(
        { ...COMPLAINT, maxAmount: null },
        comp({ reduction: decimal("1000.00"), priorReductionOnBill: decimal("5000.00") }),
      ),
    ).toEqual({ kind: "allowed" });
  });

  it("puts no cap on the line when max_percent is null", () => {
    expect(
      evaluateAdjustment(
        { ...COMPLAINT, maxPercentBp: null },
        percent(9000, { priorPercentOnLineBp: 1000 }),
      ),
    ).toEqual({ kind: "allowed" });
  });

  it("refuses before asking for approval, so a refused request never reaches an approver", () => {
    expect(evaluateAdjustment(COMPLAINT, percent(6000, { actorRole: "staff" }))).toEqual({
      kind: "refused",
      code: "adjustment.over_limit",
    });
  });
});

describe("policySnapshotOf", () => {
  it("keeps the evaluated policy and nothing that names or orders the reason", () => {
    expect(policySnapshotOf(COMPLAINT)).toEqual({
      actions: ["comp", "discount_percent"],
      maxPercentBp: 5000,
      maxAmount: "30.00",
      applyRole: "supervisor",
      approverRole: "manager",
      noteRequired: true,
    });
  });

  it("copies the action list, so a later edit of the reason cannot reach the snapshot", () => {
    const reason = { ...COMPLAINT, actions: [...COMPLAINT.actions] };
    const snapshot = policySnapshotOf(reason);
    reason.actions.push("cancel");
    expect(snapshot.actions).toEqual(["comp", "discount_percent"]);
    expect(policySnapshotOf({ ...COMPLAINT, maxAmount: null }).maxAmount).toBeNull();
  });
});

describe("billDiscountNeedsManager", () => {
  /** A staff member's €10.00 discount on a €100.00 bill that already has €30.00 off, under 40%. */
  const ask = (overrides: Partial<Parameters<typeof billDiscountNeedsManager>[0]> = {}) =>
    billDiscountNeedsManager({
      limitBp: 4000,
      priorDiscount: decimal("30.00"),
      reduction: decimal("10.00"),
      billValue: decimal("100.00"),
      actorRole: "staff",
      ...overrides,
    });

  it("lets the bill's discounts reach the limit exactly", () => {
    expect(ask()).toBe(false);
  });

  it("asks for a manager one cent past it", () => {
    expect(ask({ reduction: decimal("10.01") })).toBe(true);
  });

  it("compares exactly where the limit is a fraction of a cent: 33.33% of €10.00 is €3.333", () => {
    const third = { limitBp: 3333, billValue: decimal("10.00"), priorDiscount: decimal("0.00") };
    expect(ask({ ...third, reduction: decimal("3.33") })).toBe(false);
    expect(ask({ ...third, reduction: decimal("3.34") })).toBe(true);
  });

  it("asks a supervisor for a manager too", () => {
    expect(ask({ actorRole: "supervisor", reduction: decimal("20.00") })).toBe(true);
  });

  it("never asks a manager or an admin, who may pass the limit themselves", () => {
    expect(ask({ actorRole: "manager", reduction: decimal("70.00") })).toBe(false);
    expect(ask({ actorRole: "admin", reduction: decimal("70.00") })).toBe(false);
  });

  it("sets no limit when the venue has none", () => {
    expect(ask({ limitBp: null, reduction: decimal("70.00") })).toBe(false);
  });

  it("allows a 100% limit to take the whole bill", () => {
    expect(ask({ limitBp: 10000, reduction: decimal("70.00") })).toBe(false);
  });

  it("throws on a malformed request, the caller's bug", () => {
    expect(() => ask({ limitBp: 0 })).toThrow(RangeError);
    expect(() => ask({ limitBp: 10001 })).toThrow(RangeError);
    expect(() => ask({ reduction: decimal("-0.01") })).toThrow(RangeError);
    expect(() => ask({ priorDiscount: decimal("-0.01") })).toThrow(RangeError);
    expect(() => ask({ billValue: decimal("-0.01") })).toThrow(RangeError);
  });
});

describe("billCancelNeedsManager", () => {
  /** A staff member's cancel of €300.00 of bottles from a €400.00 bill with €100.00 off, under 40%. */
  const ask = (overrides: Partial<Parameters<typeof billCancelNeedsManager>[0]> = {}) =>
    billCancelNeedsManager({
      limitBp: 4000,
      before: { discount: decimal("100.00"), value: decimal("400.00") },
      after: { discount: decimal("100.00"), value: decimal("100.00") },
      actorRole: "staff",
      ...overrides,
    });

  it("asks for a manager when the cancel lifts the bill's discount share past the limit", () => {
    expect(ask()).toBe(true);
    expect(ask({ actorRole: "supervisor" })).toBe(true);
  });

  it("lets the share reach the limit exactly", () => {
    expect(ask({ after: { discount: decimal("40.00"), value: decimal("100.00") } })).toBe(false);
  });

  it("asks nobody when the share stays past the limit but does not rise", () => {
    expect(
      ask({
        before: { discount: decimal("78.00"), value: decimal("130.00") },
        after: { discount: decimal("60.00"), value: decimal("100.00") },
      }),
    ).toBe(false);
  });

  it("asks nobody when the share falls", () => {
    expect(
      ask({
        before: { discount: decimal("80.00"), value: decimal("100.00") },
        after: { discount: decimal("50.00"), value: decimal("90.00") },
      }),
    ).toBe(false);
  });

  it("asks nobody for a cancel that empties the bill", () => {
    expect(ask({ after: { discount: decimal("0.00"), value: decimal("0.00") } })).toBe(false);
  });

  it("never asks a manager or an admin, and sets no limit when the venue has none", () => {
    expect(ask({ actorRole: "manager" })).toBe(false);
    expect(ask({ actorRole: "admin" })).toBe(false);
    expect(ask({ limitBp: null })).toBe(false);
  });

  it("throws on a malformed request, the caller's bug", () => {
    const negative = { discount: decimal("-0.01"), value: decimal("1.00") };
    expect(() => ask({ limitBp: 0 })).toThrow(RangeError);
    expect(() => ask({ before: negative })).toThrow(RangeError);
    expect(() => ask({ after: negative })).toThrow(RangeError);
    expect(() => ask({ after: { discount: decimal("1.00"), value: decimal("-1.00") } })).toThrow(
      RangeError,
    );
  });
});
