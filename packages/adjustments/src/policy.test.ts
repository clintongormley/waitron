import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import {
  approves,
  belowFloor,
  evaluateCancel,
  evaluateComp,
  floorAllowance,
  policySnapshotOf,
  standingOff,
  type AdjustmentReason,
  type Approval,
  type CancelRequest,
  type CompRequest,
} from "./policy.js";

/** The design's worked example (§3.2, picture 04). */
const COMPLAINT: AdjustmentReason = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Complaint",
  names: { en: "Complaint", es: "Complaint (es)" },
  kind: "comp",
  actions: ["comp", "discount_percent"],
  maxPercentBp: null,
  maxAmount: decimal("30.00"),
  noteRequired: false,
  position: 0,
};

const MISTAKE: AdjustmentReason = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Mistake",
  names: { en: "Mistake", es: "Error" },
  kind: "void",
  actions: ["cancel"],
  maxPercentBp: null,
  maxAmount: null,
  noteRequired: false,
  position: 1,
};

/** One €25 Ribeye free on a bill with no comps yet, under a €40 bill limit for Manager, Admin. */
function comp(overrides: Partial<CompRequest> = {}): CompRequest {
  return {
    action: "comp",
    reduction: decimal("25.00"),
    actorPermissions: new Set(["adjustment.apply"]),
    note: null,
    takesAll: false,
    standingOnBill: decimal("0.00"),
    dishes: [{ list: decimal("25.00"), after: decimal("0.00"), allowance: 1 }],
    billComped: decimal("0.00"),
    billLimit: { maxAmount: decimal("40.00") },
    ...overrides,
  };
}

function cancel(overrides: Partial<CancelRequest> = {}): CancelRequest {
  return { actorPermissions: new Set(), note: null, stage: "held", ...overrides };
}

const BY_REASON = {
  kind: "needs_approval",
  approval: {
    by: "limit",
    permission: "adjustment.approve",
    limit: { kind: "reason", amount: decimal("30.00"), percentBp: null },
  },
} as const;

const BY_BILL = {
  kind: "needs_approval",
  approval: {
    by: "limit",
    permission: "adjustment.approve",
    limit: { kind: "bill", amount: decimal("40.00"), percentBp: null },
  },
} as const;

describe("evaluateComp", () => {
  it("a holder of adjustment.apply comps within the reason's limit", () => {
    expect(evaluateComp(COMPLAINT, comp())).toEqual({ kind: "allowed" });
    expect(
      evaluateComp(
        { ...COMPLAINT, maxPercentBp: 5000 },
        comp({
          action: "discount_percent",
          reduction: decimal("10.00"),
          dishes: [{ list: decimal("25.00"), after: decimal("15.00"), allowance: 1 }],
        }),
      ),
    ).toEqual({ kind: "allowed" });
  });

  it("without adjustment.apply every comp needs approval", () => {
    expect(evaluateComp(COMPLAINT, comp({ actorPermissions: new Set() }))).toEqual(BY_REASON);
  });

  it("past the reason's limit needs someone who can approve", () => {
    expect(evaluateComp(COMPLAINT, comp({ reduction: decimal("30.01") }))).toEqual(BY_REASON);
  });

  it("a holder of adjustment.approve passes their own limits without adjustment.apply", () => {
    expect(
      evaluateComp(
        COMPLAINT,
        comp({ actorPermissions: new Set(["adjustment.approve"]), reduction: decimal("50.00") }),
      ),
    ).toEqual({ kind: "allowed" });
  });

  it("below the floor asks the reason's approver, never refuses", () => {
    const halves = { ...COMPLAINT, maxPercentBp: 5000 };
    const dish = (after: string) => [
      { list: decimal("25.00"), after: decimal(after), allowance: 1 },
    ];
    expect(
      evaluateComp(halves, comp({ reduction: decimal("5.00"), dishes: dish("12.49") })),
    ).toEqual({
      kind: "needs_approval",
      approval: {
        by: "limit",
        permission: "adjustment.approve",
        limit: { kind: "reason", amount: decimal("30.00"), percentBp: 5000 },
      },
    });
    expect(
      evaluateComp(halves, comp({ reduction: decimal("5.00"), dishes: dish("12.50") })),
    ).toEqual({ kind: "allowed" });
  });

  it("past the reason's bill amount asks, never refuses", () => {
    const prior = { standingOnBill: decimal("20.00") };
    expect(evaluateComp(COMPLAINT, comp({ ...prior, reduction: decimal("10.01") }))).toEqual(
      BY_REASON,
    );
    expect(evaluateComp(COMPLAINT, comp({ ...prior, reduction: decimal("10.00") }))).toEqual({
      kind: "allowed",
    });
  });

  it("reaching the bill's comp limit exactly passes; one cent past asks", () => {
    const open = { ...COMPLAINT, maxAmount: null };
    expect(
      evaluateComp(open, comp({ billComped: decimal("15.00"), reduction: decimal("25.00") })),
    ).toEqual({ kind: "allowed" });
    expect(
      evaluateComp(open, comp({ billComped: decimal("15.01"), reduction: decimal("25.00") })),
    ).toEqual(BY_BILL);
  });

  it("the bill's comp limit applies with the same approvers even past the reason's limit", () => {
    expect(evaluateComp(COMPLAINT, comp({ reduction: decimal("50.00") }))).toEqual(BY_BILL);
    expect(
      evaluateComp(COMPLAINT, comp({ actorPermissions: new Set(), reduction: decimal("50.00") })),
    ).toEqual(BY_BILL);
  });

  it("a zero amount limit always needs approval", () => {
    expect(
      evaluateComp(
        { ...COMPLAINT, maxAmount: decimal("0.00") },
        comp({ reduction: decimal("0.01") }),
      ),
    ).toEqual({
      kind: "needs_approval",
      approval: {
        by: "limit",
        permission: "adjustment.approve",
        limit: { kind: "reason", amount: decimal("0.00"), percentBp: null },
      },
    });
  });

  it("a zero percent limit needs approval even within the rounding allowance", () => {
    expect(
      evaluateComp(
        { ...COMPLAINT, maxPercentBp: 0 },
        comp({
          reduction: decimal("0.01"),
          dishes: [{ list: decimal("10.00"), after: decimal("9.99"), allowance: 2 }],
        }),
      ),
    ).toEqual({
      kind: "needs_approval",
      approval: {
        by: "limit",
        permission: "adjustment.approve",
        limit: { kind: "reason", amount: decimal("30.00"), percentBp: 0 },
      },
    });
  });

  it("a zero bill limit makes every comp need approval", () => {
    expect(
      evaluateComp(
        COMPLAINT,
        comp({ reduction: decimal("0.01"), billLimit: { maxAmount: decimal("0.00") } }),
      ),
    ).toEqual({
      kind: "needs_approval",
      approval: {
        by: "limit",
        permission: "adjustment.approve",
        limit: { kind: "bill", amount: decimal("0.00"), percentBp: null },
      },
    });
  });

  it("a bill comp limit of none never asks", () => {
    expect(
      evaluateComp(
        { ...COMPLAINT, maxAmount: null },
        comp({
          reduction: decimal("1000.00"),
          billComped: decimal("5000.00"),
          billLimit: { maxAmount: null },
        }),
      ),
    ).toEqual({ kind: "allowed" });
  });

  it("a Void reason asked to comp is refused action_not_allowed", () => {
    expect(evaluateComp({ ...MISTAKE, actions: ["cancel", "comp"] }, comp())).toEqual({
      kind: "refused",
      code: "adjustment.action_not_allowed",
    });
  });

  it("a Comp reason without An amount refuses an amount", () => {
    expect(
      evaluateComp(COMPLAINT, comp({ action: "discount_amount", reduction: decimal("5.00") })),
    ).toEqual({ kind: "refused", code: "adjustment.action_not_allowed" });
    expect(
      evaluateComp(
        { ...COMPLAINT, actions: ["discount_amount"] },
        comp({ action: "discount_amount", reduction: decimal("5.00") }),
      ),
    ).toEqual({ kind: "allowed" });
  });

  describe("a reason without Free refuses everything off too (owner, 2026-10-28; plan D37 rule 4)", () => {
    const CREW_MEAL: AdjustmentReason = {
      ...COMPLAINT,
      name: "Crew meal",
      actions: ["discount_percent", "discount_amount"],
      maxPercentBp: 5000,
      maxAmount: null,
    };
    const all = (action: "discount_percent" | "discount_amount") =>
      comp({ action, actorPermissions: new Set(["adjustment.approve"]), takesAll: true });

    it.each(["discount_percent", "discount_amount"] as const)(
      "%s taking everything off is refused free_not_allowed",
      (action) => {
        expect(evaluateComp(CREW_MEAL, all(action))).toEqual({
          kind: "refused",
          code: "adjustment.free_not_allowed",
        });
      },
    );

    it("is refused before a missing note is asked for", () => {
      expect(evaluateComp({ ...CREW_MEAL, noteRequired: true }, all("discount_percent"))).toEqual({
        kind: "refused",
        code: "adjustment.free_not_allowed",
      });
    });

    it("under a reason with Free, everything off by a percentage goes on to the checks", () => {
      expect(evaluateComp(COMPLAINT, all("discount_percent"))).toEqual({ kind: "allowed" });
    });

    it("less than everything off goes on to the floor check", () => {
      expect(
        evaluateComp(CREW_MEAL, comp({ action: "discount_percent", takesAll: false })),
      ).toEqual({
        kind: "needs_approval",
        approval: {
          by: "limit",
          permission: "adjustment.approve",
          limit: { kind: "reason", amount: null, percentBp: 5000 },
        },
      });
    });
  });

  it("a missing required note is refused before any approval is asked", () => {
    const noted = { ...COMPLAINT, noteRequired: true };
    const past = { actorPermissions: new Set<string>(), reduction: decimal("50.00") };
    expect(evaluateComp(noted, comp({ ...past, note: null }))).toEqual({
      kind: "refused",
      code: "adjustment.note_required",
    });
    expect(evaluateComp(noted, comp({ ...past, note: "   " }))).toEqual({
      kind: "refused",
      code: "adjustment.note_required",
    });
    expect(evaluateComp(noted, comp({ note: "Cold" }))).toEqual({ kind: "allowed" });
  });

  it.each<[string, Partial<CompRequest>]>([
    ["a negative reduction", { reduction: decimal("-1.00") }],
    ["a negative standing reduction on the bill", { standingOnBill: decimal("-0.01") }],
    ["a negative bill comp total", { billComped: decimal("-0.01") }],
    [
      "a negative list",
      { dishes: [{ list: decimal("-0.01"), after: decimal("0.00"), allowance: 1 }] },
    ],
    [
      "a negative price after",
      { dishes: [{ list: decimal("1.00"), after: decimal("-0.01"), allowance: 1 }] },
    ],
    [
      "a negative allowance",
      { dishes: [{ list: decimal("1.00"), after: decimal("0.50"), allowance: -1 }] },
    ],
    [
      "a fractional allowance",
      { dishes: [{ list: decimal("1.00"), after: decimal("0.50"), allowance: 0.5 }] },
    ],
  ])("throws on %s, which is a caller's bug and not a verdict", (_case, overrides) => {
    expect(() => evaluateComp(COMPLAINT, comp(overrides))).toThrow(RangeError);
  });
});

describe("evaluateCancel", () => {
  it("staff cancel a held or unsent dish with nobody's PIN", () => {
    expect(evaluateCancel(MISTAKE, cancel({ stage: "held" }))).toEqual({ kind: "allowed" });
    expect(evaluateCancel(MISTAKE, cancel({ stage: "unsent" }))).toEqual({ kind: "allowed" });
  });

  it("staff cancelling a fired or served dish need the refund permission", () => {
    const refund = {
      kind: "needs_approval",
      approval: { by: "refund", permission: "sale.refund" },
    };
    expect(evaluateCancel(MISTAKE, cancel({ stage: "fired" }))).toEqual(refund);
    expect(evaluateCancel(MISTAKE, cancel({ stage: "served" }))).toEqual(refund);
  });

  it("a holder of sale.refund cancels a fired dish alone", () => {
    expect(
      evaluateCancel(
        MISTAKE,
        cancel({ actorPermissions: new Set(["sale.refund"]), stage: "fired" }),
      ),
    ).toEqual({ kind: "allowed" });
  });

  it("a Comp reason cannot cancel", () => {
    expect(evaluateCancel({ ...COMPLAINT, actions: ["cancel", "comp"] }, cancel())).toEqual({
      kind: "refused",
      code: "adjustment.action_not_allowed",
    });
    expect(evaluateCancel({ ...MISTAKE, actions: [] }, cancel())).toEqual({
      kind: "refused",
      code: "adjustment.action_not_allowed",
    });
  });

  it("a Void reason's required note", () => {
    const noted = { ...MISTAKE, noteRequired: true };
    expect(evaluateCancel(noted, cancel({ stage: "served" }))).toEqual({
      kind: "refused",
      code: "adjustment.note_required",
    });
    expect(evaluateCancel(noted, cancel({ note: " " }))).toEqual({
      kind: "refused",
      code: "adjustment.note_required",
    });
    expect(evaluateCancel(noted, cancel({ note: "Wrong table" }))).toEqual({ kind: "allowed" });
  });
});

describe("approves", () => {
  it.each<Approval>([
    { by: "refund", permission: "sale.refund" },
    {
      by: "limit",
      permission: "adjustment.approve",
      limit: { kind: "reason", amount: decimal("30.00"), percentBp: null },
    },
    {
      by: "limit",
      permission: "adjustment.approve",
      limit: { kind: "bill", amount: decimal("40.00"), percentBp: null },
    },
  ])("requires the approval's permission: $by", (approval) => {
    expect(approves(approval, new Set())).toBe(false);
    expect(approves(approval, new Set(["adjustment.apply"]))).toBe(false);
    expect(approves(approval, new Set([approval.permission]))).toBe(true);
  });
});

describe("policySnapshotOf", () => {
  it("the snapshot records limits, not roles", () => {
    expect(
      policySnapshotOf(
        { ...COMPLAINT, maxPercentBp: 5000, noteRequired: true },
        { maxBillComp: decimal("40.00") },
      ),
    ).toEqual({
      kind: "comp",
      actions: ["comp", "discount_percent"],
      maxPercentBp: 5000,
      maxAmount: "30.00",
      maxBillComp: "40.00",
      noteRequired: true,
    });
  });

  it("copies the actions so a later edit of the reason cannot reach it", () => {
    const reason = { ...COMPLAINT, actions: [...COMPLAINT.actions] };
    const snapshot = policySnapshotOf(reason, { maxBillComp: null });
    reason.actions.push("discount_amount");
    expect(snapshot.actions).toEqual(["comp", "discount_percent"]);
    expect(
      policySnapshotOf({ ...COMPLAINT, maxAmount: null }, { maxBillComp: null }).maxAmount,
    ).toBeNull();
    expect(snapshot.maxBillComp).toBeNull();
  });
});

describe("belowFloor: a dish is never charged below its floor (owner, 2026-10-28; plan D36)", () => {
  const dish = (list: string, after: string, allowance = 1) => ({
    list: decimal(list),
    after: decimal(after),
    allowance,
  });

  it("a €12.00 dish left at €6.00 is at its 50% floor and goes through; at €5.99 it asks", () => {
    expect(belowFloor([dish("12.00", "6.00")], 5000)).toBe(false);
    expect(belowFloor([dish("12.00", "5.99")], 5000)).toBe(true);
  });

  it("a €3.33 dish left at €1.66 goes through under 50%, at €1.65 it asks", () => {
    expect(belowFloor([dish("3.33", "1.66")], 5000)).toBe(false);
    expect(belowFloor([dish("3.33", "1.65")], 5000)).toBe(true);
  });

  it("three €3.33 dishes, allowance 3: €4.98 left goes through, €4.95 asks", () => {
    expect(belowFloor([dish("9.99", "4.98", 3)], 5000)).toBe(false);
    expect(belowFloor([dish("9.99", "4.95", 3)], 5000)).toBe(true);
  });

  it("3 kg of €12.99 Fish, allowance 3: €19.47 left goes through, €19.44 asks", () => {
    expect(belowFloor([dish("38.97", "19.47", 3)], 5000)).toBe(false);
    expect(belowFloor([dish("38.97", "19.44", 3)], 5000)).toBe(true);
  });

  it("€1.01 off one €3.34 dish goes through under 30%: the allowance is a whole cent", () => {
    expect(belowFloor([dish("3.34", "2.33")], 3000)).toBe(false);
    expect(belowFloor([dish("3.34", "2.32")], 3000)).toBe(true);
  });

  it("one entry below its floor asks though another is not", () => {
    expect(belowFloor([dish("12.00", "12.00"), dish("12.00", "5.99")], 5000)).toBe(true);
  });

  it("a zero floor distinguishes any reduction from an unchanged dish", () => {
    expect(belowFloor([dish("10.00", "9.99", 2)], 0)).toBe(true);
    expect(belowFloor([dish("10.00", "10.00", 2)], 0)).toBe(false);
  });

  it("a reason with no per-dish limit never asks on it", () => {
    expect(belowFloor([dish("12.00", "0.00")], null)).toBe(false);
  });
});

describe("floorAllowance: the cents rounding can move on a dish (plan D36 reading 3)", () => {
  const line = (quantity: string, priceQuantity = "1.000") => ({
    quantity: decimal(quantity),
    priceQuantity: decimal(priceQuantity),
  });

  it("counts each line's priced quantity, summed and rounded up once", () => {
    expect(floorAllowance([line("1.000")])).toBe(1);
    expect(floorAllowance([line("3.000")])).toBe(3);
    expect(floorAllowance([line("3.000", "1.000")])).toBe(3);
    expect(floorAllowance([line("0.350", "1.000")])).toBe(1);
    expect(floorAllowance([line("0.350", "0.100")])).toBe(4);
    expect(floorAllowance([line("1.000"), line("2.000")])).toBe(3);
    expect(floorAllowance([line("3.000"), line("6.000")])).toBe(9);
    expect(floorAllowance([line("0.350"), line("0.350")])).toBe(1);
  });

  it("refuses a line whose quantity is not above zero", () => {
    expect(() => floorAllowance([line("-1.500")])).toThrow(RangeError);
    expect(() => floorAllowance([line("1.000", "0.000")])).toThrow(RangeError);
  });
});

describe("standingOff: what a reason still has off a bill, its lines prorated (owner, 2026-10-28; plan D37)", () => {
  const row = (reduction: string, quantityThen: string, quantityNow: string) => ({
    reduction: decimal(reduction),
    quantityThen: decimal(quantityThen),
    quantityNow: decimal(quantityNow),
  });

  it("is nothing when the reason took nothing off a line on the bill", () => {
    expect(standingOff([])).toBe("0.00");
  });

  it("counts a line still whole at what was taken off it", () => {
    expect(standingOff([row("25.00", "1.000", "1.000"), row("4.99", "2.000", "2.000")])).toBe(
      "29.99",
    );
  });

  it("counts half of a line of two after one is cancelled, and nothing of a line now at none", () => {
    expect(standingOff([row("12.00", "2.000", "1.000"), row("9.00", "1.000", "0.000")])).toBe(
      "6.00",
    );
  });

  it("prorates a weighed line by its weight now", () => {
    expect(standingOff([row("3.60", "0.350", "0.175")])).toBe("1.80");
  });

  it("counts more of a line raised in place than was taken off it then", () => {
    expect(standingOff([row("3.60", "3.000", "4.000")])).toBe("4.80");
  });

  it("rounds once, half up, after adding every line's share", () => {
    expect(standingOff([row("0.01", "2.000", "1.000")])).toBe("0.01");
    expect(standingOff([row("0.01", "2.000", "1.000"), row("0.01", "2.000", "1.000")])).toBe(
      "0.01",
    );
    expect(standingOff([row("0.02", "3.000", "1.000"), row("0.02", "3.000", "1.000")])).toBe(
      "0.01",
    );
  });

  it.each([
    ["a negative reduction", row("-0.01", "1.000", "1.000")],
    ["a quantity then of none", row("1.00", "0.000", "1.000")],
    ["a negative quantity now", row("1.00", "1.000", "-1.000")],
  ])("throws on %s, a caller's bug", (_, bad) => {
    expect(() => standingOff([bad])).toThrow(RangeError);
  });
});
