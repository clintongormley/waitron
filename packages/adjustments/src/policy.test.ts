import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import { evaluateAdjustment, type AdjustmentReason, type AdjustmentRequest } from "./policy.js";

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

  it("counts a percentage discount given no percentage as adding none to the line", () => {
    expect(
      evaluateAdjustment(COMPLAINT, percent(0, { percentBp: null, priorPercentOnLineBp: 5000 })),
    ).toEqual({ kind: "allowed" });
    expect(
      evaluateAdjustment(COMPLAINT, percent(0, { percentBp: null, priorPercentOnLineBp: 5001 })),
    ).toEqual({ kind: "refused", code: "adjustment.over_limit" });
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
