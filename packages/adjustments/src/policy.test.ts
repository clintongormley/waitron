import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import {
  approves,
  evaluateCancel,
  evaluateComp,
  policySnapshotOf,
  type AdjustmentReason,
  type Approval,
  type CancelRequest,
  type CompRequest,
} from "./policy.js";

/** The design's worked example (§3.2, picture 04). */
const COMPLAINT: AdjustmentReason = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Complaint",
  names: { en: "Complaint", es: "Queja" },
  kind: "comp",
  actions: ["comp", "discount_percent"],
  maxPercentBp: null,
  maxAmount: decimal("30.00"),
  applyRoles: ["supervisor", "manager", "admin"],
  approverRoles: ["manager", "admin"],
  noteRequired: false,
  active: true,
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
  applyRoles: [],
  approverRoles: [],
  noteRequired: false,
  active: true,
  position: 1,
};

/** One €25 Chuletón free on a bill with no comps yet, under a €40 bill limit for Manager, Admin. */
function comp(overrides: Partial<CompRequest> = {}): CompRequest {
  return {
    action: "comp",
    reduction: decimal("25.00"),
    actorRole: "supervisor",
    note: null,
    priorReductionOnBill: decimal("0.00"),
    itemShareBp: 10000,
    billComped: decimal("0.00"),
    billLimit: { maxAmount: decimal("40.00"), approverRoles: ["manager", "admin"] },
    ...overrides,
  };
}

function cancel(overrides: Partial<CancelRequest> = {}): CancelRequest {
  return { actorRole: "staff", note: null, stage: "held", ...overrides };
}

const BY_REASON = {
  kind: "needs_approval",
  approval: { by: "reason", roles: ["manager", "admin"] },
} as const;

describe("evaluateComp", () => {
  it("Ana, staff, asks for one €25 Chuletón free: someone on Who can approve it", () => {
    expect(evaluateComp(COMPLAINT, comp({ actorRole: "staff" }))).toEqual(BY_REASON);
  });

  it("Luis, supervisor, €25 within €30 goes straight through", () => {
    expect(evaluateComp(COMPLAINT, comp())).toEqual({ kind: "allowed" });
  });

  it("Luis, €50 past €30 and the bill's €40: someone on Who can approve past it", () => {
    expect(evaluateComp(COMPLAINT, comp({ reduction: decimal("50.00") }))).toEqual({
      kind: "needs_approval",
      approval: { by: "bill_limit", roles: ["manager", "admin"], limit: decimal("40.00") },
    });
  });

  it("Marta, manager, €50: on both approval lists, straight through", () => {
    expect(
      evaluateComp(COMPLAINT, comp({ actorRole: "manager", reduction: decimal("50.00") })),
    ).toEqual({ kind: "allowed" });
  });

  it("someone on Who can approve it but not Who can apply it goes straight through", () => {
    const reason = {
      ...COMPLAINT,
      applyRoles: ["staff" as const],
      approverRoles: ["manager" as const],
    };
    expect(evaluateComp(reason, comp({ actorRole: "manager" }))).toEqual({ kind: "allowed" });
    expect(evaluateComp(reason, comp({ actorRole: "supervisor" }))).toEqual({
      kind: "needs_approval",
      approval: { by: "reason", roles: ["manager"] },
    });
  });

  it("past the item limit asks the reason's approver, never refuses", () => {
    const halves = { ...COMPLAINT, maxPercentBp: 5000 };
    const small = { reduction: decimal("5.00") };
    expect(evaluateComp(halves, comp({ ...small, itemShareBp: 5001 }))).toEqual(BY_REASON);
    expect(evaluateComp(halves, comp({ ...small, itemShareBp: 5000 }))).toEqual({
      kind: "allowed",
    });
  });

  it("past the reason's bill amount asks, never refuses", () => {
    const prior = { priorReductionOnBill: decimal("20.00") };
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
    ).toEqual({
      kind: "needs_approval",
      approval: { by: "bill_limit", roles: ["manager", "admin"], limit: decimal("40.00") },
    });
  });

  it("past the bill's comp limit, staff need the bill list even when the reason asks too", () => {
    expect(
      evaluateComp(COMPLAINT, comp({ actorRole: "staff", reduction: decimal("50.00") })),
    ).toEqual({
      kind: "needs_approval",
      approval: { by: "bill_limit", roles: ["manager", "admin"], limit: decimal("40.00") },
    });
  });

  it("past the bill's comp limit, the reason's approver still needs the bill list", () => {
    const reason = { ...COMPLAINT, approverRoles: ["supervisor" as const, "manager" as const] };
    expect(evaluateComp(reason, comp({ reduction: decimal("50.00") }))).toEqual({
      kind: "needs_approval",
      approval: { by: "bill_limit", roles: ["manager", "admin"], limit: decimal("40.00") },
    });
  });

  it("past the bill's comp limit, someone on the bill list alone goes straight through", () => {
    const reason = {
      ...COMPLAINT,
      applyRoles: ["admin" as const],
      approverRoles: ["admin" as const],
    };
    const request = comp({
      actorRole: "manager",
      reduction: decimal("50.00"),
      billLimit: { maxAmount: decimal("40.00"), approverRoles: ["manager"] },
    });
    expect(evaluateComp(reason, request)).toEqual({ kind: "allowed" });
  });

  it("a bill comp limit of none never asks", () => {
    expect(
      evaluateComp(
        { ...COMPLAINT, maxAmount: null },
        comp({
          reduction: decimal("1000.00"),
          billComped: decimal("5000.00"),
          billLimit: { maxAmount: null, approverRoles: ["admin"] },
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

  it("a missing required note is refused before any approval is asked", () => {
    const noted = { ...COMPLAINT, noteRequired: true };
    const past = { actorRole: "staff" as const, reduction: decimal("50.00") };
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

  it("a switched-off reason is refused", () => {
    expect(
      evaluateComp({ ...COMPLAINT, active: false }, comp({ action: "discount_amount" })),
    ).toEqual({ kind: "refused", code: "adjustment.reason_inactive" });
  });

  it.each<[string, Partial<CompRequest>]>([
    ["a negative reduction", { reduction: decimal("-1.00") }],
    ["a negative prior reduction on the bill", { priorReductionOnBill: decimal("-0.01") }],
    ["a negative bill comp total", { billComped: decimal("-0.01") }],
    ["a negative item share", { itemShareBp: -1 }],
    ["a fractional item share", { itemShareBp: 12.5 }],
  ])("throws on %s, which is a caller's bug and not a verdict", (_case, overrides) => {
    expect(() => evaluateComp(COMPLAINT, comp(overrides))).toThrow(RangeError);
    expect(() => evaluateComp({ ...COMPLAINT, active: false }, comp(overrides))).toThrow(
      RangeError,
    );
  });
});

describe("evaluateCancel", () => {
  it("staff cancel a held or unsent dish with nobody's PIN", () => {
    expect(evaluateCancel(MISTAKE, cancel({ stage: "held" }))).toEqual({ kind: "allowed" });
    expect(evaluateCancel(MISTAKE, cancel({ stage: "unsent" }))).toEqual({ kind: "allowed" });
  });

  it("staff cancelling a fired or served dish need the refund permission", () => {
    const refund = { kind: "needs_approval", approval: { by: "refund" } };
    expect(evaluateCancel(MISTAKE, cancel({ stage: "fired" }))).toEqual(refund);
    expect(evaluateCancel(MISTAKE, cancel({ stage: "served" }))).toEqual(refund);
  });

  it("a supervisor cancels a fired dish alone", () => {
    for (const actorRole of ["supervisor", "manager", "admin"] as const) {
      expect(evaluateCancel(MISTAKE, cancel({ actorRole, stage: "fired" }))).toEqual({
        kind: "allowed",
      });
    }
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

  it("a switched-off Void reason is refused", () => {
    expect(evaluateCancel({ ...MISTAKE, active: false }, cancel())).toEqual({
      kind: "refused",
      code: "adjustment.reason_inactive",
    });
  });
});

describe("approves", () => {
  it("a refund approval accepts supervisor, manager and admin and refuses staff", () => {
    const refund: Approval = { by: "refund" };
    expect(approves(refund, "staff")).toBe(false);
    expect(approves(refund, "supervisor")).toBe(true);
    expect(approves(refund, "manager")).toBe(true);
    expect(approves(refund, "admin")).toBe(true);
  });

  it("a list accepts exactly its members", () => {
    const reason: Approval = { by: "reason", roles: ["supervisor", "admin"] };
    expect(approves(reason, "staff")).toBe(false);
    expect(approves(reason, "supervisor")).toBe(true);
    expect(approves(reason, "manager")).toBe(false);
    expect(approves(reason, "admin")).toBe(true);
    const bill: Approval = { by: "bill_limit", roles: ["manager"], limit: decimal("40.00") };
    expect(approves(bill, "admin")).toBe(false);
    expect(approves(bill, "manager")).toBe(true);
  });
});

describe("policySnapshotOf", () => {
  it("keeps the evaluated policy and nothing that names or orders the reason", () => {
    expect(policySnapshotOf({ ...COMPLAINT, maxPercentBp: 5000, noteRequired: true })).toEqual({
      kind: "comp",
      actions: ["comp", "discount_percent"],
      maxPercentBp: 5000,
      maxAmount: "30.00",
      applyRoles: ["supervisor", "manager", "admin"],
      approverRoles: ["manager", "admin"],
      noteRequired: true,
    });
  });

  it("copies the actions and both role lists, so a later edit of the reason cannot reach it", () => {
    const reason = {
      ...COMPLAINT,
      actions: [...COMPLAINT.actions],
      applyRoles: [...COMPLAINT.applyRoles],
      approverRoles: [...COMPLAINT.approverRoles],
    };
    const snapshot = policySnapshotOf(reason);
    reason.actions.push("discount_amount");
    reason.applyRoles.push("staff");
    reason.approverRoles.push("supervisor");
    expect(snapshot.actions).toEqual(["comp", "discount_percent"]);
    expect(snapshot.applyRoles).toEqual(["supervisor", "manager", "admin"]);
    expect(snapshot.approverRoles).toEqual(["manager", "admin"]);
    expect(policySnapshotOf({ ...COMPLAINT, maxAmount: null }).maxAmount).toBeNull();
  });
});
